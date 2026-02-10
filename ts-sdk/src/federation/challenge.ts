/**
 * Federation challenge nonce utilities.
 *
 * Generates and validates challenge nonces for federation authentication.
 * Nonces embed a timestamp for age validation.
 */

import { ulid } from '../utils/ulid';

/**
 * Generate a federation challenge nonce.
 *
 * Format: `map_chal_<ulid>` — the ULID provides both uniqueness and an embedded timestamp.
 */
export function generateFederationChallenge(): string {
  return `map_chal_${ulid()}`;
}

/**
 * Validate that a challenge nonce is not too old.
 *
 * @param challenge - The challenge string to validate
 * @param maxAgeMs - Maximum age in milliseconds (default: 5 minutes)
 * @returns true if the challenge is valid and within the age limit
 */
export function validateChallengeAge(
  challenge: string,
  maxAgeMs: number = 5 * 60 * 1000
): boolean {
  if (!challenge || !challenge.startsWith('map_chal_')) {
    return false;
  }

  // Extract ULID portion
  const ulidPart = challenge.slice('map_chal_'.length);
  if (ulidPart.length !== 26) {
    return false;
  }

  // Decode ULID timestamp (first 10 chars encode 48-bit Unix ms timestamp)
  const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const chars = ulidPart.toUpperCase();
  let timestamp = 0;
  for (let i = 0; i < 10; i++) {
    const idx = ENCODING.indexOf(chars[i]);
    if (idx === -1) return false;
    timestamp = timestamp * 32 + idx;
  }

  const age = Date.now() - timestamp;
  return age >= 0 && age <= maxAgeMs;
}
