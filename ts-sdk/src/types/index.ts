/**
 * Multi-Agent Protocol (MAP) Type Definitions - v2
 *
 * Core type definitions matching the MAP JSON Schema.
 * These types are the foundation for the TypeScript SDK.
 *
 * v2 Changes:
 * - Fixed ERROR_CODES collision (FEDERATION_AUTH_FAILED)
 * - Added Agent.ownerId for ownership tracking
 * - Reorganized method constants by capability domain
 * - Added EventInput type and createEvent() helper
 * - Added disconnect policy and lifecycle events
 * - Expanded subscription filters
 * - Standardized response shapes (always return entities)
 * - Added hierarchy expansion to agents/get
 * - Added CAPABILITY_REQUIREMENTS mapping
 * - Clarified message event data (no payloads)
 */

// =============================================================================
// Primitive Types & Identifiers
// =============================================================================

/** Unique identifier for any participant (agent, client, system, gateway) */
export type ParticipantId = string;

/** Unique identifier for an agent */
export type AgentId = string;

/** Unique identifier for a scope */
export type ScopeId = string;

/** Unique identifier for a session */
export type SessionId = string;

/** Unique identifier for a message */
export type MessageId = string;

/** Unique identifier for a subscription */
export type SubscriptionId = string;

/** Identifier for correlating related messages */
export type CorrelationId = string;

/** Unique identifier for a conversation (format: 'conv-{ulid}') */
export type ConversationId = string;

/** Unique identifier for a turn within a conversation (format: 'turn-{ulid}') */
export type TurnId = string;

/** Unique identifier for a thread within a conversation (format: 'thread-{ulid}') */
export type ThreadId = string;

/** Unique identifier for a trajectory checkpoint */
export type CheckpointId = string;

/** Unique identifier for a task */
export type TaskId = string;

/** JSON-RPC request ID */
export type RequestId = string | number;

/** MAP protocol version */
export type ProtocolVersion = 1;

/** Unix timestamp in milliseconds */
export type Timestamp = number;

/** Vendor extension metadata */
export type Meta = Record<string, unknown>;

// =============================================================================
// Agent Environment Types
// =============================================================================

/**
 * Compute environment information for an agent.
 * Category names are normative; field conventions within categories are documented separately.
 *
 * @example
 * ```typescript
 * const environment: AgentEnvironment = {
 *   schemaVersion: '1.0',
 *   os: { type: 'linux', version: '22.04' },
 *   process: { cwd: '/home/user/project' },
 *   network: { connectivity: 'full' },
 *   tools: { installed: { python: '3.11', node: '20.0' } }
 * };
 * ```
 */
export interface AgentEnvironment {
  /** Schema version for evolution (e.g., '1.0') */
  schemaVersion?: string;

  /** Self-declared profile compliance (e.g., ['cloud-native', 'ml-ready']) */
  profiles?: string[];

  /** Host/machine info (arch, cpu, memory, gpu) */
  host?: Record<string, unknown>;

  /** Operating system info (type, version) */
  os?: Record<string, unknown>;

  /** Process/runtime info (pid, cwd, runtime) */
  process?: Record<string, unknown>;

  /** Container info if containerized */
  container?: Record<string, unknown>;

  /** Cloud provider info (provider, region) */
  cloud?: Record<string, unknown>;

  /** Kubernetes info if in k8s */
  k8s?: Record<string, unknown>;

  /** Filesystem/workspace info (cwd, mounts, workspace) */
  filesystem?: Record<string, unknown>;

  /** Network info (connectivity, addresses) */
  network?: Record<string, unknown>;

  /** Available tools and runtimes */
  tools?: Record<string, unknown>;

  /** Resource limits and constraints */
  resources?: Record<string, unknown>;

  /** Security/isolation context */
  security?: Record<string, unknown>;

  /** External services and APIs (aiProviders, mcp) */
  services?: Record<string, unknown>;

  /** Allow additional categories */
  [key: string]: unknown;
}

// =============================================================================
// Agent Capability Descriptor Types
// =============================================================================

/**
 * Structured capability descriptor for an agent.
 * Published at registration time via the `capabilityDescriptor` field on Agent.
 * Optional — agents without descriptors still work via role/metadata.
 */
export interface MAPAgentCapabilityDescriptor {
  /** Globally unique capability descriptor ID (e.g., "urn:map:cap:code-review") */
  id?: string;
  /** Semantic version of the capability descriptor */
  version?: string;
  /** Human-readable name */
  name?: string;
  /** Human-readable summary of what this agent does */
  description?: string;
  /** Capability categories this agent supports */
  capabilities?: MAPCapabilityDeclaration[];
  /** Input types this agent can accept */
  accepts?: MAPInterfaceSpec[];
  /** Output types this agent can provide */
  provides?: MAPInterfaceSpec[];
  /** Semantic tags for discovery (searchable) */
  tags?: string[];
}

/**
 * A single capability declaration within an agent's descriptor.
 */
export interface MAPCapabilityDeclaration {
  /** Machine-readable capability identifier (namespaced, e.g., "doc:summarize") */
  id: string;
  /** Capability version */
  version?: string;
  /** What this capability does */
  description?: string;
  /** Interfaces for this specific capability */
  interfaces?: MAPInterfaceSpec[];
}

/**
 * Interface specification for capability inputs/outputs.
 */
export interface MAPInterfaceSpec {
  /** Content type (e.g., "application/json", "text/plain") */
  contentType: string;
  /** JSON Schema URI for the expected payload structure */
  schema?: string;
  /** Description of this interface */
  description?: string;
}

// =============================================================================
// Participant Types
// =============================================================================

/** Type of participant in the protocol */
export type ParticipantType = "agent" | "client" | "system" | "gateway";

/** Transport binding type */
export type TransportType = "websocket" | "stdio" | "inprocess" | "http-sse";

/**
 * Streaming capabilities for backpressure and flow control.
 * Servers advertise these to indicate what features they support.
 */
export interface StreamingCapabilities {
  /** Server can receive and process ack notifications */
  supportsAck?: boolean;
  /** Server will pause sending when client falls behind */
  supportsFlowControl?: boolean;
  /** Server supports pause/resume subscription state */
  supportsPause?: boolean;
}

/** Capabilities of a participant, grouped by category */
export interface ParticipantCapabilities {
  observation?: {
    /** Can subscribe to event streams */
    canObserve?: boolean;
    /** Can query agents and structure */
    canQuery?: boolean;
  };
  messaging?: {
    /** Can send messages */
    canSend?: boolean;
    /** Can receive messages addressed to it */
    canReceive?: boolean;
    /** Can send to scopes/roles */
    canBroadcast?: boolean;
  };
  lifecycle?: {
    /** Can create child agents */
    canSpawn?: boolean;
    /** Can register agents (not as children) */
    canRegister?: boolean;
    /** Can remove agents */
    canUnregister?: boolean;
    /** Can inject context/control agents */
    canSteer?: boolean;
    /** Can request agent termination */
    canStop?: boolean;
  };
  scopes?: {
    /** Can create new scopes */
    canCreateScopes?: boolean;
    /** Can modify and delete scopes */
    canManageScopes?: boolean;
  };
  federation?: {
    /** Can connect to and route to federated systems */
    canFederate?: boolean;
  };
  /** Mail protocol capabilities for conversation/turn tracking */
  mail?: {
    /** Whether mail is enabled (server response only) */
    enabled?: boolean;
    /** Can create new conversations */
    canCreate?: boolean;
    /** Can join existing conversations */
    canJoin?: boolean;
    /** Can invite participants to conversations */
    canInvite?: boolean;
    /** Can view conversation history */
    canViewHistory?: boolean;
    /** Can create threads within conversations */
    canCreateThreads?: boolean;
  };
  /** Workspace file access capabilities */
  workspace?: {
    /** Whether workspace is enabled (server response only) */
    enabled?: boolean;
    /** Can search files by pattern */
    canSearch?: boolean;
    /** Can list files in a directory */
    canList?: boolean;
    /** Can read file contents */
    canRead?: boolean;
  };
  /** Trajectory checkpoint tracking capabilities */
  trajectory?: {
    /** Whether trajectory tracking is enabled (server response only) */
    enabled?: boolean;
    /** Can report trajectory checkpoints */
    canReport?: boolean;
    /** Can list and query checkpoints */
    canQuery?: boolean;
    /** Can request full checkpoint content */
    canRequestContent?: boolean;
  };
  /** Task management capabilities */
  tasks?: {
    /** Whether task management is enabled (server response only) */
    enabled?: boolean;
    /** Can create tasks */
    canCreate?: boolean;
    /** Can assign tasks to agents */
    canAssign?: boolean;
    /** Can update task status and fields */
    canUpdate?: boolean;
    /** Can list and query tasks */
    canList?: boolean;
  };
  /** Resource discovery capabilities */
  resources?: {
    /** Whether resource discovery is enabled (server response only) */
    enabled?: boolean;
    /** Namespaced resource types the hub has handlers for */
    kinds?: string[];
  };
  /**
   * MAP extensions this participant advertises (capability negotiation, advertise-only).
   * Each entry is a MAP-EXT capability URI plus optional version. See docs/map-ext.md.
   * Phase 1: advertise-only — the SDK populates this from mounted manifests and clients
   * MAY read it, but nothing is enforced at runtime yet (consolidation plan §6.0).
   *
   * @example [{ uri: 'urn:map:ext:mail:1' }, { uri: 'urn:map:ext:trajectory:1', version: '1.0.0' }]
   */
  extensions?: Array<{ uri: string; version?: string }>;
  /** Streaming/backpressure capabilities */
  streaming?: StreamingCapabilities;

  /**
   * Protocols supported by this participant.
   * Used for protocol capability discovery.
   *
   * @example ['acp', 'mcp']
   */
  protocols?: string[];

  /**
   * ACP (Agent Client Protocol) capability details.
   * Only present if 'acp' is in the protocols array.
   */
  acp?: ACPCapability;

  _meta?: Meta;
}

/**
 * ACP capability advertisement.
 * Describes what ACP features an agent supports.
 */
export interface ACPCapability {
  /** ACP protocol version supported (e.g., '2024-10-07') */
  version: string;
  /** ACP features supported by this agent */
  features?: string[];
  _meta?: Meta;
}

/** A participant in the MAP protocol */
export interface Participant {
  id: ParticipantId;
  type: ParticipantType;
  name?: string;
  capabilities?: ParticipantCapabilities;
  transport?: TransportType;
  sessionId?: SessionId;
  metadata?: Record<string, unknown>;
  _meta?: Meta;
}

// =============================================================================
// Agent Types
// =============================================================================

/**
 * State of an agent.
 * Standard states are enumerated; custom states use 'x-' prefix.
 */
export type AgentState =
  | "registered"
  | "active"
  | "busy"
  | "idle"
  | "suspended"
  | "stopping"
  | "stopped"
  | "failed"
  | "orphaned"
  | `x-${string}`;

/** Type of relationship between agents */
export type AgentRelationshipType =
  | "peer"
  | "supervisor"
  | "supervised"
  | "collaborator";

/** A relationship between agents */
export interface AgentRelationship {
  type: AgentRelationshipType;
  agentId: AgentId;
  metadata?: Record<string, unknown>;
  _meta?: Meta;
}

/** Lifecycle metadata for an agent */
export interface AgentLifecycle {
  createdAt?: Timestamp;
  startedAt?: Timestamp;
  stoppedAt?: Timestamp;
  lastActiveAt?: Timestamp;
  orphanedAt?: Timestamp;
  exitCode?: number;
  exitReason?: string;
  _meta?: Meta;
}

// =============================================================================
// Persistent Identity Types
// =============================================================================

/**
 * How the identity was established.
 * Standard types align with agent-iam providers; custom types use "x-" prefix.
 *
 * Provider routing by persistentId prefix:
 * - "did:key:..."        → keypair
 * - "key:..."            → keypair (legacy)
 * - "platform:..."       → platform
 * - "spiffe://..."       → attested
 * - "did:web:..."        → decentralized
 * - "did:wba:..."        → decentralized
 */
export type IdentityType =
  | "keypair"
  | "platform"
  | "attested"
  | "decentralized"
  | `x-${string}`;

/**
 * How the server verified the agent's persistent identity.
 *
 * - "verified": Server cryptographically verified the proof
 * - "auth-derived": Identity was extracted from a verified auth token
 * - "self-declared": Agent presented identity but proof was not verified
 * - "unverified": No proof was provided
 *
 * Per Option D: Servers MUST NOT set "verified" unless cryptographic
 * verification succeeded. If proof is present, servers SHOULD attempt
 * verification.
 */
export type IdentityVerificationStatus =
  | "verified"
  | "auth-derived"
  | "self-declared"
  | "unverified";

/**
 * JSON Web Key (JWK) representation of a public key (RFC 7517).
 * Used for DID and Verifiable Credentials interoperability.
 *
 * For Ed25519 keys:
 * - kty: "OKP"
 * - crv: "Ed25519"
 * - x: base64url-encoded raw 32-byte public key
 */
export interface AgentPublicKeyJwk {
  kty: string;
  crv?: string;
  x?: string;
  [key: string]: unknown;
}

/**
 * Legacy authority endorsement format.
 * Kept for backward compatibility with agent-iam < 0.0.3.
 */
export interface AgentEndorsement {
  /** Identifier of the endorsing authority */
  authorityId: string;
  /** The authority's public key (PEM) for verification */
  authorityPublicKey?: string;
  /** What the authority is claiming (e.g., "member-of:acme-engineering") */
  claim: string;
  /** Cryptographic signature over persistentId + publicKey + claim */
  signature: string;
  /** When the endorsement was issued (ISO 8601) */
  issuedAt: string;
  /** When the endorsement expires (ISO 8601, optional) */
  expiresAt?: string;
}

/**
 * W3C Verifiable Credential endorsement format (aligned with VC Data Model 2.0).
 *
 * Enables interoperability with the broader VC ecosystem.
 * Proof is computed over a JCS (RFC 8785) canonicalization of the credential fields.
 */
export interface AgentVerifiableCredential {
  type: "VerifiableCredential";
  issuer: {
    /** Issuer identifier (DID, URI, or plain string) */
    id: string;
    /** Human-readable name */
    name?: string;
  };
  /** When the credential was issued (ISO 8601) */
  issuanceDate: string;
  /** When the credential expires (ISO 8601, optional) */
  expirationDate?: string;
  credentialSubject: {
    /** The agent's persistentId (e.g., "did:key:z6Mk...") */
    id: string;
    /** What is being attested */
    claim: string;
  };
  proof: {
    type: "Ed25519Signature2020";
    /** Issuer's key reference (e.g., "did:key:z6Mk...#z6Mk...") */
    verificationMethod: string;
    /** When the proof was created (ISO 8601) */
    created: string;
    /** base64url-encoded Ed25519 signature over JCS-canonicalized payload */
    proofValue: string;
  };
}

/**
 * An endorsement can be either the legacy format or W3C VC format.
 * Both are supported for backward compatibility.
 * Use isVerifiableCredential() / isLegacyEndorsement() to discriminate.
 */
export type Endorsement = AgentEndorsement | AgentVerifiableCredential;

