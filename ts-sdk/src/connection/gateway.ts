/**
 * Gateway connection for MAP protocol federation
 *
 * Used by gateways to connect two MAP systems together,
 * routing messages between them.
 */

import type { Stream } from '../stream';
import { BaseConnection, type BaseConnectionOptions, type ConnectionState } from './base';
import { withRetry, type RetryPolicy, DEFAULT_RETRY_POLICY } from '../utils';
import {
  CORE_METHODS,
  FEDERATION_METHODS,
  PROTOCOL_VERSION,
  type ParticipantCapabilities,
  type SessionId,
  type Message,
  type ConnectRequestParams,
  type ConnectResponseResult,
  type DisconnectResponseResult,
  type FederationAuth,
  type FederationConnectRequestParams,
  type FederationConnectResponseResult,
  type FederationRouteRequestParams,
  type FederationRouteResponseResult,
  type FederationRoutingConfig,
  type FederationBufferConfig,
  type FederationEnvelope,
  type ReplayRequestParams,
  type ReplayResponseResult,
  type EventType,
} from '../types';
import { createFederationEnvelope } from '../federation/envelope';
import { FederationOutageBuffer } from '../federation/buffer';

/**
 * Options for automatic gateway reconnection
 */
export interface GatewayReconnectionOptions {
  /** Enable automatic reconnection (default: false) */
  enabled: boolean;
  /** Maximum number of retry attempts (default: 10) */
  maxRetries?: number;
  /** Initial delay in milliseconds (default: 1000) */
  baseDelayMs?: number;
  /** Maximum delay in milliseconds (default: 30000) */
  maxDelayMs?: number;
  /** Add jitter to delays (default: true) */
  jitter?: boolean;
}

/**
 * Options for event replay on gateway reconnection
 */
export interface GatewayReplayOptions {
  /** Enable replay on reconnection (default: false) */
  enabled: boolean;
  /** Event types to replay (default: all) */
  eventTypes?: EventType[];
  /** Maximum events to replay per peer (default: 1000) */
  maxEvents?: number;
  /** Maximum age of events to replay in ms (default: 1 hour) */
  maxAgeMs?: number;
}

/**
 * Reconnection event types for gateway
 */
export type GatewayReconnectionEventType =
  | 'disconnected'
  | 'reconnecting'
  | 'reconnected'
  | 'reconnectFailed'
  | 'bufferOverflow'
  | 'bufferDrained'
  | 'replayStarted'
  | 'replayCompleted';

/**
 * Handler for gateway reconnection events
 */
export type GatewayReconnectionEventHandler = (event: {
  type: GatewayReconnectionEventType;
  attempt?: number;
  delay?: number;
  error?: Error;
  peerId?: string;
  messagesBuffered?: number;
  messagesDrained?: number;
  eventsReplayed?: number;
}) => void;

/**
 * Options for gateway connection
 */
export interface GatewayConnectionOptions extends BaseConnectionOptions {
  /** Gateway name */
  name?: string;
  /** Gateway capabilities */
  capabilities?: ParticipantCapabilities;
  /** Federation routing configuration */
  routing?: FederationRoutingConfig;
  /** Factory to create new stream for reconnection */
  createStream?: () => Promise<Stream>;
  /** Reconnection options */
  reconnection?: GatewayReconnectionOptions;
  /** Outage buffer configuration */
  buffer?: FederationBufferConfig;
  /** Replay options for reconnection */
  replay?: GatewayReplayOptions;
}

/**
 * Gateway connection for MAP federation.
 *
 * Provides methods for:
 * - Connecting to peer MAP systems
 * - Routing messages between systems
 * - Automatic reconnection with message buffering
 */
export class GatewayConnection {
  #connection: BaseConnection;
  readonly #options: GatewayConnectionOptions;
  readonly #connectedSystems: Map<string, { name?: string; version?: string }> = new Map();
  readonly #reconnectionHandlers: Set<GatewayReconnectionEventHandler> = new Set();
  readonly #outageBuffer: FederationOutageBuffer | null;
  readonly #lastSyncTimestamps: Map<string, number> = new Map();

