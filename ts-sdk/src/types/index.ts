/**
 * Multi-Agent Protocol (MAP) Type Definitions
 *
 * Core type definitions matching the MAP JSON Schema.
 * These types are the foundation for the TypeScript SDK.
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

/** JSON-RPC request ID */
export type RequestId = string | number;

/** MAP protocol version */
export type ProtocolVersion = 1;

/** Unix timestamp in milliseconds */
export type Timestamp = number;

/** Vendor extension metadata */
export type Meta = Record<string, unknown>;

// =============================================================================
// Participant Types
// =============================================================================

/** Type of participant in the protocol */
export type ParticipantType = 'agent' | 'client' | 'system' | 'gateway';

/** Transport binding type */
export type TransportType = 'websocket' | 'stdio' | 'inprocess' | 'http-sse';

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
  | 'registered'
  | 'active'
  | 'busy'
  | 'idle'
  | 'suspended'
  | 'stopping'
  | 'stopped'
  | 'failed'
  | `x-${string}`;

/** Type of relationship between agents */
export type AgentRelationshipType = 'peer' | 'supervisor' | 'supervised' | 'collaborator';

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
  exitCode?: number;
  exitReason?: string;
  _meta?: Meta;
}

/** Who can see this agent */
export type AgentVisibility = 'public' | 'parent-only' | 'scope' | 'system';

/** An agent in the multi-agent system */
export interface Agent {
  id: AgentId;
  name?: string;
  description?: string;
  parent?: AgentId;
  relationships?: AgentRelationship[];
  state: AgentState;
  role?: string;
  scopes?: ScopeId[];
  visibility?: AgentVisibility;
  lifecycle?: AgentLifecycle;
  capabilities?: ParticipantCapabilities;
  metadata?: Record<string, unknown>;
  _meta?: Meta;
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
  participants?: 'all' | 'agents' | 'clients';
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
export type MessagePriority = 'urgent' | 'high' | 'normal' | 'low';

/** Message delivery guarantees */
export type DeliverySemantics = 'fire-and-forget' | 'acknowledged' | 'guaranteed';

/** Relationship context for the message */
export type MessageRelationship = 'parent-to-child' | 'child-to-parent' | 'peer' | 'broadcast';

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
  _meta?: Meta;
}

/** A message in the multi-agent system */
export interface Message<T = unknown> {
  id: MessageId;
  from: ParticipantId;
  to: Address;
  payload?: T;
  meta?: MessageMeta;
  _meta?: Meta;
}

// =============================================================================
// Scope Types
// =============================================================================

/** Policy for joining a scope */
export type JoinPolicy = 'open' | 'invite' | 'role' | 'system';

/** Who can see the scope exists and its members */
export type ScopeVisibility = 'public' | 'members' | 'system';

/** Who can see messages sent to this scope */
export type MessageVisibility = 'public' | 'members' | 'system';

/** Who can send messages to this scope */
export type SendPolicy = 'members' | 'any';

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

/** Type of system event */
export type EventType =
  | 'agent_registered'
  | 'agent_state_changed'
  | 'agent_unregistered'
  | 'message_sent'
  | 'message_delivered'
  | 'message_failed'
  | 'scope_created'
  | 'scope_deleted'
  | 'scope_member_joined'
  | 'scope_member_left'
  | 'system_error'
  | 'federation_connected'
  | 'federation_disconnected';

/** A system event */
export interface Event {
  id: string;
  type: EventType;
  timestamp: Timestamp;
  source?: ParticipantId;
  data?: Record<string, unknown>;
  causedBy?: string[];
  _meta?: Meta;
}

/** Filter for event subscriptions */
export interface SubscriptionFilter {
  agents?: AgentId[];
  roles?: string[];
  scopes?: ScopeId[];
  eventTypes?: EventType[];
  priorities?: MessagePriority[];
  _meta?: Meta;
}

/** An active event subscription */
export interface Subscription {
  id: SubscriptionId;
  filter?: SubscriptionFilter;
  createdAt?: Timestamp;
  replayFrom?: Timestamp | string;
  _meta?: Meta;
}