/** Type guard for W3C VC-format endorsements */
export function isVerifiableCredential(e: Endorsement): e is AgentVerifiableCredential {
  return "type" in e && (e as AgentVerifiableCredential).type === "VerifiableCredential";
}

/** Type guard for legacy endorsements */
export function isLegacyEndorsement(e: Endorsement): e is AgentEndorsement {
  return "authorityId" in e;
}

/**
 * Proof binding a persistent identity to the current session.
 * Prevents replay attacks by tying the proof to a specific challenge.
 */
export interface AgentIdentityProof {
  /** The challenge/nonce that was signed */
  challenge: string;
  /** Cryptographic signature over the challenge */
  signature: string;
  /** When the proof was generated (ISO 8601) */
  provenAt: string;
}

/**
 * Persistent identity for an agent that survives across sessions and connections.
 *
 * Identity ("who you are") is separate from capability ("what you can do")
 * and from the transient AgentId assigned per registration.
 *
 * The persistentId format depends on the identity type:
 * - keypair:       "did:key:z6Mk..." (W3C DID:key) or "key:..." (legacy)
 * - platform:      "platform:{uuid}"
 * - attested:      "spiffe://trust-domain/path" (CNCF SPIFFE)
 * - decentralized: "did:web:domain:path" or "did:wba:domain:path"
 *
 * The persistentId is stable across:
 * - Session boundaries (disconnect/reconnect)
 * - Token refresh and expiration
 * - Delegation chains (parent → child)
 * - Federation (cross-system movement)
 */
export interface AgentPersistentIdentity {
  /** Stable identifier across sessions */
  persistentId: string;
  /** How this identity was established */
  identityType: IdentityType;
  /** Public key for self-certifying verification (PEM format) */
  publicKey?: string;
  /** Public key in JWK format (for DID/VC ecosystem interop) */
  publicKeyJwk?: AgentPublicKeyJwk;
  /** Proof binding this identity to the current session */
  proof?: AgentIdentityProof;
  /** Endorsements for progressive trust (supports both legacy and VC formats) */
  endorsements?: Endorsement[];
  /**
   * How the server verified this identity.
   * Set by the server, not the client. Servers MUST NOT set "verified"
   * unless cryptographic verification succeeded.
   */
  verificationStatus?: IdentityVerificationStatus;
  _meta?: Meta;
}

/** Who can see this agent */
export type AgentVisibility = "public" | "parent-only" | "scope" | "system";

/** An agent in the multi-agent system */
export interface Agent {
  id: AgentId;

  /**
   * The participant that owns/controls this agent's connection.
   * Used for message routing and cleanup on disconnect.
   *
   * - Non-null: Agent is owned by the specified participant
   * - null: Agent is orphaned (owner disconnected with 'orphan' policy)
   */
  ownerId: ParticipantId | null;

  name?: string;
  description?: string;

  /** Parent agent ID (for spawned agents) */
  parent?: AgentId;

  /** Child agent IDs (populated when queried with include.children) */
  children?: AgentId[];

  relationships?: AgentRelationship[];
  state: AgentState;
  role?: string;
  scopes?: ScopeId[];

  /**
   * Simple visibility setting (legacy).
   * @deprecated Use permissionOverrides.canSee.agents for more granular control
   */
  visibility?: AgentVisibility;

  /**
   * Per-agent permission overrides.
   * Merged on top of role-based defaults from system configuration.
   * Only include fields that differ from the role default.
   *
   * @example
   * ```typescript
   * // Agent that accepts messages from clients (unlike role default)
   * permissionOverrides: {
   *   acceptsFrom: { clients: 'all' }
   * }
   * ```
   */
  permissionOverrides?: Partial<AgentPermissions>;

  lifecycle?: AgentLifecycle;
  capabilities?: ParticipantCapabilities;

  /** Compute environment where this agent runs */
  environment?: AgentEnvironment;

  /** Structured capability descriptor for rich agent discovery */
  capabilityDescriptor?: MAPAgentCapabilityDescriptor;

  /**
   * Persistent identity that survives across sessions.
   * When present, identifies this agent instance across reconnections,
   * token refreshes, and federation boundaries.
   */
  persistentIdentity?: AgentPersistentIdentity;

  metadata?: Record<string, unknown>;
  _meta?: Meta;
}

/**
 * Check if an agent is orphaned (owner disconnected).
 * Orphaned agents have `ownerId === null`.
 */
export function isOrphanedAgent(agent: Agent): boolean {
  return agent.ownerId === null;
}

// =============================================================================
// Agent Permission Types
// =============================================================================

/**
 * Rule for which agents this agent can see.
 * - 'all': Can see any agent in the system
 * - 'hierarchy': Can see parent, children, ancestors, descendants
 * - 'scoped': Can see agents in the same scopes
 * - 'direct': Can only see explicitly included agents
 * - { include: [...] }: Explicit allowlist of agent IDs
 */
export type AgentVisibilityRule =
  | "all"
  | "hierarchy"
  | "scoped"
  | "direct"
  | { include: AgentId[] };

/**
 * Rule for which scopes this agent can see.
 * - 'all': Can see any scope
 * - 'member': Can only see scopes they're a member of
 * - { include: [...] }: Explicit allowlist of scope IDs
 */
export type ScopeVisibilityRule = "all" | "member" | { include: ScopeId[] };

/**
 * Rule for how much agent hierarchy structure this agent can see.
 * - 'full': Can see the full agent hierarchy tree
 * - 'local': Can see immediate parent and children only
 * - 'none': Cannot see hierarchy relationships
 */
export type StructureVisibilityRule = "full" | "local" | "none";

/**
 * Rule for which agents this agent can send messages to.
 * - 'all': Can message any agent
 * - 'hierarchy': Can message parent, children, ancestors, descendants
 * - 'scoped': Can message agents in the same scopes
 * - { include: [...] }: Explicit allowlist of agent IDs
 */
export type AgentMessagingRule =
  | "all"
  | "hierarchy"
  | "scoped"
  | { include: AgentId[] };

/**
 * Rule for which scopes this agent can send messages to.
 * - 'all': Can send to any scope
 * - 'member': Can only send to scopes they're a member of
 * - { include: [...] }: Explicit allowlist of scope IDs
 */
export type ScopeMessagingRule = "all" | "member" | { include: ScopeId[] };

/**
 * Rule for which agents this agent accepts messages from.
 * - 'all': Accepts from any agent
 * - 'hierarchy': Accepts from parent, children, ancestors, descendants
 * - 'scoped': Accepts from agents in the same scopes
 * - { include: [...] }: Explicit allowlist of agent IDs
 */
export type AgentAcceptanceRule =
  | "all"
  | "hierarchy"
  | "scoped"
  | { include: AgentId[] };

/**
 * Rule for which clients this agent accepts messages from.
 * - 'all': Accepts from any client
 * - 'none': Does not accept from any client
 * - { include: [...] }: Explicit allowlist of participant IDs
 */
export type ClientAcceptanceRule =
  | "all"
  | "none"
  | { include: ParticipantId[] };

/**
 * Rule for which federated systems this agent accepts messages from.
 * - 'all': Accepts from any federated system
 * - 'none': Does not accept from any federated system
 * - { include: [...] }: Explicit allowlist of system IDs
 */
export type SystemAcceptanceRule = "all" | "none" | { include: string[] };

/**
 * Permission configuration for an agent.
 * Defines what the agent can see, who it can message, and who it accepts messages from.
 *
 * Used in two ways:
 * 1. As role-based defaults in system configuration
 * 2. As per-agent overrides via Agent.permissionOverrides
 *
 * @example
 * ```typescript
 * const workerPermissions: AgentPermissions = {
 *   canSee: {
 *     agents: 'hierarchy',
 *     scopes: 'member',
 *     structure: 'local',
 *   },
 *   canMessage: {
 *     agents: 'hierarchy',
 *     scopes: 'member',
 *   },
 *   acceptsFrom: {
 *     agents: 'hierarchy',
 *     clients: 'none',
 *     systems: 'none',
 *   },
 * };
 * ```
 */
export interface AgentPermissions {
  /** Rules for what this agent can see */
  canSee?: {
    /** Which agents this agent can see */
    agents?: AgentVisibilityRule;
    /** Which scopes this agent can see */
    scopes?: ScopeVisibilityRule;
    /** How much hierarchy structure this agent can see */
    structure?: StructureVisibilityRule;
  };
  /** Rules for who this agent can send messages to */
  canMessage?: {
    /** Which agents this agent can message */
    agents?: AgentMessagingRule;
    /** Which scopes this agent can send to */
    scopes?: ScopeMessagingRule;
  };
  /** Rules for who this agent accepts messages from */
  acceptsFrom?: {
    /** Which agents this agent accepts messages from */
    agents?: AgentAcceptanceRule;
    /** Which clients this agent accepts messages from */
    clients?: ClientAcceptanceRule;
    /** Which federated systems this agent accepts messages from */
    systems?: SystemAcceptanceRule;
  };
}

/**
 * System-level configuration for agent permissions.
 * Defines default permissions and role-based permission templates.
 *
 * Resolution order:
 * 1. Start with defaultPermissions
 * 2. If agent has a role, deep merge rolePermissions[role]
 * 3. Deep merge agent.permissionOverrides
 *
 * @example
 * ```typescript
 * const config: AgentPermissionConfig = {
 *   defaultPermissions: {
 *     canSee: { agents: 'hierarchy', scopes: 'member', structure: 'local' },
 *     canMessage: { agents: 'hierarchy', scopes: 'member' },
 *     acceptsFrom: { agents: 'hierarchy', clients: 'none', systems: 'none' },
 *   },
 *   rolePermissions: {
 *     coordinator: {
 *       canSee: { agents: 'all', scopes: 'all', structure: 'full' },
 *       canMessage: { agents: 'all', scopes: 'all' },
 *       acceptsFrom: { agents: 'all', clients: 'all', systems: 'none' },
 *     },
 *   },
 * };
 * ```
 */
export interface AgentPermissionConfig {
  /** Default permissions for agents without a role or role-specific config */
  defaultPermissions: AgentPermissions;
  /** Role-based permission templates */
  rolePermissions: Record<string, AgentPermissions>;
}

// =============================================================================
// Addressing Types
// =============================================================================

/** Address a single agent directly */
export interface DirectAddress {
  agent: AgentId;
}

/** Address multiple agents */
export interface MultiAddress {
  agents: AgentId[];
}

/** Address all agents in a scope */
export interface ScopeAddress {
  scope: ScopeId;
}

/** Address agents by role, optionally within a scope */
export interface RoleAddress {
  role: string;
  within?: ScopeId;
}

/** Address relative to sender in hierarchy */
export interface HierarchicalAddress {
  parent?: true;
  children?: true;
  ancestors?: true;
  descendants?: true;
  siblings?: true;
  depth?: number;
}

/** Address all agents in the system */
export interface BroadcastAddress {
  broadcast: true;
}

/** Address the system/router itself */
export interface SystemAddress {
  system: true;
}

/** Address any participant by ID or category */
export interface ParticipantAddress {
  participant?: ParticipantId;
  participants?: "all" | "agents" | "clients";
}

/** Address an agent in a federated system */
export interface FederatedAddress {
  system: string;
  agent: AgentId;
}

/** Flexible addressing for any topology */
export type Address =
  | string
  | DirectAddress
  | MultiAddress
  | ScopeAddress
  | RoleAddress
  | HierarchicalAddress
  | BroadcastAddress
  | SystemAddress
  | ParticipantAddress
  | FederatedAddress;

// =============================================================================
// Message Types
// =============================================================================

/** Message priority */
export type MessagePriority = "urgent" | "high" | "normal" | "low";

/** Message delivery guarantees */
export type DeliverySemantics =
  | "fire-and-forget"
  | "acknowledged"
  | "guaranteed";

/** Relationship context for the message */
export type MessageRelationship =
  | "parent-to-child"
  | "child-to-parent"
  | "peer"
  | "broadcast";

/** Metadata for a message */
export interface MessageMeta {
  timestamp?: Timestamp;
  relationship?: MessageRelationship;
  expectsResponse?: boolean;
  correlationId?: CorrelationId;
  isResult?: boolean;
  priority?: MessagePriority;
  delivery?: DeliverySemantics;
  ttlMs?: number;
  /**
   * Protocol identifier for tunneled protocols (e.g., 'acp').
   * Used to identify the protocol of the payload.
   */
  protocol?: string;
  /**
   * Mail turn tracking metadata.
   * When present on map/send, the server records a turn in the specified
   * conversation in addition to routing the message.
   */
  mail?: MailMessageMeta;
  _meta?: Meta;
}

/** A message in the multi-agent system */
export interface Message<T = unknown> {
  id: MessageId;
  from: ParticipantId;
  to: Address;
  timestamp: Timestamp;
  payload?: T;
  meta?: MessageMeta;
  _meta?: Meta;
}

// =============================================================================
// Scope Types
// =============================================================================

/** Policy for joining a scope */
export type JoinPolicy = "open" | "invite" | "role" | "system";

/** Who can see the scope exists and its members */
export type ScopeVisibility = "public" | "members" | "system";

/** Who can see messages sent to this scope */
export type MessageVisibility = "public" | "members" | "system";

/** Who can send messages to this scope */
export type SendPolicy = "members" | "any";

/** A scope for grouping agents */
export interface Scope {
  id: ScopeId;
  name?: string;
  description?: string;
  parent?: ScopeId;
  joinPolicy?: JoinPolicy;
  autoJoinRoles?: string[];
  visibility?: ScopeVisibility;
  messageVisibility?: MessageVisibility;
  sendPolicy?: SendPolicy;
  persistent?: boolean;
  autoDelete?: boolean;
  metadata?: Record<string, unknown>;
  _meta?: Meta;
}

// =============================================================================
// Event Types
// =============================================================================

/**
 * Event type constants.
 * Use these instead of string literals for type safety and autocomplete.
 */
export const EVENT_TYPES = {
  // Agent lifecycle events
  AGENT_REGISTERED: "agent_registered",
  AGENT_UNREGISTERED: "agent_unregistered",
  AGENT_STATE_CHANGED: "agent_state_changed",
  AGENT_ENVIRONMENT_CHANGED: "agent_environment_changed",
  AGENT_ORPHANED: "agent_orphaned",

  // Participant lifecycle events
  PARTICIPANT_CONNECTED: "participant_connected",
  PARTICIPANT_DISCONNECTED: "participant_disconnected",

  // Message events
  MESSAGE_SENT: "message_sent",
  MESSAGE_DELIVERED: "message_delivered",
  MESSAGE_FAILED: "message_failed",

  // Scope events
  SCOPE_CREATED: "scope_created",
  SCOPE_DELETED: "scope_deleted",
  SCOPE_MEMBER_JOINED: "scope_member_joined",
  SCOPE_MEMBER_LEFT: "scope_member_left",

  // Permission events
  PERMISSIONS_CLIENT_UPDATED: "permissions_client_updated",
  PERMISSIONS_AGENT_UPDATED: "permissions_agent_updated",

  // System events
  SYSTEM_ERROR: "system_error",

  // Agent identity events
  AGENT_RESUMED: "agent.resumed",
  AGENT_IDENTITY_VERIFICATION_FAILED: "agent.identity.verification.failed",

  // Credential events
  CREDENTIAL_ISSUED: "credential.issued",
  CREDENTIAL_DENIED: "credential.denied",

  // Federation events
  FEDERATION_CONNECTED: "federation_connected",
  FEDERATION_DISCONNECTED: "federation_disconnected",

  // Trajectory events
  TRAJECTORY_CHECKPOINT: "trajectory.checkpoint",
  TRAJECTORY_CONTENT_AVAILABLE: "trajectory.content.available",

  // Task events
  TASK_CREATED: "task.created",
  TASK_ASSIGNED: "task.assigned",
  TASK_STATUS: "task.status",
  TASK_COMPLETED: "task.completed",

  // Mail events
  MAIL_CREATED: "mail.created",
  MAIL_CLOSED: "mail.closed",
  MAIL_PARTICIPANT_JOINED: "mail.participant.joined",
  MAIL_PARTICIPANT_LEFT: "mail.participant.left",
  MAIL_TURN_ADDED: "mail.turn.added",
  MAIL_TURN_UPDATED: "mail.turn.updated",
  MAIL_THREAD_CREATED: "mail.thread.created",
  MAIL_SUMMARY_GENERATED: "mail.summary.generated",
} as const;

