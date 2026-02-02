/**
 * Multi-Agent Protocol (MAP) SDK
 *
 * A protocol for client connection and internal message routing in multi-agent systems.
 *
 * @module @multi-agent-protocol/sdk
 */

// ===========================================================================
// Types - Protocol types and constants
// ===========================================================================
export * from "./types";

// ===========================================================================
// Errors - Protocol error classes
// ===========================================================================
export { MAPRequestError, MAPConnectionError, MAPTimeoutError } from "./errors";

// ===========================================================================
// Stream - Transport layer utilities
// ===========================================================================
export {
  type Stream,
  type AnyMessage,
  ndJsonStream,
  websocketStream,
  waitForOpen,
  createStreamPair,
  // Agentic-mesh transport (optional peer dependency)
  agenticMeshStream,
  type AgenticMeshStreamConfig,
  type MeshPeerEndpoint,
  type MeshTransportAdapter,
} from "./stream";

// ===========================================================================
// JSON-RPC - Wire protocol utilities
// ===========================================================================
export {
  isRequest,
  isNotification,
  isResponse,
  isErrorResponse,
  createRequest,
  createNotification,
  createSuccessResponse,
  createErrorResponse,
} from "./jsonrpc";

// ===========================================================================
// Subscription - Event subscription handling
// ===========================================================================
export { Subscription, createSubscription } from "./subscription";

// ===========================================================================
// Connections - Role-specific connection classes
// ===========================================================================
export {
  BaseConnection,
  type BaseConnectionOptions,
  type RequestHandler,
  type NotificationHandler,
  type ConnectionState,
  type StateChangeHandler,
  ClientConnection,
  type ClientConnectionOptions,
  type ClientConnectOptions,
  type MeshConnectOptions,
  type ReconnectionOptions,
  type ReconnectionEventType,
  type ReconnectionEventHandler,
  AgentConnection,
  type AgentConnectionOptions,
  type AgentConnectOptions,
  type AgentMeshConnectOptions,
  type MessageHandler,
  type AgentReconnectionOptions,
  type AgentReconnectionEventType,
  type AgentReconnectionEventHandler,
  GatewayConnection,
  type GatewayConnectionOptions,
} from "./connection";

// ===========================================================================
// Router - Router interface (implementation not included)
// ===========================================================================
export {
  type ConnectedParticipant,
  type AgentExposure,
  type EventExposure,
  type ScopeExposure,
  type SystemExposure,
  type RouterLimits,
  type MAPRouterConfig,
  type MAPRouter,
  type MAPRouterFactory,
} from "./router";

// ===========================================================================
// Schema - Zod validators (optional, requires zod peer dependency)
// ===========================================================================
export * from "./schema";

// ===========================================================================
// Protocol - Method registry and response builders
// ===========================================================================
export {
  METHOD_REGISTRY,
  type MethodCategory,
  type CapabilityPath,
  type MethodInfo,
  getMethodsByCategory,
  getRequiredCapabilities,
  hasRequiredCapabilities,
  getMethodInfo,
  // Response builders
  buildConnectResponse,
  buildDisconnectResponse,
  buildSendResponse,
  buildAgentsRegisterResponse,
  buildAgentsUnregisterResponse,
  buildAgentsListResponse,
  buildAgentsGetResponse,
  buildAgentsUpdateResponse,
  buildAgentsSpawnResponse,
  buildScopesCreateResponse,
  buildScopesListResponse,
  buildScopesJoinResponse,
  buildScopesLeaveResponse,
  buildSubscribeResponse,
  buildUnsubscribeResponse,
} from "./protocol";

// ===========================================================================
// Utils - Utility functions
// ===========================================================================
export {
  // ULID utilities
  ulid,
  monotonicFactory,
  ulidTimestamp,
  compareUlid,
  isValidUlid,
  // Retry utilities
  type RetryPolicy,
  type RetryState,
  type RetryCallbacks,
  DEFAULT_RETRY_POLICY,
  calculateDelay,
  withRetry,
  retryable,
  createRetryPolicy,
  sleep,
  // Causal ordering utilities
  CausalEventBuffer,
  type CausalEvent,
  type CausalEventBufferOptions,
  type CausalBufferPushResult,
  validateCausalOrder,
  sortCausalOrder,
} from "./utils";