// =============================================================================
// Error Types
// =============================================================================

/** Category of error for handling decisions */
export type ErrorCategory =
  | 'protocol'
  | 'auth'
  | 'routing'
  | 'agent'
  | 'resource'
  | 'federation'
  | 'internal';

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
export const JSONRPC_VERSION = '2.0' as const;

/** Base JSON-RPC request */
export interface MAPRequestBase<TParams = unknown> {
  jsonrpc: '2.0';
  id: RequestId;
  method: string;
  params?: TParams;
}

/** Base JSON-RPC response (success) */
export interface MAPResponseSuccess<T = unknown> {
  jsonrpc: '2.0';
  id: RequestId;
  result: T;
}

/** Base JSON-RPC response (error) */
export interface MAPResponseError {
  jsonrpc: '2.0';
  id: RequestId;
  error: MAPError;
}

/** JSON-RPC response (success or error) */
export type MAPResponse<T = unknown> = MAPResponseSuccess<T> | MAPResponseError;

/** Base JSON-RPC notification */
export interface MAPNotificationBase<TParams = unknown> {
  jsonrpc: '2.0';
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
}

// =============================================================================
// Authentication Types
// =============================================================================

export type AuthMethod = 'bearer' | 'api-key' | 'mtls' | 'none';

export interface AuthParams {
  method: AuthMethod;
  token?: string;
}

export interface FederationAuth {
  method: 'bearer' | 'api-key' | 'mtls';
  credentials?: string;
}

// =============================================================================
// Request/Response Types - Core Tier
// =============================================================================

// --- map/connect ---
export interface ConnectRequestParams {
  protocolVersion: ProtocolVersion;
  participantType: ParticipantType;
  participantId?: ParticipantId;
  name?: string;
  capabilities?: ParticipantCapabilities;
  sessionId?: SessionId;
  auth?: AuthParams;
  _meta?: Meta;
}

export interface ConnectRequest extends MAPRequestBase<ConnectRequestParams> {
  method: 'map/connect';
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
  _meta?: Meta;
}

// --- map/disconnect ---
export interface DisconnectRequestParams {
  reason?: string;
  _meta?: Meta;
}

export interface DisconnectRequest extends MAPRequestBase<DisconnectRequestParams> {
  method: 'map/disconnect';
  params?: DisconnectRequestParams;
}

export interface DisconnectResponseResult {
  acknowledged: boolean;
  _meta?: Meta;
}

// --- map/session/list ---
export interface SessionListRequestParams {
  _meta?: Meta;
}

export interface SessionListRequest extends MAPRequestBase<SessionListRequestParams> {
  method: 'map/session/list';
  params?: SessionListRequestParams;
}

export interface SessionListResponseResult {
  sessions: SessionInfo[];
  _meta?: Meta;
}

// --- map/session/load ---
export interface SessionLoadRequestParams {
  sessionId: SessionId;
  _meta?: Meta;
}

export interface SessionLoadRequest extends MAPRequestBase<SessionLoadRequestParams> {
  method: 'map/session/load';
  params: SessionLoadRequestParams;
}

export interface SessionLoadResponseResult {
  sessionId: SessionId;
  restored: boolean;
  _meta?: Meta;
}

// --- map/session/close ---
export interface SessionCloseRequestParams {
  sessionId?: SessionId;
  _meta?: Meta;
}

export interface SessionCloseRequest extends MAPRequestBase<SessionCloseRequestParams> {
  method: 'map/session/close';
  params?: SessionCloseRequestParams;
}

export interface SessionCloseResponseResult {
  closed: boolean;
  _meta?: Meta;
}

// --- map/agents/list ---
export interface AgentsListFilter {
  states?: AgentState[];
  roles?: string[];
  scopes?: ScopeId[];
  parent?: AgentId;
  hasChildren?: boolean;
}

export interface AgentsListRequestParams {
  filter?: AgentsListFilter;
  limit?: number;
  cursor?: string;
  _meta?: Meta;
}

export interface AgentsListRequest extends MAPRequestBase<AgentsListRequestParams> {
  method: 'map/agents/list';
  params?: AgentsListRequestParams;
}