/** Type of system event (derived from EVENT_TYPES) */
export type EventType = (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES];

/**
 * Input for creating events.
 * id and timestamp are optional - server generates them.
 */
export interface EventInput {
  type: EventType;
  timestamp?: Timestamp;
  source?: ParticipantId;
  data?: Record<string, unknown>;
  causedBy?: string[];
  _meta?: Meta;
}

/**
 * Wire event as sent to clients.
 * id and timestamp are always present.
 */
export interface Event {
  id: string;
  type: EventType;
  timestamp: Timestamp;
  source?: ParticipantId;
  data?: Record<string, unknown>;
  causedBy?: string[];
  _meta?: Meta;
}

/** Helper to create events with auto-generated id and timestamp */
export function createEvent(input: EventInput): Event {
  return {
    id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: input.timestamp ?? Date.now(),
    type: input.type,
    source: input.source,
    data: input.data,
    causedBy: input.causedBy,
    _meta: input._meta,
  };
}

// =============================================================================
// Subscription Types
// =============================================================================

/**
 * Filter for event subscriptions.
 *
 * ## Combination Logic
 *
 * All specified fields are combined with **AND** logic:
 * - An event must match ALL specified criteria to be delivered
 * - Within array fields, values are combined with **OR** logic
 * - Empty arrays (`[]`) are treated as "no filter" (matches any)
 * - Undefined/omitted fields are treated as "no filter" (matches any)
 *
 * ## Examples
 *
 * ```typescript
 * // Match agent_registered OR agent_unregistered events from agent-1 OR agent-2
 * {
 *   eventTypes: ['agent_registered', 'agent_unregistered'],
 *   fromAgents: ['agent-1', 'agent-2']
 * }
 *
 * // Match any event from agents with role 'worker' OR 'supervisor'
 * { fromRoles: ['worker', 'supervisor'] }
 *
 * // Match scope events in scope-1 with metadata containing priority='high'
 * {
 *   scopes: ['scope-1'],
 *   metadataMatch: { priority: 'high' }
 * }
 * ```
 *
 * ## Field Semantics
 *
 * | Field | Within-field | Cross-field | Description |
 * |-------|--------------|-------------|-------------|
 * | `eventTypes` | OR | AND | Event type is one of the listed types |
 * | `fromAgents` | OR | AND | Event source is one of the listed agents |
 * | `fromRoles` | OR | AND | Event source agent has one of the listed roles |
 * | `roles` | OR | AND | Event relates to agents with one of the listed roles |
 * | `scopes` | OR | AND | Event relates to one of the listed scopes |
 * | `priorities` | OR | AND | Message priority is one of the listed levels |
 * | `correlationIds` | OR | AND | Event has one of the listed correlation IDs |
 * | `metadataMatch` | AND | AND | Event metadata contains ALL specified key-value pairs |
 */
export interface SubscriptionFilter {
  /**
   * Filter by roles the event relates to.
   * Matches events where the related agent has one of these roles.
   */
  roles?: string[];

  /**
   * Filter by scopes the event relates to.
   * Matches events with scopeId in event.data matching one of these.
   */
  scopes?: ScopeId[];

  /**
   * Filter by event type.
   * Use EVENT_TYPES constants: `eventTypes: [EVENT_TYPES.AGENT_REGISTERED]`
   */
  eventTypes?: EventType[];

  /**
   * Filter by message priority (for message events).
   */
  priorities?: MessagePriority[];

  /**
   * Filter by correlation ID.
   * Matches events with correlationId in event.data matching one of these.
   */
  correlationIds?: CorrelationId[];

  /**
   * Filter by source agent ID.
   * Matches events where event.source is one of these agent IDs.
   */
  fromAgents?: AgentId[];

  /**
   * Filter by source agent role.
   * Matches events where the source agent has one of these roles.
   */
  fromRoles?: string[];

  /**
   * Filter by metadata key-value pairs.
   * All specified pairs must match (AND logic within this field).
   * Checks event.data.metadata for matching values.
   */
  metadataMatch?: Record<string, unknown>;

  /**
   * Filter by agent environment attributes.
   * Matches events from agents whose environment contains matching values.
   * Uses dot notation for nested fields (e.g., 'os.type', 'cloud.region').
   *
   * @example
   * ```typescript
   * environmentMatch: {
   *   'os.type': 'linux',
   *   'cloud.provider': 'aws'
   * }
   * ```
   */
  environmentMatch?: Record<string, unknown>;

  /**
   * Mail-specific filter for conversation events.
   * Matches mail events related to a specific conversation, thread,
   * participant, or content type.
   */
  mail?: MailSubscriptionFilter;

  /**
   * Trajectory-specific filter for checkpoint events.
   * Matches trajectory events for a specific agent, session, or branch.
   */
  trajectory?: TrajectorySubscriptionFilter;

  _meta?: Meta;
}

/** Options for subscriptions */
export interface SubscriptionOptions {
  /** Include full payloads in message events (default: false) */
  includeMessagePayloads?: boolean;
  /** Exclude events from own actions (default: false) */
  excludeOwnEvents?: boolean;
}

/** An active event subscription */
export interface Subscription {
  id: SubscriptionId;
  filter?: SubscriptionFilter;
  options?: SubscriptionOptions;
  createdAt?: Timestamp;
  replayFrom?: Timestamp | string;
  _meta?: Meta;
}

// =============================================================================
// Subscription Backpressure Types
// =============================================================================

/**
 * State of a subscription's event delivery.
 * - 'active': Events are being delivered normally
 * - 'paused': Events are buffered but not delivered to the iterator
 * - 'closed': Subscription is terminated
 */
export type SubscriptionState = "active" | "paused" | "closed";

/**
 * Information about events dropped due to buffer overflow.
 * Passed to overflow handlers when events cannot be buffered.
 */
export interface OverflowInfo {
  /** Number of events dropped in this overflow batch */
  eventsDropped: number;
  /** Event ID of oldest dropped event (if available) */
  oldestDroppedId?: string;
  /** Event ID of newest dropped event (if available) */
  newestDroppedId?: string;
  /** Timestamp when overflow occurred */
  timestamp: Timestamp;
  /** Total events dropped since subscription started */
  totalDropped: number;
}

/** Handler called when subscription buffer overflows */
export type OverflowHandler = (info: OverflowInfo) => void;

/**
 * Parameters for acknowledging received events.
 * Sent as a notification to inform the server of client progress.
 * Enables optional server-side flow control.
 */
export interface SubscriptionAckParams {
  /** Subscription being acknowledged */
  subscriptionId: SubscriptionId;
  /** Acknowledge all events up to and including this sequence number */
  upToSequence: number;
  _meta?: Meta;
}

/** Notification for subscription acknowledgment */
export interface SubscriptionAckNotification extends MAPNotificationBase<SubscriptionAckParams> {
  method: "map/subscribe.ack";
  params: SubscriptionAckParams;
}

// =============================================================================
// Message Event Data Types
// =============================================================================

/**
 * Data for message_sent events.
 *
 * Payload is included for subscribers that have permission to observe the
 * event stream. Access control is enforced at the subscription level —
 * clients that can subscribe are trusted to see message content.
 */
export interface MessageSentEventData {
  messageId: MessageId;
  from: ParticipantId;
  to: Address;
  timestamp: Timestamp;
  correlationId?: CorrelationId;
  priority?: MessagePriority;
  payload?: unknown;
}

/**
 * Data for message_delivered events.
 *
 * Payload is included for subscribers that have permission to observe the
 * event stream. Access control is enforced at the subscription level.
 */
export interface MessageDeliveredEventData {
  messageId: MessageId;
  from: ParticipantId;
  deliveredTo: ParticipantId[];
  timestamp: Timestamp;
  correlationId?: CorrelationId;
  payload?: unknown;
}

/** Data for message_failed events */
export interface MessageFailedEventData {
  messageId: MessageId;
  from: ParticipantId;
  to: Address;
  reason: string;
  code?: number;
}

// =============================================================================
// Error Types
// =============================================================================

/** Category of error for handling decisions */
export type ErrorCategory =
  | "protocol"
  | "auth"
  | "routing"
  | "agent"
  | "resource"
  | "federation"
  | "mail"
  | "trajectory"
  | "internal";

/** Structured error data */
export interface MAPErrorData {
  category?: ErrorCategory;
  retryable?: boolean;
  retryAfterMs?: number;
  details?: Record<string, unknown>;
  _meta?: Meta;
}

/** JSON-RPC 2.0 error object */
export interface MAPError {
  code: number;
  message: string;
  data?: MAPErrorData;
}

// =============================================================================
// JSON-RPC Base Types
// =============================================================================

/** JSON-RPC version constant */
export const JSONRPC_VERSION = "2.0" as const;

/** Base JSON-RPC request */
export interface MAPRequestBase<TParams = unknown> {
  jsonrpc: "2.0";
  id: RequestId;
  method: string;
  params?: TParams;
}

/** Base JSON-RPC response (success) */
export interface MAPResponseSuccess<T = unknown> {
  jsonrpc: "2.0";
  id: RequestId;
  result: T;
}

/** Base JSON-RPC response (error) */
export interface MAPResponseError {
  jsonrpc: "2.0";
  id: RequestId;
  error: MAPError;
}

/** JSON-RPC response (success or error) */
export type MAPResponse<T = unknown> = MAPResponseSuccess<T> | MAPResponseError;

/** Base JSON-RPC notification */
export interface MAPNotificationBase<TParams = unknown> {
  jsonrpc: "2.0";
  method: string;
  params?: TParams;
}

// =============================================================================
// Session Types
// =============================================================================

export interface SessionInfo {
  id: SessionId;
  createdAt: Timestamp;
  lastActiveAt?: Timestamp;
  closedAt?: Timestamp;
}

// =============================================================================
// Authentication Types
// =============================================================================

/** Standard authentication methods defined by the protocol */
export type StandardAuthMethod =
  | "bearer"
  | "api-key"
  | "mtls"
  | "none"
  | "did:wba";

/** Authentication method - standard or custom (x- prefixed) */
export type AuthMethod = StandardAuthMethod | `x-${string}`;

/** Authentication error codes */
export type AuthErrorCode =
  | "invalid_credentials"
  | "expired"
  | "insufficient_scope"
  | "method_not_supported"
  | "auth_required";

/**
 * Client-provided authentication credentials.
 * Used in connect requests and authenticate calls.
 */
export interface AuthCredentials {
  /** The authentication method being used */
  method: AuthMethod;
  /** The credential value (token, API key, etc.) */
  credential?: string;
  /** Method-specific additional data */
  metadata?: Record<string, unknown>;
}

/**
 * Server-advertised authentication capabilities.
 * Included in connect response when auth is required.
 */
export interface ServerAuthCapabilities {
  /** Supported authentication methods (in preference order) */
  methods: AuthMethod[];
  /** Is authentication required to proceed? */
  required: boolean;
  /** OAuth2 authorization server metadata URL (RFC 8414) */
  oauth2MetadataUrl?: string;
  /** JWKS URL for local JWT verification (RFC 7517) */
  jwksUrl?: string;
  /** Realm identifier for this server */
  realm?: string;
}

/**
 * Authenticated principal information.
 * Returned after successful authentication.
 */
export interface AuthPrincipal {
  /** Unique identifier for this principal */
  id: string;
  /** Token issuer (for federated auth) */
  issuer?: string;
  /** Additional claims from the credential */
  claims?: Record<string, unknown>;
  /** Token expiration timestamp (Unix ms) - from JWT exp claim */
  expiresAt?: number;
  /** Persistent identity extracted from credentials (if present) */
  persistentId?: string;
}

/**
 * Authentication error details.
 */
export interface AuthError {
  /** Error code */
  code: AuthErrorCode;
  /** Human-readable error message */
  message: string;
}

/**
 * Result of an authentication attempt.
 */
export interface AuthResult {
  /** Whether authentication succeeded */
  success: boolean;
  /** Authenticated principal (if success) */
  principal?: AuthPrincipal;
  /** Error details (if failure) */
  error?: AuthError;
  /** Provider-specific data to store on session (e.g., verified AgentToken) */
  providerData?: unknown;
}

/**
 * Supported federation authentication methods.
 */
export type FederationAuthMethod =
  | "bearer"
  | "api-key"
  | "mtls"
  | "none"
  | "did:wba"
  | "oauth2"
  | `x-${string}`;

/**
 * Authentication for federated connections.
 */
export interface FederationAuth {
  method: FederationAuthMethod;
  credentials?: string;
  /** Method-specific additional data (e.g., DID proof, OAuth2 config) */
  metadata?: Record<string, unknown>;
}

// =============================================================================
// DID:WBA (Web-Based Agent) Types
// =============================================================================

/**
 * DID:WBA authentication credentials for federation.
 * Used for domain-anchored decentralized identity.
 */
export interface DIDWBACredentials {
  method: "did:wba";
  /** DID and proof nested in metadata (matches wire format) */
  metadata: {
    /** The DID of the connecting system/agent (e.g., "did:wba:agents.example.com:gateway") */
    did: string;
    /** Cryptographic proof of DID ownership */
    proof: DIDWBAProof;
  };
}

/**
 * Cryptographic proof for DID:WBA authentication.
 */
export interface DIDWBAProof {
  /** Proof type (e.g., "JsonWebSignature2020", "Ed25519Signature2020") */
  type: string;
  /** ISO 8601 timestamp of proof creation */
  created: string;
  /** Server-provided nonce (prevents replay) */
  challenge: string;
  /** JWS signature over (challenge + did + created) */
  jws: string;
}

/**
 * DID Document structure for MAP federation.
 * Resolved from `did:wba:<domain>:<path>` → `https://<domain>/<path>/did.json`
 */
export interface DIDDocument {
  "@context"?: string | string[];
  id: string;
  verificationMethod?: DIDVerificationMethod[];
  authentication?: string[];
  service?: DIDService[];
}

/**
 * A verification method within a DID Document.
 */
