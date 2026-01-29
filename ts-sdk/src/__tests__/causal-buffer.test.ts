/**
 * Tests for CausalEventBuffer
 */

import { describe, it, expect, vi } from 'vitest';
import {
  CausalEventBuffer,
  validateCausalOrder,
  sortCausalOrder,
  type CausalEvent,
} from '../utils/causal-buffer';

function createEvent(
  eventId: string,
  causedBy?: string[],
  type: string = 'test'
): CausalEvent {
  return {
    eventId,
    causedBy,
    event: { id: eventId, type, timestamp: Date.now() },
  };
}

describe('CausalEventBuffer', () => {
  describe('basic functionality', () => {
    it('should release events without dependencies immediately', () => {
      const buffer = new CausalEventBuffer();

      const result = buffer.push(createEvent('A'));

      expect(result.ready).toHaveLength(1);
      expect(result.ready[0].eventId).toBe('A');
      expect(result.pending).toBe(0);
    });

    it('should hold events waiting for predecessors', () => {
      const buffer = new CausalEventBuffer();

      const result = buffer.push(createEvent('B', ['A']));

      expect(result.ready).toHaveLength(0);
      expect(result.pending).toBe(1);
    });

    it('should release dependent event when predecessor arrives', () => {
      const buffer = new CausalEventBuffer();

      // B depends on A, but arrives first
      buffer.push(createEvent('B', ['A']));

      // A arrives
      const result = buffer.push(createEvent('A'));

      expect(result.ready).toHaveLength(2);
      expect(result.ready[0].eventId).toBe('A');
      expect(result.ready[1].eventId).toBe('B');
      expect(result.pending).toBe(0);
    });

    it('should handle chain of dependencies', () => {
      const buffer = new CausalEventBuffer();

      // Push in reverse order: C depends on B, B depends on A
      buffer.push(createEvent('C', ['B']));
      buffer.push(createEvent('B', ['A']));

      expect(buffer.pendingCount).toBe(2);

      // A arrives, should release all
      const result = buffer.push(createEvent('A'));

      expect(result.ready).toHaveLength(3);
      expect(result.ready.map((e) => e.eventId)).toEqual(['A', 'B', 'C']);
      expect(result.pending).toBe(0);
    });

    it('should handle multiple predecessors', () => {
      const buffer = new CausalEventBuffer();

      // C depends on both A and B
      buffer.push(createEvent('C', ['A', 'B']));

      // A arrives
      let result = buffer.push(createEvent('A'));
      expect(result.ready).toHaveLength(1);
      expect(result.ready[0].eventId).toBe('A');
      expect(result.pending).toBe(1); // C still waiting for B

      // B arrives
      result = buffer.push(createEvent('B'));
      expect(result.ready).toHaveLength(2);
      expect(result.ready.map((e) => e.eventId)).toEqual(['B', 'C']);
      expect(result.pending).toBe(0);
    });

    it('should handle diamond dependency pattern', () => {
      const buffer = new CausalEventBuffer();

      // D depends on B and C, both depend on A
      buffer.push(createEvent('D', ['B', 'C']));
      buffer.push(createEvent('B', ['A']));
      buffer.push(createEvent('C', ['A']));

      expect(buffer.pendingCount).toBe(3);

      // A arrives
      const result = buffer.push(createEvent('A'));

      expect(result.ready).toHaveLength(4);
      // A must come first, then B and C (either order), then D
      expect(result.ready[0].eventId).toBe('A');
      expect(['B', 'C']).toContain(result.ready[1].eventId);
      expect(['B', 'C']).toContain(result.ready[2].eventId);
      expect(result.ready[3].eventId).toBe('D');
    });
  });

  describe('deduplication', () => {
    it('should ignore duplicate events', () => {
      const buffer = new CausalEventBuffer();

      buffer.push(createEvent('A'));
      const result = buffer.push(createEvent('A'));

      expect(result.ready).toHaveLength(0);
      expect(buffer.seenCount).toBe(1);
    });

    it('should track seen events', () => {
      const buffer = new CausalEventBuffer();

      buffer.push(createEvent('A'));
      buffer.push(createEvent('B'));

      expect(buffer.hasSeen('A')).toBe(true);
      expect(buffer.hasSeen('B')).toBe(true);
      expect(buffer.hasSeen('C')).toBe(false);
    });
  });

  describe('timeout handling', () => {
    it('should force release events after timeout', async () => {
      const onForcedRelease = vi.fn();
      const buffer = new CausalEventBuffer({
        maxWaitTime: 50,
        onForcedRelease,
      });

      // B depends on A which never arrives
      // Set receivedAt far in the past to ensure immediate timeout
      const pastTime = Date.now() - 1000;
      const result = buffer.push({
        eventId: 'B',
        causedBy: ['A'],
        event: { id: 'B', type: 'test', timestamp: pastTime },
        receivedAt: pastTime,
      });

      // B should be force-released immediately due to timeout
      expect(result.ready.some((e) => e.eventId === 'B')).toBe(true);
      expect(onForcedRelease).toHaveBeenCalledWith(
        expect.objectContaining({ eventId: 'B' }),
        ['A']
      );
      expect(buffer.pendingCount).toBe(0);
    });

    it('should not timeout with maxWaitTime = 0', () => {
      const buffer = new CausalEventBuffer({ maxWaitTime: 0 });

      buffer.push({
        ...createEvent('B', ['A']),
        receivedAt: Date.now() - 10000,
      });

      const result = buffer.push(createEvent('C'));

      expect(result.ready).toHaveLength(1);
      expect(result.ready[0].eventId).toBe('C');
      expect(buffer.pendingCount).toBe(1);
    });
  });

  describe('buffer overflow', () => {
    it('should force release oldest events when buffer overflows', () => {
      const onForcedRelease = vi.fn();
      const buffer = new CausalEventBuffer({
        maxBufferSize: 3,
        maxWaitTime: Infinity,
        onForcedRelease,
      });

      // Add 4 events that all depend on 'X' (which never arrives)
      buffer.push({ ...createEvent('A', ['X']), receivedAt: 1 });
      buffer.push({ ...createEvent('B', ['X']), receivedAt: 2 });
      buffer.push({ ...createEvent('C', ['X']), receivedAt: 3 });

      expect(buffer.pendingCount).toBe(3);

      // Adding D should force release A (oldest)
      const result = buffer.push({ ...createEvent('D', ['X']), receivedAt: 4 });

      expect(result.ready.some((e) => e.eventId === 'A')).toBe(true);
      expect(buffer.pendingCount).toBe(3); // B, C, D
      expect(onForcedRelease).toHaveBeenCalled();
    });
  });

  describe('flush', () => {
    it('should release all pending events', () => {
      const buffer = new CausalEventBuffer({ maxWaitTime: Infinity });

      buffer.push(createEvent('B', ['A']));
      buffer.push(createEvent('C', ['A']));

      expect(buffer.pendingCount).toBe(2);

      const flushed = buffer.flush();

      expect(flushed).toHaveLength(2);
      expect(buffer.pendingCount).toBe(0);
    });

    it('should call onForcedRelease for events with missing predecessors', () => {
      const onForcedRelease = vi.fn();
      const buffer = new CausalEventBuffer({
        maxWaitTime: Infinity,
        onForcedRelease,
      });

      buffer.push(createEvent('B', ['A']));
      buffer.flush();

      expect(onForcedRelease).toHaveBeenCalledWith(
        expect.objectContaining({ eventId: 'B' }),
        ['A']
      );
    });
  });

  describe('clear', () => {
    it('should reset all state', () => {
      const buffer = new CausalEventBuffer();

      buffer.push(createEvent('A'));
      buffer.push(createEvent('B', ['X']));

      buffer.clear();

      expect(buffer.seenCount).toBe(0);
      expect(buffer.pendingCount).toBe(0);
      expect(buffer.hasSeen('A')).toBe(false);
    });
  });
});