export interface AgentsListResponseResult {
  agents: Agent[];
  nextCursor?: string;
  _meta?: Meta;
}

// --- map/agents/get ---
export interface AgentsGetRequestParams {
  agentId: AgentId;
  _meta?: Meta;
}

export interface AgentsGetRequest extends MAPRequestBase<AgentsGetRequestParams> {
  method: 'map/agents/get';
  params: AgentsGetRequestParams;
}

export interface AgentsGetResponseResult {
  agent: Agent;
  _meta?: Meta;
}

// --- map/send ---
export interface SendRequestParams {
  to: Address;
  payload?: unknown;
  meta?: MessageMeta;
  _meta?: Meta;
}

export interface SendRequest extends MAPRequestBase<SendRequestParams> {
  method: 'map/send';
  params: SendRequestParams;
}

export interface SendResponseResult {
  messageId: MessageId;
  delivered?: ParticipantId[];
  _meta?: Meta;
}

// --- map/subscribe ---
export interface SubscribeRequestParams {
  filter?: SubscriptionFilter;
  replayFrom?: Timestamp | string;
  _meta?: Meta;
}

export interface SubscribeRequest extends MAPRequestBase<SubscribeRequestParams> {
  method: 'map/subscribe';
  params?: SubscribeRequestParams;
}

export interface SubscribeResponseResult {
  subscriptionId: SubscriptionId;
  _meta?: Meta;
}

// --- map/unsubscribe ---
export interface UnsubscribeRequestParams {
  subscriptionId: SubscriptionId;
  _meta?: Meta;
}

export interface UnsubscribeRequest extends MAPRequestBase<UnsubscribeRequestParams> {
  method: 'map/unsubscribe';
  params: UnsubscribeRequestParams;
}

export interface UnsubscribeResponseResult {
  unsubscribed: boolean;
  _meta?: Meta;
}

// --- map/auth/refresh ---
export interface AuthRefreshRequestParams {
  refreshToken: string;
  _meta?: Meta;
}

export interface AuthRefreshRequest extends MAPRequestBase<AuthRefreshRequestParams> {
  method: 'map/auth/refresh';
  params: AuthRefreshRequestParams;
}

export interface AuthRefreshResponseResult {
  accessToken: string;
  expiresAt: Timestamp;
  refreshToken?: string;
  _meta?: Meta;
}

// =============================================================================
// Request/Response Types - Structure Tier
// =============================================================================

// --- map/agents/register ---
export interface AgentsRegisterRequestParams {
  agentId?: AgentId;
  name?: string;
  description?: string;
  role?: string;
  parent?: AgentId;
  scopes?: ScopeId[];
  visibility?: AgentVisibility;
  capabilities?: ParticipantCapabilities;
  metadata?: Record<string, unknown>;
  _meta?: Meta;
}

export interface AgentsRegisterRequest extends MAPRequestBase<AgentsRegisterRequestParams> {
  method: 'map/agents/register';
  params?: AgentsRegisterRequestParams;
}

export interface AgentsRegisterResponseResult {
  agent: Agent;
  _meta?: Meta;
}

// --- map/agents/spawn ---
export interface AgentsSpawnRequestParams {
  agentId?: AgentId;
  name?: string;
  description?: string;
  role?: string;
  parent?: AgentId;
  scopes?: ScopeId[];
  visibility?: AgentVisibility;
  capabilities?: ParticipantCapabilities;
  initialMessage?: Message;
  metadata?: Record<string, unknown>;
  _meta?: Meta;
}

export interface AgentsSpawnRequest extends MAPRequestBase<AgentsSpawnRequestParams> {
  method: 'map/agents/spawn';
  params?: AgentsSpawnRequestParams;
}

export interface AgentsSpawnResponseResult {
  agent: Agent;
  messageId?: MessageId;
  _meta?: Meta;
}

// --- map/agents/unregister ---
export interface AgentsUnregisterRequestParams {
  agentId: AgentId;
  reason?: string;
  _meta?: Meta;
}