export interface DIDVerificationMethod {
  id: string;
  type: string;
  controller: string;
  publicKeyJwk?: Record<string, unknown>;
}

/**
 * A service endpoint within a DID Document.
 */
export interface DIDService {
  id: string;
  type: string;
  serviceEndpoint: string | Record<string, unknown>;
  /** MAP protocol version (for MAPFederationEndpoint services) */
  mapProtocolVersion?: number;
  /** MAP capabilities advertised by this endpoint */
  mapCapabilities?: Record<string, boolean>;
}

/**
 * Union type for all supported federation auth credentials.
 */
export type MAPFederationAuth = FederationAuth | DIDWBACredentials;

// =============================================================================
// Connect Types
// =============================================================================

/** Policy for handling unexpected disconnection */
export interface DisconnectPolicy {
  /** What happens to agents on disconnect */
  agentBehavior: "unregister" | "orphan" | "grace-period";
  /** Grace period before unregistering (ms) */
  gracePeriodMs?: number;
  /** Emit events to subscribers */
  notifySubscribers?: boolean;
}

export interface ConnectRequestParams {
  protocolVersion: ProtocolVersion;
  participantType: ParticipantType;
  participantId?: ParticipantId;
  name?: string;
  capabilities?: ParticipantCapabilities;
  sessionId?: SessionId;
  /** Token to resume a previously disconnected session */
  resumeToken?: string;
  /** Reclaim orphaned agents from previous connection */
  reclaimAgents?: AgentId[];
  /** Policy for unexpected disconnect */
  disconnectPolicy?: DisconnectPolicy;
  /** Authentication credentials */
  auth?: AuthCredentials;
  _meta?: Meta;
}

export interface ConnectRequest extends MAPRequestBase<ConnectRequestParams> {
  method: "map/connect";
  params: ConnectRequestParams;
}

export interface ConnectResponseResult {
  protocolVersion: ProtocolVersion;
  sessionId: SessionId;
  participantId: ParticipantId;
  capabilities: ParticipantCapabilities;
  systemInfo?: {
    name?: string;
    version?: string;
  };
  /** Is this a reconnection? */
  reconnected?: boolean;
  /** Reclaimed agents */
  reclaimedAgents?: Agent[];
  /** Currently owned agents */
  ownedAgents?: AgentId[];
  /** Authenticated principal (if auth succeeded) */
  principal?: AuthPrincipal;
  /** Auth required but not provided - client should authenticate */
  authRequired?: ServerAuthCapabilities;
  /** Token to resume this session later */
  resumeToken?: string;
  _meta?: Meta;
}

// =============================================================================
// Disconnect Types
// =============================================================================

export interface DisconnectRequestParams {
  reason?: string;
  _meta?: Meta;
}

export interface DisconnectRequest extends MAPRequestBase<DisconnectRequestParams> {
  method: "map/disconnect";
  params?: DisconnectRequestParams;
}

export interface DisconnectResponseResult {
  session: SessionInfo;
  /** Token to resume this session later */
  resumeToken?: string;
  _meta?: Meta;
}

// =============================================================================
// Session Request/Response Types
// =============================================================================

export interface SessionListRequestParams {
  _meta?: Meta;
}

export interface SessionListRequest extends MAPRequestBase<SessionListRequestParams> {
  method: "map/session/list";
  params?: SessionListRequestParams;
}

export interface SessionListResponseResult {
  sessions: SessionInfo[];
  _meta?: Meta;
}

export interface SessionLoadRequestParams {
  sessionId: SessionId;
  _meta?: Meta;
}

export interface SessionLoadRequest extends MAPRequestBase<SessionLoadRequestParams> {
  method: "map/session/load";
  params: SessionLoadRequestParams;
}

export interface SessionLoadResponseResult {
  sessionId: SessionId;
  restored: boolean;
  _meta?: Meta;
}

export interface SessionCloseRequestParams {
  sessionId?: SessionId;
  _meta?: Meta;
}

export interface SessionCloseRequest extends MAPRequestBase<SessionCloseRequestParams> {
  method: "map/session/close";
  params?: SessionCloseRequestParams;
}

export interface SessionCloseResponseResult {
  session: SessionInfo;
  _meta?: Meta;
}

// =============================================================================
// Agents Request/Response Types
// =============================================================================

export interface AgentsListFilter {
  states?: AgentState[];
  roles?: string[];
  scopes?: ScopeId[];
  parent?: AgentId;
  hasChildren?: boolean;
  ownerId?: ParticipantId;
  /** Filter by structured capability ID (e.g., "doc:summarize") */
  capabilityId?: string;
  /** Filter by semantic tags from capability descriptor */
  tags?: string[];
  /** Filter by accepted content type */
  accepts?: string;
  /** Filter by persistent identity */
  persistentId?: string;
}

export interface AgentsListRequestParams {
  filter?: AgentsListFilter;
  limit?: number;
  cursor?: string;
  _meta?: Meta;
}

export interface AgentsListRequest extends MAPRequestBase<AgentsListRequestParams> {
  method: "map/agents/list";
  params?: AgentsListRequestParams;
}

export interface AgentsListResponseResult {
  agents: Agent[];
  nextCursor?: string;
  _meta?: Meta;
}

/** Options for expanding related agents */
export interface AgentIncludeOptions {
  parent?: boolean;
  children?: boolean;
  siblings?: boolean;
  ancestors?: boolean;
  descendants?: boolean;
  maxDepth?: number;
}

export interface AgentsGetRequestParams {
  agentId: AgentId;
  include?: AgentIncludeOptions;
  _meta?: Meta;
}

export interface AgentsGetRequest extends MAPRequestBase<AgentsGetRequestParams> {
  method: "map/agents/get";
  params: AgentsGetRequestParams;
}

export interface AgentsGetResponseResult {
  agent: Agent;
  parent?: Agent;
  children?: Agent[];
  siblings?: Agent[];
  ancestors?: Agent[];
  descendants?: Agent[];
  _meta?: Meta;
}

export interface AgentsRegisterRequestParams {
  agentId?: AgentId;
  name?: string;
  description?: string;
  role?: string;
  parent?: AgentId;
  scopes?: ScopeId[];
  visibility?: AgentVisibility;
  capabilities?: ParticipantCapabilities;
  /** Compute environment where this agent runs */
  environment?: AgentEnvironment;
  /** Structured capability descriptor for rich agent discovery */
  capabilityDescriptor?: MAPAgentCapabilityDescriptor;
  /**
   * Persistent identity for this agent.
   * If provided, the server will attempt to verify the proof and may
   * resume a previous registration with the same persistentId.
   * If omitted and the server is configured to auto-assign identities,
   * the server may generate one and return it in the response.
   */
  persistentIdentity?: AgentPersistentIdentity;
  /**
   * When true and persistentIdentity is provided, the server will attempt
   * to resume a previously orphaned agent with the same persistentId.
   * The resumed agent's ID and accumulated state are preserved.
   */
  resumePersistentIdentity?: boolean;
  metadata?: Record<string, unknown>;
  /** Permission overrides merged on top of role-based defaults */
  permissionOverrides?: Partial<AgentPermissions>;
  _meta?: Meta;
}

export interface AgentsRegisterRequest extends MAPRequestBase<AgentsRegisterRequestParams> {
  method: "map/agents/register";
  params?: AgentsRegisterRequestParams;
}

export interface AgentsRegisterResponseResult {
  agent: Agent;
  /**
   * Whether this registration resumed a previous agent via persistent identity.
   * When true, the agent's ID and state may reflect the previous registration.
   */
  resumed?: boolean;
  /**
   * Context about what was resumed (only present when resumed is true).
   * Indicates which session the agent was previously associated with.
   */
  resumedFrom?: {
    previousSessionId: string;
  };
  _meta?: Meta;
}

export interface AgentsUnregisterRequestParams {
  agentId: AgentId;
  reason?: string;
  _meta?: Meta;
}

export interface AgentsUnregisterRequest extends MAPRequestBase<AgentsUnregisterRequestParams> {
  method: "map/agents/unregister";
  params: AgentsUnregisterRequestParams;
}

export interface AgentsUnregisterResponseResult {
  agent: Agent;
  _meta?: Meta;
}

export interface AgentsUpdateRequestParams {
  agentId: AgentId;
  state?: AgentState;
  /** Update agent's compute environment */
  environment?: AgentEnvironment;
  metadata?: Record<string, unknown>;
  /**
   * Permission overrides to apply to the agent.
   * Merged on top of role-based defaults.
   */
  permissionOverrides?: Partial<AgentPermissions>;
  _meta?: Meta;
}

export interface AgentsUpdateRequest extends MAPRequestBase<AgentsUpdateRequestParams> {
  method: "map/agents/update";
  params: AgentsUpdateRequestParams;
}

export interface AgentsUpdateResponseResult {
  agent: Agent;
  _meta?: Meta;
}

export interface AgentsSpawnRequestParams {
  agentId?: AgentId;
  name?: string;
  description?: string;
  role?: string;
  parent?: AgentId;
  scopes?: ScopeId[];
  visibility?: AgentVisibility;
  capabilities?: ParticipantCapabilities;
  /** Compute environment where this agent runs */
  environment?: AgentEnvironment;
  /** Structured capability descriptor for rich agent discovery */
  capabilityDescriptor?: MAPAgentCapabilityDescriptor;
  initialMessage?: Message;
  metadata?: Record<string, unknown>;
  _meta?: Meta;
}

export interface AgentsSpawnRequest extends MAPRequestBase<AgentsSpawnRequestParams> {
  method: "map/agents/spawn";
  params?: AgentsSpawnRequestParams;
}

export interface AgentsSpawnResponseResult {
  agent: Agent;
  messageId?: MessageId;
  _meta?: Meta;
}

export interface AgentsStopRequestParams {
  agentId: AgentId;
  reason?: string;
  force?: boolean;
  _meta?: Meta;
}

export interface AgentsStopRequest extends MAPRequestBase<AgentsStopRequestParams> {
  method: "map/agents/stop";
  params: AgentsStopRequestParams;
}

export interface AgentsStopResponseResult {
  agent: Agent;
  _meta?: Meta;
}

export interface AgentsSuspendRequestParams {
  agentId: AgentId;
  reason?: string;
  _meta?: Meta;
}

export interface AgentsSuspendRequest extends MAPRequestBase<AgentsSuspendRequestParams> {
  method: "map/agents/suspend";
  params: AgentsSuspendRequestParams;
}

export interface AgentsSuspendResponseResult {
  agent: Agent;
  _meta?: Meta;
}

export interface AgentsResumeRequestParams {
  agentId: AgentId;
  _meta?: Meta;
}

export interface AgentsResumeRequest extends MAPRequestBase<AgentsResumeRequestParams> {
  method: "map/agents/resume";
  params: AgentsResumeRequestParams;
}

export interface AgentsResumeResponseResult {
  agent: Agent;
  _meta?: Meta;
}

// =============================================================================
// Send Types
// =============================================================================

export interface SendRequestParams {
  to: Address;
  payload?: unknown;
  meta?: MessageMeta;
  _meta?: Meta;
}

export interface SendRequest extends MAPRequestBase<SendRequestParams> {
  method: "map/send";
  params: SendRequestParams;
}

export interface SendResponseResult {
  messageId: MessageId;
  delivered?: ParticipantId[];
  _meta?: Meta;
}

// =============================================================================
// Subscribe Types
// =============================================================================

export interface SubscribeRequestParams {
  filter?: SubscriptionFilter;
  options?: SubscriptionOptions;
  replayFrom?: Timestamp | string;
  _meta?: Meta;
}

export interface SubscribeRequest extends MAPRequestBase<SubscribeRequestParams> {
  method: "map/subscribe";
  params?: SubscribeRequestParams;
}

export interface SubscribeResponseResult {
  subscriptionId: SubscriptionId;
  _meta?: Meta;
}

export interface UnsubscribeRequestParams {
  subscriptionId: SubscriptionId;
  _meta?: Meta;
}

export interface UnsubscribeRequest extends MAPRequestBase<UnsubscribeRequestParams> {
  method: "map/unsubscribe";
  params: UnsubscribeRequestParams;
}

export interface UnsubscribeResponseResult {
  subscription: {
    id: SubscriptionId;
    closedAt: Timestamp;
  };
  _meta?: Meta;
}

// =============================================================================
// Replay Types
// =============================================================================

/**
 * A replayed event with its envelope metadata.
 */
export interface ReplayedEvent {
  /** Globally unique event ID (ULID format) */
  eventId: string;
  /** Server timestamp when event was originally processed */
  timestamp: Timestamp;
  /** Event IDs that causally precede this event */
  causedBy?: string[];
  /** The event payload */
  event: Event;
}

/**
 * Parameters for replaying historical events.
 *
 * Uses keyset pagination with `afterEventId` - pass the last eventId
 * from the previous response to get the next page of results.
 *
 * @example
 * ```typescript
 * // Replay from a specific point
 * const page1 = await client.replay({ limit: 100 });
 * const page2 = await client.replay({
 *   afterEventId: page1.events.at(-1)?.eventId,
 *   limit: 100
 * });
 * ```
 */
export interface ReplayRequestParams {
  /**
   * Start after this eventId (exclusive).
   * Used for keyset pagination - pass the last eventId from previous response.
   */
  afterEventId?: string;

  /**
   * Alternative: start from this timestamp (inclusive).
   * If both afterEventId and fromTimestamp are provided, afterEventId takes precedence.
   */
  fromTimestamp?: Timestamp;

  /**
   * End at this timestamp (inclusive).
   * If not provided, replays up to the most recent event.
   */
  toTimestamp?: Timestamp;

  /**
   * Filter events (same as subscription filter).
   */
  filter?: SubscriptionFilter;

  /**
   * Maximum number of events to return.
   * Default: 100, Maximum: 1000
   */
  limit?: number;

  _meta?: Meta;
}

export interface ReplayRequest extends MAPRequestBase<ReplayRequestParams> {
  method: "map/replay";
  params?: ReplayRequestParams;
}

export interface ReplayResponseResult {
  /** Replayed events in chronological order */
  events: ReplayedEvent[];

  /** Whether more events exist after the last returned event */
  hasMore: boolean;

  /**
   * Total count of matching events (if known).
   * May be omitted for performance reasons on large result sets.
   */
  totalCount?: number;

  _meta?: Meta;
}

// =============================================================================
// Auth Types
// =============================================================================

export interface AuthRefreshRequestParams {
  refreshToken: string;
  _meta?: Meta;
}

export interface AuthRefreshRequest extends MAPRequestBase<AuthRefreshRequestParams> {
  method: "map/auth/refresh";
  params: AuthRefreshRequestParams;
}

export interface AuthRefreshResponseResult {
  accessToken: string;
  expiresAt: Timestamp;
  refreshToken?: string;
  _meta?: Meta;
}

/**
 * Parameters for map/authenticate request.
 * Used when auth negotiation is required after initial connect.
 */
export interface AuthenticateRequestParams {
  /** The authentication method being used */
  method: AuthMethod;
  /** The credential value (token, API key, etc.) */
  credential?: string;
  /** Method-specific additional data */
  metadata?: Record<string, unknown>;
  _meta?: Meta;
}

