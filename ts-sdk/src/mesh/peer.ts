/**
 * MAPMeshPeer - Decentralized P2P mesh peer
 *
 * Wraps agentic-mesh's MeshPeer to provide a unified interface for
 * decentralized MAP networks where each peer runs its own MapServer.
 *
 * @module
 */

import type {
  AgentId,
  ScopeId,
  AgentState,
  Agent,
  Scope,
  Address,
  Message,
  MessageMeta,
  SubscriptionFilter,
} from '../types';

import type {
  MAPMeshPeerConfig,
  PeerEndpoint,
  CreateAgentConfig,
  CreateScopeConfig,
  LocalAgent,
  SendResult,
  GitSyncService,
  GitSyncClient,
  SyncOptions,
  SyncResult,
  PullOptions,
  PushOptions,
  CloneOptions,
  MeshEventSubscription,
  MAPMeshPeerEvents,
} from './types';

// Import agentic-mesh (peer dependency)
import { createMeshPeer as agenticMeshCreateMeshPeer } from 'agentic-mesh';

/**
 * Internal MeshPeer type from agentic-mesh.
 * We use a minimal interface to avoid tight coupling.
 */
interface MeshPeerLike {
  readonly peerId: string;
  readonly peerName: string;
  readonly isRunning: boolean;
  readonly connectedPeers: string[];
  readonly git: GitTransportServiceLike | null;

  start(transport?: unknown): Promise<void>;
  stop(): Promise<void>;
  connectToPeer(endpoint: PeerEndpoint): Promise<unknown>;
  disconnectFromPeer(peerId: string, reason?: string): Promise<void>;
  createAgent(config: CreateAgentConfig): Promise<AgentConnectionLike>;
  getAgentConnection(agentId: AgentId): AgentConnectionLike | undefined;
  getLocalAgents(): Agent[];
  getAllAgents(): Agent[];
  createScope(config: CreateScopeConfig): Scope;
  getScope(scopeId: ScopeId): Scope | undefined;
  listScopes(): Scope[];
  send(from: AgentId, to: Address, payload: unknown, meta?: MessageMeta): Promise<SendResult>;
  subscribe(participantId: string, filter?: SubscriptionFilter): MeshEventSubscription;

  on<K extends keyof MAPMeshPeerEvents>(event: K, handler: MAPMeshPeerEvents[K]): void;
  off<K extends keyof MAPMeshPeerEvents>(event: K, handler: MAPMeshPeerEvents[K]): void;
  emit<K extends keyof MAPMeshPeerEvents>(event: K, ...args: Parameters<MAPMeshPeerEvents[K]>): boolean;
}

/**
 * Internal AgentConnection type from agentic-mesh.
 * Uses EventEmitter pattern for message handling.
 */
interface AgentConnectionLike {
  readonly agentId: AgentId;
  readonly name: string;
  readonly role?: string;
  readonly state: string;
  readonly isRegistered: boolean;

  register(): Promise<void>;
  unregister(reason?: string): Promise<void>;
  updateState(state: string): Promise<void>;
  updateMetadata(metadata: Record<string, unknown>): Promise<void>;
  send(to: Address, payload: unknown, meta?: MessageMeta): Promise<SendResult>;
  // EventEmitter methods for message handling
  on(event: 'message', handler: (message: unknown) => void): this;
  off(event: 'message', handler: (message: unknown) => void): this;
}

/**
 * Internal GitTransportService type from agentic-mesh.
 */
interface GitTransportServiceLike {
  readonly httpPort: number;
  start(): Promise<void>;
  stop(): Promise<void>;
  createSyncClient(repoPath: string): GitSyncClientLike;
}

/**
 * Internal GitSyncClient type from agentic-mesh.
 */
interface GitSyncClientLike {
  sync(peerId: string, options?: SyncOptions): Promise<SyncResult>;
  fetch(peerId: string, branch?: string): Promise<SyncResult>;
  pull(peerId: string, branch?: string, options?: PullOptions): Promise<SyncResult>;
  push(peerId: string, branch?: string, options?: PushOptions): Promise<SyncResult>;
  clone(peerId: string, destPath: string, options?: CloneOptions): Promise<SyncResult>;
  listRemoteRefs(peerId: string): Promise<Array<{ ref: string; sha: string }>>;
}

