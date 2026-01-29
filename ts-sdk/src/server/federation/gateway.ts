/**
 * FederationGateway implementation
 *
 * Manages connections between MAP systems for federation.
 */

import type {
  FederationGateway,
  FederationGatewayOptions,
  PeerConnection,
  PeerMessageHandler,
  ServerFederationEnvelope,
  OutageBuffer,
} from "../types";
import { OutageBufferImpl } from "./buffer";

/**
 * Default maximum hops for loop prevention.
 */
const DEFAULT_MAX_HOPS = 5;

/**
 * Error thrown when routing would exceed max hops.
 */
export class MaxHopsExceededError extends Error {
  constructor(systemId: string, maxHops: number) {
    super(`Max hops (${maxHops}) exceeded routing to ${systemId}`);
    this.name = "MaxHopsExceededError";
  }
}

/**
 * Error thrown when routing would create a loop.
 */
export class RoutingLoopError extends Error {
  constructor(systemId: string, path: string[]) {
    super(`Routing loop detected: ${path.join(" -> ")} -> ${systemId}`);
    this.name = "RoutingLoopError";
  }
}

/**
 * Error thrown when peer is not found.
 */
export class PeerNotFoundError extends Error {
  constructor(systemId: string) {
    super(`Peer not found: ${systemId}`);
    this.name = "PeerNotFoundError";
  }
}

/**
 * Transport interface for peer communication.
 *
 * Implement this for different transport mechanisms (WebSocket, HTTP, etc.)
 */
export interface PeerTransport {
  /** Send message to peer */
  send(envelope: ServerFederationEnvelope): Promise<void>;
  /** Close the transport */
  close(): void;
}

/**
 * Internal peer state with transport.
 */
interface PeerState {
  connection: PeerConnection;
  transport?: PeerTransport;
}

/**
 * FederationGateway implementation.
 *
 * Manages peer connections and message routing between federated MAP systems.
 *
 * @example
 * ```typescript
 * const gateway = new FederationGatewayImpl({
 *   systemId: "system-a",
 *   buffer: { maxMessages: 1000 },
 * });
 *
 * // Connect to peer
 * await gateway.connectPeer({
 *   systemId: "system-b",
 *   endpoint: "wss://system-b.example.com/map",
 * });
 *
 * // Handle incoming messages
 * gateway.onPeerMessage((from, envelope) => {
 *   console.log("Message from", from, envelope);
 * });
 *
 * // Route message to peer
 * await gateway.routeToPeer("system-b", {
 *   payload: { type: "event", data: {} },
 *   routing: { from: "system-a", to: "system-b", hops: [], maxHops: 5 },
 *   timestamp: Date.now(),
 * });
 * ```
 */
export class FederationGatewayImpl implements FederationGateway {
  readonly systemId: string;
  readonly buffer: OutageBuffer;

  private readonly peers: Map<string, PeerState> = new Map();
  private readonly messageHandlers: Set<PeerMessageHandler> = new Set();
  private readonly maxHops: number;

  constructor(options: FederationGatewayOptions) {
    this.systemId = options.systemId;
    this.buffer = new OutageBufferImpl(options.buffer);
    this.maxHops = DEFAULT_MAX_HOPS;
  }

  /**
   * Connect to a peer system.
   *
   * This is a placeholder that creates the peer entry.
   * In production, this would establish the actual transport connection.
   */
  async connectPeer(params: {
    systemId: string;
    endpoint: string;
    credentials?: unknown;
    transport?: PeerTransport;
  }): Promise<PeerConnection> {
    // Check if already connected
    const existing = this.peers.get(params.systemId);
    if (existing?.connection.status === "connected") {
      return existing.connection;
    }

    // Create peer connection
    const connection: PeerConnection = {
      systemId: params.systemId,
      endpoint: params.endpoint,
      status: "connecting",
    };

    this.peers.set(params.systemId, {
      connection,
      transport: params.transport,
    });

    // Mark as connected (in real impl, this happens after transport handshake)
    connection.status = "connected";
    connection.connectedAt = Date.now();
    connection.lastActivity = Date.now();

    // Flush any buffered messages
    const buffered = this.buffer.flush(params.systemId);
    if (buffered.length > 0 && params.transport) {
      for (const envelope of buffered) {
        await params.transport.send(envelope);
      }
    }

    return connection;
  }