export interface AgentsUnregisterRequest extends MAPRequestBase<AgentsUnregisterRequestParams> {
  method: 'map/agents/unregister';
  params: AgentsUnregisterRequestParams;
}

export interface AgentsUnregisterResponseResult {
  unregistered: boolean;
  _meta?: Meta;
}

// --- map/agents/update ---
export interface AgentsUpdateRequestParams {
  agentId: AgentId;
  state?: AgentState;
  metadata?: Record<string, unknown>;
  _meta?: Meta;
}

export interface AgentsUpdateRequest extends MAPRequestBase<AgentsUpdateRequestParams> {
  method: 'map/agents/update';
  params: AgentsUpdateRequestParams;
}

export interface AgentsUpdateResponseResult {
  agent: Agent;
  _meta?: Meta;
}

// --- map/agents/stop ---
export interface AgentsStopRequestParams {
  agentId: AgentId;
  reason?: string;
  force?: boolean;
  _meta?: Meta;
}

export interface AgentsStopRequest extends MAPRequestBase<AgentsStopRequestParams> {
  method: 'map/agents/stop';
  params: AgentsStopRequestParams;
}

export interface AgentsStopResponseResult {
  stopping: boolean;
  agent?: Agent;
  _meta?: Meta;
}

// --- map/agents/suspend ---
export interface AgentsSuspendRequestParams {
  agentId: AgentId;
  reason?: string;
  _meta?: Meta;
}

export interface AgentsSuspendRequest extends MAPRequestBase<AgentsSuspendRequestParams> {
  method: 'map/agents/suspend';
  params: AgentsSuspendRequestParams;
}

export interface AgentsSuspendResponseResult {
  suspended: boolean;
  agent?: Agent;
  _meta?: Meta;
}

// --- map/agents/resume ---
export interface AgentsResumeRequestParams {
  agentId: AgentId;
  _meta?: Meta;
}

export interface AgentsResumeRequest extends MAPRequestBase<AgentsResumeRequestParams> {
  method: 'map/agents/resume';
  params: AgentsResumeRequestParams;
}

export interface AgentsResumeResponseResult {
  resumed: boolean;
  agent?: Agent;
  _meta?: Meta;
}

// --- map/structure/graph ---
export interface StructureGraphRequestParams {
  rootAgentId?: AgentId;
  depth?: number;
  includeRelationships?: boolean;
  _meta?: Meta;
}

export interface StructureGraphRequest extends MAPRequestBase<StructureGraphRequestParams> {
  method: 'map/structure/graph';
  params?: StructureGraphRequestParams;
}

export interface GraphEdge {
  from: AgentId;
  to: AgentId;
  type: 'parent-child' | 'peer' | 'supervisor' | 'collaborator';
}

export interface StructureGraphResponseResult {
  nodes: Agent[];
  edges: GraphEdge[];
  _meta?: Meta;
}

// --- map/scopes/list ---
export interface ScopesListRequestParams {
  parent?: ScopeId;
  _meta?: Meta;
}

export interface ScopesListRequest extends MAPRequestBase<ScopesListRequestParams> {
  method: 'map/scopes/list';
  params?: ScopesListRequestParams;
}

export interface ScopesListResponseResult {
  scopes: Scope[];
  _meta?: Meta;
}

// --- map/scopes/get ---
export interface ScopesGetRequestParams {
  scopeId: ScopeId;
  _meta?: Meta;
}

export interface ScopesGetRequest extends MAPRequestBase<ScopesGetRequestParams> {
  method: 'map/scopes/get';
  params: ScopesGetRequestParams;
}

export interface ScopesGetResponseResult {
  scope: Scope;
  _meta?: Meta;
}

// --- map/scopes/create ---
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
  method: 'map/scopes/create';
  params?: ScopesCreateRequestParams;
}

export interface ScopesCreateResponseResult {
  scope: Scope;
  _meta?: Meta;
}

// --- map/scopes/delete ---
export interface ScopesDeleteRequestParams {
  scopeId: ScopeId;
  _meta?: Meta;
}

export interface ScopesDeleteRequest extends MAPRequestBase<ScopesDeleteRequestParams> {
  method: 'map/scopes/delete';
  params: ScopesDeleteRequestParams;
}