/**
 * Decentralized P2P mesh peer with MAP protocol support.
 *
 * Each MAPMeshPeer runs its own MapServer and can connect to other peers
 * for agent discovery, messaging, and git synchronization.
 *
 * @example
 * ```typescript
 * import { createNebulaTransport } from 'agentic-mesh';
 * import { MAPMeshPeer } from '@multi-agent-protocol/sdk';
 *
 * // Create transport
 * const transport = createNebulaTransport({
 *   configPath: '/etc/nebula/config.yml',
 * });
 *
 * // Create mesh peer
 * const peer = await MAPMeshPeer.create({
 *   peerId: 'worker-1',
 *   peerName: 'Worker Node 1',
 *   transport,
 *   git: {
 *     enabled: true,
 *     repoPath: '/workspace/project',
 *   },
 *   peers: [
 *     { peerId: 'coordinator', address: '10.0.0.1', port: 4242 },
 *   ],
 * });
 *
 * // Start the peer
 * await peer.start();
 *
 * // Create a local agent
 * const agent = await peer.createAgent({
 *   name: 'DataProcessor',
 *   role: 'processor',
 * });
 *
 * // Connect to another peer
 * await peer.connectToPeer({ peerId: 'worker-2', address: '10.0.0.3' });
 *
 * // Sync code with connected peer
 * await peer.git?.sync('worker-2', { branch: 'main' });
 *
 * // Clean shutdown
 * await peer.stop();
 * ```
 */
export class MAPMeshPeer {
  readonly #meshPeer: MeshPeerLike;
  readonly #config: MAPMeshPeerConfig;
  readonly #gitService: GitSyncServiceImpl | null;

  private constructor(meshPeer: MeshPeerLike, config: MAPMeshPeerConfig) {
    this.#meshPeer = meshPeer;
    this.#config = config;
    this.#gitService = meshPeer.git
      ? new GitSyncServiceImpl(meshPeer.git, config.git?.repoPath ?? process.cwd())
      : null;
  }

  // ===========================================================================
  // Static Factory
  // ===========================================================================

  /**
   * Create a new MAPMeshPeer.
   *
   * Requires `agentic-mesh` to be installed as a peer dependency.
   *
   * @param config - Peer configuration
   * @returns Promise resolving to the created peer (not yet started)
   */
  static async create(config: MAPMeshPeerConfig): Promise<MAPMeshPeer> {
    const meshPeer = agenticMeshCreateMeshPeer({
      peerId: config.peerId,
      peerName: config.peerName,
      transport: config.transport as any,
      git: config.git as any,
      peers: config.peers as any,
      map: config.map,
    }) as unknown as MeshPeerLike;

    return new MAPMeshPeer(meshPeer, config);
  }

  // ===========================================================================
  // Properties
  // ===========================================================================

  /** Unique peer identifier */
  get peerId(): string {
    return this.#meshPeer.peerId;
  }

  /** Display name for this peer */
  get peerName(): string {
    return this.#meshPeer.peerName;
  }

  /** Whether the peer is currently running */
  get isRunning(): boolean {
    return this.#meshPeer.isRunning;
  }

  /** List of connected peer IDs */
  get connectedPeers(): string[] {
    return this.#meshPeer.connectedPeers;
  }

