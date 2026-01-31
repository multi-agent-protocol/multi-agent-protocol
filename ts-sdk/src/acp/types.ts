/**
 * ACP (Agent Client Protocol) types for ACP-over-MAP tunneling.
 *
 * These types are bundled directly in the MAP SDK for simplicity,
 * enabling ACP semantics to be preserved when routing through MAP.
 *
 * @see https://agentclientprotocol.com/
 * @module
 */

// =============================================================================
// Core ID Types
// =============================================================================

/**
 * A unique identifier for a conversation session.
 */
export type ACPSessionId = string;

/**
 * JSON-RPC request ID.
 */
export type ACPRequestId = string | number | null;

/**
 * Protocol version identifier.
 */
export type ACPProtocolVersion = number;

/**
 * Unique identifier for a tool call within a session.
 */
export type ACPToolCallId = string;

/**
 * Unique identifier for a permission option.
 */
export type ACPPermissionOptionId = string;

/**
 * Unique identifier for a session mode.
 */
export type ACPSessionModeId = string;

// =============================================================================
// JSON-RPC Base Types
// =============================================================================

/**
 * ACP JSON-RPC request structure.
 */
export interface ACPRequest<TParams = unknown> {
  jsonrpc: "2.0";
  id: ACPRequestId;
  method: string;
  params?: TParams;
}

/**
 * ACP JSON-RPC notification structure (no response expected).
 */
export interface ACPNotification<TParams = unknown> {
  jsonrpc: "2.0";
  method: string;
  params?: TParams;
}

/**
 * ACP JSON-RPC success response structure.
 */
export interface ACPSuccessResponse<TResult = unknown> {
  jsonrpc: "2.0";
  id: ACPRequestId;
  result: TResult;
}

/**
 * ACP JSON-RPC error object.
 */
export interface ACPErrorObject {
  code: ACPErrorCode;
  message: string;
  data?: unknown;
}

/**
 * ACP JSON-RPC error response structure.
 */
export interface ACPErrorResponse {
  jsonrpc: "2.0";
  id: ACPRequestId;
  error: ACPErrorObject;
}

/**
 * Union of all ACP JSON-RPC response types.
 */
export type ACPResponse<TResult = unknown> =
  | ACPSuccessResponse<TResult>
  | ACPErrorResponse;

/**
 * Union of all ACP JSON-RPC message types.
 */
export type ACPMessage =
  | ACPRequest
  | ACPNotification
  | ACPSuccessResponse
  | ACPErrorResponse;

// =============================================================================
// Error Codes
// =============================================================================

/**
 * Predefined ACP error codes following JSON-RPC specification.
 */
export type ACPErrorCode =
  | -32700 // Parse error
  | -32600 // Invalid request
  | -32601 // Method not found
  | -32602 // Invalid params
  | -32603 // Internal error
  | -32800 // Request cancelled
  | -32000 // Auth required
  | -32002 // Session not found
  | number; // Custom codes

/**
 * Standard ACP error codes with semantic names.
 */
export const ACP_ERROR_CODES = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  REQUEST_CANCELLED: -32800,
  AUTH_REQUIRED: -32000,
  SESSION_NOT_FOUND: -32002,
} as const;

// =============================================================================
// Error Class
// =============================================================================

/**
 * Error class for ACP protocol errors.
 * Preserves the original ACP error code and data.
 */
export class ACPError extends Error {
  readonly code: ACPErrorCode;
  readonly data?: unknown;

  constructor(code: ACPErrorCode, message: string, data?: unknown) {
    super(message);
    this.name = "ACPError";
    this.code = code;
    this.data = data;
  }

  /**
   * Create an ACPError from an error response.
   */
  static fromResponse(error: ACPErrorObject): ACPError {
    return new ACPError(error.code, error.message, error.data);
  }

  /**
   * Convert to JSON-RPC error object.
   */
  toErrorObject(): ACPErrorObject {
    return {
      code: this.code,
      message: this.message,
      ...(this.data !== undefined && { data: this.data }),
    };
  }
}

