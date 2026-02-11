/**
 * Client connection for MAP protocol
 *
 * Used by clients to connect to a MAP system, query agents,
 * subscribe to events, and send messages.
 */

import { type Stream, websocketStream, waitForOpen } from '../stream';
import type {
  AgenticMeshStreamConfig,
  MeshPeerEndpoint,
  MeshTransportAdapter,
} from '../stream/agentic-mesh';
import { BaseConnection, type BaseConnectionOptions, type ConnectionState } from './base';
import { Subscription, createSubscription, type EventHandler } from '../subscription';
import { withRetry, type RetryPolicy, DEFAULT_RETRY_POLICY } from '../utils';
import {
  ACPStreamConnection,
  type ACPStreamOptions,
} from '../acp/stream';
import {
  CORE_METHODS,
  OBSERVATION_METHODS,
  STATE_METHODS,
  STEERING_METHODS,
  SESSION_METHODS,
  AUTH_METHODS,
  MAIL_METHODS,
  NOTIFICATION_METHODS,
  PROTOCOL_VERSION,
  type ParticipantCapabilities,
  type SessionId,
  type AgentId,
  type ScopeId,
  type SubscriptionId,
  type Address,
  type Agent,
  type Scope,
  type Message,
  type MessageMeta,
  type SubscriptionFilter,
  type EventNotificationParams,
  type ConnectRequestParams,
  type ConnectResponseResult,
  type DisconnectResponseResult,
  type SessionListResponseResult,
  type SessionLoadResponseResult,
  type SessionCloseResponseResult,
  type AgentsListRequestParams,
  type AgentsListResponseResult,
  type AgentsGetResponseResult,
  type AgentsGetRequestParams,
  type SendRequestParams,
  type SendResponseResult,
  type SubscribeRequestParams,
  type SubscribeResponseResult,
  type UnsubscribeResponseResult,
  type StructureGraphRequestParams,
  type StructureGraphResponseResult,
  type ScopesListRequestParams,
  type ScopesListResponseResult,
  type ScopesGetResponseResult,
  type ScopesMembersRequestParams,
  type ScopesMembersResponseResult,
  type InjectRequestParams,
  type InjectResponseResult,
  type ReplayRequestParams,
  type ReplayResponseResult,
  type ReplayedEvent,
  type SubscriptionAckParams,
  type AuthenticateRequestParams,
  type AuthenticateResponseResult,
  type AuthPrincipal,
  type ConversationId,
  type ThreadId,
  type MailCreateRequestParams,
  type MailCreateResponseResult,
  type MailGetRequestParams,
  type MailGetResponseResult,
  type MailListRequestParams,
  type MailListResponseResult,
  type MailCloseRequestParams,
  type MailCloseResponseResult,
  type MailJoinRequestParams,
  type MailJoinResponseResult,
  type MailLeaveRequestParams,
  type MailLeaveResponseResult,
  type MailInviteRequestParams,
  type MailInviteResponseResult,
  type MailTurnRequestParams,
  type MailTurnResponseResult,
  type MailTurnsListRequestParams,
  type MailTurnsListResponseResult,
  type MailThreadCreateRequestParams,
  type MailThreadCreateResponseResult,
  type MailThreadListRequestParams,
  type MailThreadListResponseResult,
  type MailSummaryRequestParams,
  type MailSummaryResponseResult,
  type MailReplayRequestParams,
  type MailReplayResponseResult,
} from '../types';

/**
 * Options for automatic reconnection
 */
export interface ReconnectionOptions {
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
  /** Restore subscriptions after reconnect (default: true) */
  restoreSubscriptions?: boolean;
  /** Replay missed events on restore (default: true) */
  replayOnRestore?: boolean;
  /** Maximum events to replay per subscription (default: 1000) */
  maxReplayEventsPerSubscription?: number;
}

/**
 * State tracked for subscription restoration
 */
interface SubscriptionState {
  filter?: SubscriptionFilter;
  lastEventId?: string;
  handlers: Set<EventHandler>;
}

/**
 * Reconnection event types
 */
export type ReconnectionEventType =
  | 'disconnected'
  | 'reconnecting'
  | 'reconnected'
  | 'reconnectFailed'
  | 'subscriptionRestored'
  | 'subscriptionRestoreFailed';

/**
 * Handler for reconnection events
 */
export type ReconnectionEventHandler = (event: {
  type: ReconnectionEventType;
  attempt?: number;
  delay?: number;
  error?: Error;
  subscriptionId?: SubscriptionId;
  newSubscriptionId?: SubscriptionId;
}) => void;

/**
 * Options for client connection
 */
export interface ClientConnectionOptions extends BaseConnectionOptions {
  /** Client name for identification */
  name?: string;
  /** Client capabilities */
  capabilities?: ParticipantCapabilities;
  /** Factory to create new stream for reconnection */
  createStream?: () => Promise<Stream>;
  /** Reconnection options */
  reconnection?: ReconnectionOptions;
}

/**
 * Options for ClientConnection.connect() static method
 */
export interface ClientConnectOptions {
  /** Client name for identification */
  name?: string;
  /** Client capabilities to advertise */
  capabilities?: ParticipantCapabilities;
  /** Authentication credentials */
  auth?: {
    method: 'bearer' | 'api-key' | 'mtls' | 'none';
    token?: string;
  };
  /**
   * Reconnection configuration.
   * - `true` = enable with defaults
   * - `false` or omitted = disabled
   * - `ReconnectionOptions` = enable with custom settings
   */
  reconnection?: boolean | ReconnectionOptions;
  /** Connection timeout in ms (default: 10000) */
  connectTimeout?: number;
}

/**
 * Options for ClientConnection.connectMesh() static method
 */