export interface AuthenticateRequest extends MAPRequestBase<AuthenticateRequestParams> {
  method: "map/authenticate";
  params: AuthenticateRequestParams;
}

/**
 * Response from map/authenticate request.
 */
export interface AuthenticateResponseResult {
  /** Whether authentication succeeded */
  success: boolean;
  /** Session ID (if auth succeeded) */
  sessionId?: SessionId;
  /** Participant ID (if auth succeeded) */
  participantId?: ParticipantId;
  /** Authenticated principal (if auth succeeded) */
  principal?: AuthPrincipal;
  /** Error details (if auth failed) */
  error?: AuthError;
  _meta?: Meta;
}

// =============================================================================
// Scope Types
// =============================================================================

export interface ScopesListRequestParams {
  parent?: ScopeId;
  _meta?: Meta;
}

export interface ScopesListRequest extends MAPRequestBase<ScopesListRequestParams> {
  method: "map/scopes/list";
  params?: ScopesListRequestParams;
}

export interface ScopesListResponseResult {
  scopes: Scope[];
  _meta?: Meta;
}

export interface ScopesGetRequestParams {
  scopeId: ScopeId;
  _meta?: Meta;
}

export interface ScopesGetRequest extends MAPRequestBase<ScopesGetRequestParams> {
  method: "map/scopes/get";
  params: ScopesGetRequestParams;
}

export interface ScopesGetResponseResult {
  scope: Scope;
  _meta?: Meta;
}

export interface ScopesCreateRequestParams {
  scopeId?: ScopeId;
  name?: string;
  description?: string;
  parent?: ScopeId;
  joinPolicy?: JoinPolicy;
  autoJoinRoles?: string[];
  visibility?: ScopeVisibility;
  messageVisibility?: MessageVisibility;
  sendPolicy?: SendPolicy;
  persistent?: boolean;
  autoDelete?: boolean;
  metadata?: Record<string, unknown>;
  _meta?: Meta;
}

export interface ScopesCreateRequest extends MAPRequestBase<ScopesCreateRequestParams> {
  method: "map/scopes/create";
  params?: ScopesCreateRequestParams;
}

export interface ScopesCreateResponseResult {
  scope: Scope;
  _meta?: Meta;
}

export interface ScopesDeleteRequestParams {
  scopeId: ScopeId;
  _meta?: Meta;
}

export interface ScopesDeleteRequest extends MAPRequestBase<ScopesDeleteRequestParams> {
  method: "map/scopes/delete";
  params: ScopesDeleteRequestParams;
}

export interface ScopesDeleteResponseResult {
  scope: Scope;
  _meta?: Meta;
}

export interface ScopesJoinRequestParams {
  scopeId: ScopeId;
  agentId: AgentId;
  _meta?: Meta;
}

export interface ScopesJoinRequest extends MAPRequestBase<ScopesJoinRequestParams> {
  method: "map/scopes/join";
  params: ScopesJoinRequestParams;
}

export interface ScopesJoinResponseResult {
  scope: Scope;
  agent: Agent;
  _meta?: Meta;
}

export interface ScopesLeaveRequestParams {
  scopeId: ScopeId;
  agentId: AgentId;
  _meta?: Meta;
}

export interface ScopesLeaveRequest extends MAPRequestBase<ScopesLeaveRequestParams> {
  method: "map/scopes/leave";
  params: ScopesLeaveRequestParams;
}

export interface ScopesLeaveResponseResult {
  scope: Scope;
  agent: Agent;
  _meta?: Meta;
}

export interface ScopesMembersRequestParams {
  scopeId: ScopeId;
  limit?: number;
  cursor?: string;
  _meta?: Meta;
}

export interface ScopesMembersRequest extends MAPRequestBase<ScopesMembersRequestParams> {
  method: "map/scopes/members";
  params: ScopesMembersRequestParams;
}

export interface ScopesMembersResponseResult {
  members: AgentId[];
  nextCursor?: string;
  _meta?: Meta;
}

// =============================================================================
// Structure Graph Types
// =============================================================================

export interface StructureGraphRequestParams {
  rootAgentId?: AgentId;
  depth?: number;
  includeRelationships?: boolean;
  _meta?: Meta;
}

export interface StructureGraphRequest extends MAPRequestBase<StructureGraphRequestParams> {
  method: "map/structure/graph";
  params?: StructureGraphRequestParams;
}

export interface GraphEdge {
  from: AgentId;
  to: AgentId;
  type: "parent-child" | "peer" | "supervisor" | "collaborator";
}

export interface StructureGraphResponseResult {
  nodes: Agent[];
  edges: GraphEdge[];
  _meta?: Meta;
}

// =============================================================================
// Inject Types
// =============================================================================

export type InjectDelivery = "interrupt" | "queue" | "best-effort";
export type InjectDeliveryResult = "interrupt" | "queue" | "message";

export interface InjectRequestParams {
  agentId: AgentId;
  content: unknown;
  delivery?: InjectDelivery;
  _meta?: Meta;
}

export interface InjectRequest extends MAPRequestBase<InjectRequestParams> {
  method: "map/inject";
  params: InjectRequestParams;
}

export interface InjectResponseResult {
  injected: boolean;
  delivery?: InjectDeliveryResult;
  _meta?: Meta;
}

// =============================================================================
// Permission Update Types
// =============================================================================

/**
 * Parameters for updating client permissions.
 * Only system/admin participants can update client permissions.
 */
export interface PermissionsUpdateRequestParams {
  /** Client to update permissions for */
  clientId: ParticipantId;
  /** Partial permissions to merge with existing */
  permissions: Partial<ParticipantCapabilities>;
  _meta?: Meta;
}

export interface PermissionsUpdateRequest extends MAPRequestBase<PermissionsUpdateRequestParams> {
  method: "map/permissions/update";
  params: PermissionsUpdateRequestParams;
}

export interface PermissionsUpdateResponseResult {
  /** Whether update was applied */
  success: boolean;
  /** Effective permissions after update */
  effectivePermissions: ParticipantCapabilities;
  _meta?: Meta;
}

/**
 * Event data for permissions_client_updated events.
 * Emitted when a client's permissions are changed.
 */
export interface PermissionsClientUpdatedEventData {
  /** Client whose permissions changed */
  clientId: ParticipantId;
  /** The permission changes that were applied */
  changes: Partial<ParticipantCapabilities>;
  /** Effective permissions after the update */
  effectivePermissions: ParticipantCapabilities;
  /** Participant who made the change */
  updatedBy: ParticipantId;
}

/**
 * Event data for permissions_agent_updated events.
 * Emitted when an agent's permission overrides are changed.
 */
export interface PermissionsAgentUpdatedEventData {
  /** Agent whose permissions changed */
  agentId: AgentId;
  /** The permission changes that were applied */
  changes: Partial<AgentPermissions>;
  /** Effective permissions after the update */
  effectivePermissions: AgentPermissions;
  /** Participant who made the change */
  updatedBy: ParticipantId;
}

// =============================================================================
// Federation Types
// =============================================================================

/**
 * Metadata for federation routing and tracking.
 * Included in every message routed between federated systems.
 */
export interface FederationMetadata {
  /** System that originated this message */
  sourceSystem: string;
  /** Intended final destination system */
  targetSystem: string;
  /** Number of systems this message has traversed */
  hopCount: number;
  /** Maximum hops before rejection (prevents infinite loops) */
  maxHops?: number;
  /** Systems this message has traversed (for debugging/loop detection) */
  path?: string[];
  /** Timestamp when message was first sent (ms since epoch) */
  originTimestamp: Timestamp;
  /** Correlation ID for cross-system tracing */
  correlationId?: string;
  /**
   * Signature for integrity verification.
   * @todo Define signing algorithm and key management
   */
  signature?: string;
}

/**
 * Envelope for messages routed between federated systems.
 * Wraps the payload with routing metadata for tracking and loop prevention.
 *
 * @typeParam T - The payload type (typically Message)
 *
 * @example
 * ```typescript
 * const envelope: FederationEnvelope<Message> = {
 *   payload: message,
 *   federation: {
 *     sourceSystem: 'alpha',
 *     targetSystem: 'beta',
 *     hopCount: 0,
 *     originTimestamp: Date.now(),
 *   },
 * };
 * ```
 */
export interface FederationEnvelope<T = unknown> {
  /** The payload being routed */
  payload: T;
  /** Federation routing metadata */
  federation: FederationMetadata;
}

/**
 * Configuration for federation routing behavior.
 * Used by gateways to control message routing policies.
 */
export interface FederationRoutingConfig {
  /** This system's identifier */
  systemId: string;
  /** Maximum hops to accept (default: 10) */
  maxHops?: number;
  /** Whether to track full path for debugging (default: false) */
  trackPath?: boolean;
  /** Systems we're willing to route to (undefined = all) */
  allowedTargets?: string[];
  /** Systems we accept routes from (undefined = all) */
  allowedSources?: string[];
}

// =============================================================================
// Federation Reconnection Types
// =============================================================================

/**
 * Configuration for buffering messages during federation outages.
 * Messages are stored locally until the peer reconnects.
 */
export interface FederationBufferConfig {
  /** Enable buffering of messages during disconnection (default: true) */
  enabled?: boolean;
  /** Maximum number of messages to buffer per peer (default: 1000) */
  maxMessages?: number;
  /** Maximum buffer size in bytes per peer (default: 10MB) */
  maxBytes?: number;
  /** Time to retain buffered messages in ms (default: 1 hour) */
  retentionMs?: number;
  /** Strategy when buffer is full */
  overflowStrategy?: "drop-oldest" | "drop-newest" | "reject";
}

/**
 * Configuration for replaying events from event store on reconnection.
 * Supplements buffer with persisted events.
 */
export interface FederationReplayConfig {
  /** Enable replay from event store on reconnection (default: true) */
  enabled?: boolean;
  /** Maximum time window for replay in ms (default: 1 hour) */
  maxReplayWindowMs?: number;
  /** Maximum number of events to replay (default: 10000) */
  maxReplayEvents?: number;
  /** Filter for events to replay (optional) */
  filter?: SubscriptionFilter;
}

/**
 * Type of gateway reconnection event.
 */
export type GatewayReconnectionEventType =
  | "connecting"
  | "connected"
  | "disconnected"
  | "reconnecting"
  | "reconnect_failed"
  | "buffer_overflow"
  | "replay_started"
  | "replay_completed";

/**
 * Event emitted during gateway reconnection lifecycle.
 */
export interface GatewayReconnectionEvent {
  /** Type of reconnection event */
  type: GatewayReconnectionEventType;
  /** Target system ID */
  systemId: string;
  /** Timestamp of the event */
  timestamp: Timestamp;
  /** Current reconnection attempt (for reconnecting events) */
  attempt?: number;
  /** Error message (for disconnected/reconnect_failed) */
  error?: string;
  /** Number of buffered messages (for buffer_overflow) */
  bufferedCount?: number;
  /** Number of events being replayed (for replay_started/completed) */
  replayCount?: number;
  /** Duration of outage in ms (for connected after reconnect) */
  outageDurationMs?: number;
}

/** Handler for gateway reconnection events */
export type GatewayReconnectionEventHandler = (
  event: GatewayReconnectionEvent,
) => void;

/**
 * Options for gateway connection with reconnection support.
 * Extends base connection options with federation-specific settings.
 */
export interface GatewayReconnectionOptions {
  /** Enable automatic reconnection (default: true) */
  autoReconnect?: boolean;
  /** Initial delay before first reconnection attempt in ms (default: 1000) */
  initialDelayMs?: number;
  /** Maximum delay between reconnection attempts in ms (default: 30000) */
  maxDelayMs?: number;
  /** Backoff multiplier for exponential backoff (default: 2) */
  backoffMultiplier?: number;
  /** Maximum number of reconnection attempts (default: Infinity) */
  maxRetries?: number;
  /** Add random jitter to delays (default: true) */
  jitter?: boolean;
  /** Buffer configuration for outages */
  buffer?: FederationBufferConfig;
  /** Replay configuration for event store recovery */
  replay?: FederationReplayConfig;
  /** Handler for reconnection lifecycle events */
  onReconnectionEvent?: GatewayReconnectionEventHandler;
}

export interface FederationConnectRequestParams {
  systemId: string;
  endpoint: string;
  auth?: FederationAuth;
  /** Pre-fetched server auth context (e.g., from .well-known discovery) */
  authContext?: {
    /** How the client learned the server's auth requirements */
    source: "well-known" | "cached" | "configured";
    /** Server's nonce/challenge (if pre-fetched, e.g., for did:wba) */
    challenge?: string;
  };
  /** System info about the connecting peer */
  systemInfo?: { name: string; version: string; endpoint: string };
  /** MAP protocol version (default: 1) */
  protocolVersion?: number;
  /** What this peer exposes to the other side */
  exposure?: Record<string, unknown>;
  _meta?: Meta;
}

export interface FederationConnectRequest extends MAPRequestBase<FederationConnectRequestParams> {
  method: "map/federation/connect";
  params: FederationConnectRequestParams;
}

export interface FederationConnectResponseResult {
  connected: boolean;
  systemInfo?: {
    name?: string;
    version?: string;
    capabilities?: ParticipantCapabilities;
  };
  /** Federation session ID (when single-request auth succeeds) */
  sessionId?: string;
  /** Authenticated principal (when single-request auth succeeds) */
  principal?: AuthPrincipal;
  /** Auth negotiation fallback (when auth not provided or failed recoverably) */
  authRequired?: {
    methods: string[];
    /** Server-generated challenge nonce (e.g., for did:wba) */
    challenge?: string;
    required: boolean;
  };
  _meta?: Meta;
}

export interface FederationRouteRequestParams {
  /** Target system ID (for immediate next hop) */
  systemId: string;
  /**
   * Wrapped message with federation metadata.
   * Use this for new implementations.
   */
  envelope?: FederationEnvelope<Message>;
  /**
   * Raw message (legacy format).
   * @deprecated Use envelope instead for proper routing metadata
   */
  message?: Message;
  _meta?: Meta;
}

export interface FederationRouteRequest extends MAPRequestBase<FederationRouteRequestParams> {
  method: "map/federation/route";
  params: FederationRouteRequestParams;
}

export interface FederationRouteResponseResult {
  routed: boolean;
  messageId?: MessageId;
  _meta?: Meta;
}

// =============================================================================
// Mail Types - Conversation, Turn, and Thread types
// =============================================================================

/**
 * Type of conversation.
 */
export type ConversationType =
  | "user-session"
  | "agent-task"
  | "multi-agent"
  | "mixed";

/**
 * Status of a conversation.
 */
export type ConversationStatus =
  | "active"
  | "paused"
  | "completed"
  | "failed"
  | "archived";

/**
 * A conversation - a container for tracking related interactions.
 */
export interface Conversation {
  id: ConversationId;
  type: ConversationType;
  status: ConversationStatus;
  subject?: string;
  participantCount: number;
  parentConversationId?: ConversationId;
  parentTurnId?: TurnId;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  closedAt?: Timestamp;
  createdBy: ParticipantId;
  metadata?: Record<string, unknown>;
  _meta?: Meta;
}

/**
 * Role of a participant within a conversation.
 */