  /**
   * Route message to a peer system.
   *
   * If peer is connected, sends immediately.
   * If peer is disconnected, buffers for later delivery.
   * Validates hop count and loop detection before routing.
   */
  async routeToPeer(
    systemId: string,
    envelope: ServerFederationEnvelope
  ): Promise<void> {
    // Validate routing
    this.validateRouting(systemId, envelope);

    // Add this system to hops
    const updatedEnvelope: ServerFederationEnvelope = {
      ...envelope,
      routing: {
        ...envelope.routing,
        hops: [...envelope.routing.hops, this.systemId],
      },
    };

    const peer = this.peers.get(systemId);

    if (!peer || peer.connection.status !== "connected") {
      // Buffer for later
      this.buffer.add(systemId, updatedEnvelope);
      return;
    }

    // Send via transport
    if (peer.transport) {
      await peer.transport.send(updatedEnvelope);
      peer.connection.lastActivity = Date.now();
    } else {
      // No transport, buffer instead
      this.buffer.add(systemId, updatedEnvelope);
    }
  }

  /**
   * Register handler for incoming peer messages.
   */
  onPeerMessage(handler: PeerMessageHandler): void {
    this.messageHandlers.add(handler);
  }

  /**
   * Remove a peer message handler.
   */
  offPeerMessage(handler: PeerMessageHandler): void {
    this.messageHandlers.delete(handler);
  }

  /**
   * Handle an incoming message from a peer.
   *
   * This should be called by the transport when a message arrives.
   */
  handleIncomingMessage(
    from: string,
    envelope: ServerFederationEnvelope
  ): void {
    // Update peer activity
    const peer = this.peers.get(from);
    if (peer) {
      peer.connection.lastActivity = Date.now();
    }

    // Notify handlers
    for (const handler of this.messageHandlers) {
      try {
        handler(from, envelope);
      } catch (error) {
        console.error("FederationGateway message handler error:", error);
      }
    }
  }

  /**
   * List all peer connections.
   */
  listPeers(): PeerConnection[] {
    return Array.from(this.peers.values()).map((p) => p.connection);
  }

  /**
   * Get a specific peer connection.
   */
  getPeer(systemId: string): PeerConnection | undefined {
    return this.peers.get(systemId)?.connection;
  }

  /**
   * Disconnect from a peer system.
   */
  disconnectPeer(systemId: string): void {
    const peer = this.peers.get(systemId);
    if (!peer) {
      return;
    }

    // Close transport if exists
    if (peer.transport) {
      peer.transport.close();
    }

    // Mark as disconnected
    peer.connection.status = "disconnected";
    this.peers.delete(systemId);
  }

  /**
   * Mark a peer as disconnected (e.g., on connection drop).
   *
   * The peer entry is kept for potential reconnection,
   * and messages will be buffered.
   */
  markPeerDisconnected(systemId: string): void {
    const peer = this.peers.get(systemId);
    if (peer) {
      peer.connection.status = "disconnected";
      peer.transport = undefined;
    }
  }

  /**
   * Validate routing before sending.
   *
   * Throws if max hops exceeded or loop detected.
   */
  private validateRouting(
    targetSystem: string,
    envelope: ServerFederationEnvelope
  ): void {
    const hops = envelope.routing.hops;
    const maxHops = envelope.routing.maxHops ?? this.maxHops;

    // Check hop count (current hops + 1 for this hop)
    if (hops.length >= maxHops) {
      throw new MaxHopsExceededError(targetSystem, maxHops);
    }

    // Check for loop (target already in path)
    if (hops.includes(targetSystem)) {
      throw new RoutingLoopError(targetSystem, hops);
    }

    // Check if we've already been in the path
    if (hops.includes(this.systemId)) {
      throw new RoutingLoopError(this.systemId, hops);
    }
  }

  /**
   * Create an envelope for sending.
   */
  createEnvelope(
    to: string,
    payload: unknown,
    maxHops?: number
  ): ServerFederationEnvelope {
    return {
      payload,
      routing: {
        from: this.systemId,
        to,
        hops: [],
        maxHops: maxHops ?? this.maxHops,
      },
      timestamp: Date.now(),
    };
  }
}