// =============================================================================
// Meta Extension
// =============================================================================

/**
 * The _meta property for ACP extensibility.
 */
export type ACPMeta = {
  [key: string]: unknown;
} | null;

// =============================================================================
// Implementation Info
// =============================================================================

/**
 * Metadata about the implementation of a client or agent.
 */
export interface ACPImplementation {
  _meta?: ACPMeta;
  /** Programmatic name of the implementation. */
  name: string;
  /** Human-readable title for display. */
  title?: string | null;
  /** Version string (e.g., "1.0.0"). */
  version: string;
}

// =============================================================================
// Capabilities
// =============================================================================

/**
 * File system capabilities supported by the client.
 */
export interface ACPFileSystemCapability {
  _meta?: ACPMeta;
  /** Whether the client supports fs/read_text_file. */
  readTextFile?: boolean;
  /** Whether the client supports fs/write_text_file. */
  writeTextFile?: boolean;
}

/**
 * Capabilities supported by the client.
 */
export interface ACPClientCapabilities {
  _meta?: ACPMeta;
  /** File system capabilities. */
  fs?: ACPFileSystemCapability;
  /** Whether the client supports terminal methods. */
  terminal?: boolean;
}

/**
 * Prompt capabilities supported by the agent.
 */
export interface ACPPromptCapabilities {
  _meta?: ACPMeta;
  /** Agent supports audio content. */
  audio?: boolean;
  /** Agent supports embedded resource context. */
  embeddedContext?: boolean;
  /** Agent supports image content. */
  image?: boolean;
}

/**
 * MCP capabilities supported by the agent.
 */
export interface ACPMcpCapabilities {
  _meta?: ACPMeta;
  /** Agent supports HTTP MCP servers. */
  http?: boolean;
  /** Agent supports SSE MCP servers. */
  sse?: boolean;
}

/**
 * Session capabilities supported by the agent.
 */
export interface ACPSessionCapabilities {
  _meta?: ACPMeta;
  /** Whether the agent supports session/fork. */
  fork?: { _meta?: ACPMeta } | null;
  /** Whether the agent supports session/list. */
  list?: { _meta?: ACPMeta } | null;
  /** Whether the agent supports session/resume. */
  resume?: { _meta?: ACPMeta } | null;
}

/**
 * Capabilities supported by the agent.
 */
export interface ACPAgentCapabilities {
  _meta?: ACPMeta;
  /** Whether the agent supports session/load. */
  loadSession?: boolean;
  /** MCP capabilities. */
  mcpCapabilities?: ACPMcpCapabilities;
  /** Prompt capabilities. */
  promptCapabilities?: ACPPromptCapabilities;
  /** Session capabilities. */
  sessionCapabilities?: ACPSessionCapabilities;
}

// =============================================================================
// Authentication
// =============================================================================

/**
 * Describes an available authentication method.
 */
export interface ACPAuthMethod {
  _meta?: ACPMeta;
  /** Unique identifier for this auth method. */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Optional description. */
  description?: string | null;
}

// =============================================================================
// Initialize
// =============================================================================

/**
 * Request parameters for the initialize method.
 */
export interface ACPInitializeRequest {
  _meta?: ACPMeta;
  /** The latest protocol version supported by the client. */
  protocolVersion: ACPProtocolVersion;
  /** Information about the client implementation. */
  clientInfo?: ACPImplementation | null;
  /** Capabilities supported by the client. */
  clientCapabilities?: ACPClientCapabilities;
}

/**
 * Response to the initialize method.
 */
export interface ACPInitializeResponse {
  _meta?: ACPMeta;
  /** The negotiated protocol version. */
  protocolVersion: ACPProtocolVersion;
  /** Information about the agent implementation. */
  agentInfo?: ACPImplementation | null;
  /** Capabilities supported by the agent. */
  agentCapabilities?: ACPAgentCapabilities;
  /** Available authentication methods. */
  authMethods?: ACPAuthMethod[];
}

// =============================================================================
// Authenticate
// =============================================================================