export type ParticipantRole =
  | "initiator"
  | "assistant"
  | "worker"
  | "observer"
  | "moderator";

/**
 * Permissions for a participant within a conversation.
 */
export interface ConversationPermissions {
  canSend: boolean;
  canObserve: boolean;
  canInvite: boolean;
  canRemove: boolean;
  canCreateThreads: boolean;
  historyAccess: "none" | "from-join" | "full";
  canSeeInternal: boolean;
  _meta?: Meta;
}

/**
 * A participant in a conversation with role and permissions.
 */
export interface ConversationParticipant {
  id: ParticipantId;
  type: "user" | "agent" | "system";
  role: ParticipantRole;
  joinedAt: Timestamp;
  leftAt?: Timestamp;
  permissions: ConversationPermissions;
  agentInfo?: {
    agentId: AgentId;
    name?: string;
    role?: string;
  };
  _meta?: Meta;
}

/**
 * A thread within a conversation for focused discussion.
 */
export interface Thread {
  id: ThreadId;
  conversationId: ConversationId;
  parentThreadId?: ThreadId;
  subject?: string;
  rootTurnId: TurnId;
  turnCount: number;
  participantCount: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdBy: ParticipantId;
  _meta?: Meta;
}

/**
 * How a turn was created.
 * - 'explicit': Created directly via mail/turn call
 * - 'intercepted': Auto-recorded from map/send with mail meta
 */
export type TurnSource =
  | { type: "explicit"; method: "mail/turn" }
  | { type: "intercepted"; messageId: MessageId };

/**
 * Visibility of a turn within a conversation.
 */
export type TurnVisibility =
  | { type: "all" }
  | { type: "participants"; ids: ParticipantId[] }
  | { type: "role"; roles: ParticipantRole[] }
  | { type: "private" };

/**
 * Status of a turn's content lifecycle.
 */
export type TurnStatus = "pending" | "streaming" | "complete" | "failed";

/**
 * A turn - the atomic unit of conversation.
 * Records what a participant intentionally communicates.
 *
 * Content uses a generic model:
 * - Well-known types: 'text', 'data', 'event', 'reference'
 * - Custom types use 'x-' prefix (e.g., 'x-tool-call')
 */
export interface Turn {
  id: TurnId;
  conversationId: ConversationId;
  participant: ParticipantId;
  timestamp: Timestamp;
  /** Content type - well-known ('text', 'data', 'event', 'reference') or custom ('x-*') */
  contentType: string;
  /** Content payload - shape determined by contentType */
  content: unknown;
  /** Thread this turn belongs to */
  threadId?: ThreadId;
  /** Turn this is in reply to */
  inReplyTo?: TurnId;
  /** How this turn was created */
  source: TurnSource;
  /** Who can see this turn */
  visibility?: TurnVisibility;
  /** Status of the turn content */
  status?: TurnStatus;
  metadata?: Record<string, unknown>;
  _meta?: Meta;
}

/**
 * Mail metadata for map/send turn tracking.
 * Include in MessageMeta.mail to route AND record a turn.
 */
export interface MailMessageMeta {
  conversationId: ConversationId;
  threadId?: ThreadId;
  inReplyTo?: TurnId;
  visibility?: TurnVisibility;
}

/**
 * Mail-specific subscription filter.
 * Used in SubscriptionFilter.mail for filtering mail events.
 */
export interface MailSubscriptionFilter {
  conversationId?: ConversationId;
  threadId?: ThreadId;
  participantId?: ParticipantId;
  contentType?: string;
}

// =============================================================================
// Mail Event Data Types
// =============================================================================

/** Data for mail.created events */
export interface MailCreatedEventData {
  conversationId: ConversationId;
  type: ConversationType;
  subject?: string;
  createdBy: ParticipantId;
}

/** Data for mail.closed events */
export interface MailClosedEventData {
  conversationId: ConversationId;
  closedBy: ParticipantId;
  reason?: string;
}

/** Data for mail.participant.joined events */
export interface MailParticipantJoinedEventData {
  conversationId: ConversationId;
  participant: ConversationParticipant;
}

/** Data for mail.participant.left events */
export interface MailParticipantLeftEventData {
  conversationId: ConversationId;
  participantId: ParticipantId;
  reason?: string;
}

/** Data for mail.turn.added events */
export interface MailTurnAddedEventData {
  conversationId: ConversationId;
  turn: Turn;
}

/** Data for mail.turn.updated events */
export interface MailTurnUpdatedEventData {
  conversationId: ConversationId;
  turnId: TurnId;
  status?: TurnStatus;
}

/** Data for mail.thread.created events */
export interface MailThreadCreatedEventData {
  conversationId: ConversationId;
  thread: Thread;
}

/** Data for mail.summary.generated events */
export interface MailSummaryGeneratedEventData {
  conversationId: ConversationId;
  summary: string;
}

// =============================================================================
// Mail Request/Response Types
// =============================================================================

// --- mail/create ---

export interface MailCreateRequestParams {
  type?: ConversationType;
  subject?: string;
  parentConversationId?: ConversationId;
  parentTurnId?: TurnId;
  initialParticipants?: Array<{
    id: ParticipantId;
    role?: ParticipantRole;
    permissions?: Partial<ConversationPermissions>;
  }>;
  initialTurn?: {
    contentType: string;
    content: unknown;
    visibility?: TurnVisibility;
  };
  metadata?: Record<string, unknown>;
  _meta?: Meta;
}

export interface MailCreateRequest extends MAPRequestBase<MailCreateRequestParams> {
  method: "mail/create";
  params: MailCreateRequestParams;
}

export interface MailCreateResponseResult {
  conversation: Conversation;
  participant: ConversationParticipant;
  initialTurn?: Turn;
  _meta?: Meta;
}

// --- mail/get ---

export interface MailGetRequestParams {
  conversationId: ConversationId;
  include?: {
    participants?: boolean;
    threads?: boolean;
    recentTurns?: number;
    stats?: boolean;
  };
  _meta?: Meta;
}

export interface MailGetRequest extends MAPRequestBase<MailGetRequestParams> {
  method: "mail/get";
  params: MailGetRequestParams;
}

export interface MailGetResponseResult {
  conversation: Conversation;
  participants?: ConversationParticipant[];
  threads?: Thread[];
  recentTurns?: Turn[];
  stats?: {
    totalTurns: number;
    turnsByContentType: Record<string, number>;
    activeParticipants: number;
    threadCount: number;
  };
  _meta?: Meta;
}

// --- mail/list ---

export interface MailListRequestParams {
  filter?: {
    type?: ConversationType[];
    status?: ConversationStatus[];
    participantId?: ParticipantId;
    createdAfter?: Timestamp;
    createdBefore?: Timestamp;
    parentConversationId?: ConversationId;
  };
  limit?: number;
  cursor?: string;
  _meta?: Meta;
}

export interface MailListRequest extends MAPRequestBase<MailListRequestParams> {
  method: "mail/list";
  params?: MailListRequestParams;
}

export interface MailListResponseResult {
  conversations: Conversation[];
  nextCursor?: string;
  hasMore: boolean;
  _meta?: Meta;
}

// --- mail/close ---

export interface MailCloseRequestParams {
  conversationId: ConversationId;
  reason?: string;
  _meta?: Meta;
}

export interface MailCloseRequest extends MAPRequestBase<MailCloseRequestParams> {
  method: "mail/close";
  params: MailCloseRequestParams;
}

export interface MailCloseResponseResult {
  conversation: Conversation;
  _meta?: Meta;
}

// --- mail/reopen ---

export interface MailReopenRequestParams {
  conversationId: ConversationId;
  _meta?: Meta;
}

export interface MailReopenRequest extends MAPRequestBase<MailReopenRequestParams> {
  method: "mail/reopen";
  params: MailReopenRequestParams;
}

export interface MailReopenResponseResult {
  conversation: Conversation;
  _meta?: Meta;
}

// --- mail/presence ---

export type MailPresenceStatus = "online" | "offline" | "unknown";

export interface MailPresenceRequestParams {
  conversationId: ConversationId;
  _meta?: Meta;
}

export interface MailPresenceRequest extends MAPRequestBase<MailPresenceRequestParams> {
  method: "mail/presence";
  params: MailPresenceRequestParams;
}

export interface MailPresenceParticipant {
  participantId: ParticipantId;
  role: ParticipantRole;
  joinedAt: Timestamp;
  presence: MailPresenceStatus;
}

export interface MailPresenceResponseResult {
  conversationId: ConversationId;
  participants: MailPresenceParticipant[];
  _meta?: Meta;
}

// --- mail/join ---

export interface MailJoinRequestParams {
  conversationId: ConversationId;
  role?: ParticipantRole;
  catchUp?: {
    from: string | number;
    limit?: number;
    includeSummary?: boolean;
  };
  _meta?: Meta;
}

export interface MailJoinRequest extends MAPRequestBase<MailJoinRequestParams> {
  method: "mail/join";
  params: MailJoinRequestParams;
}

export interface MailJoinResponseResult {
  conversation: Conversation;
  participant: ConversationParticipant;
  history?: Turn[];
  historyCursor?: string;
  summary?: string;
  _meta?: Meta;
}

// --- mail/leave ---

export interface MailLeaveRequestParams {
  conversationId: ConversationId;
  reason?: string;
  _meta?: Meta;
}

export interface MailLeaveRequest extends MAPRequestBase<MailLeaveRequestParams> {
  method: "mail/leave";
  params: MailLeaveRequestParams;
}

export interface MailLeaveResponseResult {
  success: boolean;
  leftAt: Timestamp;
  _meta?: Meta;
}

// --- mail/invite ---

export interface MailInviteRequestParams {
  conversationId: ConversationId;
  participant: {
    id: ParticipantId;
    role?: ParticipantRole;
    permissions?: Partial<ConversationPermissions>;
  };
  message?: string;
  _meta?: Meta;
}

export interface MailInviteRequest extends MAPRequestBase<MailInviteRequestParams> {
  method: "mail/invite";
  params: MailInviteRequestParams;
}

export interface MailInviteResponseResult {
  invited: boolean;
  participant?: ConversationParticipant;
  invitationId?: string;
  pending?: boolean;
  _meta?: Meta;
}

// --- mail/turn ---

export interface MailTurnRequestParams {
  conversationId: ConversationId;
  contentType: string;
  content: unknown;
  threadId?: ThreadId;
  inReplyTo?: TurnId;
  visibility?: TurnVisibility;
  metadata?: Record<string, unknown>;
  _meta?: Meta;
}

export interface MailTurnRequest extends MAPRequestBase<MailTurnRequestParams> {
  method: "mail/turn";
  params: MailTurnRequestParams;
}

export interface MailTurnResponseResult {
  turn: Turn;
  _meta?: Meta;
}

// --- mail/turns/list ---

export interface MailTurnsListRequestParams {
  conversationId: ConversationId;
  filter?: {
    threadId?: ThreadId;
    includeAllThreads?: boolean;
    contentTypes?: string[];
    participantId?: ParticipantId;
    afterTurnId?: TurnId;
    beforeTurnId?: TurnId;
    afterTimestamp?: Timestamp;
    beforeTimestamp?: Timestamp;
  };
  limit?: number;
  order?: "asc" | "desc";
  _meta?: Meta;
}

export interface MailTurnsListRequest extends MAPRequestBase<MailTurnsListRequestParams> {
  method: "mail/turns/list";
  params: MailTurnsListRequestParams;
}

export interface MailTurnsListResponseResult {
  turns: Turn[];
  hasMore: boolean;
  nextCursor?: string;
  _meta?: Meta;
}

// --- mail/thread/create ---

export interface MailThreadCreateRequestParams {
  conversationId: ConversationId;
  rootTurnId: TurnId;
  subject?: string;
  parentThreadId?: ThreadId;
  _meta?: Meta;
}

export interface MailThreadCreateRequest extends MAPRequestBase<MailThreadCreateRequestParams> {
  method: "mail/thread/create";
  params: MailThreadCreateRequestParams;
}

export interface MailThreadCreateResponseResult {
  thread: Thread;
  _meta?: Meta;
}

// --- mail/thread/list ---

export interface MailThreadListRequestParams {
  conversationId: ConversationId;
  parentThreadId?: ThreadId;
  limit?: number;
  cursor?: string;
  _meta?: Meta;
}

export interface MailThreadListRequest extends MAPRequestBase<MailThreadListRequestParams> {
  method: "mail/thread/list";
  params?: MailThreadListRequestParams;
}

export interface MailThreadListResponseResult {
  threads: Thread[];
  hasMore: boolean;
  nextCursor?: string;
  _meta?: Meta;
}

// --- mail/summary ---

export interface MailSummaryRequestParams {
  conversationId: ConversationId;
  scope?: {
    fromTurnId?: TurnId;
    toTurnId?: TurnId;
    threadId?: ThreadId;
  };
  regenerate?: boolean;
  include?: {
    keyPoints?: boolean;
    keyDecisions?: boolean;
    openQuestions?: boolean;
    participants?: boolean;
  };
  _meta?: Meta;
}

export interface MailSummaryRequest extends MAPRequestBase<MailSummaryRequestParams> {
  method: "mail/summary";
  params: MailSummaryRequestParams;
}

export interface MailSummaryResponseResult {
  summary: string;
  keyPoints?: string[];
  keyDecisions?: string[];
  openQuestions?: string[];
  generated: boolean;
  cachedAt?: Timestamp;
  _meta?: Meta;
}

// --- mail/replay ---

export interface MailReplayRequestParams {
  conversationId: ConversationId;
  fromTurnId?: TurnId;
  fromTimestamp?: Timestamp;
  threadId?: ThreadId;
  limit?: number;
  contentTypes?: string[];
  _meta?: Meta;
}

export interface MailReplayRequest extends MAPRequestBase<MailReplayRequestParams> {
  method: "mail/replay";
  params: MailReplayRequestParams;
}

export interface MailReplayResponseResult {
  turns: Turn[];
  hasMore: boolean;
  nextCursor?: string;
  missedCount: number;
  _meta?: Meta;
}

// =============================================================================
// Workspace Request/Response Types
// =============================================================================

// --- workspace/search ---

export interface WorkspaceSearchRequestParams {
  /** Agent whose workspace to search */
  agentId: AgentId;
  /** Search query (matched against filenames) */
  query: string;
  /** Subdirectory to search within (relative to workspace root) */
  cwd?: string;
  /** Max results to return (default 50) */
  limit?: number;
  _meta?: Meta;
}

export interface WorkspaceFileResult {
  /** Relative path from workspace root */
  path: string;
  /** Whether this is a directory */
  isDirectory: boolean;
  /** File size in bytes (undefined for directories) */
  size?: number;
  /** MIME type guess based on extension */
  mime?: string;
}

export interface WorkspaceSearchResponseResult {
  files: WorkspaceFileResult[];
  _meta?: Meta;
}

// --- workspace/list ---

export interface WorkspaceListRequestParams {
  /** Agent whose workspace to list */
  agentId: AgentId;
  /** Directory to list (relative to workspace root, default ".") */
  directory?: string;
  _meta?: Meta;
}

export interface WorkspaceListResponseResult {
  files: WorkspaceFileResult[];
  _meta?: Meta;
}

