/**
 * Address utilities for recipient disambiguation
 *
 * Provides utilities for parsing and formatting message addresses
 * with type prefixes to distinguish between agent and scope recipients.
 *
 * Format: "{type}:{id}"
 * - agent:abc123  -> agent recipient
 * - scope:room-1  -> scope recipient
 */

/** Valid address types */
export type AddressType = "agent" | "scope";

/** Parsed address components */
export interface AddressComponents {
  type: AddressType;
  id: string;
}

/** The separator used in address format */
const SEPARATOR = ":";

/** Valid address types for validation */
const VALID_ADDRESS_TYPES: readonly AddressType[] = ["agent", "scope"];

/**
 * Error thrown when an address format is invalid.
 */
export class InvalidAddressError extends Error {
  constructor(address: string, reason: string) {
    super(`Invalid address "${address}": ${reason}`);
    this.name = "InvalidAddressError";
  }
}

/**
 * Format an address with type prefix.
 *
 * @param type - The address type (agent or scope)
 * @param id - The entity ID
 * @returns Formatted address string
 * @throws InvalidAddressError if parameters are invalid
 *
 * @example
 * formatAddress("agent", "abc123")  // "agent:abc123"
 * formatAddress("scope", "room-1")  // "scope:room-1"
 */
export function formatAddress(type: AddressType, id: string): string {
  if (!id) {
    throw new InvalidAddressError("", "ID cannot be empty");
  }

  if (id.includes(SEPARATOR)) {
    throw new InvalidAddressError(id, "ID cannot contain colon separator");
  }

  return `${type}${SEPARATOR}${id}`;
}

/**
 * Parse an address string into its components.
 *
 * @param address - The address string to parse
 * @returns Parsed address components
 * @throws InvalidAddressError if format is invalid
 *
 * @example
 * parseAddress("agent:abc123")  // { type: "agent", id: "abc123" }
 * parseAddress("scope:room-1")  // { type: "scope", id: "room-1" }
 */
export function parseAddress(address: string): AddressComponents {
  const separatorIndex = address.indexOf(SEPARATOR);

  if (separatorIndex === -1) {
    throw new InvalidAddressError(address, "missing type prefix");
  }

  const type = address.slice(0, separatorIndex);
  const id = address.slice(separatorIndex + 1);

  if (!VALID_ADDRESS_TYPES.includes(type as AddressType)) {
    throw new InvalidAddressError(address, `invalid type "${type}", must be agent or scope`);
  }

  if (!id) {
    throw new InvalidAddressError(address, "ID cannot be empty");
  }

  // Check for extra colons (could be a federated ID embedded)
  // Allow federated IDs in the id portion: agent:system-a:agent:abc123
  // This means the id would be "system-a:agent:abc123" which is fine

  return {
    type: type as AddressType,
    id,
  };
}

/**
 * Check if a string is a valid prefixed address.
 *
 * @param address - The string to check
 * @returns true if valid prefixed address format
 *
 * @example
 * isAddress("agent:abc123")  // true
 * isAddress("scope:room-1")  // true
 * isAddress("abc123")        // false (no prefix)
 * isAddress("invalid:abc")   // false (invalid type)
 */
export function isAddress(address: string): boolean {
  try {
    parseAddress(address);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if an address is for an agent.
 *
 * @param address - The address string to check
 * @returns true if address is for an agent
 */
export function isAgentAddress(address: string): boolean {
  try {
    const parsed = parseAddress(address);
    return parsed.type === "agent";
  } catch {
    return false;
  }
}

/**
 * Check if an address is for a scope.
 *
 * @param address - The address string to check
 * @returns true if address is for a scope
 */
export function isScopeAddress(address: string): boolean {
  try {
    const parsed = parseAddress(address);
    return parsed.type === "scope";
  } catch {
    return false;
  }
}

/**
 * Extract the ID from an address, or return the original if not prefixed.
 *
 * Useful for backward compatibility when handling both prefixed and unprefixed addresses.
 *
 * @param address - The address string
 * @returns The extracted ID or the original string
 */
export function extractId(address: string): string {
  try {
    const parsed = parseAddress(address);
    return parsed.id;
  } catch {
    return address;
  }
}

/**
 * Extract the type from an address, or return undefined if not prefixed.
 *
 * @param address - The address string
 * @returns The address type or undefined
 */
export function extractType(address: string): AddressType | undefined {
  try {
    const parsed = parseAddress(address);
    return parsed.type;
  } catch {
    return undefined;
  }
}

/**
 * Convenience function to create an agent address.
 *
 * @param agentId - The agent ID
 * @returns Formatted agent address
 */
export function toAgent(agentId: string): string {
  return formatAddress("agent", agentId);
}

/**
 * Convenience function to create a scope address.
 *
 * @param scopeId - The scope ID
 * @returns Formatted scope address
 */
export function toScope(scopeId: string): string {
  return formatAddress("scope", scopeId);
}