/**
 * Request parameters for the authenticate method.
 */
export interface ACPAuthenticateRequest {
  _meta?: ACPMeta;
  /** The ID of the authentication method to use. */
  methodId: string;
}

/**
 * Response to the authenticate method.
 */
export interface ACPAuthenticateResponse {
  _meta?: ACPMeta;
}

// =============================================================================
// MCP Server Configuration
// =============================================================================

/**
 * Environment variable for MCP server configuration.
 */
export interface ACPEnvVariable {
  _meta?: ACPMeta;
  name: string;
  value: string;
}

/**
 * HTTP header for MCP server configuration.
 */
export interface ACPHttpHeader {
  _meta?: ACPMeta;
  name: string;
  value: string;
}

/**
 * Stdio transport configuration for MCP.
 */
export interface ACPMcpServerStdio {
  _meta?: ACPMeta;
  name: string;
  command: string;
  args: string[];
  env: ACPEnvVariable[];
}

/**
 * HTTP transport configuration for MCP.
 */
export interface ACPMcpServerHttp {
  _meta?: ACPMeta;
  type: "http";
  name: string;
  url: string;
  headers: ACPHttpHeader[];
}

/**
 * SSE transport configuration for MCP.
 */
export interface ACPMcpServerSse {
  _meta?: ACPMeta;
  type: "sse";
  name: string;
  url: string;
  headers: ACPHttpHeader[];
}

/**
 * MCP server configuration (union of all transport types).
 */
export type ACPMcpServer = ACPMcpServerStdio | ACPMcpServerHttp | ACPMcpServerSse;

// =============================================================================
// Session Mode
// =============================================================================

/**
 * A mode the agent can operate in.
 */
export interface ACPSessionMode {
  _meta?: ACPMeta;
  id: ACPSessionModeId;
  name: string;
  description?: string | null;
}

/**
 * The set of modes and the currently active one.
 */
export interface ACPSessionModeState {
  _meta?: ACPMeta;
  availableModes: ACPSessionMode[];
  currentModeId: ACPSessionModeId;
}

// =============================================================================
// Session Management
// =============================================================================

/**
 * Request parameters for creating a new session.
 */
export interface ACPNewSessionRequest {
  _meta?: ACPMeta;
  /** The working directory for this session. */
  cwd: string;
  /** List of MCP servers to connect to. */
  mcpServers: ACPMcpServer[];
}

/**
 * Response from creating a new session.
 */
export interface ACPNewSessionResponse {
  _meta?: ACPMeta;
  /** Unique identifier for the created session. */
  sessionId: ACPSessionId;
  /** Initial mode state if supported. */
  modes?: ACPSessionModeState | null;
}

/**
 * Request parameters for loading an existing session.
 */
export interface ACPLoadSessionRequest {
  _meta?: ACPMeta;
  /** The ID of the session to load. */
  sessionId: ACPSessionId;
  /** The working directory for this session. */
  cwd: string;
  /** List of MCP servers to connect to. */
  mcpServers: ACPMcpServer[];
}

/**
 * Response from loading an existing session.
 */
export interface ACPLoadSessionResponse {
  _meta?: ACPMeta;
  /** Mode state if supported. */
  modes?: ACPSessionModeState | null;
}

/**
 * Request parameters for setting a session mode.
 */
export interface ACPSetSessionModeRequest {
  _meta?: ACPMeta;
  /** The ID of the session. */
  sessionId: ACPSessionId;
  /** The ID of the mode to set. */
  modeId: ACPSessionModeId;
}

/**
 * Response to session/set_mode method.
 */
export interface ACPSetSessionModeResponse {
  _meta?: ACPMeta;
}

// =============================================================================
// Content Types
// =============================================================================

/**
 * Optional annotations for content.
 */
export interface ACPAnnotations {
  _meta?: ACPMeta;
  audience?: ACPRole[] | null;
  lastModified?: string | null;
  priority?: number | null;
}

/**
 * Role in a conversation.
 */
export type ACPRole = "assistant" | "user";

/**
 * Text content block.
 */
