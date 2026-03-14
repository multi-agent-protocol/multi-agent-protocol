/**
 * Agent connection for MAP protocol
 *
 * Used by agents to connect to a MAP system, receive messages,
 * update state, spawn children, and communicate with peers.
 */

import { type Stream, websocketStream, waitForOpen } from "../stream";
import type {
  AgenticMeshStreamConfig,
  MeshPeerEndpoint,
  MeshTransportAdapter,
} from "../stream/agentic-mesh";
import {
  BaseConnection,
  type BaseConnectionOptions,
  type ConnectionState,
} from "./base";
import { withRetry, type RetryPolicy, DEFAULT_RETRY_POLICY } from "../utils";
import { Subscription, createSubscription } from "../subscription";
import {
  CORE_METHODS,
  LIFECYCLE_METHODS,
  STATE_METHODS,
  SCOPE_METHODS,
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
  type AgentState,
  type AgentVisibility,
  type Scope,
  type Message,
  type MessageMeta,
  type SubscriptionFilter,
  type EventNotificationParams,
  type MessageNotificationParams,
  type ConnectRequestParams,
  type ConnectResponseResult,
  type DisconnectResponseResult,
  type AgentsRegisterRequestParams,
  type AgentsRegisterResponseResult,
  type AgentsSpawnRequestParams,
  type AgentsSpawnResponseResult,
  type AgentsUpdateResponseResult,
  type AgentsUnregisterResponseResult,
  type SendRequestParams,
  type SendResponseResult,
  type SubscribeRequestParams,
  type SubscribeResponseResult,
  type UnsubscribeResponseResult,
  type ScopesCreateRequestParams,
  type ScopesCreateResponseResult,
  type ScopesJoinResponseResult,
  type ScopesLeaveResponseResult,
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
  TASK_METHODS,
  type TaskId,
  type TasksCreateRequestParams,
  type TasksCreateResponseResult,
  type TasksAssignRequestParams,
  type TasksAssignResponseResult,
  type TasksUpdateRequestParams,
  type TasksUpdateResponseResult,
  type TasksListRequestParams,
  type TasksListResponseResult,
} from "../types";

/**
 * Handler for incoming messages addressed to this agent
 */
export type MessageHandler = (message: Message) => void | Promise<void>;

/**
 * Options for automatic reconnection
 */
export interface AgentReconnectionOptions {
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
  /** Restore scope memberships after reconnect (default: true) */
  restoreScopeMemberships?: boolean;
}

/**
 * Agent reconnection event types
 */
export type AgentReconnectionEventType =
  | "disconnected"
  | "reconnecting"
  | "reconnected"
  | "reconnectFailed";

/**
 * Handler for reconnection events
 */
export type AgentReconnectionEventHandler = (event: {
  type: AgentReconnectionEventType;
  attempt?: number;
  delay?: number;
  error?: Error;
}) => void;

/**
 * Options for agent connection
 */
export interface AgentConnectionOptions extends BaseConnectionOptions {
  /** Agent name */
  name?: string;
  /** Agent role */
  role?: string;
  /** Agent capabilities */
  capabilities?: ParticipantCapabilities;
  /** Agent visibility */
  visibility?: AgentVisibility;
  /** Parent agent ID (if this is a child agent) */
  parent?: AgentId;
  /** Initial scopes to join */
  scopes?: ScopeId[];
  /** Factory to create new stream for reconnection */
  createStream?: () => Promise<Stream>;
  /** Reconnection options */
  reconnection?: AgentReconnectionOptions;
}

/**
 * Options for AgentConnection.connect() static method
 */
export interface AgentConnectOptions {
  /** Agent name */
  name?: string;
  /** Agent role */
  role?: string;
  /** Agent capabilities to advertise */
  capabilities?: ParticipantCapabilities;
  /** Agent visibility settings */
  visibility?: AgentVisibility;
  /** Parent agent ID (for child agents) */
  parent?: AgentId;
  /** Initial scopes to join */
  scopes?: ScopeId[];
  /** Initial metadata */
  metadata?: Record<string, unknown>;
  /** Authentication credentials */
  auth?: {
    method: "bearer" | "api-key" | "mtls" | "none";
    token?: string;
  };
  /**
   * Reconnection configuration.
   * - `true` = enable with defaults
   * - `false` or omitted = disabled
   * - `AgentReconnectionOptions` = enable with custom settings
   */
  reconnection?: boolean | AgentReconnectionOptions;
  /** Connection timeout in ms (default: 10000) */
  connectTimeout?: number;
}