export interface ScopesDeleteResponseResult {
  deleted: boolean;
  _meta?: Meta;
}

// --- map/scopes/join ---
export interface ScopesJoinRequestParams {
  scopeId: ScopeId;
  agentId: AgentId;
  _meta?: Meta;
}

export interface ScopesJoinRequest extends MAPRequestBase<ScopesJoinRequestParams> {
  method: 'map/scopes/join';
  params: ScopesJoinRequestParams;
}

export interface ScopesJoinResponseResult {
  joined: boolean;
  _meta?: Meta;
}

// --- map/scopes/leave ---
export interface ScopesLeaveRequestParams {
  scopeId: ScopeId;
  agentId: AgentId;
  _meta?: Meta;
}

export interface ScopesLeaveRequest extends MAPRequestBase<ScopesLeaveRequestParams> {
  method: 'map/scopes/leave';
  params: ScopesLeaveRequestParams;
}

export interface ScopesLeaveResponseResult {
  left: boolean;
  _meta?: Meta;
}

// --- map/scopes/members ---
export interface ScopesMembersRequestParams {
  scopeId: ScopeId;
  limit?: number;
  cursor?: string;
  _meta?: Meta;
}

export interface ScopesMembersRequest extends MAPRequestBase<ScopesMembersRequestParams> {
  method: 'map/scopes/members';
  params: ScopesMembersRequestParams;
}

export interface ScopesMembersResponseResult {
  members: AgentId[];
  nextCursor?: string;
  _meta?: Meta;
}

// =============================================================================
// Request/Response Types - Extension Tier
// =============================================================================

// --- map/inject ---
export type InjectDelivery = 'interrupt' | 'queue' | 'best-effort';
export type InjectDeliveryResult = 'interrupt' | 'queue' | 'message';

export interface InjectRequestParams {
  agentId: AgentId;
  content: unknown;
  delivery?: InjectDelivery;
  _meta?: Meta;
}

export interface InjectRequest extends MAPRequestBase<InjectRequestParams> {
  method: 'map/inject';
  params: InjectRequestParams;
}

export interface InjectResponseResult {
  injected: boolean;
  delivery?: InjectDeliveryResult;
  _meta?: Meta;
}

// --- map/federation/connect ---
export interface FederationConnectRequestParams {
  systemId: string;
  endpoint: string;
  auth?: FederationAuth;
  _meta?: Meta;
}

export interface FederationConnectRequest extends MAPRequestBase<FederationConnectRequestParams> {
  method: 'map/federation/connect';
  params: FederationConnectRequestParams;
}

export interface FederationConnectResponseResult {
  connected: boolean;
  systemInfo?: {
    name?: string;
    version?: string;
    capabilities?: ParticipantCapabilities;
  };
  _meta?: Meta;
}

// --- map/federation/route ---
export interface FederationRouteRequestParams {
  systemId: string;
  message: Message;
  _meta?: Meta;
}

export interface FederationRouteRequest extends MAPRequestBase<FederationRouteRequestParams> {
  method: 'map/federation/route';
  params: FederationRouteRequestParams;
}

export interface FederationRouteResponseResult {
  routed: boolean;
  messageId?: MessageId;
  _meta?: Meta;
}

// =============================================================================
// Notification Types
// =============================================================================

// --- map/event ---
export interface EventNotificationParams {
  subscriptionId: SubscriptionId;
  sequenceNumber: number;
  event: Event;
  _meta?: Meta;
}

export interface EventNotification extends MAPNotificationBase<EventNotificationParams> {
  method: 'map/event';
  params: EventNotificationParams;
}

// --- map/message ---
export interface MessageNotificationParams {
  message: Message;
  _meta?: Meta;
}