export interface ACPTextContent {
  _meta?: ACPMeta;
  type: "text";
  text: string;
  annotations?: ACPAnnotations | null;
}

/**
 * Image content block.
 */
export interface ACPImageContent {
  _meta?: ACPMeta;
  type: "image";
  data: string;
  mimeType: string;
  annotations?: ACPAnnotations | null;
}

/**
 * Audio content block.
 */
export interface ACPAudioContent {
  _meta?: ACPMeta;
  type: "audio";
  data: string;
  mimeType: string;
  annotations?: ACPAnnotations | null;
}

/**
 * Resource link content block.
 */
export interface ACPResourceLink {
  _meta?: ACPMeta;
  type: "resource_link";
  uri: string;
  name: string;
  title?: string | null;
  description?: string | null;
  mimeType?: string | null;
  size?: number | null;
  annotations?: ACPAnnotations | null;
}

/**
 * Text resource contents.
 */
export interface ACPTextResourceContents {
  _meta?: ACPMeta;
  uri: string;
  text: string;
  mimeType?: string | null;
}

/**
 * Binary resource contents.
 */
export interface ACPBlobResourceContents {
  _meta?: ACPMeta;
  uri: string;
  blob: string;
  mimeType?: string | null;
}

/**
 * Embedded resource content block.
 */
export interface ACPEmbeddedResource {
  _meta?: ACPMeta;
  type: "resource";
  resource: ACPTextResourceContents | ACPBlobResourceContents;
  annotations?: ACPAnnotations | null;
}

/**
 * Union of all content block types.
 */
export type ACPContentBlock =
  | ACPTextContent
  | ACPImageContent
  | ACPAudioContent
  | ACPResourceLink
  | ACPEmbeddedResource;

// =============================================================================
// Prompt
// =============================================================================

/**
 * Request parameters for sending a user prompt.
 */
export interface ACPPromptRequest {
  _meta?: ACPMeta;
  /** The ID of the session. */
  sessionId: ACPSessionId;
  /** The content blocks of the user's message. */
  prompt: ACPContentBlock[];
}

/**
 * Reasons why an agent stops processing.
 */
export type ACPStopReason =
  | "end_turn"
  | "max_tokens"
  | "max_turn_requests"
  | "refusal"
  | "cancelled";

/**
 * Response from processing a user prompt.
 */
export interface ACPPromptResponse {
  _meta?: ACPMeta;
  /** Why the agent stopped processing. */
  stopReason: ACPStopReason;
}

// =============================================================================
// Cancel
// =============================================================================

/**
 * Notification to cancel ongoing operations for a session.
 */
export interface ACPCancelNotification {
  _meta?: ACPMeta;
  /** The ID of the session to cancel operations for. */
  sessionId: ACPSessionId;
}

// =============================================================================
// Tool Call Types
// =============================================================================

/**
 * Categories of tools.
 */
export type ACPToolKind =
  | "read"
  | "edit"
  | "delete"
  | "move"
  | "search"
  | "execute"
  | "think"
  | "fetch"
  | "switch_mode"
  | "other";

/**
 * Execution status of a tool call.
 */
export type ACPToolCallStatus = "pending" | "in_progress" | "completed" | "failed";

/**
 * A file location being accessed by a tool.
 */
export interface ACPToolCallLocation {
  _meta?: ACPMeta;
  path: string;
  line?: number | null;
}

/**
 * A diff representing file modifications.
 */
export interface ACPDiff {
  _meta?: ACPMeta;
  path: string;
  oldText?: string | null;
  newText: string;
}

/**
 * Terminal reference.
 */
export interface ACPTerminal {
  _meta?: ACPMeta;
  terminalId: string;
}

/**
 * Standard content wrapper.
 */
export interface ACPContent {
  _meta?: ACPMeta;
  content: ACPContentBlock;
}

/**
 * Tool call content types.
 */
export type ACPToolCallContent =
  | (ACPContent & { type: "content" })
  | (ACPDiff & { type: "diff" })
  | (ACPTerminal & { type: "terminal" });