/**
 * Options for AgentConnection.connectMesh() static method
 */
export interface AgentMeshConnectOptions {
  /** The agentic-mesh transport adapter (Nebula, Tailscale, etc.) */
  transport: MeshTransportAdapter;
  /** Remote peer to connect to */
  peer: MeshPeerEndpoint;
  /** Local peer ID for identification */
  localPeerId: string;
  /** Agent name */
  name?: string;
  /** Agent role */
  role?: string;
  /** Agent capabilities to advertise */
  capabilities?: ParticipantCapabilities;
  /** Agent visibility settings */
  visibility?: AgentVisibility;
  /** Parent agent ID (for child agents) */
  parent?: AgentId;
  /** Initial scopes to join */
  scopes?: ScopeId[];
  /** Initial metadata */
  metadata?: Record<string, unknown>;
  /** Authentication credentials */
  auth?: {
    method: "bearer" | "api-key" | "mtls" | "none";
    token?: string;
  };
  /**
   * Reconnection configuration.
   * - `true` = enable with defaults
   * - `false` or omitted = disabled
   * - `AgentReconnectionOptions` = enable with custom settings
   */
  reconnection?: boolean | AgentReconnectionOptions;
  /** Connection timeout in ms (default: 10000) */
  timeout?: number;
}

/**
 * Agent connection to a MAP system.
 *
 * Provides methods for:
 * - Registering self with the system
 * - Receiving and handling messages
 * - Sending messages to other agents
 * - Spawning child agents
 * - Updating own state
 * - Managing scope memberships
 */
export class AgentConnection {
  #connection: BaseConnection;
  readonly #subscriptions: Map<SubscriptionId, Subscription> = new Map();
  readonly #options: AgentConnectionOptions;
  readonly #messageHandlers: Set<MessageHandler> = new Set();
  readonly #reconnectionHandlers: Set<AgentReconnectionEventHandler> =
    new Set();
  readonly #scopeMemberships: Set<ScopeId> = new Set();