  #sessionId: SessionId | null = null;
  #serverCapabilities: ParticipantCapabilities | null = null;
  #connected = false;
  #isReconnecting = false;
  #lastConnectOptions?: {
    auth?: { method: 'bearer' | 'api-key' | 'mtls' | 'none'; token?: string };
  };

  constructor(stream: Stream, options: GatewayConnectionOptions = {}) {
    this.#connection = new BaseConnection(stream, options);
    this.#options = options;

    // Initialize outage buffer if configured
    this.#outageBuffer = options.buffer?.enabled
      ? new FederationOutageBuffer(options.buffer)
      : null;

    // Set up disconnect detection for auto-reconnect
    if (options.reconnection?.enabled && options.createStream) {
      this.#connection.onStateChange((newState) => {
        if (newState === 'closed' && this.#connected && !this.#isReconnecting) {
          void this.#handleDisconnect();
        }
      });
    }
  }

  // ===========================================================================
  // Connection Lifecycle
  // ===========================================================================

  /**
   * Connect to the local MAP system
   */
  async connect(options?: {
    auth?: { method: 'bearer' | 'api-key' | 'mtls' | 'none'; token?: string };
  }): Promise<ConnectResponseResult> {
    const params: ConnectRequestParams = {
      protocolVersion: PROTOCOL_VERSION,
      participantType: 'gateway',
      name: this.#options.name,
      capabilities: this.#options.capabilities,
      auth: options?.auth,
    };

    const result = await this.#connection.sendRequest<
      ConnectRequestParams,
      ConnectResponseResult
    >(CORE_METHODS.CONNECT, params);

    this.#sessionId = result.sessionId;
    this.#serverCapabilities = result.capabilities;
    this.#connected = true;

    // Transition to connected state
    this.#connection._transitionTo('connected');

    // Store connect options for potential reconnection
    this.#lastConnectOptions = options;

    return result;
  }

  /**
   * Disconnect from the local MAP system
   */
  async disconnect(reason?: string): Promise<void> {
    if (!this.#connected) return;

    try {
      await this.#connection.sendRequest<{ reason?: string }, DisconnectResponseResult>(
        CORE_METHODS.DISCONNECT,
        reason ? { reason } : undefined
      );
    } finally {
      await this.#connection.close();
      this.#connected = false;
    }
  }

  /**
   * Whether the gateway is connected to the local system
   */
  get isConnected(): boolean {
    return this.#connected && !this.#connection.isClosed;
  }

  /**
   * Current session ID
   */
  get sessionId(): SessionId | null {
    return this.#sessionId;
  }

  /**
   * Server capabilities
   */
  get serverCapabilities(): ParticipantCapabilities | null {
    return this.#serverCapabilities;
  }

  /**
   * List of connected remote systems
   */
  get connectedSystems(): Map<string, { name?: string; version?: string }> {
    return new Map(this.#connectedSystems);
  }

  /**
   * AbortSignal that triggers when the connection closes
   */
  get signal(): AbortSignal {
    return this.#connection.signal;
  }

  /**
   * Promise that resolves when the connection closes
   */
  get closed(): Promise<void> {
    return this.#connection.closed;
  }

  // ===========================================================================
  // Federation
  // ===========================================================================

  /**
   * Connect to a remote MAP system.
   *
   * Supports single-request authentication: if `auth` is provided,
   * credentials are sent in the initial connect request for 1-RTT auth.
   * If the server responds with `authRequired`, the client can retry
   * with appropriate credentials.
   */
  async connectToSystem(
    systemId: string,
    endpoint: string,
    options?: {
      auth?: FederationAuth;
      authContext?: { source: "well-known" | "cached" | "configured"; challenge?: string };
    }
  ): Promise<FederationConnectResponseResult> {
    const params: FederationConnectRequestParams = {
      systemId,
      endpoint,
      auth: options?.auth,
      authContext: options?.authContext,
    };

    const result = await this.#connection.sendRequest<
      FederationConnectRequestParams,
      FederationConnectResponseResult
    >(FEDERATION_METHODS.FEDERATION_CONNECT, params);

    // Only track as connected if auth succeeded or wasn't required
    if (result.connected && result.systemInfo) {
      this.#connectedSystems.set(systemId, {
        name: result.systemInfo.name,
        version: result.systemInfo.version,
      });
    }

    return result;
  }

  /**
   * Route a message to a remote system.
   *
   * If routing config is provided, wraps the message in a federation envelope
   * with proper metadata for multi-hop routing. Otherwise, sends raw message
   * for backwards compatibility.
   *
   * During reconnection, messages are buffered if buffer is configured.
   */
  async routeToSystem(
    systemId: string,
    message: Message
  ): Promise<FederationRouteResponseResult> {
    // Create envelope if routing config available
    let envelope: FederationEnvelope<Message> | undefined;
    if (this.#options.routing) {
      envelope = createFederationEnvelope(
        message,
        this.#options.routing.systemId,
        systemId,
        {
          maxHops: this.#options.routing.maxHops,
          trackPath: this.#options.routing.trackPath,
        }
      );
    }

    // If reconnecting and buffer is available, buffer the message
    if (this.#isReconnecting && this.#outageBuffer && envelope) {
      const buffered = this.#outageBuffer.enqueue(systemId, envelope);
      if (!buffered) {
        this.#emitReconnectionEvent({
          type: 'bufferOverflow',
          peerId: systemId,
          messagesBuffered: this.#outageBuffer.count(systemId),
        });
      }
      // Return a "pending" response - message will be sent on reconnect
      return { routed: false };
    }

    const params: FederationRouteRequestParams = { systemId };
    if (envelope) {
      params.envelope = envelope;
    } else {
      // Legacy: send raw message for backwards compatibility
      params.message = message;
    }

    const result = await this.#connection.sendRequest<
      FederationRouteRequestParams,
      FederationRouteResponseResult
    >(FEDERATION_METHODS.FEDERATION_ROUTE, params);

    // Update sync timestamp on successful route
    if (result.routed) {
      this.#lastSyncTimestamps.set(systemId, Date.now());
    }

    return result;
  }

  /**
   * Check if a remote system is connected
   */
  isSystemConnected(systemId: string): boolean {
    return this.#connectedSystems.has(systemId);
  }

  // ===========================================================================
  // Reconnection
  // ===========================================================================

  /**
   * Current connection state
   */
  get state(): ConnectionState {
    return this.#connection.state;
  }

  /**
   * Whether the connection is currently reconnecting
   */
  get isReconnecting(): boolean {
    return this.#isReconnecting;
  }

  /**
   * Get the outage buffer (for advanced use)
   */
  get outageBuffer(): FederationOutageBuffer | null {
    return this.#outageBuffer;
  }

  /**
   * Get last sync timestamp for a peer
   */
  getLastSyncTimestamp(peerId: string): number | undefined {
    return this.#lastSyncTimestamps.get(peerId);
  }

  /**
   * Register a handler for reconnection events.
   *
   * @param handler - Function called when reconnection events occur
   * @returns Unsubscribe function to remove the handler
   */
  onReconnection(handler: GatewayReconnectionEventHandler): () => void {
    this.#reconnectionHandlers.add(handler);
    return () => this.#reconnectionHandlers.delete(handler);
  }

  /**
   * Register a handler for connection state changes.
   *
   * @param handler - Function called when state changes
   * @returns Unsubscribe function to remove the handler
   */
  onStateChange(
    handler: (newState: ConnectionState, oldState: ConnectionState) => void
  ): () => void {
    return this.#connection.onStateChange(handler);
  }

  // ===========================================================================
  // Internal
  // ===========================================================================

  /**
   * Emit a reconnection event to all registered handlers
   */
  #emitReconnectionEvent(event: Parameters<GatewayReconnectionEventHandler>[0]): void {
    for (const handler of this.#reconnectionHandlers) {
      try {
        handler(event);
      } catch (error) {
        console.error('MAP: Gateway reconnection event handler error:', error);
      }
    }
  }

  /**
   * Handle disconnect when auto-reconnect is enabled
   */
  async #handleDisconnect(): Promise<void> {
    this.#isReconnecting = true;
    this.#connected = false;

    this.#emitReconnectionEvent({ type: 'disconnected' });

    try {
      await this.#attemptReconnect();
    } catch (error) {
      this.#isReconnecting = false;
      this.#emitReconnectionEvent({
        type: 'reconnectFailed',
        error: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }

  /**
   * Attempt to reconnect with retry logic
   */
  async #attemptReconnect(): Promise<void> {
    const options = this.#options.reconnection!;
    const createStream = this.#options.createStream!;

    const retryPolicy: RetryPolicy = {
      maxRetries: options.maxRetries ?? DEFAULT_RETRY_POLICY.maxRetries,
      baseDelayMs: options.baseDelayMs ?? DEFAULT_RETRY_POLICY.baseDelayMs,
      maxDelayMs: options.maxDelayMs ?? DEFAULT_RETRY_POLICY.maxDelayMs,
      jitter: options.jitter ?? DEFAULT_RETRY_POLICY.jitter,
    };

    await withRetry(
      async () => {
        // Create a new stream
        const newStream = await createStream();

        // Reconnect the base connection
        await this.#connection.reconnect(newStream);

        // Re-authenticate
        const connectResult = await this.connect(this.#lastConnectOptions);

        // Update stored values
        this.#sessionId = connectResult.sessionId;
        this.#serverCapabilities = connectResult.capabilities;
      },
      retryPolicy,
      {
        onRetry: (state) => {
          this.#emitReconnectionEvent({
            type: 'reconnecting',
            attempt: state.attempt,
            delay: state.nextDelayMs,
            error: state.lastError,
          });
        },
      }
    );

    this.#isReconnecting = false;
    this.#emitReconnectionEvent({ type: 'reconnected' });

    // Drain buffered messages immediately on reconnect
    await this.#drainBufferedMessages();

    // Replay missed events from peers
    await this.#replayFromPeers();
  }

  /**
   * Drain buffered messages after reconnection
   */
  async #drainBufferedMessages(): Promise<void> {
    if (!this.#outageBuffer) return;

    const peers = this.#outageBuffer.peers();
    for (const peerId of peers) {
      const messages = this.#outageBuffer.drain(peerId);
      if (messages.length === 0) continue;

      // Send each buffered message
      for (const envelope of messages) {
        try {
          const params: FederationRouteRequestParams = {
            systemId: peerId,
            envelope,
          };

          await this.#connection.sendRequest<
            FederationRouteRequestParams,
            FederationRouteResponseResult
          >(FEDERATION_METHODS.FEDERATION_ROUTE, params);
        } catch (error) {
          // Log but continue draining - we don't want to lose other messages
          console.warn('MAP: Failed to send buffered message to', peerId, error);
        }
      }

      this.#emitReconnectionEvent({
        type: 'bufferDrained',
        peerId,
        messagesDrained: messages.length,
      });
    }
  }

  /**
   * Replay missed events from peers after reconnection
   */
  async #replayFromPeers(): Promise<void> {
    const replayOptions = this.#options.replay;
    if (!replayOptions?.enabled) return;

    // Get peers that have sync timestamps (peers we've communicated with)
    const peersToReplay = Array.from(this.#lastSyncTimestamps.entries());
    if (peersToReplay.length === 0) return;

    for (const [peerId, lastSync] of peersToReplay) {
      try {
        await this.#replayFromPeer(peerId, lastSync);
      } catch (error) {
        // Log but continue with other peers
        console.warn('MAP: Failed to replay events from peer', peerId, error);
      }
    }
  }

  /**
   * Replay missed events from a single peer
   */
  async #replayFromPeer(peerId: string, lastSyncTimestamp: number): Promise<void> {
    const replayOptions = this.#options.replay!;

    // Check max age
    const maxAge = replayOptions.maxAgeMs ?? 60 * 60 * 1000; // 1 hour default
    const cutoff = Date.now() - maxAge;
    if (lastSyncTimestamp < cutoff) {
      // Too old, skip replay for this peer
      return;
    }

    this.#emitReconnectionEvent({ type: 'replayStarted', peerId });

    let totalReplayed = 0;
    const maxEvents = replayOptions.maxEvents ?? 1000;
    let afterEventId: string | undefined;
    let hasMore = true;

    // Paginate through replay results
    while (hasMore && totalReplayed < maxEvents) {
      const params: ReplayRequestParams = {
        limit: Math.min(100, maxEvents - totalReplayed),
      };

      // Use eventId for pagination, or timestamp for first request
      if (afterEventId) {
        params.afterEventId = afterEventId;
      } else {
        params.fromTimestamp = lastSyncTimestamp;
      }

      // Filter by event types if specified
      if (replayOptions.eventTypes) {
        params.filter = { eventTypes: replayOptions.eventTypes };
      }

      const result = await this.#connection.sendRequest<
        ReplayRequestParams,
        ReplayResponseResult
      >(CORE_METHODS.REPLAY, params);

      totalReplayed += result.events.length;
      hasMore = result.hasMore;
      afterEventId = result.events.at(-1)?.eventId;

      // Safety: break if no events returned
      if (result.events.length === 0) {
        break;
      }

      // Update sync timestamp to latest replayed event
      const lastEvent = result.events.at(-1);
      if (lastEvent) {
        this.#lastSyncTimestamps.set(peerId, lastEvent.timestamp);
      }
    }

    this.#emitReconnectionEvent({
      type: 'replayCompleted',
      peerId,
      eventsReplayed: totalReplayed,
    });
  }
}