// ===========================================================================
// Permissions - Permission utilities for 4-layer model
// ===========================================================================
export {
  // Types (SystemExposure is exported from router module)
  type PermissionSystemConfig,
  type PermissionParticipant,
  type PermissionContext,
  type PermissionAction,
  type PermissionResult,
  type AcceptanceContext,
  // Layer 1: System exposure
  isAgentExposed,
  isEventTypeExposed,
  isScopeExposed,
  // Layer 2: Capabilities
  hasCapability,
  canPerformMethod,
  // Layer 3: Scope permissions
  canSeeScope,
  canSendToScope,
  canJoinScope,
  // Layer 4: Agent permissions
  canSeeAgent,
  canMessageAgent,
  canControlAgent,
  // High-level resolution
  canPerformAction,
  // Filtering utilities
  filterVisibleAgents,
  filterVisibleScopes,
  filterVisibleEvents,
  // Agent permission resolution (hybrid model)
  DEFAULT_AGENT_PERMISSION_CONFIG,
  deepMergePermissions,
  mapVisibilityToRule,
  resolveAgentPermissions,
  canAgentAcceptMessage,
  canAgentSeeAgent,
  canAgentMessageAgent,
} from "./permissions";

// ===========================================================================
// Federation - Federation envelope and routing utilities
// ===========================================================================
export {
  // Envelope utilities
  type CreateEnvelopeOptions,
  type ProcessEnvelopeResult,
  createFederationEnvelope,
  processFederationEnvelope,
  isEnvelopeAtDestination,
  unwrapEnvelope,
  getEnvelopeRoutingInfo,
  isValidEnvelope,
  withPayload,
  // Outage buffer
  type PeerBufferStats,
  FederationOutageBuffer,
} from "./federation";

// ===========================================================================
// Addresses - Address utilities for message routing
// ===========================================================================
export {
  // Convenience functions
  toAgent,
  toScope,
  // Address validation
  isAddress,
  isAgentAddress,
  isScopeAddress,
  // Address parsing
  formatAddress,
  parseAddress,
  extractId,
  extractType,
  // Types
  type AddressType,
  type AddressComponents,
  // Errors
  InvalidAddressError,
} from "./server/messages/address";

// ===========================================================================
// Mesh - Decentralized P2P mesh peer (optional agentic-mesh dependency)
// ===========================================================================
export {
  MAPMeshPeer,
  type MAPMeshPeerConfig,
  type MeshGitConfig,
  type MeshMapServerConfig,
  type PeerEndpoint,
  type TransportAdapter,
  type CreateAgentConfig,
  type LocalAgent,
  type SendResult,
  type CreateScopeConfig,
  type GitSyncService,
  type GitSyncClient,
  type SyncOptions,
  type SyncResult,
  type PullOptions,
  type PushOptions,
  type CloneOptions,
  type MeshEventSubscription,
  type MAPMeshPeerEvents,
} from "./mesh";