export interface MeshConnectOptions {
  /** The agentic-mesh transport adapter (Nebula, Tailscale, etc.) */
  transport: MeshTransportAdapter;
  /** Remote peer to connect to */
  peer: MeshPeerEndpoint;
  /** Local peer ID for identification */
  localPeerId: string;
  /** Client name for identification */
  name?: string;
  /** Client capabilities to advertise */
  capabilities?: ParticipantCapabilities;
  /** Authentication credentials */
  auth?: {
    method: 'bearer' | 'api-key' | 'mtls' | 'none';
    token?: string;
  };
  /**
   * Reconnection configuration.
   * - `true` = enable with defaults
   * - `false` or omitted = disabled
   * - `ReconnectionOptions` = enable with custom settings
   */
  reconnection?: boolean | ReconnectionOptions;
  /** Connection timeout in ms (default: 10000) */
  timeout?: number;
}

/**
 * Client connection to a MAP system.
 *
 * Provides methods for:
 * - Querying agents and structure
 * - Subscribing to events
 * - Sending messages to agents
 * - (With permissions) Steering agents
 *
 * ## Response Shape Patterns
 *
 * Methods follow consistent response shape conventions:
 *
 * **Create Operations** return the full entity that was created:
 * - `registerAgent()` → `{ agent: Agent }`
 * - `createScope()` → `{ scope: Scope }`
 * - `subscribe()` → `Subscription` (full subscription object)
 *
 * **Query Operations** return the requested data:
 * - `listAgents()` → `{ agents: Agent[] }`
 * - `getAgent()` → `{ agent: Agent, children?: Agent[] }`
 * - `getScope()` → `Scope`
 * - `listScopes()` → `{ scopes: Scope[] }`
 *
 * **Action Operations** return confirmation with reference ID:
 * - `send()` → `{ messageId: string }`
 * - `inject()` → `{ accepted: boolean }`
 *
 * **Lifecycle Operations** return status:
 * - `connect()` → `ConnectResponseResult` (session info, capabilities, auth status)
 * - `disconnect()` → `string | undefined` (resume token)
 * - `authenticate()` → `{ success: boolean, principal?: AuthPrincipal }`
 */
export class ClientConnection {
  #connection: BaseConnection;
  readonly #subscriptions: Map<SubscriptionId, Subscription> = new Map();
  readonly #subscriptionStates: Map<SubscriptionId, SubscriptionState> = new Map();
  readonly #reconnectionHandlers: Set<ReconnectionEventHandler> = new Set();
  readonly #acpStreams: Map<string, ACPStreamConnection> = new Map();
  readonly #options: ClientConnectionOptions;