/**
 * A tool call requested by the language model.
 */
export interface ACPToolCall {
  _meta?: ACPMeta;
  toolCallId: ACPToolCallId;
  title: string;
  kind?: ACPToolKind;
  status?: ACPToolCallStatus;
  rawInput?: unknown;
  rawOutput?: unknown;
  content?: ACPToolCallContent[];
  locations?: ACPToolCallLocation[];
}

/**
 * An update to an existing tool call.
 */
export interface ACPToolCallUpdate {
  _meta?: ACPMeta;
  toolCallId: ACPToolCallId;
  title?: string | null;
  kind?: ACPToolKind | null;
  status?: ACPToolCallStatus | null;
  rawInput?: unknown;
  rawOutput?: unknown;
  content?: ACPToolCallContent[] | null;
  locations?: ACPToolCallLocation[] | null;
}

// =============================================================================
// Plan Types
// =============================================================================

/**
 * Priority levels for plan entries.
 */
export type ACPPlanEntryPriority = "high" | "medium" | "low";

/**
 * Status of a plan entry.
 */
export type ACPPlanEntryStatus = "pending" | "in_progress" | "completed";

/**
 * A single entry in the execution plan.
 */
export interface ACPPlanEntry {
  _meta?: ACPMeta;
  content: string;
  priority: ACPPlanEntryPriority;
  status: ACPPlanEntryStatus;
}

/**
 * An execution plan.
 */
export interface ACPPlan {
  _meta?: ACPMeta;
  entries: ACPPlanEntry[];
}

// =============================================================================
// Session Update Types
// =============================================================================

/**
 * A streamed chunk of content.
 */
export interface ACPContentChunk {
  _meta?: ACPMeta;
  content: ACPContentBlock;
}

/**
 * Available command input type.
 */
export interface ACPUnstructuredCommandInput {
  _meta?: ACPMeta;
}

/**
 * Available command input.
 */
export type ACPAvailableCommandInput = ACPUnstructuredCommandInput;

/**
 * Information about an available command.
 */
export interface ACPAvailableCommand {
  _meta?: ACPMeta;
  name: string;
  description: string;
  input?: ACPAvailableCommandInput | null;
}

/**
 * Available commands update.
 */
export interface ACPAvailableCommandsUpdate {
  _meta?: ACPMeta;
  availableCommands: ACPAvailableCommand[];
}

/**
 * Current mode update.
 */
export interface ACPCurrentModeUpdate {
  _meta?: ACPMeta;
  currentModeId: ACPSessionModeId;
}

/**
 * Session info update.
 */
export interface ACPSessionInfoUpdate {
  _meta?: ACPMeta;
  title?: string | null;
  updatedAt?: string | null;
}

/**
 * All session update types.
 */
export type ACPSessionUpdate =
  | (ACPContentChunk & { sessionUpdate: "user_message_chunk" })
  | (ACPContentChunk & { sessionUpdate: "agent_message_chunk" })
  | (ACPContentChunk & { sessionUpdate: "agent_thought_chunk" })
  | (ACPToolCall & { sessionUpdate: "tool_call" })
  | (ACPToolCallUpdate & { sessionUpdate: "tool_call_update" })
  | (ACPPlan & { sessionUpdate: "plan" })
  | (ACPAvailableCommandsUpdate & { sessionUpdate: "available_commands_update" })
  | (ACPCurrentModeUpdate & { sessionUpdate: "current_mode_update" })
  | (ACPSessionInfoUpdate & { sessionUpdate: "session_info_update" });

/**
 * Session notification containing an update.
 */
export interface ACPSessionNotification {
  _meta?: ACPMeta;
  sessionId: ACPSessionId;
  update: ACPSessionUpdate;
}

// =============================================================================
// Permission Request
// =============================================================================

/**
 * Permission option kind.
 */
export type ACPPermissionOptionKind =
  | "allow_once"
  | "allow_always"
  | "reject_once"
  | "reject_always";

/**
 * A permission option.
 */
