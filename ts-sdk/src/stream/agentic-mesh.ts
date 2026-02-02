/**
 * Agentic-Mesh Stream Adapter
 *
 * Wraps agentic-mesh's TunnelStream as a MAP SDK Stream interface.
 * This enables MAP clients/agents to communicate over encrypted mesh
 * networks (Nebula, Tailscale, Headscale).
 *
 * @module
 */

import type { Stream, AnyMessage } from './index';
import { TunnelStream, type TransportAdapter } from 'agentic-mesh';

/**
 * Peer endpoint for mesh connection.
 * Re-exported from agentic-mesh for convenience.
 */
export interface MeshPeerEndpoint {
  /** Peer identifier */
  peerId: string;
  /** Transport-specific address (IP, URL, etc.) */
  address: string;
  /** Optional port (for TCP-based transports) */
  port?: number;
  /** Additional transport-specific metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Transport adapter interface (subset used by this module).
 * Full interface is defined in agentic-mesh.
 */
export interface MeshTransportAdapter {
  /** Whether the transport is currently active */
  readonly active: boolean;
  /** Start the transport */
  start(): Promise<void>;
  /** Connect to a peer endpoint */
  connect(endpoint: MeshPeerEndpoint): Promise<boolean>;
  /** Check if connected to a peer */
  isConnected(peerId: string): boolean;
}

/**
 * Configuration for agentic-mesh stream.
 */
export interface AgenticMeshStreamConfig {
  /**
   * The agentic-mesh transport adapter (Nebula, Tailscale, etc.).
   *
   * Create using agentic-mesh factory functions:
   * - `createNebulaTransport()` for Nebula networks
   * - `createTailscaleTransport()` for Tailscale networks
   */
  transport: MeshTransportAdapter;

  /**
   * Remote peer to connect to.
   */
  peer: MeshPeerEndpoint;

  /**
   * Local peer ID for identification.
   * Used to generate unique stream IDs.
   */
  localPeerId: string;

  /**
   * Connection timeout in milliseconds.
   * @default 10000
   */
  timeout?: number;
}

/**
 * Internal TunnelStream interface (from agentic-mesh).
 * We use a minimal interface to avoid tight coupling.
 */
interface TunnelStreamLike {
  readonly isOpen: boolean;
  open(): Promise<void>;
  close(): Promise<void>;
  write(frame: unknown): Promise<void>;
  [Symbol.asyncIterator](): AsyncIterator<unknown>;
}

/**
 * Creates a MAP Stream over an agentic-mesh tunnel.
 *
 * This wraps agentic-mesh's TunnelStream (NDJSON over encrypted transport)
 * and adapts it to the MAP SDK's Stream interface.
 *
 * Requires `agentic-mesh` to be installed as a peer dependency.
 *
 * @param config - Stream configuration
 * @returns Promise resolving to a connected MAP Stream
 * @throws Error if agentic-mesh is not installed
 * @throws Error if peer connection fails
 *
 * @example
 * ```typescript
 * import { createNebulaTransport } from 'agentic-mesh';
 * import { agenticMeshStream, ClientConnection } from '@multi-agent-protocol/sdk';
 *
 * // Create Nebula transport
 * const transport = createNebulaTransport({
 *   configPath: '/etc/nebula/config.yml',
 * });
 *
 * // Create MAP stream over mesh
 * const stream = await agenticMeshStream({
 *   transport,
 *   peer: { peerId: 'server', address: '10.0.0.1', port: 4242 },
 *   localPeerId: 'my-client',
 * });
 *
 * // Use with MAP client
 * const client = new ClientConnection(stream, { name: 'MeshClient' });
 * await client.connect();
 * ```
 */
export async function agenticMeshStream(
  config: AgenticMeshStreamConfig
): Promise<Stream> {
  // Start transport if not already active
  if (!config.transport.active) {
    await config.transport.start();
  }

  // Connect to peer
  const connected = await config.transport.connect(config.peer);
  if (!connected) {
    throw new Error(`Failed to connect to peer: ${config.peer.peerId}`);
  }

  // Create tunnel stream with unique ID
  const streamId = `map-${config.localPeerId}-${Date.now()}`;
  const tunnelStream = new TunnelStream({
    transport: config.transport as unknown as TransportAdapter,
    peerId: config.peer.peerId,
    streamId,
  });

  // Open the stream
  await tunnelStream.open();

  // Adapt to MAP Stream interface
  return tunnelStreamToMapStream(tunnelStream);
}

/**
 * Adapts a TunnelStream to the MAP SDK Stream interface.
 *
 * The MAP SDK uses Web Streams API (ReadableStream/WritableStream)
 * while TunnelStream uses AsyncIterator pattern.
 *
 * @internal
 */
function tunnelStreamToMapStream(tunnel: TunnelStreamLike): Stream {
  // Track if reading has been aborted (for cleanup)
  let readingAborted = false;

  const readable = new ReadableStream<AnyMessage>({
    async start(controller) {
      try {
        for await (const frame of tunnel) {
          if (readingAborted) break;
          controller.enqueue(frame as AnyMessage);
        }
        if (!readingAborted) {
          controller.close();
        }
      } catch (error) {
        if (!readingAborted) {
          controller.error(error);
        }
      }
    },
    cancel() {
      readingAborted = true;
      tunnel.close().catch(() => {
        // Ignore close errors during cancel
      });
    },
  });

  const writable = new WritableStream<AnyMessage>({
    async write(message) {
      if (!tunnel.isOpen) {
        throw new Error('Stream is not open');
      }
      await tunnel.write(message);
    },
    async close() {
      await tunnel.close();
    },
    abort() {
      readingAborted = true;
      tunnel.close().catch(() => {
        // Ignore close errors during abort
      });
    },
  });

  return { readable, writable };
}
