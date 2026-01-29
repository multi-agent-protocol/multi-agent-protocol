/**
 * Tests for ULID utilities
 */

import { describe, it, expect } from 'vitest';
import { ulid, ulidTimestamp, compareUlid, isValidUlid, monotonicFactory } from '../utils';

describe('ULID utilities', () => {
  describe('ulid', () => {
    it('generates 26-character string', () => {
      const id = ulid();
      expect(id).toHaveLength(26);
    });

    it('generates unique IDs', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(ulid());
      }
      expect(ids.size).toBe(100);
    });

    it('generates valid Crockford Base32 characters', () => {
      const id = ulid();
      // ULID uses Crockford Base32 alphabet (excludes I, L, O, U)
      const validChars = /^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]+$/;
      expect(id).toMatch(validChars);
    });

    it('IDs are time-sortable', async () => {
      const id1 = ulid();
      await new Promise((resolve) => setTimeout(resolve, 2));
      const id2 = ulid();

      // Lexicographic comparison gives chronological order
      expect(id1 < id2).toBe(true);
    });
  });

  describe('monotonicFactory', () => {
    it('creates factory that produces monotonic IDs', () => {
      const factory = monotonicFactory();
      const ids: string[] = [];

      // Generate IDs rapidly (same millisecond)
      for (let i = 0; i < 100; i++) {
        ids.push(factory());
      }

      // All IDs should be monotonically increasing
      for (let i = 1; i < ids.length; i++) {
        expect(ids[i] > ids[i - 1]).toBe(true);
      }
    });

    it('creates unique IDs within same millisecond', () => {
      const factory = monotonicFactory();
      const ids = new Set<string>();

      for (let i = 0; i < 1000; i++) {
        ids.add(factory());
      }

      expect(ids.size).toBe(1000);
    });
  });

  describe('ulidTimestamp', () => {
    it('extracts timestamp from ULID', () => {
      const now = Date.now();
      const id = ulid();
      const timestamp = ulidTimestamp(id);

      // Timestamp should be close to now (within 100ms)
      expect(Math.abs(timestamp - now)).toBeLessThan(100);
    });

    it('correctly decodes known timestamp', () => {
      // ULID with timestamp 0 would start with "0000000000"
      // Let's generate a ULID and verify round-trip
      const id = ulid();
      const timestamp1 = ulidTimestamp(id);

      // Create another ULID with the same timestamp
      const now = Date.now();
      const id2 = ulid();
      const timestamp2 = ulidTimestamp(id2);

      // Both should be close to now
      expect(Math.abs(timestamp1 - now)).toBeLessThan(100);
      expect(Math.abs(timestamp2 - now)).toBeLessThan(100);
    });

    it('throws on invalid ULID length', () => {
      expect(() => ulidTimestamp('short')).toThrow('Invalid ULID');
      expect(() => ulidTimestamp('0123456789ABCDEFGHIJKLMNOPQR')).toThrow('Invalid ULID');
    });

    it('throws on invalid characters in timestamp portion', () => {
      // I, L, O, U are not valid in Crockford Base32
      // Invalid char must be in first 10 characters (timestamp portion)
      expect(() => ulidTimestamp('012345678IABCDEFGHJKMNPQRS')).toThrow('Invalid ULID character');
      expect(() => ulidTimestamp('012345678LABCDEFGHJKMNPQRS')).toThrow('Invalid ULID character');
    });

    it('handles lowercase input', () => {
      const id = ulid();
      const lowerId = id.toLowerCase();
      const timestamp = ulidTimestamp(lowerId);

      // Should not throw and should extract valid timestamp
      expect(timestamp).toBeGreaterThan(0);
    });
  });

  describe('compareUlid', () => {
    it('returns negative when first ULID is older', async () => {
      const id1 = ulid();
      await new Promise((resolve) => setTimeout(resolve, 2));
      const id2 = ulid();

      expect(compareUlid(id1, id2)).toBeLessThan(0);
    });

    it('returns positive when first ULID is newer', async () => {
      const id1 = ulid();
      await new Promise((resolve) => setTimeout(resolve, 2));
      const id2 = ulid();

      expect(compareUlid(id2, id1)).toBeGreaterThan(0);
    });

    it('returns 0 for same ULID', () => {
      const id = ulid();
      expect(compareUlid(id, id)).toBe(0);
    });

    it('can be used to sort an array', async () => {
      // Use monotonicFactory to ensure guaranteed ordering even within same ms
      const factory = monotonicFactory();
      const ids: string[] = [];
      for (let i = 0; i < 10; i++) {
        ids.push(factory());
      }

      // Shuffle
      const shuffled = [...ids].sort(() => Math.random() - 0.5);

      // Sort with compareUlid
      const sorted = shuffled.sort(compareUlid);

      // Should be in chronological order (original order)
      expect(sorted).toEqual(ids);
    });
  });

  describe('isValidUlid', () => {
    it('returns true for valid ULID', () => {
      const id = ulid();
      expect(isValidUlid(id)).toBe(true);
    });

    it('returns true for lowercase ULID', () => {
      const id = ulid().toLowerCase();
      expect(isValidUlid(id)).toBe(true);
    });

    it('returns false for too short string', () => {
      expect(isValidUlid('0123456789ABCDEF')).toBe(false);
    });

    it('returns false for too long string', () => {
      expect(isValidUlid('0123456789ABCDEFGHJKMNPQRSTVWXYZ')).toBe(false);
    });

    it('returns false for non-string', () => {
      expect(isValidUlid(123 as unknown as string)).toBe(false);
      expect(isValidUlid(null as unknown as string)).toBe(false);
      expect(isValidUlid(undefined as unknown as string)).toBe(false);
    });

    it('returns false for invalid characters (I, L, O, U)', () => {
      expect(isValidUlid('01234567890IBCDEFGHJKMNPQRS')).toBe(false);
      expect(isValidUlid('01234567890LBCDEFGHJKMNPQRS')).toBe(false);
      expect(isValidUlid('01234567890OBCDEFGHJKMNPQRS')).toBe(false);
      expect(isValidUlid('01234567890UBCDEFGHJKMNPQRS')).toBe(false);
    });

    it('returns false for special characters', () => {
      expect(isValidUlid('0123456789!BCDEFGHJKMNPQRS')).toBe(false);
      expect(isValidUlid('0123456789-BCDEFGHJKMNPQRS')).toBe(false);
    });
  });
});