export interface ACPPermissionOption {
  _meta?: ACPMeta;
  optionId: ACPPermissionOptionId;
  name: string;
  kind: ACPPermissionOptionKind;
}

/**
 * Request for user permission to execute a tool call.
 */
export interface ACPRequestPermissionRequest {
  _meta?: ACPMeta;
  sessionId: ACPSessionId;
  toolCall: ACPToolCallUpdate;
  options: ACPPermissionOption[];
}

/**
 * Permission outcome when user selected an option.
 */
export interface ACPSelectedPermissionOutcome {
  _meta?: ACPMeta;
  outcome: "selected";
  optionId: ACPPermissionOptionId;
}

/**
 * Permission outcome when cancelled.
 */
export interface ACPCancelledPermissionOutcome {
  outcome: "cancelled";
}

/**
 * Permission request outcome.
 */
export type ACPRequestPermissionOutcome =
  | ACPSelectedPermissionOutcome
  | ACPCancelledPermissionOutcome;

/**
 * Response to a permission request.
 */
export interface ACPRequestPermissionResponse {
  _meta?: ACPMeta;
  outcome: ACPRequestPermissionOutcome;
}

// =============================================================================
// File System
// =============================================================================

/**
 * Request to read content from a text file.
 */
export interface ACPReadTextFileRequest {
  _meta?: ACPMeta;
  sessionId: ACPSessionId;
  path: string;
  line?: number | null;
  limit?: number | null;
}

/**
 * Response containing file contents.
 */
export interface ACPReadTextFileResponse {
  _meta?: ACPMeta;
  content: string;
}

/**
 * Request to write content to a text file.
 */
export interface ACPWriteTextFileRequest {
  _meta?: ACPMeta;
  sessionId: ACPSessionId;
  path: string;
  content: string;
}

/**
 * Response to write text file.
 */
export interface ACPWriteTextFileResponse {
  _meta?: ACPMeta;
}

// =============================================================================
// Terminal
// =============================================================================

/**
 * Request to create a new terminal.
 */
export interface ACPCreateTerminalRequest {
  _meta?: ACPMeta;
  sessionId: ACPSessionId;
  command: string;
  args?: string[];
  cwd?: string | null;
  env?: ACPEnvVariable[];
  outputByteLimit?: number | null;
}

/**
 * Response containing the terminal ID.
 */
export interface ACPCreateTerminalResponse {
  _meta?: ACPMeta;
  terminalId: string;
}

/**
 * Request to get terminal output.
 */
export interface ACPTerminalOutputRequest {
  _meta?: ACPMeta;
  sessionId: ACPSessionId;
  terminalId: string;
}

/**
 * Terminal exit status.
 */
export interface ACPTerminalExitStatus {
  _meta?: ACPMeta;
  exitCode?: number | null;
  signal?: string | null;
}

/**
 * Response containing terminal output.
 */
export interface ACPTerminalOutputResponse {
  _meta?: ACPMeta;
  output: string;
  truncated: boolean;
  exitStatus?: ACPTerminalExitStatus | null;
}

/**
 * Request to release a terminal.
 */
export interface ACPReleaseTerminalRequest {
  _meta?: ACPMeta;
  sessionId: ACPSessionId;
  terminalId: string;
}

/**
 * Response to release terminal.
 */
export interface ACPReleaseTerminalResponse {
  _meta?: ACPMeta;
}

/**
 * Request to wait for terminal exit.
 */
export interface ACPWaitForTerminalExitRequest {
  _meta?: ACPMeta;
  sessionId: ACPSessionId;
  terminalId: string;
}

/**
 * Response with terminal exit status.
 */
export interface ACPWaitForTerminalExitResponse {
  _meta?: ACPMeta;
  exitCode?: number | null;
  signal?: string | null;
}

/**
 * Request to kill a terminal command.
 */
export interface ACPKillTerminalCommandRequest {
  _meta?: ACPMeta;
  sessionId: ACPSessionId;
  terminalId: string;
}

/**
 * Response to kill terminal command.
 */