// --- workspace/read ---

export interface WorkspaceReadRequestParams {
  /** Agent whose workspace to read from */
  agentId: AgentId;
  /** File path relative to workspace root */
  path: string;
  /** Optional line range */
  lineRange?: { start: number; end: number };
  _meta?: Meta;
}

export interface WorkspaceReadResponseResult {
  /** File text content */
  text: string;
  /** MIME type */
  mime: string;
  /** File size in bytes */
  size: number;
  _meta?: Meta;
}

// =============================================================================
// Trajectory Types
// =============================================================================

/**
 * A trajectory checkpoint records a snapshot of agent work at a meaningful point.
 *
 * The checkpoint intentionally carries only minimal, agent-agnostic fields.
 * Domain-specific data (token usage, file lists, summaries, attribution, VCS
 * info, etc.) belongs in the freeform `metadata` bag so that different agent
 * implementations can attach whatever makes sense for their workflow.
 */
export interface TrajectoryCheckpoint {
  /** Unique checkpoint identifier */
  id: CheckpointId;
  /** The agent that created this checkpoint */
  agentId: AgentId;
  /** When the checkpoint was created */
  timestamp: Timestamp;
  /** Short human-readable label (e.g., commit message, task name) */
  label?: string;
  /** Agent's work session identifier (distinct from MAP protocol SessionId) */
  sessionId?: string;
  /** Extensible key-value metadata — agent-specific data goes here */
  metadata?: Record<string, unknown>;
  _meta?: Meta;
}

/**
 * Content artifact names are freeform strings.
 * Well-known names include "metadata", "transcript", "prompts", "context"
 * but agents may define their own.
 */
export type TrajectoryContentField = string;

/** Base fields common to both inline and streaming content responses */
export interface TrajectoryContentResultBase {
  checkpointId: CheckpointId;
  /** Named content artifacts — small payloads are delivered inline */
  artifacts: Record<string, unknown>;
}

/** Inline content response — all content fits in a single message */
export interface TrajectoryContentResultInline extends TrajectoryContentResultBase {
  streaming: false;
}

/** Streaming content response — one large artifact will arrive as chunks */
export interface TrajectoryContentResultStreaming extends TrajectoryContentResultBase {
  streaming: true;
  /** Unique ID for correlating chunks */
  streamId: string;
  /** Which artifact key is being streamed */
  streamArtifact: string;
  /** Info about the upcoming stream */
  streamInfo: {
    totalBytes: number;
    totalChunks: number;
    encoding: "base64";
  };
}

/** Content result — either inline or streaming */
export type TrajectoryContentResult =
  | TrajectoryContentResultInline
  | TrajectoryContentResultStreaming;

/** Params for a content chunk notification */
export interface TrajectoryContentChunkParams {
  /** Correlates to streamId from the streaming response */
  streamId: string;
  /** 0-based chunk index */
  index: number;
  /** Base64-encoded chunk data */
  data: string;
  /** True on the last chunk */
  final?: boolean;
  /** SHA-256 checksum of the full content (only on final chunk) */
  checksum?: string;
}

// =============================================================================
// Trajectory Subscription Filter
// =============================================================================

/** Trajectory-specific subscription filter */
export interface TrajectorySubscriptionFilter {
  /** Filter by agent ID */
  agentId?: AgentId;
  /** Filter by work session ID */
  sessionId?: string;
}

// =============================================================================
// Trajectory Event Data Types
// =============================================================================

/** Data for trajectory.checkpoint events */
export interface TrajectoryCheckpointEventData {
  checkpoint: TrajectoryCheckpoint;
}

/** Data for trajectory.content.available events */
export interface TrajectoryContentAvailableEventData {
  checkpointId: CheckpointId;
  agentId: AgentId;
}

// =============================================================================
// Trajectory Request/Response Types
// =============================================================================

// --- trajectory/checkpoint ---

export interface TrajectoryCheckpointRequestParams {
  /** Checkpoint data (timestamp auto-filled by server if omitted) */
  checkpoint: Omit<TrajectoryCheckpoint, "timestamp"> & {
    timestamp?: Timestamp;
  };
  _meta?: Meta;
}

export interface TrajectoryCheckpointRequest extends MAPRequestBase<TrajectoryCheckpointRequestParams> {
  method: "trajectory/checkpoint";
  params: TrajectoryCheckpointRequestParams;
}

export interface TrajectoryCheckpointResponseResult {
  checkpoint: TrajectoryCheckpoint;
  _meta?: Meta;
}

// --- trajectory/list ---

export interface TrajectoryListRequestParams {
  filter?: {
    agentId?: AgentId;
    sessionId?: string;
    afterTimestamp?: Timestamp;
    beforeTimestamp?: Timestamp;
  };
  limit?: number;
  cursor?: string;
  _meta?: Meta;
}

export interface TrajectoryListRequest extends MAPRequestBase<TrajectoryListRequestParams> {
  method: "trajectory/list";
  params: TrajectoryListRequestParams;
}

export interface TrajectoryListResponseResult {
  checkpoints: TrajectoryCheckpoint[];
  hasMore: boolean;
  nextCursor?: string;
  _meta?: Meta;
}

// --- trajectory/get ---

export interface TrajectoryGetRequestParams {
  checkpointId: CheckpointId;
  _meta?: Meta;
}

export interface TrajectoryGetRequest extends MAPRequestBase<TrajectoryGetRequestParams> {
  method: "trajectory/get";
  params: TrajectoryGetRequestParams;
}

export interface TrajectoryGetResponseResult {
  checkpoint: TrajectoryCheckpoint;
  _meta?: Meta;
}

// --- trajectory/content ---

export interface TrajectoryContentRequestParams {
  checkpointId: CheckpointId;
  /** Which content fields to include (default: all) */
  include?: TrajectoryContentField[];
  _meta?: Meta;
}

export interface TrajectoryContentRequest extends MAPRequestBase<TrajectoryContentRequestParams> {
  method: "trajectory/content";
  params: TrajectoryContentRequestParams;
}

export interface TrajectoryContentResponseResult {
  content: TrajectoryContentResult;
  _meta?: Meta;
}

// --- trajectory/content.chunk (notification) ---

export interface TrajectoryContentChunkNotification extends MAPNotificationBase<TrajectoryContentChunkParams> {
  method: "trajectory/content.chunk";
  params: TrajectoryContentChunkParams;
}

// =============================================================================
// Task Types
// =============================================================================

/** Standard task status values. Implementations may use `meta` for richer states. */
export type MAPTaskStatus =
  | "open"
  | "in_progress"
  | "blocked"
  | "completed"
  | "failed";

/**
 * A task in the MAP system.
 *
 * Intentionally minimal — MAP defines the coordination envelope,
 * not the task semantics. Providers (e.g., OpenTasks) can use
 * the `meta` field for implementation-specific data (graph edges,
 * priority levels, content hashes, etc.).
 */
export interface MAPTask {
  /** Unique task identifier */
  id: TaskId;

  /** Agent this task is assigned to (null = unassigned) */
  assignee?: AgentId | null;

  /** Human-readable task title */
  title?: string;

  /** Current task status */
  status?: MAPTaskStatus;

  /** Task description or instructions */
  description?: string;

  /** Provider/implementation-specific metadata */
  meta?: Meta;
}

// =============================================================================
// Task Event Data Types
// =============================================================================

/** Data for task.created events */
export interface TaskCreatedEventData {
  task: MAPTask;
}

/** Data for task.assigned events */
export interface TaskAssignedEventData {
  taskId: TaskId;
  agentId: AgentId;
}

/** Data for task.status events */
export interface TaskStatusEventData {
  taskId: TaskId;
  previous: MAPTaskStatus;
  current: MAPTaskStatus;
}

/** Data for task.completed events */
export interface TaskCompletedEventData {
  taskId: TaskId;
  result?: unknown;
}

// =============================================================================
// Task Request/Response Types
// =============================================================================

// --- map/tasks/create ---

export interface TasksCreateRequestParams {
  /** Task data. If `id` is omitted, the server generates one. */
  task: Omit<MAPTask, "id"> & { id?: TaskId };
  _meta?: Meta;
}

export interface TasksCreateRequest extends MAPRequestBase<TasksCreateRequestParams> {
  method: "map/tasks/create";
  params: TasksCreateRequestParams;
}

export interface TasksCreateResponseResult {
  task: MAPTask;
  _meta?: Meta;
}

// --- map/tasks/assign ---

export interface TasksAssignRequestParams {
  taskId: TaskId;
  agentId: AgentId;
  _meta?: Meta;
}

export interface TasksAssignRequest extends MAPRequestBase<TasksAssignRequestParams> {
  method: "map/tasks/assign";
  params: TasksAssignRequestParams;
}

export interface TasksAssignResponseResult {
  task: MAPTask;
  _meta?: Meta;
}

// --- map/tasks/update ---

export interface TasksUpdateRequestParams {
  taskId: TaskId;
  status?: MAPTaskStatus;
  title?: string;
  description?: string;
  assignee?: AgentId | null;
  meta?: Meta;
  _meta?: Meta;
}

export interface TasksUpdateRequest extends MAPRequestBase<TasksUpdateRequestParams> {
  method: "map/tasks/update";
  params: TasksUpdateRequestParams;
}

export interface TasksUpdateResponseResult {
  task: MAPTask;
  _meta?: Meta;
}

// --- map/tasks/list ---

export interface TasksListRequestParams {
  filter?: {
    assignee?: AgentId;
    status?: MAPTaskStatus | MAPTaskStatus[];
  };
  limit?: number;
  cursor?: string;
  _meta?: Meta;
}

export interface TasksListRequest extends MAPRequestBase<TasksListRequestParams> {
  method: "map/tasks/list";
  params?: TasksListRequestParams;
}

export interface TasksListResponseResult {
  tasks: MAPTask[];
  hasMore: boolean;
  nextCursor?: string;
  _meta?: Meta;
}

// =============================================================================
// Notification Types
// =============================================================================

/**
 * Parameters for event notifications delivered to subscribers.
 *
 * The envelope contains both delivery metadata (subscriptionId, sequence)
 * and optional fields for deduplication and causal ordering.
 */
export interface EventNotificationParams {
  /** The subscription this event is being delivered to */
  subscriptionId: SubscriptionId;

  /** Monotonically increasing sequence number within this subscription */
  sequenceNumber: number;

  /**
   * Globally unique event identifier (ULID format).
   *
   * Used for:
   * - Deduplication (same event delivered multiple times)
   * - Replay references (afterEventId in replay requests)
   * - Causal tracking (referenced in causedBy arrays)
   *
   * Format: 26-character ULID, e.g., "01HQJY3KCNP5VXWZ8M4R6T2G9B"
   *
   * @remarks
   * If not provided by the server, deduplication is skipped.
   * New routers should always provide this field.
   */
  eventId?: string;

  /**
   * Server timestamp when the event was processed (milliseconds since epoch).
   *
   * This is the envelope-level timestamp, which may differ from event.timestamp
   * if the event was queued or replayed.
   */
  timestamp?: Timestamp;

  /**
   * Event IDs of events that causally precede this event.
   *
   * Used for enforcing causal ordering - this event should not be
   * processed until all events in causedBy have been processed.
   *
   * @example
   * A message_delivered event would have causedBy: [messagesentEventId]
   */
  causedBy?: string[];

  /** The event payload */
  event: Event;

  _meta?: Meta;
}

export interface EventNotification extends MAPNotificationBase<EventNotificationParams> {
  method: "map/event";
  params: EventNotificationParams;
}

export interface MessageNotificationParams {
  message: Message;
  _meta?: Meta;
}

export interface MessageNotification extends MAPNotificationBase<MessageNotificationParams> {
  method: "map/message";
  params: MessageNotificationParams;
}

// =============================================================================
// Union Types for All Requests/Responses/Notifications
// =============================================================================

/** All MAP request types */
export type MAPRequest =
  // Core
  | ConnectRequest
  | DisconnectRequest
  | SessionListRequest
  | SessionLoadRequest
  | SessionCloseRequest
  | AgentsListRequest
  | AgentsGetRequest
  | SendRequest
  | SubscribeRequest
  | UnsubscribeRequest
  | ReplayRequest
  | AuthRefreshRequest
  // Structure
  | AgentsRegisterRequest
  | AgentsSpawnRequest
  | AgentsUnregisterRequest
  | AgentsUpdateRequest
  | AgentsStopRequest
  | AgentsSuspendRequest
  | AgentsResumeRequest
  | StructureGraphRequest
  | ScopesListRequest
  | ScopesGetRequest
  | ScopesCreateRequest
  | ScopesDeleteRequest
  | ScopesJoinRequest
  | ScopesLeaveRequest
  | ScopesMembersRequest
  // Permissions
  | PermissionsUpdateRequest
  // Extension
  | InjectRequest
  | FederationConnectRequest
  | FederationRouteRequest
  // Mail
  | MailCreateRequest
  | MailGetRequest
  | MailListRequest
  | MailCloseRequest
  | MailJoinRequest
  | MailLeaveRequest
  | MailInviteRequest
  | MailTurnRequest
  | MailTurnsListRequest
  | MailThreadCreateRequest
  | MailThreadListRequest
  | MailSummaryRequest
  | MailReplayRequest
  // Trajectory
  | TrajectoryCheckpointRequest
  | TrajectoryListRequest
  | TrajectoryGetRequest
  | TrajectoryContentRequest;

/** All MAP notification types */
export type MAPNotification =
  | EventNotification
  | MessageNotification
  | SubscriptionAckNotification
  | TrajectoryContentChunkNotification;

// =============================================================================
// Method Constants (Reorganized by capability domain)
// =============================================================================

/** Core methods - All implementations must support */
export const CORE_METHODS = {
  CONNECT: "map/connect",
  DISCONNECT: "map/disconnect",
  SEND: "map/send",
  SUBSCRIBE: "map/subscribe",
  UNSUBSCRIBE: "map/unsubscribe",
  REPLAY: "map/replay",
} as const;

/** Observation methods - Query/read operations */
export const OBSERVATION_METHODS = {
  AGENTS_LIST: "map/agents/list",
  AGENTS_GET: "map/agents/get",
  SCOPES_LIST: "map/scopes/list",
  SCOPES_GET: "map/scopes/get",
  SCOPES_MEMBERS: "map/scopes/members",
  STRUCTURE_GRAPH: "map/structure/graph",
} as const;

/** Lifecycle methods - Agent creation/destruction */
export const LIFECYCLE_METHODS = {
  AGENTS_REGISTER: "map/agents/register",
  AGENTS_UNREGISTER: "map/agents/unregister",
  AGENTS_SPAWN: "map/agents/spawn",
} as const;

/** State methods - Agent state management */
export const STATE_METHODS = {
  AGENTS_UPDATE: "map/agents/update",
  AGENTS_SUSPEND: "map/agents/suspend",
  AGENTS_RESUME: "map/agents/resume",
  AGENTS_STOP: "map/agents/stop",
} as const;

/** Steering methods - External control */
export const STEERING_METHODS = {
  INJECT: "map/inject",
} as const;

