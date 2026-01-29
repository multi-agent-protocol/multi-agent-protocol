/**
 * Tests for Federation utilities
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  // Envelope utilities
  createFederationEnvelope,
  processFederationEnvelope,
  isEnvelopeAtDestination,
  unwrapEnvelope,
  getEnvelopeRoutingInfo,
  isValidEnvelope,
  withPayload,
  // Outage buffer
  FederationOutageBuffer,
} from '../federation';
import type { FederationEnvelope, FederationRoutingConfig, Message } from '../types';
import { ERROR_CODES } from '../types';

describe('Federation Utilities', () => {
  // ===========================================================================
  // Envelope Creation
  // ===========================================================================

  describe('createFederationEnvelope', () => {
    it('creates envelope with required fields', () => {
      const payload = { content: 'test' };
      const envelope = createFederationEnvelope(payload, 'system-a', 'system-b');

      expect(envelope.payload).toBe(payload);
      expect(envelope.federation.sourceSystem).toBe('system-a');
      expect(envelope.federation.targetSystem).toBe('system-b');
      expect(envelope.federation.hopCount).toBe(0);
      expect(envelope.federation.originTimestamp).toBeGreaterThan(0);
    });

    it('includes optional maxHops', () => {
      const envelope = createFederationEnvelope({}, 'a', 'b', { maxHops: 5 });
      expect(envelope.federation.maxHops).toBe(5);
    });

    it('tracks path when trackPath is true', () => {
      const envelope = createFederationEnvelope({}, 'system-a', 'system-b', { trackPath: true });
      expect(envelope.federation.path).toEqual(['system-a']);
    });

    it('does not track path when trackPath is false', () => {
      const envelope = createFederationEnvelope({}, 'a', 'b', { trackPath: false });
      expect(envelope.federation.path).toBeUndefined();
    });

    it('includes correlationId when provided', () => {
      const envelope = createFederationEnvelope({}, 'a', 'b', { correlationId: 'req-123' });
      expect(envelope.federation.correlationId).toBe('req-123');
    });
  });

  // ===========================================================================
  // Envelope Processing
  // ===========================================================================

  describe('processFederationEnvelope', () => {
    const baseConfig: FederationRoutingConfig = {
      systemId: 'system-relay',
      maxHops: 10,
      trackPath: true,
    };

    it('increments hop count', () => {
      const envelope = createFederationEnvelope({}, 'system-a', 'system-c');
      const result = processFederationEnvelope(envelope, baseConfig);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.envelope.federation.hopCount).toBe(1);
      }
    });

    it('adds current system to path when trackPath is true', () => {
      const envelope = createFederationEnvelope({}, 'system-a', 'system-c', { trackPath: true });
      const result = processFederationEnvelope(envelope, { ...baseConfig, trackPath: true });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.envelope.federation.path).toEqual(['system-a', 'system-relay']);
      }
    });

    it('rejects when max hops exceeded', () => {
      const envelope: FederationEnvelope<object> = {
        payload: {},
        federation: {
          sourceSystem: 'system-a',
          targetSystem: 'system-z',
          hopCount: 10,
          maxHops: 10,
          originTimestamp: Date.now(),
        },
      };
      const result = processFederationEnvelope(envelope, baseConfig);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errorCode).toBe(ERROR_CODES.FEDERATION_MAX_HOPS_EXCEEDED);
        expect(result.errorMessage).toContain('exceeded maximum');
      }
    });

    it('rejects when loop detected', () => {
      const envelope: FederationEnvelope<object> = {
        payload: {},
        federation: {
          sourceSystem: 'system-a',
          targetSystem: 'system-c',
          hopCount: 2,
          path: ['system-a', 'system-relay'], // Already visited
          originTimestamp: Date.now(),
        },
      };
      const result = processFederationEnvelope(envelope, baseConfig);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errorCode).toBe(ERROR_CODES.FEDERATION_LOOP_DETECTED);
        expect(result.errorMessage).toContain('Loop detected');
      }
    });

    it('rejects when source not in allowed sources', () => {
      const envelope = createFederationEnvelope({}, 'untrusted-system', 'system-c');
      const config: FederationRoutingConfig = {
        ...baseConfig,
        allowedSources: ['trusted-system'],
      };
      const result = processFederationEnvelope(envelope, config);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errorCode).toBe(ERROR_CODES.FEDERATION_ROUTE_REJECTED);
        expect(result.errorMessage).toContain('not in allowed sources');
      }
    });

    it('rejects when target not in allowed targets', () => {
      const envelope = createFederationEnvelope({}, 'system-a', 'blocked-target');
      const config: FederationRoutingConfig = {
        ...baseConfig,
        allowedTargets: ['approved-target'],
      };
      const result = processFederationEnvelope(envelope, config);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errorCode).toBe(ERROR_CODES.FEDERATION_ROUTE_REJECTED);
        expect(result.errorMessage).toContain('not in allowed targets');
      }
    });

    it('allows when source is in allowed sources', () => {
      const envelope = createFederationEnvelope({}, 'trusted-system', 'system-c');
      const config: FederationRoutingConfig = {
        ...baseConfig,
        allowedSources: ['trusted-system', 'another-trusted'],
      };
      const result = processFederationEnvelope(envelope, config);

      expect(result.success).toBe(true);
    });

    it('uses envelope maxHops over config maxHops', () => {
      const envelope: FederationEnvelope<object> = {
        payload: {},
        federation: {
          sourceSystem: 'system-a',
          targetSystem: 'system-c',
          hopCount: 3,
          maxHops: 3, // Envelope says max 3
          originTimestamp: Date.now(),
        },
      };
      const config: FederationRoutingConfig = {
        ...baseConfig,
        maxHops: 10, // Config allows 10
      };
      const result = processFederationEnvelope(envelope, config);

      expect(result.success).toBe(false); // Should use envelope's maxHops
    });
  });

  // ===========================================================================
  // Envelope Utilities
  // ===========================================================================

  describe('isEnvelopeAtDestination', () => {
    it('returns true when at target system', () => {
      const envelope = createFederationEnvelope({}, 'system-a', 'system-b');
      expect(isEnvelopeAtDestination(envelope, 'system-b')).toBe(true);
    });

    it('returns false when not at target system', () => {
      const envelope = createFederationEnvelope({}, 'system-a', 'system-b');
      expect(isEnvelopeAtDestination(envelope, 'system-c')).toBe(false);
    });
  });

  describe('unwrapEnvelope', () => {
    it('extracts payload from envelope', () => {
      const payload = { id: 'msg-1', content: 'hello' };
      const envelope = createFederationEnvelope(payload, 'a', 'b');
      expect(unwrapEnvelope(envelope)).toBe(payload);
    });
  });

  describe('getEnvelopeRoutingInfo', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(1000);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('extracts routing information', () => {
      const envelope: FederationEnvelope<object> = {
        payload: {},
        federation: {
          sourceSystem: 'system-a',
          targetSystem: 'system-b',
          hopCount: 2,
          path: ['system-a', 'system-relay'],
          originTimestamp: 500,
          correlationId: 'corr-123',
        },
      };

      const info = getEnvelopeRoutingInfo(envelope);

      expect(info.source).toBe('system-a');
      expect(info.target).toBe('system-b');
      expect(info.hops).toBe(2);
      expect(info.path).toEqual(['system-a', 'system-relay']);
      expect(info.age).toBe(500); // 1000 - 500
      expect(info.correlationId).toBe('corr-123');
    });
  });

  describe('isValidEnvelope', () => {
    it('returns true for valid envelope', () => {
      const envelope = createFederationEnvelope({}, 'a', 'b');
      expect(isValidEnvelope(envelope)).toBe(true);
    });

    it('returns false for null', () => {
      expect(isValidEnvelope(null)).toBe(false);
    });

    it('returns false for non-object', () => {
      expect(isValidEnvelope('string')).toBe(false);
      expect(isValidEnvelope(123)).toBe(false);
    });

    it('returns false without payload', () => {
      expect(isValidEnvelope({ federation: {} })).toBe(false);
    });

    it('returns false without federation', () => {
      expect(isValidEnvelope({ payload: {} })).toBe(false);
    });

    it('returns false with invalid federation fields', () => {
      expect(isValidEnvelope({
        payload: {},
        federation: {
          sourceSystem: 123, // Should be string
          targetSystem: 'b',
          hopCount: 0,
          originTimestamp: Date.now(),
        },
      })).toBe(false);

      expect(isValidEnvelope({
        payload: {},
        federation: {
          sourceSystem: 'a',
          targetSystem: 'b',
          hopCount: 'zero', // Should be number
          originTimestamp: Date.now(),
        },
      })).toBe(false);
    });
  });

  describe('withPayload', () => {
    it('creates new envelope with different payload', () => {
      const original = createFederationEnvelope({ type: 'old' }, 'a', 'b');
      const updated = withPayload(original, { type: 'new' });

      expect(updated.payload).toEqual({ type: 'new' });
      expect(updated.federation).toBe(original.federation);
    });

    it('preserves federation metadata', () => {
      const original = createFederationEnvelope({}, 'a', 'b', {
        trackPath: true,
        correlationId: 'test',
        maxHops: 5,
      });
      const updated = withPayload(original, { transformed: true });

      expect(updated.federation.sourceSystem).toBe('a');
      expect(updated.federation.targetSystem).toBe('b');
      expect(updated.federation.correlationId).toBe('test');
      expect(updated.federation.maxHops).toBe(5);
    });
  });

  // ===========================================================================
  // Outage Buffer
  // ===========================================================================

  describe('FederationOutageBuffer', () => {
    let buffer: FederationOutageBuffer;

    function createMessage(id: string): FederationEnvelope<Message> {
      return createFederationEnvelope(
        { id, from: 'agent-1', to: 'agent-2', content: 'test', timestamp: Date.now() },
        'system-a',
        'system-b'
      );
    }

    beforeEach(() => {
      buffer = new FederationOutageBuffer();
    });

    describe('constructor and config', () => {
      it('uses default config when none provided', () => {
        expect(buffer.enabled).toBe(true);
        expect(buffer.config.maxMessages).toBe(1000);
        expect(buffer.config.maxBytes).toBe(10 * 1024 * 1024);
        expect(buffer.config.retentionMs).toBe(60 * 60 * 1000);
        expect(buffer.config.overflowStrategy).toBe('drop-oldest');
      });

      it('merges provided config with defaults', () => {
        const customBuffer = new FederationOutageBuffer({
          maxMessages: 500,
          overflowStrategy: 'reject',
        });
        expect(customBuffer.config.maxMessages).toBe(500);
        expect(customBuffer.config.overflowStrategy).toBe('reject');
        expect(customBuffer.config.maxBytes).toBe(10 * 1024 * 1024); // Default
      });

      it('can be disabled', () => {
        const disabled = new FederationOutageBuffer({ enabled: false });
        expect(disabled.enabled).toBe(false);
        expect(disabled.enqueue('peer-1', createMessage('1'))).toBe(false);
      });
    });

    describe('enqueue', () => {
      it('buffers messages for a peer', () => {
        const msg1 = createMessage('msg-1');
        const msg2 = createMessage('msg-2');

        expect(buffer.enqueue('peer-1', msg1)).toBe(true);
        expect(buffer.enqueue('peer-1', msg2)).toBe(true);
        expect(buffer.count('peer-1')).toBe(2);
      });

      it('buffers messages for different peers separately', () => {
        buffer.enqueue('peer-1', createMessage('1'));
        buffer.enqueue('peer-2', createMessage('2'));
        buffer.enqueue('peer-1', createMessage('3'));

        expect(buffer.count('peer-1')).toBe(2);
        expect(buffer.count('peer-2')).toBe(1);
      });

      it('drops oldest when maxMessages exceeded with drop-oldest strategy', () => {
        const smallBuffer = new FederationOutageBuffer({
          maxMessages: 2,
          overflowStrategy: 'drop-oldest',
        });

        smallBuffer.enqueue('peer-1', createMessage('1'));
        smallBuffer.enqueue('peer-1', createMessage('2'));
        smallBuffer.enqueue('peer-1', createMessage('3'));

        expect(smallBuffer.count('peer-1')).toBe(2);
        const messages = smallBuffer.drain('peer-1');
        expect(messages[0].payload.id).toBe('2');
        expect(messages[1].payload.id).toBe('3');
      });

      it('rejects new when maxMessages exceeded with drop-newest strategy', () => {
        const smallBuffer = new FederationOutageBuffer({
          maxMessages: 2,
          overflowStrategy: 'drop-newest',
        });

        expect(smallBuffer.enqueue('peer-1', createMessage('1'))).toBe(true);
        expect(smallBuffer.enqueue('peer-1', createMessage('2'))).toBe(true);
        expect(smallBuffer.enqueue('peer-1', createMessage('3'))).toBe(false);

        expect(smallBuffer.count('peer-1')).toBe(2);
        const messages = smallBuffer.drain('peer-1');
        expect(messages[0].payload.id).toBe('1');
        expect(messages[1].payload.id).toBe('2');
      });

      it('rejects new when maxMessages exceeded with reject strategy', () => {
        const smallBuffer = new FederationOutageBuffer({
          maxMessages: 2,
          overflowStrategy: 'reject',
        });

        expect(smallBuffer.enqueue('peer-1', createMessage('1'))).toBe(true);
        expect(smallBuffer.enqueue('peer-1', createMessage('2'))).toBe(true);
        expect(smallBuffer.enqueue('peer-1', createMessage('3'))).toBe(false);
      });
    });

    describe('drain', () => {
      it('returns messages in FIFO order', () => {
        buffer.enqueue('peer-1', createMessage('1'));
        buffer.enqueue('peer-1', createMessage('2'));
        buffer.enqueue('peer-1', createMessage('3'));

        const messages = buffer.drain('peer-1');

        expect(messages).toHaveLength(3);
        expect(messages[0].payload.id).toBe('1');
        expect(messages[1].payload.id).toBe('2');
        expect(messages[2].payload.id).toBe('3');
      });

      it('clears buffer after drain', () => {
        buffer.enqueue('peer-1', createMessage('1'));
        buffer.drain('peer-1');

        expect(buffer.count('peer-1')).toBe(0);
        expect(buffer.drain('peer-1')).toEqual([]);
      });

      it('returns empty array for unknown peer', () => {
        expect(buffer.drain('unknown')).toEqual([]);
      });
    });

    describe('peek', () => {
      it('returns messages without removing them', () => {
        buffer.enqueue('peer-1', createMessage('1'));
        buffer.enqueue('peer-1', createMessage('2'));

        const peeked = buffer.peek('peer-1');
        expect(peeked).toHaveLength(2);

        // Still there
        expect(buffer.count('peer-1')).toBe(2);
        expect(buffer.peek('peer-1')).toHaveLength(2);
      });

      it('returns empty array for unknown peer', () => {
        expect(buffer.peek('unknown')).toEqual([]);
      });
    });

    describe('stats', () => {
      beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(1000);
      });

      afterEach(() => {
        vi.useRealTimers();
      });

      it('returns statistics for all peers', () => {
        buffer.enqueue('peer-1', createMessage('1'));

        vi.setSystemTime(1500);
        buffer.enqueue('peer-1', createMessage('2'));
        buffer.enqueue('peer-2', createMessage('3'));

        const stats = buffer.stats();

        expect(stats.size).toBe(2);

        const peer1Stats = stats.get('peer-1')!;
        expect(peer1Stats.count).toBe(2);
        expect(peer1Stats.totalEnqueued).toBe(2);
        expect(peer1Stats.oldestAge).toBe(500); // 1500 - 1000

        const peer2Stats = stats.get('peer-2')!;
        expect(peer2Stats.count).toBe(1);
        expect(peer2Stats.oldestAge).toBe(0);
      });
    });

    describe('expiration', () => {
      beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
      });

      afterEach(() => {
        vi.useRealTimers();
      });

      it('evicts expired messages on count', () => {
        const shortRetention = new FederationOutageBuffer({
          retentionMs: 1000,
        });

        shortRetention.enqueue('peer-1', createMessage('1'));

        vi.setSystemTime(500);
        shortRetention.enqueue('peer-1', createMessage('2'));

        vi.setSystemTime(1500); // First message expired

        expect(shortRetention.count('peer-1')).toBe(1);
      });

      it('evicts expired messages on drain', () => {
        const shortRetention = new FederationOutageBuffer({
          retentionMs: 1000,
        });

        shortRetention.enqueue('peer-1', createMessage('1'));

        vi.setSystemTime(500);
        shortRetention.enqueue('peer-1', createMessage('2'));

        vi.setSystemTime(1500);

        const messages = shortRetention.drain('peer-1');
        expect(messages).toHaveLength(1);
        expect(messages[0].payload.id).toBe('2');
      });

      it('tracks dropped messages in stats', () => {
        const shortRetention = new FederationOutageBuffer({
          retentionMs: 1000,
        });

        shortRetention.enqueue('peer-1', createMessage('1'));
        shortRetention.enqueue('peer-1', createMessage('2'));

        vi.setSystemTime(1500);

        const stats = shortRetention.stats();
        const peer1Stats = stats.get('peer-1')!;
        expect(peer1Stats.totalDropped).toBe(2);
      });
    });

    describe('has', () => {
      it('returns true when buffer has messages', () => {
        buffer.enqueue('peer-1', createMessage('1'));
        expect(buffer.has('peer-1')).toBe(true);
      });

      it('returns false when buffer is empty', () => {
        expect(buffer.has('peer-1')).toBe(false);
      });

      it('returns false for unknown peer', () => {
        expect(buffer.has('unknown')).toBe(false);
      });
    });

    describe('clear', () => {
      it('clears buffer for specific peer', () => {
        buffer.enqueue('peer-1', createMessage('1'));
        buffer.enqueue('peer-2', createMessage('2'));

        buffer.clear('peer-1');

        expect(buffer.has('peer-1')).toBe(false);
        expect(buffer.has('peer-2')).toBe(true);
      });
    });

    describe('clearAll', () => {
      it('clears all buffers', () => {
        buffer.enqueue('peer-1', createMessage('1'));
        buffer.enqueue('peer-2', createMessage('2'));

        buffer.clearAll();

        expect(buffer.has('peer-1')).toBe(false);
        expect(buffer.has('peer-2')).toBe(false);
      });
    });

    describe('peers', () => {
      it('returns list of peers with buffered messages', () => {
        buffer.enqueue('peer-1', createMessage('1'));
        buffer.enqueue('peer-2', createMessage('2'));

        const peers = buffer.peers();

        expect(peers).toContain('peer-1');
        expect(peers).toContain('peer-2');
        expect(peers).toHaveLength(2);
      });

      it('excludes peers with empty buffers', () => {
        buffer.enqueue('peer-1', createMessage('1'));
        buffer.enqueue('peer-2', createMessage('2'));
        buffer.drain('peer-1');

        const peers = buffer.peers();

        expect(peers).not.toContain('peer-1');
        expect(peers).toContain('peer-2');
      });
    });
  });
});