  /** Git sync service (null if git not enabled) */
  get git(): GitSyncService | null {
    return this.#gitService;
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  /**
   * Start the mesh peer.
   *
   * This starts the transport, MAP server, and git service (if enabled),
   * then connects to any initial peers specified in the config.
   */
  async start(): Promise<void> {
    await this.#meshPeer.start(this.#config.transport);
  }

  /**
   * Stop the mesh peer.
   *
   * This disconnects from all peers, unregisters all agents,
   * stops the git service, MAP server, and transport.
   */
  async stop(): Promise<void> {
    await this.#meshPeer.stop();
  }

  // ===========================================================================
  // Peer Connections
  // ===========================================================================

  /**
   * Connect to a remote peer.
   *
   * After connecting, agents on both peers will be discoverable
   * and messages can be routed between them.
   *
   * @param endpoint - Peer endpoint to connect to
   */
  async connectToPeer(endpoint: PeerEndpoint): Promise<void> {
    await this.#meshPeer.connectToPeer(endpoint);
  }

  /**
   * Disconnect from a peer.
   *
   * @param peerId - ID of peer to disconnect from
   * @param reason - Optional reason for disconnecting
   */
  async disconnectFromPeer(peerId: string, reason?: string): Promise<void> {
    await this.#meshPeer.disconnectFromPeer(peerId, reason);
  }

  /**
   * Check if connected to a specific peer.
   *
   * @param peerId - Peer ID to check
   * @returns true if connected
   */
  isConnectedTo(peerId: string): boolean {
    return this.connectedPeers.includes(peerId);
  }

  // ===========================================================================
  // Agent Management
  // ===========================================================================

  /**
   * Create and register a local agent on this peer's MapServer.
   *
   * @param config - Agent configuration
   * @returns The created agent
   */
  async createAgent(config: CreateAgentConfig): Promise<LocalAgent> {
    const agentConn = await this.#meshPeer.createAgent(config);
    return new LocalAgentImpl(agentConn);
  }

  /**
   * Get a local agent by ID.
   *
   * @param agentId - Agent ID to look up
   * @returns The agent, or undefined if not found
   */
  getAgent(agentId: AgentId): LocalAgent | undefined {
    const conn = this.#meshPeer.getAgentConnection(agentId);
    return conn ? new LocalAgentImpl(conn) : undefined;
  }

  /**
   * Get all local agents on this peer.
   */
  getLocalAgents(): Agent[] {
    return this.#meshPeer.getLocalAgents();
  }

  /**
   * Get all known agents (local and discovered from connected peers).
   */
  getAllAgents(): Agent[] {
    return this.#meshPeer.getAllAgents();
  }

  // ===========================================================================
  // Scope Management
  // ===========================================================================

  /**
   * Create a scope on this peer's MapServer.
   *
   * @param config - Scope configuration
   * @returns The created scope
   */
  createScope(config: CreateScopeConfig): Scope {
    return this.#meshPeer.createScope(config);
  }

  /**
   * Get a scope by ID.
   *
   * @param scopeId - Scope ID to look up
   * @returns The scope, or undefined if not found
   */
  getScope(scopeId: ScopeId): Scope | undefined {
    return this.#meshPeer.getScope(scopeId);
  }

  /**
   * List all scopes on this peer.
   */
  listScopes(): Scope[] {
    return this.#meshPeer.listScopes();
  }

  // ===========================================================================
  // Messaging
  // ===========================================================================

  /**
   * Send a message from an agent to an address.
   *
   * Messages are routed to local agents or forwarded to connected peers.
   *
   * @param from - Sending agent ID
   * @param to - Destination address
   * @param payload - Message payload
   * @param meta - Optional message metadata
   * @returns Send result with delivery status
   */
  async send(
    from: AgentId,
    to: Address,
    payload: unknown,
    meta?: MessageMeta
  ): Promise<SendResult> {
    return this.#meshPeer.send(from, to, payload, meta);
  }

  // ===========================================================================
  // Events
  // ===========================================================================

  /**
   * Subscribe to events from this peer's MapServer.
   *
   * @param filter - Optional filter for event types
   * @returns Event subscription
   */
  subscribe(filter?: SubscriptionFilter): MeshEventSubscription {
    // Use the peer ID as participant for subscriptions
    return this.#meshPeer.subscribe(this.peerId, filter);
  }

  /**
   * Register a handler for peer connection events.
   *
   * @param handler - Function called when a peer connects
   * @returns Unsubscribe function
   */
  onPeerConnected(handler: (peerId: string, endpoint: PeerEndpoint) => void): () => void {
    this.#meshPeer.on('peer:connected', handler);
    return () => this.#meshPeer.off('peer:connected', handler);
  }

  /**
   * Register a handler for peer disconnection events.
   *
   * @param handler - Function called when a peer disconnects
   * @returns Unsubscribe function
   */
  onPeerDisconnected(handler: (peerId: string, reason?: string) => void): () => void {
    this.#meshPeer.on('peer:disconnected', handler);
    return () => this.#meshPeer.off('peer:disconnected', handler);
  }

  /**
   * Register a handler for agent registration events.
   *
   * @param handler - Function called when an agent registers
   * @returns Unsubscribe function
   */
  onAgentRegistered(handler: (agent: Agent) => void): () => void {
    this.#meshPeer.on('agent:registered', handler);
    return () => this.#meshPeer.off('agent:registered', handler);
  }

  /**
   * Register a handler for agent unregistration events.
   *
   * @param handler - Function called when an agent unregisters
   * @returns Unsubscribe function
   */
  onAgentUnregistered(handler: (agent: Agent) => void): () => void {
    this.#meshPeer.on('agent:unregistered', handler);
    return () => this.#meshPeer.off('agent:unregistered', handler);
  }

  /**
   * Register a handler for error events.
   *
   * @param handler - Function called when an error occurs
   * @returns Unsubscribe function
   */
  onError(handler: (error: Error) => void): () => void {
    this.#meshPeer.on('error', handler);
    return () => this.#meshPeer.off('error', handler);
  }
}

// =============================================================================
// Internal Implementations
// =============================================================================

/**
 * Implementation of LocalAgent wrapping AgentConnection.
 */
class LocalAgentImpl implements LocalAgent {
  readonly #conn: AgentConnectionLike;