describe('validateCausalOrder', () => {
  it('should return true for valid causal order', () => {
    const events = [
      createEvent('A'),
      createEvent('B', ['A']),
      createEvent('C', ['B']),
    ];

    expect(validateCausalOrder(events)).toBe(true);
  });

  it('should return true for events with no dependencies', () => {
    const events = [
      createEvent('A'),
      createEvent('B'),
      createEvent('C'),
    ];

    expect(validateCausalOrder(events)).toBe(true);
  });

  it('should return false when predecessor comes after dependent', () => {
    const events = [
      createEvent('B', ['A']),
      createEvent('A'), // Should come before B
    ];

    expect(validateCausalOrder(events)).toBe(false);
  });

  it('should return false when predecessor is missing', () => {
    const events = [
      createEvent('B', ['X']), // X doesn't exist
    ];

    expect(validateCausalOrder(events)).toBe(false);
  });

  it('should handle multiple predecessors', () => {
    const validOrder = [
      createEvent('A'),
      createEvent('B'),
      createEvent('C', ['A', 'B']),
    ];
    expect(validateCausalOrder(validOrder)).toBe(true);

    const invalidOrder = [
      createEvent('A'),
      createEvent('C', ['A', 'B']), // B not seen yet
      createEvent('B'),
    ];
    expect(validateCausalOrder(invalidOrder)).toBe(false);
  });
});

describe('sortCausalOrder', () => {
  it('should sort events into causal order', () => {
    const unordered = [
      createEvent('C', ['B']),
      createEvent('A'),
      createEvent('B', ['A']),
    ];

    const sorted = sortCausalOrder(unordered);

    expect(sorted.map((e) => e.eventId)).toEqual(['A', 'B', 'C']);
  });

  it('should handle events with no dependencies', () => {
    const events = [
      createEvent('C'),
      createEvent('A'),
      createEvent('B'),
    ];

    const sorted = sortCausalOrder(events);

    // All events should be present (order may vary since no deps)
    expect(sorted).toHaveLength(3);
    expect(sorted.map((e) => e.eventId).sort()).toEqual(['A', 'B', 'C']);
  });

  it('should handle diamond dependency pattern', () => {
    const unordered = [
      createEvent('D', ['B', 'C']),
      createEvent('C', ['A']),
      createEvent('B', ['A']),
      createEvent('A'),
    ];

    const sorted = sortCausalOrder(unordered);

    // A must come first, D must come last
    expect(sorted[0].eventId).toBe('A');
    expect(sorted[3].eventId).toBe('D');
    // B and C must come before D
    const bIndex = sorted.findIndex((e) => e.eventId === 'B');
    const cIndex = sorted.findIndex((e) => e.eventId === 'C');
    expect(bIndex).toBeLessThan(3);
    expect(cIndex).toBeLessThan(3);
  });

  it('should throw on cycle', () => {
    const cyclic = [
      createEvent('A', ['B']),
      createEvent('B', ['A']),
    ];

    expect(() => sortCausalOrder(cyclic)).toThrow(/[Cc]ycle/);
  });

  it('should throw on missing predecessor', () => {
    const missing = [
      createEvent('B', ['X']), // X doesn't exist
    ];

    expect(() => sortCausalOrder(missing)).toThrow(/[Mm]issing/);
  });
});
