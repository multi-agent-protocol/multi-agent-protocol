/**
 * Gateway connection for MAP protocol federation
 *
 * Used by gateways to connect two MAP systems together,
 * routing messages between them.
 */

import type { Stream } from '../stream';
import { BaseConnection, type BaseConnectionOptions } from './base';
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
  type FederationConnectRequestParams,
  type FederationConnectResponseResult,
  type FederationRouteRequestParams,
  type FederationRouteResponseResult,
} from '../types';

/**
 * Options for gateway connection
 */
export interface GatewayConnectionOptions extends BaseConnectionOptions {
  /** Gateway name */
  name?: string;
  /** Gateway capabilities */
  capabilities?: ParticipantCapabilities;
}

/**
 * Gateway connection for MAP federation.
 *
 * Provides methods for:
 * - Connecting to peer MAP systems
 * - Routing messages between systems
 */
export class GatewayConnection {
  readonly #connection: BaseConnection;
  readonly #options: GatewayConnectionOptions;
  readonly #connectedSystems: Map<string, { name?: string; version?: string }> = new Map();

  #sessionId: SessionId | null = null;
  #serverCapabilities: ParticipantCapabilities | null = null;
  #connected = false;

  constructor(stream: Stream, options: GatewayConnectionOptions = {}) {
    this.#connection = new BaseConnection(stream, options);
    this.#options = options;
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
   * Connect to a remote MAP system
   */
  async connectToSystem(
    systemId: string,
    endpoint: string,
    auth?: { method: 'bearer' | 'api-key' | 'mtls'; credentials?: string }
  ): Promise<FederationConnectResponseResult> {
    const params: FederationConnectRequestParams = {
      systemId,
      endpoint,
      auth,
    };

    const result = await this.#connection.sendRequest<
      FederationConnectRequestParams,
      FederationConnectResponseResult
    >(FEDERATION_METHODS.FEDERATION_CONNECT, params);

    if (result.connected && result.systemInfo) {
      this.#connectedSystems.set(systemId, {
        name: result.systemInfo.name,
        version: result.systemInfo.version,
      });
    }

    return result;
  }

  /**
   * Route a message to a remote system
   */
  async routeToSystem(
    systemId: string,
    message: Message
  ): Promise<FederationRouteResponseResult> {
    const params: FederationRouteRequestParams = {
      systemId,
      message,
    };

    return this.#connection.sendRequest<
      FederationRouteRequestParams,
      FederationRouteResponseResult
    >(FEDERATION_METHODS.FEDERATION_ROUTE, params);
  }

  /**
   * Check if a remote system is connected
   */
  isSystemConnected(systemId: string): boolean {
    return this.#connectedSystems.has(systemId);
  }
}
