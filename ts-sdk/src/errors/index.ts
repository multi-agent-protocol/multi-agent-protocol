/**
 * Error classes for MAP protocol
 */

import type { MAPError, MAPErrorData, ErrorCategory, RequestId } from '../types';
import {
  PROTOCOL_ERROR_CODES,
  AUTH_ERROR_CODES,
  ROUTING_ERROR_CODES,
  AGENT_ERROR_CODES,
  RESOURCE_ERROR_CODES,
  FEDERATION_ERROR_CODES,
} from '../types';
import { createErrorResponse, type JsonRpcErrorResponse } from '../jsonrpc';

/**
 * Error thrown when a MAP request fails.
 *
 * Extends Error with JSON-RPC error properties and provides
 * factory methods for common error types.
 */
export class MAPRequestError extends Error {
  readonly code: number;
  readonly data?: MAPErrorData;

  constructor(code: number, message: string, data?: MAPErrorData) {
    super(message);
    this.name = 'MAPRequestError';
    this.code = code;
    this.data = data;
  }

  /**
   * Convert to MAP error object
   */
  toError(): MAPError {
    const error: MAPError = {
      code: this.code,
      message: this.message,
    };
    if (this.data) {
      error.data = this.data;
    }
    return error;
  }

  /**
   * Convert to JSON-RPC error response
   */
  toResponse(id: RequestId): JsonRpcErrorResponse {
    return createErrorResponse(id, this.toError());
  }

  // ==========================================================================
  // Protocol Errors (-32xxx)
  // ==========================================================================

  static parseError(details?: string): MAPRequestError {
    return new MAPRequestError(
      PROTOCOL_ERROR_CODES.PARSE_ERROR,
      details ?? 'Parse error',
      { category: 'protocol' }
    );
  }

  static invalidRequest(details?: string): MAPRequestError {
    return new MAPRequestError(
      PROTOCOL_ERROR_CODES.INVALID_REQUEST,
      details ?? 'Invalid request',
      { category: 'protocol' }
    );
  }

  static methodNotFound(method: string): MAPRequestError {
    return new MAPRequestError(
      PROTOCOL_ERROR_CODES.METHOD_NOT_FOUND,
      `Method not found: ${method}`,
      { category: 'protocol' }
    );
  }

  static invalidParams(details?: unknown): MAPRequestError {
    return new MAPRequestError(
      PROTOCOL_ERROR_CODES.INVALID_PARAMS,
      'Invalid params',
      { category: 'protocol', details: details as Record<string, unknown> }
    );
  }

  static internalError(details?: string): MAPRequestError {
    return new MAPRequestError(
      PROTOCOL_ERROR_CODES.INTERNAL_ERROR,
      details ?? 'Internal error',
      { category: 'internal' }
    );
  }

  // ==========================================================================
  // Auth Errors (1xxx)
  // ==========================================================================

  static authRequired(): MAPRequestError {
    return new MAPRequestError(
      AUTH_ERROR_CODES.AUTH_REQUIRED,
      'Authentication required',
      { category: 'auth' }
    );
  }

  static authFailed(details?: string): MAPRequestError {
    return new MAPRequestError(
      AUTH_ERROR_CODES.AUTH_FAILED,
      details ?? 'Authentication failed',
      { category: 'auth' }
    );
  }

  static tokenExpired(): MAPRequestError {
    return new MAPRequestError(
      AUTH_ERROR_CODES.TOKEN_EXPIRED,
      'Token expired',
      { category: 'auth', retryable: true }
    );
  }

  static insufficientPermissions(required?: string): MAPRequestError {
    return new MAPRequestError(
      AUTH_ERROR_CODES.INSUFFICIENT_PERMISSIONS,
      required ? `Insufficient permissions: ${required}` : 'Insufficient permissions',
      { category: 'auth' }
    );
  }

  // ==========================================================================
  // Routing Errors (2xxx)
  // ==========================================================================

  static addressNotFound(address: string): MAPRequestError {
    return new MAPRequestError(
      ROUTING_ERROR_CODES.ADDRESS_NOT_FOUND,
      `Address not found: ${address}`,
      { category: 'routing' }
    );
  }

  static agentNotFound(agentId: string): MAPRequestError {
    return new MAPRequestError(
      ROUTING_ERROR_CODES.AGENT_NOT_FOUND,
      `Agent not found: ${agentId}`,
      { category: 'routing' }
    );
  }

  static scopeNotFound(scopeId: string): MAPRequestError {
    return new MAPRequestError(
      ROUTING_ERROR_CODES.SCOPE_NOT_FOUND,
      `Scope not found: ${scopeId}`,
      { category: 'routing' }
    );
  }

  static deliveryFailed(details?: string): MAPRequestError {
    return new MAPRequestError(
      ROUTING_ERROR_CODES.DELIVERY_FAILED,
      details ?? 'Message delivery failed',
      { category: 'routing', retryable: true }
    );
  }