export interface ACPKillTerminalCommandResponse {
  _meta?: ACPMeta;
}

// =============================================================================
// ACP-over-MAP Envelope
// =============================================================================

/**
 * Context for ACP messages tunneled through MAP.
 */
export interface ACPContext {
  /** Unique identifier for this virtual ACP stream. */
  streamId: string;
  /** ACP session ID (null before session/new is called). */
  sessionId: ACPSessionId | null;
  /** Direction of message flow. */
  direction: "client-to-agent" | "agent-to-client";
  /** Information about a pending client request (for agent→client requests). */
  pendingClientRequest?: {
    requestId: ACPRequestId;
    method: string;
    timeout?: number;
  };
}

/**
 * Envelope wrapping ACP JSON-RPC messages for transport through MAP.
 *
 * This is the payload format used when sending ACP messages via MAP's send().
 */
export interface ACPEnvelope {
  /**
   * The original ACP JSON-RPC message.
   */
  acp: {
    jsonrpc: "2.0";
    id?: ACPRequestId;
    method?: string;
    params?: unknown;
    result?: unknown;
    error?: ACPErrorObject;
  };
  /**
   * ACP-specific routing context.
   */
  acpContext: ACPContext;
}

// =============================================================================
// Client Handler Interfaces
// =============================================================================

/**
 * Handlers that the client provides for agent→client requests.
 */
export interface ACPClientHandlers {
  /**
   * Handle permission request from agent.
   */
  requestPermission(
    params: ACPRequestPermissionRequest
  ): Promise<ACPRequestPermissionResponse>;

  /**
   * Handle session update notification from agent.
   */
  sessionUpdate(params: ACPSessionNotification): Promise<void>;

  /**
   * Handle read text file request (optional, based on capabilities).
   */
  readTextFile?(
    params: ACPReadTextFileRequest
  ): Promise<ACPReadTextFileResponse>;

  /**
   * Handle write text file request (optional, based on capabilities).
   */
  writeTextFile?(
    params: ACPWriteTextFileRequest
  ): Promise<ACPWriteTextFileResponse>;

  /**
   * Handle create terminal request (optional, based on capabilities).
   */
  createTerminal?(
    params: ACPCreateTerminalRequest
  ): Promise<ACPCreateTerminalResponse>;

  /**
   * Handle terminal output request (optional, based on capabilities).
   */
  terminalOutput?(
    params: ACPTerminalOutputRequest
  ): Promise<ACPTerminalOutputResponse>;

  /**
   * Handle release terminal request (optional, based on capabilities).
   */
  releaseTerminal?(
    params: ACPReleaseTerminalRequest
  ): Promise<ACPReleaseTerminalResponse>;

  /**
   * Handle wait for terminal exit request (optional, based on capabilities).
   */
  waitForTerminalExit?(
    params: ACPWaitForTerminalExitRequest
  ): Promise<ACPWaitForTerminalExitResponse>;

  /**
   * Handle kill terminal command request (optional, based on capabilities).
   */
  killTerminal?(
    params: ACPKillTerminalCommandRequest
  ): Promise<ACPKillTerminalCommandResponse>;
}

// =============================================================================
// Agent Handler Interfaces
// =============================================================================

/**
 * Context passed to agent handlers.
 */
export interface ACPAgentContext {
  /** The stream ID for this ACP session. */
  streamId: string;
  /** Current ACP session ID (null before newSession). */
  sessionId: ACPSessionId | null;
  /** The MAP participant ID of the client. */
  clientParticipantId: string;
}

/**
 * Handler interface for agents that support ACP.
 */
export interface ACPAgentHandler {
  /**
   * Handle initialize request.
   */
  initialize(
    params: ACPInitializeRequest,
    ctx: ACPAgentContext
  ): Promise<ACPInitializeResponse>;

  /**
   * Handle authenticate request (optional).
   */
  authenticate?(
    params: ACPAuthenticateRequest,
    ctx: ACPAgentContext
  ): Promise<ACPAuthenticateResponse>;

