/**
 * Type definitions for MAPMeshPeer
 *
 * These types define the configuration and interfaces for decentralized
 * P2P mesh peers that run their own MAP server.
 */

import type {
  AgentId,
  ScopeId,
  AgentState,
  AgentVisibility,
  Address,
  Message,
  MessageMeta,
  Agent,
  Scope,
  ScopeVisibility,
  Event,
  SubscriptionId,
} from '../types';

// =============================================================================
// Transport Types (compatible with agentic-mesh)
// =============================================================================

/**
 * Peer endpoint for mesh connections.
 */
export interface PeerEndpoint {
  /** Unique peer identifier */
  peerId: string;
  /** Transport-specific address (IP, hostname, etc.) */
  address: string;
  /** Optional port number */
  port?: number;
  /** Additional transport-specific metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Transport adapter interface (subset used by MAPMeshPeer).
 * Full interface is defined in agentic-mesh.
 */
export interface TransportAdapter {
  /** Whether the transport is currently active */
  readonly active: boolean;
  /** Start the transport */
  start(): Promise<void>;
  /** Stop the transport */
  stop(): Promise<void>;
  /** Connect to a peer endpoint */
  connect(endpoint: PeerEndpoint): Promise<boolean>;
  /** Check if connected to a peer */
  isConnected(peerId: string): boolean;
  /** Event emitter methods */
  on(event: string, handler: (...args: unknown[]) => void): void;
  off(event: string, handler: (...args: unknown[]) => void): void;
}

// =============================================================================
// MAPMeshPeer Configuration
// =============================================================================

/**
 * Git sync configuration for MAPMeshPeer.
 */
export interface MeshGitConfig {
  /** Enable git sync service */
  enabled: boolean;
  /** Local repository path */
  repoPath: string;
  /** HTTP port for git-remote-mesh helper (default: 3456) */
  httpPort?: number;
  /** HTTP host to bind (default: 127.0.0.1) */
  httpHost?: string;
  /** Additional git transport options */
  options?: Record<string, unknown>;
}

/**
 * MAP server configuration options.
 */
export interface MeshMapServerConfig {
  /** System name for the MAP server */
  systemName?: string;
  /** Additional server options */
  [key: string]: unknown;
}

/**
 * Configuration for creating a MAPMeshPeer.
 */
export interface MAPMeshPeerConfig {
  /** Unique peer identifier */
  peerId: string;
  /** Display name for this peer */
  peerName?: string;
  /** Transport adapter (from agentic-mesh) */
  transport: TransportAdapter;
  /** Git sync configuration (optional) */
  git?: MeshGitConfig;
  /** Initial peers to connect to on start */
  peers?: PeerEndpoint[];
  /** MAP server configuration */
  map?: MeshMapServerConfig;
}

// =============================================================================
// Agent Types
// =============================================================================

/**
 * Configuration for creating a local agent.
 */
export interface CreateAgentConfig {
  /** Agent ID (auto-generated if not provided) */
  agentId?: AgentId;
  /** Agent name */
  name?: string;
  /** Agent role */
  role?: string;
  /** Initial scopes to join */
  scopes?: ScopeId[];
  /** Agent visibility settings */
  visibility?: AgentVisibility;
  /** Initial metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Result of a send operation.
 */
export interface SendResult {
  /** IDs of participants who received the message */
  delivered: string[];
  /** Failed deliveries with reasons */
  failed?: Array<{
    participantId: string;
    reason: string;
  }>;
}

/**
 * Local agent on this peer's MapServer.
 */
export interface LocalAgent {
  /** Agent ID */
  readonly agentId: AgentId;
  /** Agent name */
  readonly name: string;
  /** Agent role */
  readonly role?: string;
  /** Current agent state */
  readonly state: AgentState;

  // State management
  /** Mark agent as busy */
  busy(): Promise<void>;
  /** Mark agent as idle */
  idle(): Promise<void>;
  /** Update agent state */
  updateState(state: AgentState): Promise<void>;
  /** Update agent metadata */
  updateMetadata(metadata: Record<string, unknown>): Promise<void>;

  // Messaging
  /** Send a message */
  send(to: Address, payload: unknown, meta?: MessageMeta): Promise<SendResult>;
  /** Register message handler */
  onMessage(handler: (message: Message) => void | Promise<void>): () => void;