export interface MessageNotification extends MAPNotificationBase<MessageNotificationParams> {
  method: 'map/message';
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
  // Extension
  | InjectRequest
  | FederationConnectRequest
  | FederationRouteRequest;

/** All MAP notification types */
export type MAPNotification = EventNotification | MessageNotification;

// =============================================================================
// Method Constants
// =============================================================================

/** Core tier methods */
export const CORE_METHODS = {
  CONNECT: 'map/connect',
  DISCONNECT: 'map/disconnect',
  SESSION_LIST: 'map/session/list',
  SESSION_LOAD: 'map/session/load',
  SESSION_CLOSE: 'map/session/close',
  AGENTS_LIST: 'map/agents/list',
  AGENTS_GET: 'map/agents/get',
  SEND: 'map/send',
  SUBSCRIBE: 'map/subscribe',
  UNSUBSCRIBE: 'map/unsubscribe',
  AUTH_REFRESH: 'map/auth/refresh',
} as const;

/** Structure tier methods */
export const STRUCTURE_METHODS = {
  AGENTS_REGISTER: 'map/agents/register',
  AGENTS_SPAWN: 'map/agents/spawn',
  AGENTS_UNREGISTER: 'map/agents/unregister',
  AGENTS_UPDATE: 'map/agents/update',
  AGENTS_STOP: 'map/agents/stop',
  AGENTS_SUSPEND: 'map/agents/suspend',
  AGENTS_RESUME: 'map/agents/resume',
  STRUCTURE_GRAPH: 'map/structure/graph',
  SCOPES_LIST: 'map/scopes/list',
  SCOPES_GET: 'map/scopes/get',
  SCOPES_CREATE: 'map/scopes/create',
  SCOPES_DELETE: 'map/scopes/delete',
  SCOPES_JOIN: 'map/scopes/join',
  SCOPES_LEAVE: 'map/scopes/leave',
  SCOPES_MEMBERS: 'map/scopes/members',
} as const;

/** Extension tier methods */
export const EXTENSION_METHODS = {
  INJECT: 'map/inject',
  FEDERATION_CONNECT: 'map/federation/connect',
  FEDERATION_ROUTE: 'map/federation/route',
} as const;

/** Notification methods */
export const NOTIFICATION_METHODS = {
  EVENT: 'map/event',
  MESSAGE: 'map/message',
} as const;

/** All MAP methods */
export const MAP_METHODS = {
  ...CORE_METHODS,
  ...STRUCTURE_METHODS,
  ...EXTENSION_METHODS,
} as const;

/** Protocol version */
export const PROTOCOL_VERSION: ProtocolVersion = 1;

// =============================================================================
// Error Codes
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
  INSUFFICIENT_PERMISSIONS: 1003,
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

/** Federation error codes */
export const FEDERATION_ERROR_CODES = {
  UNAVAILABLE: 5000,
  SYSTEM_NOT_FOUND: 5001,
  AUTH_FAILED: 5002,
  ROUTE_REJECTED: 5003,
} as const;

/** All error codes */
export const ERROR_CODES = {
  ...PROTOCOL_ERROR_CODES,
  ...AUTH_ERROR_CODES,
  ...ROUTING_ERROR_CODES,
  ...AGENT_ERROR_CODES,
  ...RESOURCE_ERROR_CODES,
  ...FEDERATION_ERROR_CODES,
} as const;

// =============================================================================
// Type Guards
// =============================================================================

/** Check if a response is an error response */
export function isErrorResponse(response: MAPResponse): response is MAPResponseError {
  return 'error' in response;
}

/** Check if a response is a success response */
export function isSuccessResponse<T>(response: MAPResponse<T>): response is MAPResponseSuccess<T> {
  return 'result' in response;
}

/** Check if an address is a direct address */
export function isDirectAddress(address: Address): address is DirectAddress {
  return typeof address === 'object' && 'agent' in address && !('system' in address);
}

/** Check if an address is a federated address */
export function isFederatedAddress(address: Address): address is FederatedAddress {
  return typeof address === 'object' && 'system' in address && 'agent' in address;
}

/** Check if an address is a scope address */
export function isScopeAddress(address: Address): address is ScopeAddress {
  return typeof address === 'object' && 'scope' in address;
}

/** Check if an address is a broadcast address */
export function isBroadcastAddress(address: Address): address is BroadcastAddress {
  return typeof address === 'object' && 'broadcast' in address;
}
