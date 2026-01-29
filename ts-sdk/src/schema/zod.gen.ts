/**
 * Zod validators for MAP protocol types
 *
 * These validators provide runtime validation for protocol messages.
 * They are generated based on the JSON schema but hand-tuned for proper Zod compatibility.
 */

import { z } from 'zod';

// ===========================================================================
// Primitives
// ===========================================================================

export const JsonRpcVersionSchema = z.literal('2.0');
export const RequestIdSchema = z.union([z.string(), z.number().int()]);
export const ProtocolVersionSchema = z.literal(1);
export const TimestampSchema = z.number().int();
export const MetaSchema = z.record(z.unknown()).optional();

// ===========================================================================
// Identifiers
// ===========================================================================

export const ParticipantIdSchema = z.string();
export const AgentIdSchema = z.string();
export const ScopeIdSchema = z.string();
export const SessionIdSchema = z.string();
export const MessageIdSchema = z.string();
export const SubscriptionIdSchema = z.string();
export const CorrelationIdSchema = z.string();

// ===========================================================================
// Enums
// ===========================================================================

export const ParticipantTypeSchema = z.enum(['agent', 'client', 'system', 'gateway']);
export const TransportTypeSchema = z.enum(['websocket', 'stdio', 'inprocess', 'http-sse']);
export const ErrorCategorySchema = z.enum([
  'protocol',
  'auth',
  'routing',
  'agent',
  'resource',
  'federation',
  'internal',
]);

export const AgentVisibilitySchema = z.enum(['public', 'parent-only', 'scope', 'system']);

// Agent state: standard states + custom x-* states
export const AgentStateSchema = z.union([
  z.enum(['registered', 'idle', 'busy', 'waiting', 'stopping', 'stopped', 'error']),
  z.string().regex(/^x-/),
]);

export const MessagePrioritySchema = z.enum(['low', 'normal', 'high', 'urgent']);
export const DeliverySemanticsSchema = z.enum(['at-most-once', 'at-least-once', 'exactly-once']);
export const MessageRelationshipSchema = z.enum([
  'peer',
  'parent-to-child',
  'child-to-parent',
  'supervisor-to-supervised',
  'broadcast',
]);

export const EventTypeSchema = z.enum([
  'agent.registered',
  'agent.unregistered',
  'agent.state-changed',
  'agent.spawned',
  'scope.created',
  'scope.deleted',
  'scope.joined',
  'scope.left',
  'message.sent',
  'message.delivered',
  'session.started',
  'session.ended',
  'system.error',
  'system.shutdown',
]);

export const ScopeJoinPolicySchema = z.enum(['open', 'approval', 'invite']);
export const ScopeVisibilitySchema = z.enum(['public', 'private', 'unlisted']);
export const MessageVisibilitySchema = z.enum(['members', 'public']);
export const ScopeSendPolicySchema = z.enum(['anyone', 'members']);

// ===========================================================================
// Capabilities
// ===========================================================================

export const ParticipantCapabilitiesSchema = z
  .object({
    observation: z
      .object({
        canObserve: z.boolean().optional(),
        canQuery: z.boolean().optional(),
      })
      .strict()
      .optional(),
    messaging: z
      .object({
        canSend: z.boolean().optional(),
        canReceive: z.boolean().optional(),
        canBroadcast: z.boolean().optional(),
      })
      .strict()
      .optional(),
    lifecycle: z
      .object({
        canSpawn: z.boolean().optional(),
        canRegister: z.boolean().optional(),
        canUnregister: z.boolean().optional(),
        canSteer: z.boolean().optional(),
        canStop: z.boolean().optional(),
      })
      .strict()
      .optional(),
    scopes: z
      .object({
        canCreateScopes: z.boolean().optional(),
        canManageScopes: z.boolean().optional(),
      })
      .strict()
      .optional(),
    _meta: MetaSchema,
  })
  .strict();

// ===========================================================================
// Addresses
// ===========================================================================

export const DirectAddressSchema = z.object({ agent: AgentIdSchema }).strict();
export const MultiAddressSchema = z.object({ agents: z.array(AgentIdSchema).min(1) }).strict();
export const ScopeAddressSchema = z.object({ scope: ScopeIdSchema }).strict();
export const RoleAddressSchema = z
  .object({
    role: z.string(),
    scope: ScopeIdSchema.optional(),
  })
  .strict();
export const HierarchicalAddressSchema = z
  .object({
    parent: z.literal(true).optional(),
    children: z.literal(true).optional(),
    siblings: z.literal(true).optional(),
    ancestors: z.literal(true).optional(),
    descendants: z.literal(true).optional(),
  })
  .strict();
export const BroadcastAddressSchema = z.object({ broadcast: z.literal(true) }).strict();
export const SystemAddressSchema = z.object({ system: z.literal(true) }).strict();
export const ParticipantAddressSchema = z
  .object({ participant: ParticipantIdSchema })
  .strict();
export const FederatedAddressSchema = z
  .object({
    system: z.string(),
    address: z.lazy(() => AddressSchema),
  })
  .strict();

export const AddressSchema: z.ZodType<unknown> = z.union([
  DirectAddressSchema,
  MultiAddressSchema,
  ScopeAddressSchema,
  RoleAddressSchema,
  HierarchicalAddressSchema,
  BroadcastAddressSchema,
  SystemAddressSchema,
  ParticipantAddressSchema,
  FederatedAddressSchema,
]);

// ===========================================================================
// Core Structures
// ===========================================================================

export const AgentRelationshipSchema = z
  .object({
    type: z.enum(['peer', 'supervisor', 'supervised', 'collaborator']),
    agentId: AgentIdSchema,
    metadata: z.record(z.unknown()).optional(),
    _meta: MetaSchema,
  })
  .strict();