  // Lifecycle
  /** Unregister this agent */
  unregister(reason?: string): Promise<void>;
}

// =============================================================================
// Scope Types
// =============================================================================

/**
 * Configuration for creating a scope.
 */
export interface CreateScopeConfig {
  /** Scope ID (auto-generated if not provided) */
  scopeId?: ScopeId;
  /** Scope name */
  name?: string;
  /** Scope description */
  description?: string;
  /** Scope visibility */
  visibility?: ScopeVisibility;
  /** Scope metadata */
  metadata?: Record<string, unknown>;
}

// =============================================================================
// Git Sync Types
// =============================================================================

/**
 * Options for sync operations.
 */
export interface SyncOptions {
  /** Branch to sync (default: current branch) */
  branch?: string;
  /** Remote name to use */
  remoteName?: string;
  /** Bidirectional sync (pull then push) */
  bidirectional?: boolean;
  /** Force sync (overwrite conflicts) */
  force?: boolean;
  /** Use rebase instead of merge */
  rebase?: boolean;
}

/**
 * Options for pull operations.
 */
export interface PullOptions {
  /** Use rebase instead of merge */
  rebase?: boolean;
  /** Fast-forward only (fail if not possible) */
  ffOnly?: boolean;
}

/**
 * Options for push operations.
 */
export interface PushOptions {
  /** Force push */
  force?: boolean;
  /** Set upstream tracking */
  setUpstream?: boolean;
  /** Push all branches */
  all?: boolean;
  /** Push tags */
  tags?: boolean;
}

/**
 * Options for clone operations.
 */
export interface CloneOptions {
  /** Branch to clone */
  branch?: string;
  /** Shallow clone depth */
  depth?: number;
  /** Clone as bare repository */
  bare?: boolean;
}

/**
 * Result of a git sync operation.
 */
export interface SyncResult {
  /** Whether operation succeeded */
  success: boolean;
  /** Type of operation performed */
  operation: 'fetch' | 'pull' | 'push' | 'clone' | 'sync';
  /** Peer ID involved */
  peerId: string;
  /** Branch involved */
  branch?: string;
  /** Commits transferred */
  commits?: string[];
  /** Error message if failed */
  error?: string;
  /** Command output */
  output?: string;
}

/**
 * Git sync client for a specific repository.
 */
export interface GitSyncClient {
  /** Bidirectional sync with a peer */
  sync(peerId: string, options?: SyncOptions): Promise<SyncResult>;
  /** Fetch from a peer */
  fetch(peerId: string, branch?: string): Promise<SyncResult>;
  /** Pull from a peer */
  pull(peerId: string, branch?: string, options?: PullOptions): Promise<SyncResult>;
  /** Push to a peer */
  push(peerId: string, branch?: string, options?: PushOptions): Promise<SyncResult>;
  /** Clone from a peer */
  clone(peerId: string, destPath: string, options?: CloneOptions): Promise<SyncResult>;
  /** List refs on remote peer */
  listRemoteRefs(peerId: string): Promise<Array<{ ref: string; sha: string }>>;
}

/**
 * Git sync service exposed by MAPMeshPeer.
 */
export interface GitSyncService {
  /** Whether the git service is running */
  readonly isRunning: boolean;
  /** HTTP port for git-remote-mesh helper */
  readonly httpPort: number;

  /** Create a sync client for a specific repository */
  createSyncClient(repoPath: string): GitSyncClient;

  // Convenience methods (use default repo path)
  /** Sync with a peer */
  sync(peerId: string, options?: SyncOptions): Promise<SyncResult>;
  /** Pull from a peer */
  pull(peerId: string, branch?: string, options?: PullOptions): Promise<SyncResult>;
  /** Push to a peer */
  push(peerId: string, branch?: string, options?: PushOptions): Promise<SyncResult>;
  /** Clone from a peer */
  clone(peerId: string, destPath: string, options?: CloneOptions): Promise<SyncResult>;
}

// =============================================================================
// Event Types
// =============================================================================

/**
 * Event subscription for MAPMeshPeer.
 */
export interface MeshEventSubscription {
  /** Subscription ID */
  readonly id: SubscriptionId;
  /** Async iterator for events */
  [Symbol.asyncIterator](): AsyncIterator<Event>;
  /** Unsubscribe */
  unsubscribe(): Promise<void>;
}

/**
 * Events emitted by MAPMeshPeer.
 */
export interface MAPMeshPeerEvents {
  /** Peer started */
  started: () => void;
  /** Peer stopped */
  stopped: () => void;
  /** Connected to a peer */
  'peer:connected': (peerId: string, endpoint: PeerEndpoint) => void;
  /** Disconnected from a peer */
  'peer:disconnected': (peerId: string, reason?: string) => void;
  /** Agent registered on this peer */
  'agent:registered': (agent: Agent) => void;
  /** Agent unregistered from this peer */
  'agent:unregistered': (agent: Agent) => void;
  /** Scope created */
  'scope:created': (scope: Scope) => void;
  /** Scope deleted */
  'scope:deleted': (scope: Scope) => void;
  /** Error occurred */
  error: (error: Error) => void;
}