  constructor(conn: AgentConnectionLike) {
    this.#conn = conn;
  }

  get agentId(): AgentId {
    return this.#conn.agentId;
  }

  get name(): string {
    return this.#conn.name;
  }

  get role(): string | undefined {
    return this.#conn.role;
  }

  get state(): AgentState {
    return this.#conn.state as AgentState;
  }

  async busy(): Promise<void> {
    await this.#conn.updateState('busy');
  }

  async idle(): Promise<void> {
    await this.#conn.updateState('idle');
  }

  async updateState(state: AgentState): Promise<void> {
    await this.#conn.updateState(state);
  }

  async updateMetadata(metadata: Record<string, unknown>): Promise<void> {
    await this.#conn.updateMetadata(metadata);
  }

  async send(to: Address, payload: unknown, meta?: MessageMeta): Promise<SendResult> {
    return this.#conn.send(to, payload, meta);
  }

  onMessage(handler: (message: Message) => void | Promise<void>): () => void {
    const wrappedHandler = (message: unknown) => handler(message as Message);
    this.#conn.on('message', wrappedHandler);
    return () => {
      this.#conn.off('message', wrappedHandler);
    };
  }

  async unregister(reason?: string): Promise<void> {
    await this.#conn.unregister(reason);
  }
}

/**
 * Implementation of GitSyncService wrapping GitTransportService.
 */
class GitSyncServiceImpl implements GitSyncService {
  readonly #service: GitTransportServiceLike;
  readonly #defaultRepoPath: string;
  #defaultClient: GitSyncClientLike | null = null;

  constructor(service: GitTransportServiceLike, defaultRepoPath: string) {
    this.#service = service;
    this.#defaultRepoPath = defaultRepoPath;
  }

  get isRunning(): boolean {
    return true; // Service is managed by MeshPeer lifecycle
  }

  get httpPort(): number {
    return this.#service.httpPort;
  }

  createSyncClient(repoPath: string): GitSyncClient {
    return this.#service.createSyncClient(repoPath);
  }

  #getDefaultClient(): GitSyncClientLike {
    if (!this.#defaultClient) {
      this.#defaultClient = this.#service.createSyncClient(this.#defaultRepoPath);
    }
    return this.#defaultClient;
  }

  async sync(peerId: string, options?: SyncOptions): Promise<SyncResult> {
    return this.#getDefaultClient().sync(peerId, options);
  }

  async pull(peerId: string, branch?: string, options?: PullOptions): Promise<SyncResult> {
    return this.#getDefaultClient().pull(peerId, branch, options);
  }

  async push(peerId: string, branch?: string, options?: PushOptions): Promise<SyncResult> {
    return this.#getDefaultClient().push(peerId, branch, options);
  }

  async clone(peerId: string, destPath: string, options?: CloneOptions): Promise<SyncResult> {
    return this.#getDefaultClient().clone(peerId, destPath, options);
  }
}