  /**
   * Handle new session request.
   */
  newSession(
    params: ACPNewSessionRequest,
    ctx: ACPAgentContext
  ): Promise<ACPNewSessionResponse>;

  /**
   * Handle load session request (optional).
   */
  loadSession?(
    params: ACPLoadSessionRequest,
    ctx: ACPAgentContext
  ): Promise<ACPLoadSessionResponse>;

  /**
   * Handle set session mode request (optional).
   */
  setSessionMode?(
    params: ACPSetSessionModeRequest,
    ctx: ACPAgentContext
  ): Promise<ACPSetSessionModeResponse>;

  /**
   * Handle prompt request.
   */
  prompt(
    params: ACPPromptRequest,
    ctx: ACPAgentContext
  ): Promise<ACPPromptResponse>;

  /**
   * Handle cancel notification.
   */
  cancel(params: ACPCancelNotification, ctx: ACPAgentContext): Promise<void>;
}

// =============================================================================
// ACP Capability Constants
// =============================================================================

/**
 * Current stable ACP protocol version.
 */
export const ACP_PROTOCOL_VERSION = 20241007; // 2024-10-07

/**
 * ACP method names.
 */
export const ACP_METHODS = {
  // Lifecycle
  INITIALIZE: "initialize",
  AUTHENTICATE: "authenticate",

  // Session management
  SESSION_NEW: "session/new",
  SESSION_LOAD: "session/load",
  SESSION_SET_MODE: "session/set_mode",

  // Prompt
  SESSION_PROMPT: "session/prompt",
  SESSION_CANCEL: "session/cancel",

  // Notifications
  SESSION_UPDATE: "session/update",

  // Agent→Client requests
  REQUEST_PERMISSION: "request_permission",
  FS_READ_TEXT_FILE: "fs/read_text_file",
  FS_WRITE_TEXT_FILE: "fs/write_text_file",
  TERMINAL_CREATE: "terminal/create",
  TERMINAL_OUTPUT: "terminal/output",
  TERMINAL_RELEASE: "terminal/release",
  TERMINAL_WAIT_FOR_EXIT: "terminal/wait_for_exit",
  TERMINAL_KILL: "terminal/kill",
} as const;

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Check if a message is an ACP request.
 */
export function isACPRequest(msg: ACPMessage): msg is ACPRequest {
  if (typeof msg !== "object" || msg === null) {
    return false;
  }
  return "method" in msg && "id" in msg && msg.id !== undefined;
}

/**
 * Check if a message is an ACP notification.
 */
export function isACPNotification(msg: ACPMessage): msg is ACPNotification {
  if (typeof msg !== "object" || msg === null) {
    return false;
  }
  return "method" in msg && !("id" in msg);
}

/**
 * Check if a message is an ACP response.
 */
export function isACPResponse(msg: ACPMessage): msg is ACPResponse {
  if (typeof msg !== "object" || msg === null) {
    return false;
  }
  return "id" in msg && !("method" in msg);
}

/**
 * Check if a response is an error response.
 */
export function isACPErrorResponse(
  response: ACPResponse
): response is ACPErrorResponse {
  if (typeof response !== "object" || response === null) {
    return false;
  }
  return "error" in response;
}

/**
 * Check if a response is a success response.
 */
export function isACPSuccessResponse<T>(
  response: ACPResponse<T>
): response is ACPSuccessResponse<T> {
  if (typeof response !== "object" || response === null) {
    return false;
  }
  return "result" in response;
}

/**
 * Check if a payload is an ACP envelope.
 */
export function isACPEnvelope(payload: unknown): payload is ACPEnvelope {
  if (typeof payload !== "object" || payload === null) {
    return false;
  }
  const envelope = payload as Record<string, unknown>;
  if (
    typeof envelope.acp !== "object" ||
    envelope.acp === null ||
    typeof envelope.acpContext !== "object" ||
    envelope.acpContext === null
  ) {
    return false;
  }
  // Validate acpContext has required streamId
  const acpContext = envelope.acpContext as Record<string, unknown>;
  return typeof acpContext.streamId === "string";
}
