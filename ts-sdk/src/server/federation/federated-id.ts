/**
 * Federated ID utilities
 *
 * Standardized format for remote entity IDs in federation.
 * Format: "{systemId}:{entityType}:{entityId}"
 *
 * Examples:
 * - "system-west:agent:agent-123"
 * - "system-east:scope:room-456"
 */

/**
 * Entity types supported in federated IDs.
 */
export type FederatedEntityType = "agent" | "scope" | "message";

/**
 * Parsed federated ID components.
 */
export interface FederatedIdComponents {
  /** The originating system ID */
  systemId: string;
  /** The entity type */
  entityType: FederatedEntityType;
  /** The original entity ID in the source system */
  entityId: string;
}

/**
 * Error thrown when a federated ID is invalid.
 */
export class InvalidFederatedIdError extends Error {
  constructor(id: string, reason: string) {
    super(`Invalid federated ID "${id}": ${reason}`);
    this.name = "InvalidFederatedIdError";
  }
}

/**
 * Separator used in federated IDs.
 */
const SEPARATOR = ":";

/**
 * Valid entity types.
 */
const VALID_ENTITY_TYPES: readonly FederatedEntityType[] = ["agent", "scope", "message"];

/**
 * Check if a string is a valid entity type.
 */
function isValidEntityType(type: string): type is FederatedEntityType {
  return VALID_ENTITY_TYPES.includes(type as FederatedEntityType);
}

/**
 * Create a federated ID from components.
 *
 * @example
 * ```typescript
 * const id = formatFederatedId("system-west", "agent", "agent-123");
 * // => "system-west:agent:agent-123"
 * ```
 */
export function formatFederatedId(
  systemId: string,
  entityType: FederatedEntityType,
  entityId: string
): string {
  // Validate components
  if (!systemId || systemId.includes(SEPARATOR)) {
    throw new InvalidFederatedIdError(
      `${systemId}:${entityType}:${entityId}`,
      "systemId cannot be empty or contain ':'"
    );
  }
  if (!entityId || entityId.includes(SEPARATOR)) {
    throw new InvalidFederatedIdError(
      `${systemId}:${entityType}:${entityId}`,
      "entityId cannot be empty or contain ':'"
    );
  }

  return `${systemId}${SEPARATOR}${entityType}${SEPARATOR}${entityId}`;
}

/**
 * Parse a federated ID into its components.
 *
 * @throws InvalidFederatedIdError if the ID is not valid
 *
 * @example
 * ```typescript
 * const { systemId, entityType, entityId } = parseFederatedId("system-west:agent:agent-123");
 * // => { systemId: "system-west", entityType: "agent", entityId: "agent-123" }
 * ```
 */
export function parseFederatedId(id: string): FederatedIdComponents {
  const parts = id.split(SEPARATOR);

  if (parts.length !== 3) {
    throw new InvalidFederatedIdError(
      id,
      `expected format "systemId:entityType:entityId", got ${parts.length} parts`
    );
  }

  const [systemId, entityType, entityId] = parts;

  if (!systemId) {
    throw new InvalidFederatedIdError(id, "systemId cannot be empty");
  }

  if (!isValidEntityType(entityType)) {
    throw new InvalidFederatedIdError(
      id,
      `entityType must be one of: ${VALID_ENTITY_TYPES.join(", ")}`
    );
  }

  if (!entityId) {
    throw new InvalidFederatedIdError(id, "entityId cannot be empty");
  }

  return { systemId, entityType, entityId };
}

/**
 * Check if a string is a valid federated ID.
 *
 * @example
 * ```typescript
 * isFederatedId("system-west:agent:agent-123"); // true
 * isFederatedId("agent-123"); // false
 * ```
 */
export function isFederatedId(id: string): boolean {
  try {
    parseFederatedId(id);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a federated ID is for a specific entity type.
 *
 * @example
 * ```typescript
 * isFederatedAgent("system-west:agent:agent-123"); // true
 * isFederatedAgent("system-west:scope:room-456"); // false
 * ```
 */
export function isFederatedAgent(id: string): boolean {
  try {
    const { entityType } = parseFederatedId(id);
    return entityType === "agent";
  } catch {
    return false;
  }
}

/**
 * Check if a federated ID is for a scope.
 */
export function isFederatedScope(id: string): boolean {
  try {
    const { entityType } = parseFederatedId(id);
    return entityType === "scope";
  } catch {
    return false;
  }
}

/**
 * Check if a federated ID is from a specific system.
 */
export function isFromSystem(id: string, systemId: string): boolean {
  try {
    const parsed = parseFederatedId(id);
    return parsed.systemId === systemId;
  } catch {
    return false;
  }
}

/**
 * Extract the original entity ID from a federated ID.
 * Returns the original ID if not a federated ID.
 */
export function extractEntityId(id: string): string {
  try {
    const { entityId } = parseFederatedId(id);
    return entityId;
  } catch {
    return id;
  }
}

/**
 * Extract the system ID from a federated ID.
 * Returns undefined if not a federated ID.
 */
export function extractSystemId(id: string): string | undefined {
  try {
    const { systemId } = parseFederatedId(id);
    return systemId;
  } catch {
    return undefined;
  }
}