  #agentId: AgentId | null = null;
  #sessionId: SessionId | null = null;
  #serverCapabilities: ParticipantCapabilities | null = null;
  #currentState: AgentState = "registered";
  #connected = false;
  #lastConnectOptions?: {
    agentId?: AgentId;
    auth?: { method: "bearer" | "api-key" | "mtls" | "none"; token?: string };
  };
  #isReconnecting = false;

  constructor(stream: Stream, options: AgentConnectionOptions = {}) {
    this.#connection = new BaseConnection(stream, options);
    this.#options = options;

    // Set up notification handler for events and messages
    this.#connection.setNotificationHandler(
      this.#handleNotification.bind(this),
    );

    // Set up disconnect detection for auto-reconnect
    if (options.reconnection?.enabled && options.createStream) {
      this.#connection.onStateChange((newState) => {
        if (newState === "closed" && this.#connected && !this.#isReconnecting) {
          void this.#handleDisconnect();
        }
      });
    }
  }

  // ===========================================================================
  // Static Factory Methods
  // ===========================================================================

  /**
   * Connect and register an agent via WebSocket URL.
   *
   * Handles:
   * - WebSocket creation and connection
   * - Stream wrapping
   * - Auto-configuration of createStream for reconnection
   * - Initial MAP protocol connect handshake
   * - Agent registration
   *
   * @param url - WebSocket URL (ws:// or wss://)
   * @param options - Connection and agent options
   * @returns Connected and registered AgentConnection instance
   *
   * @example
   * ```typescript
   * const agent = await AgentConnection.connect('ws://localhost:8080', {
   *   name: 'Worker',
   *   role: 'processor',
   *   reconnection: true
   * });
   *
   * // Already registered, ready to work
   * agent.onMessage(handleMessage);
   * await agent.busy();
   * ```
   */
  static async connect(
    url: string,
    options?: AgentConnectOptions,
  ): Promise<AgentConnection> {
    // Validate URL
    const parsedUrl = new URL(url);
    if (!["ws:", "wss:"].includes(parsedUrl.protocol)) {
      throw new Error(
        `Unsupported protocol: ${parsedUrl.protocol}. Use ws: or wss:`,
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
        : typeof options?.reconnection === "object"
          ? options.reconnection
          : undefined;

    // Create connection
    const agent = new AgentConnection(stream, {
      name: options?.name,
      role: options?.role,
      capabilities: options?.capabilities,
      visibility: options?.visibility,
      parent: options?.parent,
      scopes: options?.scopes,
      createStream,
      reconnection,
    });

    // Perform MAP handshake and registration
    await agent.connect({ auth: options?.auth });

    return agent;
  }

  /**
   * Connect and register an agent via agentic-mesh transport.
   *
   * Handles:
   * - Dynamic import of agentic-mesh (optional peer dependency)
   * - Stream creation over encrypted mesh tunnel
   * - Auto-configuration of createStream for reconnection
   * - Initial MAP protocol connect handshake
   * - Agent registration
   *
   * Requires `agentic-mesh` to be installed as a peer dependency.
   *
   * @param options - Mesh connection and agent options
   * @returns Connected and registered AgentConnection instance
   *
   * @example
   * ```typescript
   * import { createNebulaTransport } from 'agentic-mesh';
   *
   * const transport = createNebulaTransport({
   *   configPath: '/etc/nebula/config.yml',
   * });
   *
   * const agent = await AgentConnection.connectMesh({
   *   transport,
   *   peer: { peerId: 'server', address: '10.0.0.1', port: 4242 },
   *   localPeerId: 'my-agent',
   *   name: 'MeshWorker',
   *   role: 'processor',
   *   reconnection: true
   * });
   *
   * agent.onMessage(handleMessage);
   * await agent.busy();
   * ```
   */
  static async connectMesh(
    options: AgentMeshConnectOptions,
  ): Promise<AgentConnection> {
    // Dynamic import for optional peer dependency
    const { agenticMeshStream } = await import("../stream/agentic-mesh");

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
        : typeof options.reconnection === "object"
          ? options.reconnection
          : undefined;

    // Create connection
    const agent = new AgentConnection(stream, {
      name: options.name,
      role: options.role,
      capabilities: options.capabilities,
      visibility: options.visibility,
      parent: options.parent,
      scopes: options.scopes,
      createStream,
      reconnection,
    });

    // Perform MAP handshake and registration
    await agent.connect({ auth: options.auth });

    return agent;
  }

  // ===========================================================================
  // Connection Lifecycle
  // ===========================================================================

  /**
   * Connect and register with the MAP system
   */
  async connect(options?: {
    agentId?: AgentId;
    /** Token to resume a previously disconnected session */
    resumeToken?: string;
    auth?: { method: "bearer" | "api-key" | "mtls" | "none"; token?: string };
  }): Promise<{ connection: ConnectResponseResult; agent: Agent }> {
    // First, establish the connection
    const connectParams: ConnectRequestParams = {
      protocolVersion: PROTOCOL_VERSION,
      participantType: "agent",
      participantId: options?.agentId,
      name: this.#options.name,
      capabilities: this.#options.capabilities,
      resumeToken: options?.resumeToken,
      auth: options?.auth,
    };

    const connectResult = await this.#connection.sendRequest<
      ConnectRequestParams,
      ConnectResponseResult
    >(CORE_METHODS.CONNECT, connectParams);

    this.#sessionId = connectResult.sessionId;
    this.#serverCapabilities = connectResult.capabilities;
    this.#connected = true;

    // Store connect options for potential reconnection
    this.#lastConnectOptions = options;

    // Then register as an agent
    const registerParams: AgentsRegisterRequestParams = {
      agentId: options?.agentId,
      name: this.#options.name,
      role: this.#options.role,
      parent: this.#options.parent,
      scopes: this.#options.scopes,
      visibility: this.#options.visibility,
      capabilities: this.#options.capabilities,
    };

    const registerResult = await this.#connection.sendRequest<
      AgentsRegisterRequestParams,
      AgentsRegisterResponseResult
    >(LIFECYCLE_METHODS.AGENTS_REGISTER, registerParams);

    this.#agentId = registerResult.agent.id;
    this.#currentState = registerResult.agent.state;

    // Transition to connected state
    this.#connection._transitionTo("connected");

    return { connection: connectResult, agent: registerResult.agent };
  }

  /**
   * Authenticate with the server after connection.
   *
   * Use this when the server returns `authRequired` in the connect response,
   * indicating that authentication is needed before registering or accessing
   * protected resources.
   *
   * @param auth - Authentication credentials
   * @returns Authentication result with principal if successful
   *
   * @example
   * ```typescript
   * const agent = new AgentConnection(stream, { name: 'MyAgent' });
   *
   * // First connect to get auth requirements
   * const connectResult = await agent.connectOnly();
   *
   * if (connectResult.authRequired) {
   *   const authResult = await agent.authenticate({
   *     method: 'api-key',
   *     token: process.env.AGENT_API_KEY,
   *   });
   *
   *   if (authResult.success) {
   *     // Now register the agent
   *     await agent.register({ name: 'MyAgent', role: 'worker' });
   *   }
   * }
   * ```
   */
  async authenticate(auth: {
    method: "bearer" | "api-key" | "mtls" | "none";
    token?: string;
  }): Promise<AuthenticateResponseResult> {
    const params: AuthenticateRequestParams = {
      method: auth.method,
      credential: auth.token,
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
    token?: string;
  }): Promise<{
    success: boolean;
    principal?: AuthPrincipal;
    error?: { code: string; message: string };
  }> {
    const params: AuthenticateRequestParams = {
      method: auth.method,
      credential: auth.token,
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
      // Unregister the agent first
      if (this.#agentId) {
        await this.#connection.sendRequest<
          { agentId: AgentId; reason?: string },
          AgentsUnregisterResponseResult
        >(LIFECYCLE_METHODS.AGENTS_UNREGISTER, {
          agentId: this.#agentId,
          reason,
        });
      }

      // Then disconnect
      const result = await this.#connection.sendRequest<
        { reason?: string },
        DisconnectResponseResult
      >(CORE_METHODS.DISCONNECT, reason ? { reason } : undefined);
      resumeToken = result.resumeToken;
    } finally {
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
   * Whether the agent is connected
   */
  get isConnected(): boolean {
    return this.#connected && !this.#connection.isClosed;
  }

  /**
   * This agent's ID
   */
  get agentId(): AgentId | null {
    return this.#agentId;
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
   * Current agent state
   */
  get state(): AgentState {
    return this.#currentState;
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
  // Message Handling
  // ===========================================================================

  /**
   * Register a handler for incoming messages
   */
  onMessage(handler: MessageHandler): this {
    this.#messageHandlers.add(handler);
    return this;
  }

  /**
   * Remove a message handler
   */
  offMessage(handler: MessageHandler): this {
    this.#messageHandlers.delete(handler);
    return this;
  }

  // ===========================================================================
  // State Management
  // ===========================================================================

  /**
   * Update this agent's state
   */
  async updateState(state: AgentState): Promise<Agent> {
    if (!this.#agentId) {
      throw new Error("Agent not registered");
    }

    const result = await this.#connection.sendRequest<
      { agentId: AgentId; state: AgentState },
      AgentsUpdateResponseResult
    >(STATE_METHODS.AGENTS_UPDATE, {
      agentId: this.#agentId,
      state,
    });

    this.#currentState = result.agent.state;
    return result.agent;
  }

  /**
   * Update this agent's metadata
   */
  async updateMetadata(metadata: Record<string, unknown>): Promise<Agent> {
    if (!this.#agentId) {
      throw new Error("Agent not registered");
    }

    const result = await this.#connection.sendRequest<
      { agentId: AgentId; metadata: Record<string, unknown> },
      AgentsUpdateResponseResult
    >(STATE_METHODS.AGENTS_UPDATE, {
      agentId: this.#agentId,
      metadata,
    });

    return result.agent;
  }

  /**
   * Mark this agent as busy
   */
  async busy(): Promise<Agent> {
    return this.updateState("busy");
  }

  /**
   * Mark this agent as idle
   */
  async idle(): Promise<Agent> {
    return this.updateState("idle");
  }

  /**
   * Mark this agent as done/stopped
   */
  async done(result?: {
    exitCode?: number;
    exitReason?: string;
  }): Promise<void> {
    if (!this.#agentId) {
      throw new Error("Agent not registered");
    }

    await this.updateState("stopped");

    // Optionally update metadata with result
    if (result) {
      await this.updateMetadata({
        exitCode: result.exitCode,
        exitReason: result.exitReason,
      });
    }
  }

  // ===========================================================================
  // Child Agent Management
  // ===========================================================================

  /**
   * Spawn a child agent
   */
  async spawn(options: {
    agentId?: AgentId;
    name?: string;
    role?: string;
    visibility?: AgentVisibility;
    capabilities?: ParticipantCapabilities;
    scopes?: ScopeId[];
    initialMessage?: Message;
    metadata?: Record<string, unknown>;
  }): Promise<AgentsSpawnResponseResult> {
    if (!this.#agentId) {
      throw new Error("Agent not registered");
    }

    const params: AgentsSpawnRequestParams = {
      ...options,
      parent: this.#agentId,
    };

    return this.#connection.sendRequest<
      AgentsSpawnRequestParams,
      AgentsSpawnResponseResult
    >(LIFECYCLE_METHODS.AGENTS_SPAWN, params);
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
    meta?: MessageMeta,
  ): Promise<SendResponseResult> {
    const params: SendRequestParams = { to };
    if (payload !== undefined) params.payload = payload;
    if (meta) params.meta = meta;

    return this.#connection.sendRequest(CORE_METHODS.SEND, params);
  }

  /**
   * Send a message to the parent agent
   */
  async sendToParent(
    payload?: unknown,
    meta?: MessageMeta,
  ): Promise<SendResponseResult> {
    return this.send({ parent: true }, payload, {
      ...meta,
      relationship: "child-to-parent",
    });
  }

  /**
   * Send a message to child agents
   */
  async sendToChildren(
    payload?: unknown,
    meta?: MessageMeta,
  ): Promise<SendResponseResult> {
    return this.send({ children: true }, payload, {
      ...meta,
      relationship: "parent-to-child",
    });
  }

  /**
   * Send a message to a specific agent
   */
  async sendToAgent(
    agentId: AgentId,
    payload?: unknown,
    meta?: MessageMeta,
  ): Promise<SendResponseResult> {
    return this.send({ agent: agentId }, payload, meta);
  }

  /**
   * Send a message to all agents in a scope
   */
  async sendToScope(
    scopeId: ScopeId,
    payload?: unknown,
    meta?: MessageMeta,
  ): Promise<SendResponseResult> {
    return this.send({ scope: scopeId }, payload, meta);
  }

  /**
   * Send a message to sibling agents
   */
  async sendToSiblings(
    payload?: unknown,
    meta?: MessageMeta,
  ): Promise<SendResponseResult> {
    return this.send({ siblings: true }, payload, {
      ...meta,
      relationship: "peer",
    });
  }

  /**
   * Reply to a message (uses correlationId from original)
   */
  async reply(
    originalMessage: Message,
    payload?: unknown,
    meta?: MessageMeta,
  ): Promise<SendResponseResult> {
    return this.send({ agent: originalMessage.from as AgentId }, payload, {
      ...meta,
      correlationId: originalMessage.meta?.correlationId ?? originalMessage.id,
      isResult: true,
    });
  }

  // ===========================================================================
  // Scope Management
  // ===========================================================================

  /**
   * Create a new scope
   */
  async createScope(options: ScopesCreateRequestParams): Promise<Scope> {
    const result = await this.#connection.sendRequest<
      ScopesCreateRequestParams,
      ScopesCreateResponseResult
    >(SCOPE_METHODS.SCOPES_CREATE, options);
    return result.scope;
  }

  /**
   * Join a scope
   */
  async joinScope(scopeId: ScopeId): Promise<ScopesJoinResponseResult> {
    if (!this.#agentId) {
      throw new Error("Agent not registered");
    }

    const result = await this.#connection.sendRequest<
      { scopeId: ScopeId; agentId: AgentId },
      ScopesJoinResponseResult
    >(SCOPE_METHODS.SCOPES_JOIN, {
      scopeId,
      agentId: this.#agentId,
    });

    // Track scope membership for potential restoration
    this.#scopeMemberships.add(scopeId);

    return result;
  }

  /**
   * Leave a scope
   */
  async leaveScope(scopeId: ScopeId): Promise<ScopesLeaveResponseResult> {
    if (!this.#agentId) {
      throw new Error("Agent not registered");
    }

    const result = await this.#connection.sendRequest<
      { scopeId: ScopeId; agentId: AgentId },
      ScopesLeaveResponseResult
    >(SCOPE_METHODS.SCOPES_LEAVE, {
      scopeId,
      agentId: this.#agentId,
    });

    // Remove from tracked scope memberships
    this.#scopeMemberships.delete(scopeId);

    return result;
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

    const subscription = createSubscription(
      result.subscriptionId,
      () => this.unsubscribe(result.subscriptionId),
      { filter },
    );

    this.#subscriptions.set(result.subscriptionId, subscription);

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

    await this.#connection.sendRequest<
      { subscriptionId: SubscriptionId },
      UnsubscribeResponseResult
    >(CORE_METHODS.UNSUBSCRIBE, { subscriptionId });
  }

  // ===========================================================================
  // Reconnection
  // ===========================================================================

  /**
   * Current connection state
   */
  get connectionState(): ConnectionState {
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
   */
  onReconnection(handler: AgentReconnectionEventHandler): () => void {
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
    handler: (newState: ConnectionState, oldState: ConnectionState) => void,
  ): () => void {
    return this.#connection.onStateChange(handler);
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
    params?: Omit<MailCreateRequestParams, "_meta">,
  ): Promise<MailCreateResponseResult> {
    return this.#connection.sendRequest<
      MailCreateRequestParams,
      MailCreateResponseResult
    >(MAIL_METHODS.MAIL_CREATE, params ?? {});
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
    include?: MailGetRequestParams["include"],
  ): Promise<MailGetResponseResult> {
    return this.#connection.sendRequest<
      MailGetRequestParams,
      MailGetResponseResult
    >(MAIL_METHODS.MAIL_GET, { conversationId, include });
  }

  /**
   * List conversations with optional filters.
   *
   * @param params - Optional filter, limit, and cursor parameters
   * @returns Paginated list of conversations
   */
  async listConversations(
    params?: Omit<MailListRequestParams, "_meta">,
  ): Promise<MailListResponseResult> {
    return this.#connection.sendRequest<
      MailListRequestParams,
      MailListResponseResult
    >(MAIL_METHODS.MAIL_LIST, params ?? {});
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
    reason?: string,
  ): Promise<MailCloseResponseResult> {
    return this.#connection.sendRequest<
      MailCloseRequestParams,
      MailCloseResponseResult
    >(MAIL_METHODS.MAIL_CLOSE, { conversationId, reason });
  }

  /**
   * Join an existing conversation.
   *
   * @param params - Join parameters including conversationId and optional catch-up config
   * @returns Conversation, participant, and optional history
   */
  async joinConversation(
    params: Omit<MailJoinRequestParams, "_meta">,
  ): Promise<MailJoinResponseResult> {
    return this.#connection.sendRequest<
      MailJoinRequestParams,
      MailJoinResponseResult
    >(MAIL_METHODS.MAIL_JOIN, params);
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
    reason?: string,
  ): Promise<MailLeaveResponseResult> {
    return this.#connection.sendRequest<
      MailLeaveRequestParams,
      MailLeaveResponseResult
    >(MAIL_METHODS.MAIL_LEAVE, { conversationId, reason });
  }

  /**
   * Invite a participant to a conversation.
   *
   * @param params - Invite parameters including conversationId and participant info
   * @returns Invite result
   */
  async inviteToConversation(
    params: Omit<MailInviteRequestParams, "_meta">,
  ): Promise<MailInviteResponseResult> {
    return this.#connection.sendRequest<
      MailInviteRequestParams,
      MailInviteResponseResult
    >(MAIL_METHODS.MAIL_INVITE, params);
  }

  /**
   * Record a turn (message) in a conversation.
   *
   * @param params - Turn parameters including conversationId, contentType, and content
   * @returns The created turn
   */
  async recordTurn(
    params: Omit<MailTurnRequestParams, "_meta">,
  ): Promise<MailTurnResponseResult> {
    return this.#connection.sendRequest<
      MailTurnRequestParams,
      MailTurnResponseResult
    >(MAIL_METHODS.MAIL_TURN, params);
  }

  /**
   * List turns in a conversation with optional filters.
   *
   * @param params - List parameters including conversationId and optional filters
   * @returns Paginated list of turns
   */
  async listTurns(
    params: Omit<MailTurnsListRequestParams, "_meta">,
  ): Promise<MailTurnsListResponseResult> {
    return this.#connection.sendRequest<
      MailTurnsListRequestParams,
      MailTurnsListResponseResult
    >(MAIL_METHODS.MAIL_TURNS_LIST, params);
  }

  /**
   * Create a thread in a conversation.
   *
   * @param params - Thread creation parameters including conversationId and rootTurnId
   * @returns The created thread
   */
  async createThread(
    params: Omit<MailThreadCreateRequestParams, "_meta">,
  ): Promise<MailThreadCreateResponseResult> {
    return this.#connection.sendRequest<
      MailThreadCreateRequestParams,
      MailThreadCreateResponseResult
    >(MAIL_METHODS.MAIL_THREAD_CREATE, params);
  }

  /**
   * List threads in a conversation.
   *
   * @param params - List parameters including conversationId
   * @returns Paginated list of threads
   */
  async listThreads(
    params: Omit<MailThreadListRequestParams, "_meta">,
  ): Promise<MailThreadListResponseResult> {
    return this.#connection.sendRequest<
      MailThreadListRequestParams,
      MailThreadListResponseResult
    >(MAIL_METHODS.MAIL_THREAD_LIST, params);
  }

  /**
   * Get a summary of a conversation.
   *
   * @param params - Summary parameters including conversationId and optional scope/includes
   * @returns Generated summary with optional key points, decisions, and questions
   */
  async getConversationSummary(
    params: Omit<MailSummaryRequestParams, "_meta">,
  ): Promise<MailSummaryResponseResult> {
    return this.#connection.sendRequest<
      MailSummaryRequestParams,
      MailSummaryResponseResult
    >(MAIL_METHODS.MAIL_SUMMARY, params);
  }

  /**
   * Replay turns from a conversation, optionally from a specific point.
   *
   * @param params - Replay parameters including conversationId and optional starting point
   * @returns Replayed turns with pagination info
   */
  async replayConversation(
    params: Omit<MailReplayRequestParams, "_meta">,
  ): Promise<MailReplayResponseResult> {
    return this.#connection.sendRequest<
      MailReplayRequestParams,
      MailReplayResponseResult
    >(MAIL_METHODS.MAIL_REPLAY, params);
  }

  /**
   * Send a message to an agent with mail context attached.
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
    options?: { threadId?: ThreadId; meta?: MessageMeta },
  ): Promise<SendResponseResult> {
    return this.send(to, payload, {
      ...options?.meta,
      mail: { conversationId, threadId: options?.threadId },
    });
  }

  // ===========================================================================
  // Extensions
  // ===========================================================================

  /**
   * Call an extension method on the MAP server.
   *
   * Sends a raw JSON-RPC request with the given method and params.
   * Use this for protocol extensions like trajectory, macro-agent, etc.
   *
   * @param method - The extension method name (e.g., 'trajectory/checkpoint')
   * @param params - Optional parameters for the method
   * @returns The result from the server
   */
  async callExtension<TParams = unknown, TResult = unknown>(
    method: string,
    params?: TParams,
  ): Promise<TResult> {
    return await this.#connection.sendRequest<TParams, TResult>(method, params);
  }

  // ===========================================================================
  // Tasks
  // ===========================================================================

  /**
   * Create a new task.
   *
   * @param params - Task creation parameters
   * @returns The created task
   */
  async createTask(
    params: Omit<TasksCreateRequestParams, "_meta">,
  ): Promise<TasksCreateResponseResult> {
    return this.#connection.sendRequest<
      TasksCreateRequestParams,
      TasksCreateResponseResult
    >(TASK_METHODS.TASKS_CREATE, params);
  }

  /**
   * Assign a task to an agent.
   *
   * @param taskId - ID of the task to assign
   * @param agentId - ID of the agent to assign to
   * @returns The updated task
   */
  async assignTask(
    taskId: TaskId,
    agentId: AgentId,
  ): Promise<TasksAssignResponseResult> {
    return this.#connection.sendRequest<
      TasksAssignRequestParams,
      TasksAssignResponseResult
    >(TASK_METHODS.TASKS_ASSIGN, { taskId, agentId });
  }

  /**
   * Update a task's status or fields.
   *
   * @param params - Update parameters including taskId and fields to change
   * @returns The updated task
   */
  async updateTask(
    params: Omit<TasksUpdateRequestParams, "_meta">,
  ): Promise<TasksUpdateResponseResult> {
    return this.#connection.sendRequest<
      TasksUpdateRequestParams,
      TasksUpdateResponseResult
    >(TASK_METHODS.TASKS_UPDATE, params);
  }

  /**
   * List tasks with optional filters.
   *
   * @param params - Optional filter, limit, and cursor parameters
   * @returns Paginated list of tasks
   */
  async listTasks(
    params?: Omit<TasksListRequestParams, "_meta">,
  ): Promise<TasksListResponseResult> {
    return this.#connection.sendRequest<
      TasksListRequestParams,
      TasksListResponseResult
    >(TASK_METHODS.TASKS_LIST, params ?? {});
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
        const subscription = this.#subscriptions.get(
          eventParams.subscriptionId,
        );
        if (subscription) {
          subscription._pushEvent(eventParams);
        }
        break;
      }

      case NOTIFICATION_METHODS.MESSAGE:
      case NOTIFICATION_METHODS.SEND: {
        const messageParams = params as MessageNotificationParams;
        // Deliver to message handlers.
        // Servers may use either map/message (spec) or map/send (common alias).
        const message =
          messageParams.message ?? (messageParams as unknown as Message);
        for (const handler of this.#messageHandlers) {
          try {
            await handler(message);
          } catch (error) {
            console.error("MAP: Message handler error:", error);
          }
        }
        break;
      }

      default:
        console.warn("MAP: Unknown notification:", method);
    }
  }

  /**
   * Emit a reconnection event to all registered handlers
   */
  #emitReconnectionEvent(
    event: Parameters<AgentReconnectionEventHandler>[0],
  ): void {
    for (const handler of this.#reconnectionHandlers) {
      try {
        handler(event);
      } catch (error) {
        console.error("MAP: Reconnection event handler error:", error);
      }
    }
  }

  /**
   * Handle disconnect when auto-reconnect is enabled
   */
  async #handleDisconnect(): Promise<void> {
    this.#isReconnecting = true;
    this.#connected = false;

    this.#emitReconnectionEvent({ type: "disconnected" });

    try {
      await this.#attemptReconnect();
    } catch (error) {
      this.#isReconnecting = false;
      this.#emitReconnectionEvent({
        type: "reconnectFailed",
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

    // Store current scopes for restoration
    const scopesToRestore = Array.from(this.#scopeMemberships);

    await withRetry(
      async () => {
        // Create a new stream
        const newStream = await createStream();

        // Reconnect the base connection
        await this.#connection.reconnect(newStream);

        // Re-establish connection and registration
        // Use the stored agentId to try to reclaim the same identity
        const result = await this.connect({
          agentId: this.#agentId ?? this.#lastConnectOptions?.agentId,
          auth: this.#lastConnectOptions?.auth,
        });

        // Update stored values
        this.#agentId = result.agent.id;
        this.#sessionId = result.connection.sessionId;
        this.#serverCapabilities = result.connection.capabilities;
        this.#currentState = result.agent.state;
      },
      retryPolicy,
      {
        onRetry: (state) => {
          this.#emitReconnectionEvent({
            type: "reconnecting",
            attempt: state.attempt,
            delay: state.nextDelayMs,
            error: state.lastError,
          });
        },
      },
    );

    this.#isReconnecting = false;
    this.#emitReconnectionEvent({ type: "reconnected" });

    // Restore scope memberships if enabled
    if (options.restoreScopeMemberships !== false) {
      await this.#restoreScopeMemberships(scopesToRestore);
    }
  }

  /**
   * Restore scope memberships after reconnection
   */
  async #restoreScopeMemberships(scopes: ScopeId[]): Promise<void> {
    // Clear tracked memberships (will be re-added by joinScope)
    this.#scopeMemberships.clear();

    for (const scopeId of scopes) {
      try {
        await this.joinScope(scopeId);
      } catch (error) {
        console.warn(
          "MAP: Failed to restore scope membership:",
          scopeId,
          error,
        );
      }
    }
  }
}