export const AgentLifecycleSchema = z
  .object({
    createdAt: TimestampSchema.optional(),
    startedAt: TimestampSchema.optional(),
    stoppedAt: TimestampSchema.optional(),
    lastActiveAt: TimestampSchema.optional(),
    exitCode: z.number().int().optional(),
    exitReason: z.string().optional(),
    _meta: MetaSchema,
  })
  .strict();

export const AgentSchema = z
  .object({
    id: AgentIdSchema,
    name: z.string().optional(),
    description: z.string().optional(),
    parent: AgentIdSchema.optional(),
    relationships: z.array(AgentRelationshipSchema).optional(),
    state: AgentStateSchema,
    role: z.string().optional(),
    scopes: z.array(ScopeIdSchema).optional(),
    visibility: AgentVisibilitySchema.optional(),
    lifecycle: AgentLifecycleSchema.optional(),
    capabilities: ParticipantCapabilitiesSchema.optional(),
    metadata: z.record(z.unknown()).optional(),
    _meta: MetaSchema,
  })
  .strict();

export const ScopeSchema = z
  .object({
    id: ScopeIdSchema,
    name: z.string().optional(),
    parent: ScopeIdSchema.optional(),
    children: z.array(ScopeIdSchema).optional(),
    joinPolicy: ScopeJoinPolicySchema.optional(),
    visibility: ScopeVisibilitySchema.optional(),
    messageVisibility: MessageVisibilitySchema.optional(),
    sendPolicy: ScopeSendPolicySchema.optional(),
    metadata: z.record(z.unknown()).optional(),
    _meta: MetaSchema,
  })
  .strict();

export const MessageMetaSchema = z
  .object({
    correlationId: CorrelationIdSchema.optional(),
    causationId: MessageIdSchema.optional(),
    traceId: z.string().optional(),
    spanId: z.string().optional(),
    priority: MessagePrioritySchema.optional(),
    delivery: DeliverySemanticsSchema.optional(),
    relationship: MessageRelationshipSchema.optional(),
    expiresAt: TimestampSchema.optional(),
    isResult: z.boolean().optional(),
    _meta: MetaSchema,
  })
  .strict();

export const MessageSchema = z
  .object({
    id: MessageIdSchema,
    from: ParticipantIdSchema,
    to: AddressSchema,
    timestamp: TimestampSchema,
    payload: z.unknown().optional(),
    meta: MessageMetaSchema.optional(),
    _meta: MetaSchema,
  })
  .strict();

export const EventSchema = z
  .object({
    type: EventTypeSchema,
    timestamp: TimestampSchema,
    data: z.record(z.unknown()).optional(),
    _meta: MetaSchema,
  })
  .strict();

export const SubscriptionFilterSchema = z
  .object({
    eventTypes: z.array(EventTypeSchema).optional(),
    scopes: z.array(ScopeIdSchema).optional(),
    agents: z.array(AgentIdSchema).optional(),
    includeChildren: z.boolean().optional(),
    _meta: MetaSchema,
  })
  .strict();

// ===========================================================================
// Error
// ===========================================================================

export const MAPErrorDataSchema = z
  .object({
    category: ErrorCategorySchema.optional(),
    retryable: z.boolean().optional(),
    retryAfterMs: z.number().int().optional(),
    details: z.record(z.unknown()).optional(),
    _meta: MetaSchema,
  })
  .passthrough();

export const MAPErrorSchema = z
  .object({
    code: z.number().int(),
    message: z.string(),
    data: MAPErrorDataSchema.optional(),
  })
  .strict();

// ===========================================================================
// JSON-RPC Messages
// ===========================================================================

export const MAPRequestSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: RequestIdSchema,
    method: z.string(),
    params: z.record(z.unknown()).optional(),
  })
  .strict();

export const MAPResponseSuccessSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: RequestIdSchema,
    result: z.unknown(),
  })
  .strict();

export const MAPResponseErrorSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: RequestIdSchema,
    error: MAPErrorSchema,
  })
  .strict();

export const MAPResponseSchema = z.union([MAPResponseSuccessSchema, MAPResponseErrorSchema]);

export const MAPNotificationSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    method: z.string(),
    params: z.record(z.unknown()).optional(),
  })
  .strict();

// ===========================================================================
// Inferred Types (for convenience)
// ===========================================================================

export type ParticipantIdValidated = z.infer<typeof ParticipantIdSchema>;
export type AgentIdValidated = z.infer<typeof AgentIdSchema>;
export type ScopeIdValidated = z.infer<typeof ScopeIdSchema>;
export type SessionIdValidated = z.infer<typeof SessionIdSchema>;
export type MessageIdValidated = z.infer<typeof MessageIdSchema>;
export type ParticipantTypeValidated = z.infer<typeof ParticipantTypeSchema>;
export type AgentStateValidated = z.infer<typeof AgentStateSchema>;
export type AgentValidated = z.infer<typeof AgentSchema>;
export type ScopeValidated = z.infer<typeof ScopeSchema>;
export type MessageValidated = z.infer<typeof MessageSchema>;
export type EventValidated = z.infer<typeof EventSchema>;
export type AddressValidated = z.infer<typeof AddressSchema>;
export type MAPRequestValidated = z.infer<typeof MAPRequestSchema>;
export type MAPResponseValidated = z.infer<typeof MAPResponseSchema>;
export type MAPNotificationValidated = z.infer<typeof MAPNotificationSchema>;
export type MAPErrorValidated = z.infer<typeof MAPErrorSchema>;
export type ParticipantCapabilitiesValidated = z.infer<typeof ParticipantCapabilitiesSchema>;
export type SubscriptionFilterValidated = z.infer<typeof SubscriptionFilterSchema>;