// ===========================================================================
// ACP - Agent Client Protocol types for ACP-over-MAP tunneling
// ===========================================================================
export {
  // Core ID types
  type ACPSessionId,
  type ACPRequestId,
  type ACPProtocolVersion,
  type ACPToolCallId,
  type ACPPermissionOptionId,
  type ACPSessionModeId,
  // JSON-RPC base types
  type ACPRequest,
  type ACPNotification,
  type ACPSuccessResponse,
  type ACPErrorResponse,
  type ACPResponse,
  type ACPMessage,
  type ACPErrorObject,
  // Error handling
  type ACPErrorCode,
  ACP_ERROR_CODES,
  ACPError,
  // Capabilities
  type ACPMeta,
  type ACPImplementation,
  type ACPFileSystemCapability,
  type ACPClientCapabilities,
  type ACPPromptCapabilities,
  type ACPMcpCapabilities,
  type ACPSessionCapabilities,
  type ACPAgentCapabilities,
  // Authentication
  type ACPAuthMethod,
  type ACPInitializeRequest,
  type ACPInitializeResponse,
  type ACPAuthenticateRequest,
  type ACPAuthenticateResponse,
  // MCP Server
  type ACPEnvVariable,
  type ACPHttpHeader,
  type ACPMcpServerStdio,
  type ACPMcpServerHttp,
  type ACPMcpServerSse,
  type ACPMcpServer,
  // Session
  type ACPSessionMode,
  type ACPSessionModeState,
  type ACPNewSessionRequest,
  type ACPNewSessionResponse,
  type ACPLoadSessionRequest,
  type ACPLoadSessionResponse,
  type ACPSetSessionModeRequest,
  type ACPSetSessionModeResponse,
  // Content
  type ACPAnnotations,
  type ACPRole,
  type ACPTextContent,
  type ACPImageContent,
  type ACPAudioContent,
  type ACPResourceLink,
  type ACPTextResourceContents,
  type ACPBlobResourceContents,
  type ACPEmbeddedResource,
  type ACPContentBlock,
  // Prompt
  type ACPPromptRequest,
  type ACPStopReason,
  type ACPPromptResponse,
  type ACPCancelNotification,
  // Tool calls
  type ACPToolKind,
  type ACPToolCallStatus,
  type ACPToolCallLocation,
  type ACPDiff,
  type ACPTerminal,
  type ACPContent,
  type ACPToolCallContent,
  type ACPToolCall,
  type ACPToolCallUpdate,
  // Plan
  type ACPPlanEntryPriority,
  type ACPPlanEntryStatus,
  type ACPPlanEntry,
  type ACPPlan,
  // Session updates
  type ACPContentChunk,
  type ACPAvailableCommand,
  type ACPAvailableCommandsUpdate,
  type ACPCurrentModeUpdate,
  type ACPSessionInfoUpdate,
  type ACPSessionUpdate,
  type ACPSessionNotification,
  // Permission
  type ACPPermissionOptionKind,
  type ACPPermissionOption,
  type ACPRequestPermissionRequest,
  type ACPSelectedPermissionOutcome,
  type ACPCancelledPermissionOutcome,
  type ACPRequestPermissionOutcome,
  type ACPRequestPermissionResponse,
  // File system
  type ACPReadTextFileRequest,
  type ACPReadTextFileResponse,
  type ACPWriteTextFileRequest,
  type ACPWriteTextFileResponse,
  // Terminal
  type ACPCreateTerminalRequest,
  type ACPCreateTerminalResponse,
  type ACPTerminalOutputRequest,
  type ACPTerminalExitStatus,
  type ACPTerminalOutputResponse,
  type ACPReleaseTerminalRequest,
  type ACPReleaseTerminalResponse,
  type ACPWaitForTerminalExitRequest,
  type ACPWaitForTerminalExitResponse,
  type ACPKillTerminalCommandRequest,
  type ACPKillTerminalCommandResponse,
  // ACP-over-MAP envelope
  type ACPContext,
  type ACPEnvelope,
  // Handler interfaces
  type ACPClientHandlers,
  type ACPAgentContext,
  type ACPAgentHandler,
  // Constants
  ACP_PROTOCOL_VERSION,
  ACP_METHODS,
  // Type guards
  isACPRequest,
  isACPNotification,
  isACPResponse,
  isACPErrorResponse,
  isACPSuccessResponse,
  isACPEnvelope,
  // Client-side stream connection
  ACPStreamConnection,
  createACPStream,
  type ACPStreamOptions,
  type ACPStreamEvents,
  // Agent-side adapter
  ACPAgentAdapter,
} from "./acp";
