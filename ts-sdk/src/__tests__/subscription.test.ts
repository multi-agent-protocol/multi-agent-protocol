/**
 * Tests for Subscription class
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSubscription, Subscription } from '../subscription';
import type { EventNotificationParams, Event } from '../types';

describe('Subscription', () => {
  let subscription: Subscription;
  let unsubscribeFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    unsubscribeFn = vi.fn().mockResolvedValue(undefined);
    subscription = createSubscription('sub-123', unsubscribeFn, {
      filter: { eventTypes: ['agent.registered'] },
    });
  });

  afterEach(async () => {
    if (!subscription.isClosed) {
      subscription._close();
    }
  });

  describe('properties', () => {
    it('has correct id', () => {
      expect(subscription.id).toBe('sub-123');
    });

    it('has correct filter', () => {
      expect(subscription.filter).toEqual({ eventTypes: ['agent.registered'] });
    });

    it('starts as not closed', () => {
      expect(subscription.isClosed).toBe(false);
    });

    it('has zero buffered events initially', () => {
      expect(subscription.bufferedCount).toBe(0);
    });

    it('has -1 lastSequenceNumber initially', () => {
      expect(subscription.lastSequenceNumber).toBe(-1);
    });
  });

  describe('unsubscribe', () => {
    it('calls unsubscribe function', async () => {
      await subscription.unsubscribe();

      expect(unsubscribeFn).toHaveBeenCalledTimes(1);
    });

    it('marks subscription as closed', async () => {
      await subscription.unsubscribe();

      expect(subscription.isClosed).toBe(true);
    });

    it('is idempotent', async () => {
      await subscription.unsubscribe();
      await subscription.unsubscribe();

      expect(unsubscribeFn).toHaveBeenCalledTimes(1);
    });
  });

  describe('event emitter pattern', () => {
    it('calls event handlers when events are pushed', () => {
      const handler = vi.fn();
      subscription.on('event', handler);

      const event: Event = {
        type: 'agent.registered',
        timestamp: Date.now(),
        data: { agentId: 'agent-1' },
      };

      const params: EventNotificationParams = {
        subscriptionId: 'sub-123',
        sequenceNumber: 0,
        event,
      };

      subscription._pushEvent(params);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(event);
    });

    it('supports multiple handlers', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      subscription.on('event', handler1);
      subscription.on('event', handler2);

      const event: Event = {
        type: 'agent.registered',
        timestamp: Date.now(),
      };

      subscription._pushEvent({
        subscriptionId: 'sub-123',
        sequenceNumber: 0,
        event,
      });

      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);
    });

    it('can remove handlers with off', () => {
      const handler = vi.fn();

      subscription.on('event', handler);
      subscription.off('event', handler);

      subscription._pushEvent({
        subscriptionId: 'sub-123',
        sequenceNumber: 0,
        event: {
          type: 'agent.registered',
          timestamp: Date.now(),
        },
      });

      expect(handler).not.toHaveBeenCalled();
    });

    it('supports once for one-time handlers', () => {
      const handler = vi.fn();

      subscription.once('event', handler);

      subscription._pushEvent({
        subscriptionId: 'sub-123',
        sequenceNumber: 0,
        event: { type: 'agent.registered', timestamp: Date.now() },
      });

      subscription._pushEvent({
        subscriptionId: 'sub-123',
        sequenceNumber: 1,
        event: { type: 'agent.registered', timestamp: Date.now() },
      });

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('supports chaining on calls', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      const result = subscription.on('event', handler1).on('event', handler2);

      expect(result).toBe(subscription);
    });
  });

  describe('async iterable pattern', () => {
    it('can be iterated with for-await-of', async () => {
      const events: EventNotificationParams[] = [
        {
          subscriptionId: 'sub-123',
          sequenceNumber: 0,
          event: { type: 'agent.registered', timestamp: 1 },
        },
        {
          subscriptionId: 'sub-123',
          sequenceNumber: 1,
          event: { type: 'agent.state-changed', timestamp: 2 },
        },
      ];

      // Push events and close
      for (const event of events) {
        subscription._pushEvent(event);
      }
      subscription._close();

      // Collect via async iteration
      const received: Event[] = [];
      for await (const event of subscription) {
        received.push(event);
      }

      expect(received).toHaveLength(2);
      expect(received[0].type).toBe('agent.registered');
      expect(received[1].type).toBe('agent.state-changed');
    });

    it('blocks until event is available', async () => {
      const iteratorPromise = (async () => {
        const iterator = subscription[Symbol.asyncIterator]();
        return iterator.next();
      })();

      // Push event after a small delay
      await new Promise((resolve) => setTimeout(resolve, 10));

      const event: Event = { type: 'agent.registered', timestamp: Date.now() };
      subscription._pushEvent({
        subscriptionId: 'sub-123',
        sequenceNumber: 0,
        event,
      });

      const result = await iteratorPromise;

      expect(result.done).toBe(false);
      expect(result.value.type).toBe('agent.registered');
    });

    it('returns done when closed', async () => {
      subscription._close();

      const iterator = subscription[Symbol.asyncIterator]();
      const result = await iterator.next();

      expect(result.done).toBe(true);
    });

    it('handles events pushed before iteration starts', async () => {
      const event: Event = { type: 'agent.registered', timestamp: Date.now() };

      // Push before starting iteration
      subscription._pushEvent({
        subscriptionId: 'sub-123',
        sequenceNumber: 0,
        event,
      });
      subscription._close();

      const received: Event[] = [];
      for await (const e of subscription) {
        received.push(e);
      }

      expect(received).toHaveLength(1);
    });
  });

  describe('sequence tracking', () => {
    it('tracks event sequence numbers', () => {
      const events: EventNotificationParams[] = [
        { subscriptionId: 'sub-123', sequenceNumber: 0, event: { type: 'agent.registered', timestamp: 1 } },
        { subscriptionId: 'sub-123', sequenceNumber: 1, event: { type: 'agent.registered', timestamp: 2 } },
        { subscriptionId: 'sub-123', sequenceNumber: 2, event: { type: 'agent.registered', timestamp: 3 } },
      ];

      for (const event of events) {
        subscription._pushEvent(event);
      }

      expect(subscription.lastSequenceNumber).toBe(2);
    });

    it('logs warning on sequence gaps', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      subscription._pushEvent({
        subscriptionId: 'sub-123',
        sequenceNumber: 0,
        event: { type: 'agent.registered', timestamp: 1 },
      });

      // Skip sequence 1
      subscription._pushEvent({
        subscriptionId: 'sub-123',
        sequenceNumber: 2,
        event: { type: 'agent.registered', timestamp: 3 },
      });

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('buffering', () => {
    it('buffers events when no iterator waiting', () => {
      subscription._pushEvent({
        subscriptionId: 'sub-123',
        sequenceNumber: 0,
        event: { type: 'agent.registered', timestamp: 1 },
      });

      subscription._pushEvent({
        subscriptionId: 'sub-123',
        sequenceNumber: 1,
        event: { type: 'agent.registered', timestamp: 2 },
      });

      expect(subscription.bufferedCount).toBe(2);
    });

    it('respects buffer size limit', () => {
      const smallBufferSub = createSubscription('sub-small', unsubscribeFn, {
        bufferSize: 2,
      });

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // Push 3 events to a buffer of size 2
      smallBufferSub._pushEvent({ subscriptionId: 'sub-small', sequenceNumber: 0, event: { type: 'agent.registered', timestamp: 1 } });
      smallBufferSub._pushEvent({ subscriptionId: 'sub-small', sequenceNumber: 1, event: { type: 'agent.registered', timestamp: 2 } });
      smallBufferSub._pushEvent({ subscriptionId: 'sub-small', sequenceNumber: 2, event: { type: 'agent.registered', timestamp: 3 } });

      expect(smallBufferSub.bufferedCount).toBe(2); // Third was dropped
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
      smallBufferSub._close();
    });
  });

  describe('edge cases', () => {
    it('does not emit events after close', () => {
      const handler = vi.fn();
      subscription.on('event', handler);

      subscription._close();

      subscription._pushEvent({
        subscriptionId: 'sub-123',
        sequenceNumber: 0,
        event: { type: 'agent.registered', timestamp: Date.now() },
      });

      expect(handler).not.toHaveBeenCalled();
    });

    it('handles rapid event pushing', () => {
      const handler = vi.fn();
      subscription.on('event', handler);

      // Push many events rapidly
      for (let i = 0; i < 100; i++) {
        subscription._pushEvent({
          subscriptionId: 'sub-123',
          sequenceNumber: i,
          event: { type: 'agent.registered', timestamp: i },
        });
      }

      expect(handler).toHaveBeenCalledTimes(100);
    });

    it('catches and logs handler errors', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      subscription.on('event', () => {
        throw new Error('handler error');
      });

      subscription._pushEvent({
        subscriptionId: 'sub-123',
        sequenceNumber: 0,
        event: { type: 'agent.registered', timestamp: Date.now() },
      });

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });
});