  #sessionId: SessionId | null = null;
  #serverCapabilities: ParticipantCapabilities | null = null;
  #connected = false;
  #lastConnectOptions?: {
    sessionId?: SessionId;
    resumeToken?: string;
    auth?: { method: 'bearer' | 'api-key' | 'mtls' | 'none'; credential?: string };
  };
  #isReconnecting = false;
  #lastResumeToken?: string;
  #onTokenExpiring?: (expiresAt: number) => Promise<{ method: string; credential: string } | void>;

  constructor(stream: Stream, options: ClientConnectionOptions = {}) {
    this.#connection = new BaseConnection(stream, options);
    this.#options = options;

    // Set up notification handler for events
    this.#connection.setNotificationHandler(this.#handleNotification.bind(this));

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
  // Static Factory Methods
  // ===========================================================================

  /**
   * Connect to a MAP server via WebSocket URL.
   *
   * Handles:
   * - WebSocket creation and connection
   * - Stream wrapping
   * - Auto-configuration of createStream for reconnection
   * - Initial MAP protocol connect handshake
   *
   * @param url - WebSocket URL (ws:// or wss://)
   * @param options - Connection options
   * @returns Connected ClientConnection instance
   *
   * @example
   * ```typescript
   * const client = await ClientConnection.connect('ws://localhost:8080', {
   *   name: 'MyClient',
   *   reconnection: true
   * });
   *
   * // Already connected, ready to use
   * const agents = await client.listAgents();
   * ```
   */
  static async connect(
    url: string,
    options?: ClientConnectOptions
  ): Promise<ClientConnection> {
    // Validate URL
    const parsedUrl = new URL(url);
    if (!['ws:', 'wss:'].includes(parsedUrl.protocol)) {
      throw new Error(
        `Unsupported protocol: ${parsedUrl.protocol}. Use ws: or wss:`
      );
    }

    const timeout = options?.connectTimeout ?? 10000;

    // Create and connect WebSocket
    const ws = new WebSocket(url);
    await waitForOpen(ws, timeout);
    const stream = websocketStream(ws);

    // Configure createStream for reconnection
    const createStream = async () => {
      const newWs = new WebSocket(url);
      await waitForOpen(newWs, timeout);
      return websocketStream(newWs);
    };

    // Normalize reconnection option
    const reconnection =
      options?.reconnection === true
        ? { enabled: true }
        : typeof options?.reconnection === 'object'
          ? options.reconnection
          : undefined;

    // Create connection
    const client = new ClientConnection(stream, {
      name: options?.name,
      capabilities: options?.capabilities,
      createStream,
      reconnection,
    });

    // Perform MAP handshake
    await client.connect({ auth: options?.auth });

    return client;
  }

  /**
   * Connect to a MAP server via agentic-mesh transport.
   *
   * Handles:
   * - Dynamic import of agentic-mesh (optional peer dependency)
   * - Stream creation over encrypted mesh tunnel
   * - Auto-configuration of createStream for reconnection
   * - Initial MAP protocol connect handshake
   *
   * Requires `agentic-mesh` to be installed as a peer dependency.
   *
   * @param options - Mesh connection options
   * @returns Connected ClientConnection instance
   *
   * @example
   * ```typescript
   * import { createNebulaTransport } from 'agentic-mesh';
   *
   * const transport = createNebulaTransport({
   *   configPath: '/etc/nebula/config.yml',
   * });
   *
   * const client = await ClientConnection.connectMesh({
   *   transport,
   *   peer: { peerId: 'server', address: '10.0.0.1', port: 4242 },
   *   localPeerId: 'my-client',
   *   name: 'MeshClient',
   *   reconnection: true
   * });
   *
   * const agents = await client.listAgents();
   * ```
   */
  static async connectMesh(options: MeshConnectOptions): Promise<ClientConnection> {
    // Dynamic import for optional peer dependency
    const { agenticMeshStream } = await import('../stream/agentic-mesh');

    const streamConfig: AgenticMeshStreamConfig = {
      transport: options.transport,
      peer: options.peer,
      localPeerId: options.localPeerId,
      timeout: options.timeout,
    };

    // Create initial stream
    const stream = await agenticMeshStream(streamConfig);

    // Configure createStream for reconnection
    const createStream = async () => agenticMeshStream(streamConfig);

    // Normalize reconnection option
    const reconnection =
      options.reconnection === true
        ? { enabled: true }
        : typeof options.reconnection === 'object'
          ? options.reconnection
          : undefined;

    // Create connection
    const client = new ClientConnection(stream, {
      name: options.name,
      capabilities: options.capabilities,
      createStream,
      reconnection,
    });

    // Perform MAP handshake
    await client.connect({ auth: options.auth });

    return client;
  }

  // ===========================================================================
  // Connection Lifecycle
  // ===========================================================================

  /**
   * Connect to the MAP system
   *
   * @param options - Connection options
   * @param options.sessionId - Specific session ID to use
   * @param options.resumeToken - Token to resume a previously disconnected session
   * @param options.auth - Authentication credentials
   * @param options.onTokenExpiring - Callback invoked before token expires for proactive refresh
   */
  async connect(options?: {
    sessionId?: SessionId;
    /** Token to resume a previously disconnected session */
    resumeToken?: string;
    /** Authentication credentials */
    auth?: { method: 'bearer' | 'api-key' | 'mtls' | 'none'; credential?: string };
    /** Callback invoked when token is about to expire. Return new credentials to refresh. */
    onTokenExpiring?: (expiresAt: number) => Promise<{ method: string; credential: string } | void>;
  }): Promise<ConnectResponseResult> {
    const params: ConnectRequestParams = {
      protocolVersion: PROTOCOL_VERSION,
      participantType: 'client',
      name: this.#options.name,
      capabilities: this.#options.capabilities,
      sessionId: options?.sessionId,
      resumeToken: options?.resumeToken,
      auth: options?.auth,
    };

    const result = await this.#connection.sendRequest<
      ConnectRequestParams,
      ConnectResponseResult
    >(CORE_METHODS.CONNECT, params);

    this.#sessionId = result.sessionId;
    this.#serverCapabilities = result.capabilities;
    this.#connected = true;

    // Store resume token if provided in response
    if (result.resumeToken) {
      this.#lastResumeToken = result.resumeToken;
    }

    // Store token expiring callback
    if (options?.onTokenExpiring) {
      this.#onTokenExpiring = options.onTokenExpiring;
      this.#setupTokenExpiryMonitoring(result);
    }

    // Transition to connected state
    this.#connection._transitionTo('connected');

    // Store connect options for potential reconnection
    this.#lastConnectOptions = options;

    return result;
  }

  /**
   * Get the resume token for this session.
   * Can be used to reconnect and restore session state after disconnection.
   *
   * @returns The resume token, or undefined if not available
   */
  getResumeToken(): string | undefined {
    return this.#lastResumeToken;
  }

  /**
   * Reconnect to the server, optionally using a resume token to restore session.
   *
   * @param resumeToken - Token to resume previous session. If not provided, uses the last known token.
   * @returns Connect response result
   *
   * @example
   * ```typescript
   * // Save token before disconnect
   * const token = await client.disconnect();
   *
   * // Later, reconnect with the token
   * const result = await client.reconnect(token);
   * console.log('Reconnected:', result.reconnected);
   * ```
   */
  async reconnect(resumeToken?: string): Promise<ConnectResponseResult> {
    const tokenToUse = resumeToken ?? this.#lastResumeToken;

    return this.connect({
      ...this.#lastConnectOptions,
      resumeToken: tokenToUse,
    });
  }

  /**
   * Set up monitoring for token expiration
   */
  #setupTokenExpiryMonitoring(connectResult: ConnectResponseResult): void {
    const principal = connectResult.principal;
    if (!principal?.expiresAt || !this.#onTokenExpiring) {
      return;
    }

    const expiresAt = principal.expiresAt;
    const now = Date.now();

    // Trigger callback 60 seconds before expiration
    const warningTime = expiresAt - 60000;
    const delay = warningTime - now;

    if (delay > 0) {
      setTimeout(async () => {
        if (!this.#connected || !this.#onTokenExpiring) return;

        try {
          const newCredentials = await this.#onTokenExpiring(expiresAt);
          if (newCredentials) {
            const refreshResult = await this.refreshAuth({
              method: newCredentials.method as 'bearer' | 'api-key' | 'mtls' | 'none',
              credential: newCredentials.credential,
            });

            // If refresh succeeded and we got a new expiry, set up monitoring again
            if (refreshResult.success && refreshResult.principal?.expiresAt) {
              this.#setupTokenExpiryMonitoring({
                ...connectResult,
                principal: refreshResult.principal
              } as ConnectResponseResult);
            }
          }
        } catch {
          // Token refresh failed - let the connection handle expiration naturally
        }
      }, delay);
    }
  }

  /**
   * Authenticate with the server after connection.
   *
   * Use this when the server returns `authRequired` in the connect response,
   * indicating that authentication is needed before accessing protected resources.
   *
   * @param auth - Authentication credentials
   * @returns Authentication result with principal if successful
   *
   * @example
   * ```typescript
   * const connectResult = await client.connect();
   *
   * if (connectResult.authRequired) {
   *   const authResult = await client.authenticate({
   *     method: 'api-key',
   *     credential: process.env.API_KEY,
   *   });
   *
   *   if (authResult.success) {
   *     console.log('Authenticated as:', authResult.principal?.id);
   *   }
   * }
   * ```
   */
  async authenticate(auth: {
    method: 'bearer' | 'api-key' | 'mtls' | 'none';
    credential?: string;
  }): Promise<AuthenticateResponseResult> {
    const params: AuthenticateRequestParams = {
      method: auth.method,
      credential: auth.credential,
    };

    const result = await this.#connection.sendRequest<
      AuthenticateRequestParams,
      AuthenticateResponseResult
    >(AUTH_METHODS.AUTHENTICATE, params);

    // Update session info if auth succeeded
    if (result.success && result.sessionId) {
      this.#sessionId = result.sessionId;
    }

    return result;
  }

  /**
   * Refresh authentication credentials.
   *
   * Use this to update credentials before they expire for long-lived connections.
   *
   * @param auth - New authentication credentials
   * @returns Updated principal information
   */
  async refreshAuth(auth: {
    method: "bearer" | "api-key" | "mtls" | "none";
    credential?: string;
  }): Promise<{
    success: boolean;
    principal?: AuthPrincipal;
    error?: { code: string; message: string };
  }> {
    const params: AuthenticateRequestParams = {
      method: auth.method,
      credential: auth.credential,
    };

    return this.#connection.sendRequest(AUTH_METHODS.AUTH_REFRESH, params);
  }

  /**
   * Disconnect from the MAP system
   * @param reason - Optional reason for disconnecting
   * @returns Resume token that can be used to resume this session later
   */
  async disconnect(reason?: string): Promise<string | undefined> {
    if (!this.#connected) return undefined;

    let resumeToken: string | undefined;
    try {
      const result = await this.#connection.sendRequest<{ reason?: string }, DisconnectResponseResult>(
        CORE_METHODS.DISCONNECT,
        reason ? { reason } : undefined
      );
      resumeToken = result.resumeToken;

      // Store resume token for potential reconnection
      if (resumeToken) {
        this.#lastResumeToken = resumeToken;
      }
    } finally {
      // Close all ACP streams
      for (const stream of this.#acpStreams.values()) {
        await stream.close();
      }
      this.#acpStreams.clear();

      // Close all subscriptions
      for (const subscription of this.#subscriptions.values()) {
        subscription._close();
      }
      this.#subscriptions.clear();

      await this.#connection.close();
      this.#connected = false;
    }
    return resumeToken;
  }

  /**
   * Whether the client is connected
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
  // Session Management
  // ===========================================================================

  /**
   * List available sessions
   */
  async listSessions(): Promise<SessionListResponseResult> {
    return this.#connection.sendRequest(SESSION_METHODS.SESSION_LIST);
  }

  /**
   * Load an existing session
   */
  async loadSession(sessionId: SessionId): Promise<SessionLoadResponseResult> {
    return this.#connection.sendRequest(SESSION_METHODS.SESSION_LOAD, { sessionId });
  }

  /**
   * Close the current session
   */
  async closeSession(sessionId?: SessionId): Promise<SessionCloseResponseResult> {
    return this.#connection.sendRequest(SESSION_METHODS.SESSION_CLOSE, { sessionId });
  }

  // ===========================================================================
  // Agent Queries
  // ===========================================================================

  /**
   * List agents with optional filters
   */
  async listAgents(options?: AgentsListRequestParams): Promise<AgentsListResponseResult> {
    return this.#connection.sendRequest(OBSERVATION_METHODS.AGENTS_LIST, options);
  }

  /**
   * Get a single agent by ID
   */
  async getAgent(
    agentId: AgentId,
    options?: { include?: { children?: boolean; descendants?: boolean } }
  ): Promise<AgentsGetResponseResult> {
    const params: AgentsGetRequestParams = { agentId, ...options };
    return this.#connection.sendRequest<AgentsGetRequestParams, AgentsGetResponseResult>(
      OBSERVATION_METHODS.AGENTS_GET,
      params
    );
  }

  /**
   * Get the agent structure/hierarchy graph
   */
  async getStructureGraph(
    options?: StructureGraphRequestParams
  ): Promise<StructureGraphResponseResult> {
    return this.#connection.sendRequest(OBSERVATION_METHODS.STRUCTURE_GRAPH, options);
  }

  // ===========================================================================
  // Scope Queries
  // ===========================================================================

  /**
   * List scopes
   */
  async listScopes(options?: ScopesListRequestParams): Promise<ScopesListResponseResult> {
    return this.#connection.sendRequest(OBSERVATION_METHODS.SCOPES_LIST, options);
  }

  /**
   * Get a single scope by ID
   */
  async getScope(scopeId: ScopeId): Promise<Scope> {
    const result = await this.#connection.sendRequest<
      { scopeId: ScopeId },
      ScopesGetResponseResult
    >(OBSERVATION_METHODS.SCOPES_GET, { scopeId });
    return result.scope;
  }

  /**
   * List members of a scope
   */
  async getScopeMembers(
    scopeId: ScopeId,
    options?: Omit<ScopesMembersRequestParams, 'scopeId'>
  ): Promise<ScopesMembersResponseResult> {
    return this.#connection.sendRequest(OBSERVATION_METHODS.SCOPES_MEMBERS, {
      scopeId,
      ...options,
    });
  }

  // ===========================================================================
  // Messaging
  // ===========================================================================

  /**
   * Send a message to an address
   */
  async send(
    to: Address,
    payload?: unknown,
    meta?: MessageMeta
  ): Promise<SendResponseResult> {
    const params: SendRequestParams = { to };
    if (payload !== undefined) params.payload = payload;
    if (meta) params.meta = meta;

    return this.#connection.sendRequest(CORE_METHODS.SEND, params);
  }

  /**
   * Send a message to a specific agent
   */
  async sendToAgent(
    agentId: AgentId,
    payload?: unknown,
    meta?: MessageMeta
  ): Promise<SendResponseResult> {
    return this.send({ agent: agentId }, payload, meta);
  }

  /**
   * Send a message to all agents in a scope
   */
  async sendToScope(
    scopeId: ScopeId,
    payload?: unknown,
    meta?: MessageMeta
  ): Promise<SendResponseResult> {
    return this.send({ scope: scopeId }, payload, meta);
  }

  /**
   * Send a message to agents with a specific role
   */
  async sendToRole(
    role: string,
    payload?: unknown,
    meta?: MessageMeta,
    withinScope?: ScopeId
  ): Promise<SendResponseResult> {
    return this.send({ role, within: withinScope }, payload, meta);
  }

  /**
   * Broadcast a message to all agents
   */
  async broadcast(payload?: unknown, meta?: MessageMeta): Promise<SendResponseResult> {
    return this.send({ broadcast: true }, payload, meta);
  }

  /**
   * Send a request and wait for a correlated response
   *
   * This is a higher-level pattern for request/response messaging.
   * A correlationId is automatically generated.
   */
  async request<T = unknown>(
    to: Address,
    payload?: unknown,
    options?: { timeout?: number; meta?: MessageMeta }
  ): Promise<Message<T>> {
    const correlationId = `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    // Subscribe to responses with this correlation ID
    const responseSub = await this.subscribe({
      // We'll filter in the handler since subscription filters don't support correlationId
    });

    try {
      // Send the request
      await this.send(to, payload, {
        ...options?.meta,
        expectsResponse: true,
        correlationId,
      });

      // Wait for response with matching correlationId
      const timeout = options?.timeout ?? 30000;
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`Request timed out after ${timeout}ms`)), timeout);
      });

      const responsePromise = (async () => {
        for await (const event of responseSub) {
          if (
            event.type === 'message_delivered' &&
            event.data &&
            (event.data as { correlationId?: string }).correlationId === correlationId
          ) {
            return (event.data as { message: Message<T> }).message;
          }
        }
        throw new Error('Subscription closed before response received');
      })();

      return await Promise.race([responsePromise, timeoutPromise]);
    } finally {
      await responseSub.unsubscribe();
    }
  }

  // ===========================================================================
  // ACP Streams
  // ===========================================================================

  /**
   * Create a virtual ACP stream connection to an agent.
   *
   * This allows clients to interact with ACP-compatible agents using the
   * familiar ACP interface while routing all messages through MAP.
   *
   * @param options - Stream configuration options
   * @returns ACPStreamConnection instance ready for initialize()
   *
   * @example
   * ```typescript
   * const acp = client.createACPStream({
   *   targetAgent: 'coding-agent-1',
   *   client: {
   *     requestPermission: async (req) => ({
   *       outcome: { outcome: 'selected', optionId: 'allow' }
   *     }),
   *     sessionUpdate: async (update) => {
   *       console.log('Agent update:', update);
   *     }
   *   }
   * });
   *
   * await acp.initialize({
   *   protocolVersion: 20241007,
   *   clientInfo: { name: 'IDE', version: '1.0' }
   * });
   * const { sessionId } = await acp.newSession({ cwd: '/project', mcpServers: [] });
   * const result = await acp.prompt({
   *   sessionId,
   *   prompt: [{ type: 'text', text: 'Hello' }]
   * });
   *
   * await acp.close();
   * ```
   */
  createACPStream(options: Omit<ACPStreamOptions, 'mapClient'>): ACPStreamConnection {
    const stream = new ACPStreamConnection(this, options);

    // Track the stream
    this.#acpStreams.set(stream.streamId, stream);

    // Remove from tracking when closed
    stream.on('close', () => {
      this.#acpStreams.delete(stream.streamId);
    });

    return stream;
  }

  /**
   * Get an active ACP stream by ID.
   */
  getACPStream(streamId: string): ACPStreamConnection | undefined {
    return this.#acpStreams.get(streamId);
  }

  /**
   * Get all active ACP streams.
   */
  get acpStreams(): ReadonlyMap<string, ACPStreamConnection> {
    return this.#acpStreams;
  }

  // ===========================================================================
  // Subscriptions
  // ===========================================================================

  /**
   * Subscribe to events
   */
  async subscribe(filter?: SubscriptionFilter): Promise<Subscription> {
    const params: SubscribeRequestParams = {};
    if (filter) params.filter = filter;

    const result = await this.#connection.sendRequest<
      SubscribeRequestParams,
      SubscribeResponseResult
    >(CORE_METHODS.SUBSCRIBE, params);

    // Create sendAck callback if server supports it
    const serverSupportsAck = this.#serverCapabilities?.streaming?.supportsAck === true;
    const sendAck = serverSupportsAck
      ? (ackParams: SubscriptionAckParams) => {
          this.#connection.sendNotification(NOTIFICATION_METHODS.SUBSCRIBE_ACK, ackParams);
        }
      : undefined;

    const subscription = createSubscription(
      result.subscriptionId,
      () => this.unsubscribe(result.subscriptionId),
      { filter },
      sendAck
    );

    // Set server support flag on the subscription
    if (serverSupportsAck) {
      subscription._setServerSupportsAck(true);
    }

    this.#subscriptions.set(result.subscriptionId, subscription);

    // Track subscription state for potential restoration
    if (this.#options.reconnection?.restoreSubscriptions !== false) {
      this.#subscriptionStates.set(result.subscriptionId, {
        filter,
        handlers: new Set(),
      });

      // Update lastEventId when events are received
      const originalPushEvent = subscription._pushEvent.bind(subscription);
      subscription._pushEvent = (event: EventNotificationParams) => {
        const state = this.#subscriptionStates.get(result.subscriptionId);
        if (state && event.eventId) {
          state.lastEventId = event.eventId;
        }
        originalPushEvent(event);
      };
    }

    return subscription;
  }

  /**
   * Unsubscribe from events
   */
  async unsubscribe(subscriptionId: SubscriptionId): Promise<void> {
    const subscription = this.#subscriptions.get(subscriptionId);
    if (subscription) {
      subscription._close();
      this.#subscriptions.delete(subscriptionId);
    }

    // Clean up subscription state
    this.#subscriptionStates.delete(subscriptionId);

    await this.#connection.sendRequest<
      { subscriptionId: SubscriptionId },
      UnsubscribeResponseResult
    >(CORE_METHODS.UNSUBSCRIBE, { subscriptionId });
  }

  // ===========================================================================
  // Event Replay
  // ===========================================================================

  /**
   * Replay historical events.
   *
   * Uses keyset pagination - pass the last eventId from the previous
   * response to get the next page.
   *
   * @example
   * ```typescript
   * // Replay all events from the last hour
   * const result = await client.replay({
   *   fromTimestamp: Date.now() - 3600000,
   *   filter: { eventTypes: ['agent.registered'] },
   *   limit: 100
   * });
   *
   * // Paginate through results
   * let afterEventId: string | undefined;
   * do {
   *   const page = await client.replay({ afterEventId, limit: 100 });
   *   for (const item of page.events) {
   *     console.log(item.eventId, item.event);
   *   }
   *   afterEventId = page.events.at(-1)?.eventId;
   * } while (page.hasMore);
   * ```
   */
  async replay(params: ReplayRequestParams = {}): Promise<ReplayResponseResult> {
    // Validate and cap limit
    const limit = Math.min(params.limit ?? 100, 1000);

    return this.#connection.sendRequest<ReplayRequestParams, ReplayResponseResult>(
      CORE_METHODS.REPLAY,
      { ...params, limit }
    );
  }

  /**
   * Replay all events matching filter, handling pagination automatically.
   *
   * Returns an async generator for streaming through all results.
   *
   * @example
   * ```typescript
   * for await (const item of client.replayAll({
   *   filter: { eventTypes: ['agent.registered'] }
   * })) {
   *   console.log(item.eventId, item.event);
   * }
   * ```
   */
  async *replayAll(
    params: Omit<ReplayRequestParams, 'afterEventId'> = {}
  ): AsyncGenerator<ReplayedEvent> {
    let afterEventId: string | undefined;
    let hasMore = true;

    while (hasMore) {
      const result = await this.replay({ ...params, afterEventId });

      for (const item of result.events) {
        yield item;
      }

      hasMore = result.hasMore;
      afterEventId = result.events.at(-1)?.eventId;

      // Safety: if no events returned but hasMore is true, break to avoid infinite loop
      if (result.events.length === 0) {
        break;
      }
    }
  }

  // ===========================================================================
  // Steering (requires canSteer capability)
  // ===========================================================================

  /**
   * Inject context into a running agent
   */
  async inject(
    agentId: AgentId,
    content: unknown,
    delivery?: 'interrupt' | 'queue' | 'best-effort'
  ): Promise<InjectResponseResult> {
    const params: InjectRequestParams = { agentId, content };
    if (delivery) params.delivery = delivery;

    return this.#connection.sendRequest(STEERING_METHODS.INJECT, params);
  }

  // ===========================================================================
  // Lifecycle Control (requires canStop capability)
  // ===========================================================================

  /**
   * Request an agent to stop
   */
  async stopAgent(
    agentId: AgentId,
    options?: { reason?: string; force?: boolean }
  ): Promise<{ stopping: boolean; agent?: Agent }> {
    return this.#connection.sendRequest(STATE_METHODS.AGENTS_STOP, {
      agentId,
      ...options,
    });
  }

  /**
   * Suspend an agent
   */
  async suspendAgent(
    agentId: AgentId,
    reason?: string
  ): Promise<{ suspended: boolean; agent?: Agent }> {
    return this.#connection.sendRequest(STATE_METHODS.AGENTS_SUSPEND, {
      agentId,
      reason,
    });
  }

  /**
   * Resume a suspended agent
   */
  async resumeAgent(agentId: AgentId): Promise<{ resumed: boolean; agent?: Agent }> {
    return this.#connection.sendRequest(STATE_METHODS.AGENTS_RESUME, { agentId });
  }

  // ===========================================================================
  // Extensions
  // ===========================================================================

  /**
   * Call a server extension method directly via JSON-RPC.
   *
   * Extension methods (prefixed with `_macro/` or similar) are registered on the
   * server's RPC handler and callable as standard JSON-RPC methods. This bypasses
   * ACP-over-MAP messaging — use this for simple request/response operations that
   * don't need ACP session semantics.
   *
   * @param method - The extension method name (e.g., "_macro/workspace/files/search")
   * @param params - Parameters to pass to the extension method
   * @returns The result from the extension method
   *
   * @example
   * ```typescript
   * const result = await client.callExtension('_macro/workspace/files/search', {
   *   agentId: 'agent-1',
   *   query: 'app.tsx',
   * });
   * ```
   */
  async callExtension<TParams = unknown, TResult = unknown>(
    method: string,
    params?: TParams,
  ): Promise<TResult> {
    return this.#connection.sendRequest<TParams, TResult>(method, params);
  }

  // ===========================================================================
  // Mail
  // ===========================================================================

  /**
   * Create a new mail conversation.
   *
   * @param params - Conversation creation parameters
   * @returns Created conversation and participant info
   */
  async createConversation(
    params?: Omit<MailCreateRequestParams, '_meta'>
  ): Promise<MailCreateResponseResult> {
    return this.#connection.sendRequest<MailCreateRequestParams, MailCreateResponseResult>(
      MAIL_METHODS.MAIL_CREATE,
      params ?? {}
    );
  }

  /**
   * Get a conversation by ID with optional includes.
   *
   * @param conversationId - ID of the conversation to retrieve
   * @param include - Optional fields to include (participants, threads, recentTurns, stats)
   * @returns Conversation details with requested includes
   */
  async getConversation(
    conversationId: ConversationId,
    include?: MailGetRequestParams['include']
  ): Promise<MailGetResponseResult> {
    return this.#connection.sendRequest<MailGetRequestParams, MailGetResponseResult>(
      MAIL_METHODS.MAIL_GET,
      { conversationId, include }
    );
  }

  /**
   * List conversations with optional filters.
   *
   * @param params - Optional filter, limit, and cursor parameters
   * @returns Paginated list of conversations
   */
  async listConversations(
    params?: Omit<MailListRequestParams, '_meta'>
  ): Promise<MailListResponseResult> {
    return this.#connection.sendRequest<MailListRequestParams, MailListResponseResult>(
      MAIL_METHODS.MAIL_LIST,
      params ?? {}
    );
  }

  /**
   * Close a conversation.
   *
   * @param conversationId - ID of the conversation to close
   * @param reason - Optional reason for closing
   * @returns The closed conversation
   */
  async closeConversation(
    conversationId: ConversationId,
    reason?: string
  ): Promise<MailCloseResponseResult> {
    return this.#connection.sendRequest<MailCloseRequestParams, MailCloseResponseResult>(
      MAIL_METHODS.MAIL_CLOSE,
      { conversationId, reason }
    );
  }

  /**
   * Join an existing conversation.
   *
   * @param params - Join parameters including conversationId and optional catch-up config
   * @returns Conversation, participant, and optional history
   */
  async joinConversation(
    params: Omit<MailJoinRequestParams, '_meta'>
  ): Promise<MailJoinResponseResult> {
    return this.#connection.sendRequest<MailJoinRequestParams, MailJoinResponseResult>(
      MAIL_METHODS.MAIL_JOIN,
      params
    );
  }

  /**
   * Leave a conversation.
   *
   * @param conversationId - ID of the conversation to leave
   * @param reason - Optional reason for leaving
   * @returns Leave confirmation with timestamp
   */
  async leaveConversation(
    conversationId: ConversationId,
    reason?: string
  ): Promise<MailLeaveResponseResult> {
    return this.#connection.sendRequest<MailLeaveRequestParams, MailLeaveResponseResult>(
      MAIL_METHODS.MAIL_LEAVE,
      { conversationId, reason }
    );
  }

  /**
   * Invite a participant to a conversation.
   *
   * @param params - Invite parameters including conversationId and participant info
   * @returns Invite result
   */
  async inviteToConversation(
    params: Omit<MailInviteRequestParams, '_meta'>
  ): Promise<MailInviteResponseResult> {
    return this.#connection.sendRequest<MailInviteRequestParams, MailInviteResponseResult>(
      MAIL_METHODS.MAIL_INVITE,
      params
    );
  }

  /**
   * Record a turn (message) in a conversation.
   *
   * @param params - Turn parameters including conversationId, contentType, and content
   * @returns The created turn
   */
  async recordTurn(
    params: Omit<MailTurnRequestParams, '_meta'>
  ): Promise<MailTurnResponseResult> {
    return this.#connection.sendRequest<MailTurnRequestParams, MailTurnResponseResult>(
      MAIL_METHODS.MAIL_TURN,
      params
    );
  }

  /**
   * List turns in a conversation with optional filters.
   *
   * @param params - List parameters including conversationId and optional filters
   * @returns Paginated list of turns
   */
  async listTurns(
    params: Omit<MailTurnsListRequestParams, '_meta'>
  ): Promise<MailTurnsListResponseResult> {
    return this.#connection.sendRequest<MailTurnsListRequestParams, MailTurnsListResponseResult>(
      MAIL_METHODS.MAIL_TURNS_LIST,
      params
    );
  }

  /**
   * Create a thread in a conversation.
   *
   * @param params - Thread creation parameters including conversationId and rootTurnId
   * @returns The created thread
   */
  async createThread(
    params: Omit<MailThreadCreateRequestParams, '_meta'>
  ): Promise<MailThreadCreateResponseResult> {
    return this.#connection.sendRequest<MailThreadCreateRequestParams, MailThreadCreateResponseResult>(
      MAIL_METHODS.MAIL_THREAD_CREATE,
      params
    );
  }

  /**
   * List threads in a conversation.
   *
   * @param params - List parameters including conversationId
   * @returns Paginated list of threads
   */
  async listThreads(
    params: Omit<MailThreadListRequestParams, '_meta'>
  ): Promise<MailThreadListResponseResult> {
    return this.#connection.sendRequest<MailThreadListRequestParams, MailThreadListResponseResult>(
      MAIL_METHODS.MAIL_THREAD_LIST,
      params
    );
  }

  /**
   * Get a summary of a conversation.
   *
   * @param params - Summary parameters including conversationId and optional scope/includes
   * @returns Generated summary with optional key points, decisions, and questions
   */
  async getConversationSummary(
    params: Omit<MailSummaryRequestParams, '_meta'>
  ): Promise<MailSummaryResponseResult> {
    return this.#connection.sendRequest<MailSummaryRequestParams, MailSummaryResponseResult>(
      MAIL_METHODS.MAIL_SUMMARY,
      params
    );
  }

  /**
   * Replay turns from a conversation, optionally from a specific point.
   *
   * @param params - Replay parameters including conversationId and optional starting point
   * @returns Replayed turns with pagination info
   */
  async replayConversation(
    params: Omit<MailReplayRequestParams, '_meta'>
  ): Promise<MailReplayResponseResult> {
    return this.#connection.sendRequest<MailReplayRequestParams, MailReplayResponseResult>(
      MAIL_METHODS.MAIL_REPLAY,
      params
    );
  }

  /**
   * Send a message to an address with mail context attached.
   *
   * Wraps the standard `send()` method, automatically attaching `meta.mail`
   * with the specified conversationId so the message is recorded as a turn
   * in the conversation.
   *
   * @param to - Target address
   * @param payload - Message payload
   * @param conversationId - Conversation to associate with
   * @param options - Optional threadId and additional message meta
   * @returns Send result
   */
  async sendWithMail(
    to: Address,
    payload: unknown,
    conversationId: ConversationId,
    options?: { threadId?: ThreadId; meta?: MessageMeta }
  ): Promise<SendResponseResult> {
    return this.send(to, payload, {
      ...options?.meta,
      mail: { conversationId, threadId: options?.threadId },
    });
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
   * Register a handler for reconnection events.
   *
   * @param handler - Function called when reconnection events occur
   * @returns Unsubscribe function to remove the handler
   *
   * @example
   * ```typescript
   * const unsubscribe = client.onReconnection((event) => {
   *   switch (event.type) {
   *     case 'disconnected':
   *       console.log('Connection lost');
   *       break;
   *     case 'reconnecting':
   *       console.log(`Reconnecting, attempt ${event.attempt}`);
   *       break;
   *     case 'reconnected':
   *       console.log('Reconnected successfully');
   *       break;
   *     case 'reconnectFailed':
   *       console.log('Failed to reconnect:', event.error);
   *       break;
   *   }
   * });
   * ```
   */
  onReconnection(handler: ReconnectionEventHandler): () => void {
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
   * Handle incoming notifications
   */
  async #handleNotification(method: string, params: unknown): Promise<void> {
    switch (method) {
      case NOTIFICATION_METHODS.EVENT: {
        const eventParams = params as EventNotificationParams;
        const subscription = this.#subscriptions.get(eventParams.subscriptionId);
        if (subscription) {
          subscription._pushEvent(eventParams);
        } else {
          console.warn('MAP: Event for unknown subscription:', eventParams.subscriptionId);
        }
        break;
      }

      case NOTIFICATION_METHODS.MESSAGE: {
        // Message notifications could be handled here if needed
        // For now, they're delivered through event subscriptions
        break;
      }

      default:
        console.warn('MAP: Unknown notification:', method);
    }
  }

  /**
   * Emit a reconnection event to all registered handlers
   */
  #emitReconnectionEvent(event: Parameters<ReconnectionEventHandler>[0]): void {
    for (const handler of this.#reconnectionHandlers) {
      try {
        handler(event);
      } catch (error) {
        console.error('MAP: Reconnection event handler error:', error);
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

    // Restore subscriptions if enabled
    if (options.restoreSubscriptions !== false) {
      await this.#restoreSubscriptions();
    }
  }

  /**
   * Restore subscriptions after reconnection
   */
  async #restoreSubscriptions(): Promise<void> {
    const options = this.#options.reconnection!;
    const subscriptionEntries = Array.from(this.#subscriptionStates.entries());

    // Clear old subscription tracking (IDs will change)
    this.#subscriptions.clear();
    this.#subscriptionStates.clear();

    for (const [oldId, state] of subscriptionEntries) {
      try {
        // Create new subscription with same filter
        const newSubscription = await this.subscribe(state.filter);
        const newId = newSubscription.id;

        // Replay missed events if enabled
        if (options.replayOnRestore !== false && state.lastEventId) {
          const maxEvents = options.maxReplayEventsPerSubscription ?? 1000;

          try {
            let replayedCount = 0;
            let afterEventId: string | undefined = state.lastEventId;
            let hasMore = true;

            // Paginate through replayed events
            while (hasMore && replayedCount < maxEvents) {
              const result = await this.replay({
                afterEventId,
                filter: state.filter,
                limit: Math.min(100, maxEvents - replayedCount),
              });

              for (const replayedEvent of result.events) {
                if (replayedCount >= maxEvents) break;

                // Push replayed event to the new subscription
                newSubscription._pushEvent({
                  subscriptionId: newId,
                  sequenceNumber: replayedCount + 1,
                  eventId: replayedEvent.eventId,
                  timestamp: replayedEvent.timestamp,
                  event: replayedEvent.event,
                });

                replayedCount++;
              }

              hasMore = result.hasMore;
              afterEventId = result.events.at(-1)?.eventId;

              // Safety: if no events returned but hasMore is true, break
              if (result.events.length === 0) {
                break;
              }
            }
          } catch (replayError) {
            // Replay is best-effort, log but don't fail restoration
            console.warn('MAP: Failed to replay events for subscription:', oldId, replayError);
          }
        }

        this.#emitReconnectionEvent({
          type: 'subscriptionRestored',
          subscriptionId: oldId,
          newSubscriptionId: newId,
        });
      } catch (error) {
        this.#emitReconnectionEvent({
          type: 'subscriptionRestoreFailed',
          subscriptionId: oldId,
          error: error instanceof Error ? error : new Error(String(error)),
        });
      }
    }
  }
}
