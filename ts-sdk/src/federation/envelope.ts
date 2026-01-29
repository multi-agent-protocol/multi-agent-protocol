/**
 * Federation Envelope Utilities
 *
 * Provides functions for creating and processing federation envelopes
 * for routing messages between federated MAP systems.
 */

import type { FederationEnvelope, FederationRoutingConfig } from '../types';
import { ERROR_CODES } from '../types';

// =============================================================================
// Types
// =============================================================================

/**
 * Options for creating a federation envelope.
 */
export interface CreateEnvelopeOptions {
  /** Correlation ID for cross-system tracing */
  correlationId?: string;
  /** Maximum number of hops before rejection */
  maxHops?: number;
  /** Whether to track the full routing path */
  trackPath?: boolean;
}

/**
 * Result of processing a federation envelope.
 */
export type ProcessEnvelopeResult<T> =
  | {
      success: true;
      envelope: FederationEnvelope<T>;
    }
  | {
      success: false;
      errorCode: number;
      errorMessage: string;
    };

// =============================================================================
// Envelope Creation
// =============================================================================

/**
 * Create a new federation envelope for outbound messages.
 *
 * @param payload - The payload to wrap (typically a Message)
 * @param sourceSystem - ID of the originating system
 * @param targetSystem - ID of the destination system
 * @param options - Optional envelope options
 * @returns A new federation envelope
 *
 * @example
 * ```typescript
 * const envelope = createFederationEnvelope(
 *   message,
 *   'system-alpha',
 *   'system-beta',
 *   { trackPath: true, correlationId: 'req-123' }
 * );
 * ```
 */
export function createFederationEnvelope<T>(
  payload: T,
  sourceSystem: string,
  targetSystem: string,
  options?: CreateEnvelopeOptions
): FederationEnvelope<T> {
  return {
    payload,
    federation: {
      sourceSystem,
      targetSystem,
      hopCount: 0,
      maxHops: options?.maxHops,
      path: options?.trackPath ? [sourceSystem] : undefined,
      originTimestamp: Date.now(),
      correlationId: options?.correlationId,
    },
  };
}

// =============================================================================
// Envelope Processing
// =============================================================================

/**
 * Process an incoming federation envelope for forwarding.
 *
 * Validates the envelope against routing configuration and returns
 * an updated envelope ready for forwarding, or an error if routing
 * should be rejected.
 *
 * Checks performed:
 * 1. Hop count hasn't exceeded maximum
 * 2. No routing loops (if path tracking enabled)
 * 3. Source system is in allowed sources (if configured)
 * 4. Target system is in allowed targets (if configured)
 *
 * @param envelope - The incoming envelope
 * @param config - Routing configuration for this system
 * @returns Updated envelope or error result
 *
 * @example
 * ```typescript
 * const result = processFederationEnvelope(envelope, {
 *   systemId: 'system-gamma',
 *   maxHops: 5,
 *   trackPath: true,
 * });
 *
 * if (result.success) {
 *   forwardToNext(result.envelope);
 * } else {
 *   rejectWithError(result.errorCode, result.errorMessage);
 * }
 * ```
 */
export function processFederationEnvelope<T>(
  envelope: FederationEnvelope<T>,
  config: FederationRoutingConfig
): ProcessEnvelopeResult<T> {
  const { federation } = envelope;
  const maxHops = federation.maxHops ?? config.maxHops ?? 10;

  // Check hop count
  if (federation.hopCount >= maxHops) {
    return {
      success: false,
      errorCode: ERROR_CODES.FEDERATION_MAX_HOPS_EXCEEDED,
      errorMessage: `Message exceeded maximum hop count of ${maxHops}`,
    };
  }

  // Check for loops (if path tracking enabled)
  if (federation.path?.includes(config.systemId)) {
    return {
      success: false,
      errorCode: ERROR_CODES.FEDERATION_LOOP_DETECTED,
      errorMessage: `Loop detected: message already visited ${config.systemId}`,
    };
  }

  // Check source allowlist
  if (config.allowedSources && !config.allowedSources.includes(federation.sourceSystem)) {
    return {
      success: false,
      errorCode: ERROR_CODES.FEDERATION_ROUTE_REJECTED,
      errorMessage: `Source system ${federation.sourceSystem} not in allowed sources`,
    };
  }

  // Check target allowlist
  if (config.allowedTargets && !config.allowedTargets.includes(federation.targetSystem)) {
    return {
      success: false,
      errorCode: ERROR_CODES.FEDERATION_ROUTE_REJECTED,
      errorMessage: `Target system ${federation.targetSystem} not in allowed targets`,
    };
  }

  // Update for forwarding
  return {
    success: true,
    envelope: {
      payload: envelope.payload,
      federation: {
        ...federation,
        hopCount: federation.hopCount + 1,
        path: config.trackPath ? [...(federation.path ?? []), config.systemId] : federation.path,
      },
    },
  };
}

// =============================================================================
// Envelope Utilities
// =============================================================================

/**
 * Check if an envelope has reached its final destination.
 *
 * @param envelope - The envelope to check
 * @param currentSystemId - ID of the current system
 * @returns true if this is the target system
 */
export function isEnvelopeAtDestination(
  envelope: FederationEnvelope<unknown>,
  currentSystemId: string
): boolean {
  return envelope.federation.targetSystem === currentSystemId;
}

/**
 * Extract the payload from a federation envelope.
 *
 * @param envelope - The envelope to unwrap
 * @returns The payload
 */
export function unwrapEnvelope<T>(envelope: FederationEnvelope<T>): T {
  return envelope.payload;
}

/**
 * Get routing metadata for logging/debugging.
 *
 * @param envelope - The envelope to inspect
 * @returns Routing information
 */
export function getEnvelopeRoutingInfo(envelope: FederationEnvelope<unknown>): {
  source: string;
  target: string;
  hops: number;
  path?: string[];
  age: number;
  correlationId?: string;
} {
  const { federation } = envelope;
  return {
    source: federation.sourceSystem,
    target: federation.targetSystem,
    hops: federation.hopCount,
    path: federation.path,
    age: Date.now() - federation.originTimestamp,
    correlationId: federation.correlationId,
  };
}

/**
 * Validate that an object is a valid federation envelope.
 *
 * @param obj - Object to validate
 * @returns true if valid envelope structure
 */
export function isValidEnvelope(obj: unknown): obj is FederationEnvelope<unknown> {
  if (!obj || typeof obj !== 'object') return false;

  const envelope = obj as Record<string, unknown>;
  if (!('payload' in envelope) || !('federation' in envelope)) return false;

  const federation = envelope.federation as Record<string, unknown>;
  if (!federation || typeof federation !== 'object') return false;

  return (
    typeof federation.sourceSystem === 'string' &&
    typeof federation.targetSystem === 'string' &&
    typeof federation.hopCount === 'number' &&
    typeof federation.originTimestamp === 'number'
  );
}

/**
 * Create an updated envelope with a new payload (for transformations).
 *
 * @param envelope - Original envelope
 * @param newPayload - New payload
 * @returns New envelope with same metadata but new payload
 */
export function withPayload<T, U>(
  envelope: FederationEnvelope<T>,
  newPayload: U
): FederationEnvelope<U> {
  return {
    payload: newPayload,
    federation: envelope.federation,
  };
}