/** Scope methods - Scope management */
export const SCOPE_METHODS = {
  SCOPES_CREATE: "map/scopes/create",
  SCOPES_DELETE: "map/scopes/delete",
  SCOPES_JOIN: "map/scopes/join",
  SCOPES_LEAVE: "map/scopes/leave",
} as const;

/** Session methods */
export const SESSION_METHODS = {
  SESSION_LIST: "map/session/list",
  SESSION_LOAD: "map/session/load",
  SESSION_CLOSE: "map/session/close",
} as const;

/** Auth methods */
export const AUTH_METHODS = {
  AUTHENTICATE: "map/authenticate",
  AUTH_REFRESH: "map/auth/refresh",
} as const;

/** Permission methods */
export const PERMISSION_METHODS = {
  PERMISSIONS_UPDATE: "map/permissions/update",
} as const;

/** Federation methods */
export const FEDERATION_METHODS = {
  FEDERATION_CONNECT: "map/federation/connect",
  FEDERATION_ROUTE: "map/federation/route",
} as const;

/** Mail methods - Conversation and turn management */
export const MAIL_METHODS = {
  MAIL_CREATE: "mail/create",
  MAIL_GET: "mail/get",
  MAIL_LIST: "mail/list",
  MAIL_CLOSE: "mail/close",
  MAIL_REOPEN: "mail/reopen",
  MAIL_PRESENCE: "mail/presence",
  MAIL_JOIN: "mail/join",
  MAIL_LEAVE: "mail/leave",
  MAIL_INVITE: "mail/invite",
  MAIL_TURN: "mail/turn",
  MAIL_TURNS_LIST: "mail/turns/list",
  MAIL_THREAD_CREATE: "mail/thread/create",
  MAIL_THREAD_LIST: "mail/thread/list",
  MAIL_SUMMARY: "mail/summary",
  MAIL_REPLAY: "mail/replay",
} as const;

/** Workspace methods */
export const WORKSPACE_METHODS = {
  WORKSPACE_SEARCH: "workspace/search",
  WORKSPACE_LIST: "workspace/list",
  WORKSPACE_READ: "workspace/read",
} as const;

/** Trajectory methods - Agent work trajectory tracking */
export const TRAJECTORY_METHODS = {
  TRAJECTORY_CHECKPOINT: "trajectory/checkpoint",
  TRAJECTORY_LIST: "trajectory/list",
  TRAJECTORY_GET: "trajectory/get",
  TRAJECTORY_CONTENT: "trajectory/content",
} as const;

/** Task methods - Task management */
export const TASK_METHODS = {
  TASKS_CREATE: "map/tasks/create",
  TASKS_ASSIGN: "map/tasks/assign",
  TASKS_UPDATE: "map/tasks/update",
  TASKS_LIST: "map/tasks/list",
} as const;

/** Notification methods */
export const NOTIFICATION_METHODS = {
  EVENT: "map/event",
  MESSAGE: "map/message",
  SEND: "map/send",
  /** Client acknowledges received events (for backpressure) */
  SUBSCRIBE_ACK: "map/subscribe.ack",
  /** Server notifies client that auth is about to expire */
  AUTH_EXPIRING: "map/auth/expiring",
  /** Content chunk for streaming large trajectory transcripts */
  TRAJECTORY_CONTENT_CHUNK: "trajectory/content.chunk",
} as const;

/** All MAP methods */
export const MAP_METHODS = {
  ...CORE_METHODS,
  ...OBSERVATION_METHODS,
  ...LIFECYCLE_METHODS,
  ...STATE_METHODS,
  ...STEERING_METHODS,
  ...SCOPE_METHODS,
  ...SESSION_METHODS,
  ...AUTH_METHODS,
  ...PERMISSION_METHODS,
  ...FEDERATION_METHODS,
  ...MAIL_METHODS,
  ...WORKSPACE_METHODS,
  ...TRAJECTORY_METHODS,
  ...TASK_METHODS,
} as const;

// Legacy aliases for backward compatibility
export const STRUCTURE_METHODS = {
  ...LIFECYCLE_METHODS,
  ...STATE_METHODS,
  ...SCOPE_METHODS,
  STRUCTURE_GRAPH: OBSERVATION_METHODS.STRUCTURE_GRAPH,
} as const;

export const EXTENSION_METHODS = {
  ...STEERING_METHODS,
  ...FEDERATION_METHODS,
} as const;

// =============================================================================
// Error Codes (Fixed: no collisions)
// =============================================================================

/** JSON-RPC standard error codes */
export const PROTOCOL_ERROR_CODES = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

/** Authentication error codes */
export const AUTH_ERROR_CODES = {
  AUTH_REQUIRED: 1000,
  AUTH_FAILED: 1001,
  TOKEN_EXPIRED: 1002,
  PERMISSION_DENIED: 1003,
  INSUFFICIENT_SCOPE: 1004,
  METHOD_NOT_SUPPORTED: 1005,
  INVALID_CREDENTIALS: 1006,
} as const;

/** Routing error codes */
export const ROUTING_ERROR_CODES = {
  ADDRESS_NOT_FOUND: 2000,
  AGENT_NOT_FOUND: 2001,
  SCOPE_NOT_FOUND: 2002,
  DELIVERY_FAILED: 2003,
  ADDRESS_AMBIGUOUS: 2004,
} as const;

/** Agent error codes */
export const AGENT_ERROR_CODES = {
  AGENT_EXISTS: 3000,
  STATE_INVALID: 3001,
  NOT_RESPONDING: 3002,
  TERMINATED: 3003,
  SPAWN_FAILED: 3004,
} as const;

/** Resource error codes */
export const RESOURCE_ERROR_CODES = {
  EXHAUSTED: 4000,
  RATE_LIMITED: 4001,
  QUOTA_EXCEEDED: 4002,
} as const;

/** Federation error codes - prefixed to avoid collision with AUTH_FAILED */
export const FEDERATION_ERROR_CODES = {
  FEDERATION_UNAVAILABLE: 5000,
  FEDERATION_SYSTEM_NOT_FOUND: 5001,
  FEDERATION_AUTH_FAILED: 5002,
  FEDERATION_ROUTE_REJECTED: 5003,
  /** Message has already visited this system (loop detected) */
  FEDERATION_LOOP_DETECTED: 5010,
  /** Message exceeded maximum hop count */
  FEDERATION_MAX_HOPS_EXCEEDED: 5011,
  /** DID document resolution failed (network error, invalid document, etc.) */
  FEDERATION_DID_RESOLUTION_FAILED: 5004,
  /** DID proof verification failed (bad signature, expired, wrong challenge, etc.) */
  FEDERATION_DID_PROOF_INVALID: 5005,
} as const;

/** Mail error codes - prefixed to avoid collision with PERMISSION_DENIED */
export const MAIL_ERROR_CODES = {
  MAIL_CONVERSATION_NOT_FOUND: 10000,
  MAIL_CONVERSATION_CLOSED: 10001,
  MAIL_NOT_A_PARTICIPANT: 10002,
  MAIL_PERMISSION_DENIED: 10003,
  MAIL_TURN_NOT_FOUND: 10004,
  MAIL_THREAD_NOT_FOUND: 10005,
  MAIL_INVALID_TURN_CONTENT: 10006,
  MAIL_PARTICIPANT_ALREADY_JOINED: 10007,
  MAIL_INVITATION_REQUIRED: 10008,
  MAIL_HISTORY_ACCESS_DENIED: 10009,
  MAIL_PARENT_CONVERSATION_NOT_FOUND: 10010,
} as const;

/** Trajectory error codes */
export const TRAJECTORY_ERROR_CODES = {
  TRAJECTORY_NOT_ENABLED: 13000,
  TRAJECTORY_CHECKPOINT_NOT_FOUND: 13001,
  TRAJECTORY_CONTENT_UNAVAILABLE: 13002,
  TRAJECTORY_STREAM_FAILED: 13003,
  TRAJECTORY_PERMISSION_DENIED: 13004,
} as const;

/** All error codes */
export const ERROR_CODES = {
  ...PROTOCOL_ERROR_CODES,
  ...AUTH_ERROR_CODES,
  ...ROUTING_ERROR_CODES,
  ...AGENT_ERROR_CODES,
  ...RESOURCE_ERROR_CODES,
  ...FEDERATION_ERROR_CODES,
  ...MAIL_ERROR_CODES,
  ...TRAJECTORY_ERROR_CODES,
} as const;

/** Protocol version */
export const PROTOCOL_VERSION: ProtocolVersion = 1;

// =============================================================================
// Capability Requirements
// =============================================================================

/**
 * Maps methods to required capabilities.
 * Empty array means no special capability required.
 */
export const CAPABILITY_REQUIREMENTS: Record<string, string[]> = {
  // Core
  [CORE_METHODS.CONNECT]: [],
  [CORE_METHODS.DISCONNECT]: [],
  [CORE_METHODS.SEND]: ["messaging.canSend"],
  [CORE_METHODS.SUBSCRIBE]: ["observation.canObserve"],
  [CORE_METHODS.UNSUBSCRIBE]: ["observation.canObserve"],

  // Observation
  [OBSERVATION_METHODS.AGENTS_LIST]: ["observation.canQuery"],
  [OBSERVATION_METHODS.AGENTS_GET]: ["observation.canQuery"],
  [OBSERVATION_METHODS.SCOPES_LIST]: ["observation.canQuery"],
  [OBSERVATION_METHODS.SCOPES_GET]: ["observation.canQuery"],
  [OBSERVATION_METHODS.SCOPES_MEMBERS]: ["observation.canQuery"],
  [OBSERVATION_METHODS.STRUCTURE_GRAPH]: ["observation.canQuery"],

  // Lifecycle
  [LIFECYCLE_METHODS.AGENTS_REGISTER]: ["lifecycle.canRegister"],
  [LIFECYCLE_METHODS.AGENTS_UNREGISTER]: ["lifecycle.canUnregister"],
  [LIFECYCLE_METHODS.AGENTS_SPAWN]: ["lifecycle.canSpawn"],

  // State
  [STATE_METHODS.AGENTS_UPDATE]: ["lifecycle.canRegister"],
  [STATE_METHODS.AGENTS_SUSPEND]: ["lifecycle.canStop"],
  [STATE_METHODS.AGENTS_RESUME]: ["lifecycle.canStop"],
  [STATE_METHODS.AGENTS_STOP]: ["lifecycle.canStop"],

  // Steering
  [STEERING_METHODS.INJECT]: ["lifecycle.canSteer"],

  // Scopes
  [SCOPE_METHODS.SCOPES_CREATE]: ["scopes.canCreateScopes"],
  [SCOPE_METHODS.SCOPES_DELETE]: ["scopes.canManageScopes"],
  [SCOPE_METHODS.SCOPES_JOIN]: [],
  [SCOPE_METHODS.SCOPES_LEAVE]: [],

  // Session
  [SESSION_METHODS.SESSION_LIST]: [],
  [SESSION_METHODS.SESSION_LOAD]: [],
  [SESSION_METHODS.SESSION_CLOSE]: [],

  // Auth (no capability required - anyone can authenticate)
  [AUTH_METHODS.AUTHENTICATE]: [],
  [AUTH_METHODS.AUTH_REFRESH]: [],

  // Permissions (system-only, no capability check - enforced by participant type)
  [PERMISSION_METHODS.PERMISSIONS_UPDATE]: [],

  // Federation
  [FEDERATION_METHODS.FEDERATION_CONNECT]: ["federation.canFederate"],
  [FEDERATION_METHODS.FEDERATION_ROUTE]: ["federation.canFederate"],

  // Mail
  [MAIL_METHODS.MAIL_CREATE]: ["mail.canCreate"],
  [MAIL_METHODS.MAIL_GET]: ["mail.canJoin"],
  [MAIL_METHODS.MAIL_LIST]: ["mail.canJoin"],
  [MAIL_METHODS.MAIL_CLOSE]: ["mail.canCreate"],
  [MAIL_METHODS.MAIL_JOIN]: ["mail.canJoin"],
  [MAIL_METHODS.MAIL_LEAVE]: ["mail.canJoin"],
  [MAIL_METHODS.MAIL_INVITE]: ["mail.canInvite"],
  [MAIL_METHODS.MAIL_TURN]: ["mail.canJoin"],
  [MAIL_METHODS.MAIL_TURNS_LIST]: ["mail.canViewHistory"],
  [MAIL_METHODS.MAIL_THREAD_CREATE]: ["mail.canCreateThreads"],
  [MAIL_METHODS.MAIL_THREAD_LIST]: ["mail.canJoin"],
  [MAIL_METHODS.MAIL_SUMMARY]: ["mail.canViewHistory"],
  [MAIL_METHODS.MAIL_REPLAY]: ["mail.canViewHistory"],

  // Workspace
  [WORKSPACE_METHODS.WORKSPACE_SEARCH]: ["workspace.canSearch"],
  [WORKSPACE_METHODS.WORKSPACE_LIST]: ["workspace.canList"],
  [WORKSPACE_METHODS.WORKSPACE_READ]: ["workspace.canRead"],

  // Trajectory
  [TRAJECTORY_METHODS.TRAJECTORY_CHECKPOINT]: ["trajectory.canReport"],
  [TRAJECTORY_METHODS.TRAJECTORY_LIST]: ["trajectory.canQuery"],
  [TRAJECTORY_METHODS.TRAJECTORY_GET]: ["trajectory.canQuery"],
  [TRAJECTORY_METHODS.TRAJECTORY_CONTENT]: ["trajectory.canRequestContent"],

  // Tasks
  [TASK_METHODS.TASKS_CREATE]: ["tasks.canCreate"],
  [TASK_METHODS.TASKS_ASSIGN]: ["tasks.canAssign"],
  [TASK_METHODS.TASKS_UPDATE]: ["tasks.canUpdate"],
  [TASK_METHODS.TASKS_LIST]: ["tasks.canList"],
} as const;

// =============================================================================
// Type Guards
// =============================================================================

/** Check if a response is an error response */
export function isErrorResponse(
  response: MAPResponse,
): response is MAPResponseError {
  return "error" in response;
}

/** Check if a response is a success response */
export function isSuccessResponse<T>(
  response: MAPResponse<T>,
): response is MAPResponseSuccess<T> {
  return "result" in response;
}

/** Check if an address is a direct address */
export function isDirectAddress(address: Address): address is DirectAddress {
  return (
    typeof address === "object" && "agent" in address && !("system" in address)
  );
}

/** Check if an address is a federated address */
export function isFederatedAddress(
  address: Address,
): address is FederatedAddress {
  return (
    typeof address === "object" && "system" in address && "agent" in address
  );
}

/** Check if an address is a scope address */
export function isScopeAddress(address: Address): address is ScopeAddress {
  return typeof address === "object" && "scope" in address;
}

/** Check if an address is a broadcast address */
export function isBroadcastAddress(
  address: Address,
): address is BroadcastAddress {
  return typeof address === "object" && "broadcast" in address;
}

/** Check if an address is a hierarchical address */
export function isHierarchicalAddress(
  address: Address,
): address is HierarchicalAddress {
  return (
    typeof address === "object" &&
    ("parent" in address ||
      "children" in address ||
      "ancestors" in address ||
      "descendants" in address ||
      "siblings" in address)
  );
}
