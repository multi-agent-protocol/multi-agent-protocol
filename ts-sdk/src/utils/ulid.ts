/**
 * ULID utilities for MAP event IDs
 *
 * ULIDs (Universally Unique Lexicographically Sortable Identifiers) are:
 * - 26 characters, Crockford Base32 encoded
 * - Time-sortable (first 48 bits = millisecond timestamp)
 * - Lexicographically sortable (string comparison = chronological order)
 *
 * Format: TTTTTTTTTTRRRRRRRRRRRRRRR
 *         |---------|-------------|
 *         Timestamp    Randomness
 *         (10 chars)   (16 chars)
 *
 * @example
 * ```typescript
 * import { ulid, ulidTimestamp, compareUlid } from './utils/ulid';
 *
 * const id = ulid();  // "01HQJY3KCNP5VXWZ8M4R6T2G9B"
 * const ts = ulidTimestamp(id);  // 1706123456789
 * ```
 */

// Re-export from ulid package
export { ulid, monotonicFactory } from 'ulid';

// Crockford Base32 alphabet used by ULID
const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ENCODING_LEN = ENCODING.length; // 32

/**
 * Extract the timestamp from a ULID.
 *
 * @param id - The ULID string
 * @returns Unix timestamp in milliseconds
 *
 * @example
 * ```typescript
 * const id = ulid();
 * const timestamp = ulidTimestamp(id);
 * console.log(new Date(timestamp));
 * ```
 */
export function ulidTimestamp(id: string): number {
  if (id.length !== 26) {
    throw new Error(`Invalid ULID: expected 26 characters, got ${id.length}`);
  }

  // Decode first 10 characters (timestamp portion)
  let time = 0;
  for (let i = 0; i < 10; i++) {
    const char = id[i].toUpperCase();
    const idx = ENCODING.indexOf(char);
    if (idx === -1) {
      throw new Error(`Invalid ULID character: ${char}`);
    }
    time = time * ENCODING_LEN + idx;
  }

  return time;
}

/**
 * Compare two ULIDs lexicographically.
 *
 * Since ULIDs are designed to be lexicographically sortable,
 * this comparison also gives chronological ordering.
 *
 * @param a - First ULID
 * @param b - Second ULID
 * @returns Negative if a < b, positive if a > b, zero if equal
 *
 * @example
 * ```typescript
 * const ids = [ulid(), ulid(), ulid()];
 * ids.sort(compareUlid);  // Chronological order
 * ```
 */
export function compareUlid(a: string, b: string): number {
  return a.localeCompare(b);
}

/**
 * Check if a string is a valid ULID format.
 *
 * @param id - String to check
 * @returns True if valid ULID format
 */
export function isValidUlid(id: string): boolean {
  if (typeof id !== 'string' || id.length !== 26) {
    return false;
  }

  for (let i = 0; i < 26; i++) {
    if (ENCODING.indexOf(id[i].toUpperCase()) === -1) {
      return false;
    }
  }

  return true;
}