  static addressAmbiguous(address: string): MAPRequestError {
    return new MAPRequestError(
      ROUTING_ERROR_CODES.ADDRESS_AMBIGUOUS,
      `Address is ambiguous: ${address}`,
      { category: 'routing' }
    );
  }

  // ==========================================================================
  // Agent Errors (3xxx)
  // ==========================================================================

  static agentExists(agentId: string): MAPRequestError {
    return new MAPRequestError(
      AGENT_ERROR_CODES.AGENT_EXISTS,
      `Agent already exists: ${agentId}`,
      { category: 'agent' }
    );
  }

  static stateInvalid(currentState: string, requestedAction: string): MAPRequestError {
    return new MAPRequestError(
      AGENT_ERROR_CODES.STATE_INVALID,
      `Cannot ${requestedAction} agent in state: ${currentState}`,
      { category: 'agent' }
    );
  }

  static agentNotResponding(agentId: string): MAPRequestError {
    return new MAPRequestError(
      AGENT_ERROR_CODES.NOT_RESPONDING,
      `Agent not responding: ${agentId}`,
      { category: 'agent', retryable: true }
    );
  }

  static agentTerminated(agentId: string): MAPRequestError {
    return new MAPRequestError(
      AGENT_ERROR_CODES.TERMINATED,
      `Agent terminated: ${agentId}`,
      { category: 'agent' }
    );
  }

  static spawnFailed(details?: string): MAPRequestError {
    return new MAPRequestError(
      AGENT_ERROR_CODES.SPAWN_FAILED,
      details ?? 'Failed to spawn agent',
      { category: 'agent' }
    );
  }

  // ==========================================================================
  // Resource Errors (4xxx)
  // ==========================================================================

  static resourceExhausted(resource?: string): MAPRequestError {
    return new MAPRequestError(
      RESOURCE_ERROR_CODES.EXHAUSTED,
      resource ? `Resource exhausted: ${resource}` : 'Resource exhausted',
      { category: 'resource', retryable: true }
    );
  }

  static rateLimited(retryAfterMs?: number): MAPRequestError {
    return new MAPRequestError(
      RESOURCE_ERROR_CODES.RATE_LIMITED,
      'Rate limited',
      { category: 'resource', retryable: true, retryAfterMs }
    );
  }

  static quotaExceeded(quota?: string): MAPRequestError {
    return new MAPRequestError(
      RESOURCE_ERROR_CODES.QUOTA_EXCEEDED,
      quota ? `Quota exceeded: ${quota}` : 'Quota exceeded',
      { category: 'resource' }
    );
  }

  // ==========================================================================
  // Federation Errors (5xxx)
  // ==========================================================================

  static federationUnavailable(systemId?: string): MAPRequestError {
    return new MAPRequestError(
      FEDERATION_ERROR_CODES.UNAVAILABLE,
      systemId ? `Federation unavailable: ${systemId}` : 'Federation unavailable',
      { category: 'federation', retryable: true }
    );
  }

  static systemNotFound(systemId: string): MAPRequestError {
    return new MAPRequestError(
      FEDERATION_ERROR_CODES.SYSTEM_NOT_FOUND,
      `System not found: ${systemId}`,
      { category: 'federation' }
    );
  }

  static federationAuthFailed(systemId: string): MAPRequestError {
    return new MAPRequestError(
      FEDERATION_ERROR_CODES.AUTH_FAILED,
      `Federation authentication failed: ${systemId}`,
      { category: 'federation' }
    );
  }

  static routeRejected(systemId: string, reason?: string): MAPRequestError {
    return new MAPRequestError(
      FEDERATION_ERROR_CODES.ROUTE_REJECTED,
      reason ? `Route rejected by ${systemId}: ${reason}` : `Route rejected by ${systemId}`,
      { category: 'federation' }
    );
  }

  // ==========================================================================
  // Utility
  // ==========================================================================

  /**
   * Create from a MAP error object
   */
  static fromError(error: MAPError): MAPRequestError {
    return new MAPRequestError(error.code, error.message, error.data);
  }

  /**
   * Check if this error is retryable
   */
  get retryable(): boolean {
    return this.data?.retryable ?? false;
  }

  /**
   * Get retry delay in milliseconds, if specified
   */
  get retryAfterMs(): number | undefined {
    return this.data?.retryAfterMs;
  }

  /**
   * Get error category
   */
  get category(): ErrorCategory | undefined {
    return this.data?.category;
  }
}

/**
 * Error thrown when a connection is closed unexpectedly
 */
export class MAPConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MAPConnectionError';
  }

  static closed(): MAPConnectionError {
    return new MAPConnectionError('Connection closed');
  }

  static timeout(): MAPConnectionError {
    return new MAPConnectionError('Connection timeout');
  }
}

/**
 * Error thrown when an operation times out
 */
export class MAPTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(operation: string, timeoutMs: number) {
    super(`Operation timed out after ${timeoutMs}ms: ${operation}`);
    this.name = 'MAPTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}
