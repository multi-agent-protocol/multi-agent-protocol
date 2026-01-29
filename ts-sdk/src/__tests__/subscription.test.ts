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

  describe('deduplication', () => {
    it('deduplicates events with same eventId', () => {
      const handler = vi.fn();
      subscription.on('event', handler);

      const eventId = 'evt-12345';
      const params: EventNotificationParams = {
        subscriptionId: 'sub-123',
        sequenceNumber: 0,
        eventId,
        timestamp: Date.now(),
        event: { type: 'agent.registered', timestamp: Date.now() },
      };

      // Push same event twice
      subscription._pushEvent(params);
      subscription._pushEvent({ ...params, sequenceNumber: 1 });

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('processes events without eventId (no deduplication)', () => {
      const handler = vi.fn();
      subscription.on('event', handler);

      // Events without eventId are not deduplicated
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

      expect(handler).toHaveBeenCalledTimes(2);
    });

    it('tracks lastEventId when eventId is provided', () => {
      subscription._pushEvent({
        subscriptionId: 'sub-123',
        sequenceNumber: 0,
        eventId: 'evt-first',
        event: { type: 'agent.registered', timestamp: 1 },
      });

      subscription._pushEvent({
        subscriptionId: 'sub-123',
        sequenceNumber: 1,
        eventId: 'evt-second',
        event: { type: 'agent.registered', timestamp: 2 },
      });

      expect(subscription.lastEventId).toBe('evt-second');
    });

    it('tracks lastTimestamp when timestamp is provided', () => {
      subscription._pushEvent({
        subscriptionId: 'sub-123',
        sequenceNumber: 0,
        timestamp: 1000,
        event: { type: 'agent.registered', timestamp: 1000 },
      });

      subscription._pushEvent({
        subscriptionId: 'sub-123',
        sequenceNumber: 1,
        timestamp: 2000,
        event: { type: 'agent.registered', timestamp: 2000 },
      });

      expect(subscription.lastTimestamp).toBe(2000);
    });

    it('tracks seen eventId count', () => {
      expect(subscription.trackedEventIdCount).toBe(0);

      subscription._pushEvent({
        subscriptionId: 'sub-123',
        sequenceNumber: 0,
        eventId: 'evt-1',
        event: { type: 'agent.registered', timestamp: 1 },
      });

      subscription._pushEvent({
        subscriptionId: 'sub-123',
        sequenceNumber: 1,
        eventId: 'evt-2',
        event: { type: 'agent.registered', timestamp: 2 },
      });

      expect(subscription.trackedEventIdCount).toBe(2);
    });

    it('evicts old eventIds when limit is reached (LRU)', () => {
      const smallCacheSub = createSubscription('sub-lru', unsubscribeFn, {
        maxSeenEventIds: 3,
      });

      const handler = vi.fn();
      smallCacheSub.on('event', handler);

      // Push 5 events with unique IDs
      for (let i = 0; i < 5; i++) {
        smallCacheSub._pushEvent({
          subscriptionId: 'sub-lru',
          sequenceNumber: i,
          eventId: `evt-${i}`,
          event: { type: 'agent.registered', timestamp: i },
        });
      }

      // Should have 5 events delivered
      expect(handler).toHaveBeenCalledTimes(5);

      // Should only track 3 eventIds (limit)
      expect(smallCacheSub.trackedEventIdCount).toBe(3);

      // evt-0 and evt-1 should have been evicted, so re-sending evt-0 should work
      smallCacheSub._pushEvent({
        subscriptionId: 'sub-lru',
        sequenceNumber: 5,
        eventId: 'evt-0',
        event: { type: 'agent.registered', timestamp: 100 },
      });

      expect(handler).toHaveBeenCalledTimes(6); // evt-0 delivered again

      // evt-4 should still be tracked, so re-sending should be deduplicated
      smallCacheSub._pushEvent({
        subscriptionId: 'sub-lru',
        sequenceNumber: 6,
        eventId: 'evt-4',
        event: { type: 'agent.registered', timestamp: 101 },
      });

      expect(handler).toHaveBeenCalledTimes(6); // evt-4 deduplicated

      smallCacheSub._close();
    });

    it('clears tracking on unsubscribe', async () => {
      subscription._pushEvent({
        subscriptionId: 'sub-123',
        sequenceNumber: 0,
        eventId: 'evt-1',
        event: { type: 'agent.registered', timestamp: 1 },
      });

      expect(subscription.trackedEventIdCount).toBe(1);

      await subscription.unsubscribe();

      expect(subscription.trackedEventIdCount).toBe(0);
    });
  });

  // ===========================================================================
  // Pause/Resume (Phase 2 - STREAM-004)
  // ===========================================================================

  describe('pause/resume', () => {
    it('starts in active state', () => {
      expect(subscription.state).toBe('active');
      expect(subscription.isPaused).toBe(false);
    });

    it('pause() sets state to paused', () => {
      subscription.pause();

      expect(subscription.state).toBe('paused');
      expect(subscription.isPaused).toBe(true);
    });

    it('resume() sets state to active', () => {
      subscription.pause();
      subscription.resume();

      expect(subscription.state).toBe('active');
      expect(subscription.isPaused).toBe(false);
    });

    it('pause() is idempotent', () => {
      subscription.pause();
      subscription.pause();

      expect(subscription.state).toBe('paused');
    });

    it('resume() is idempotent', () => {
      subscription.resume();
      subscription.resume();

      expect(subscription.state).toBe('active');
    });

    it('pause() is no-op when closed', async () => {
      await subscription.unsubscribe();
      subscription.pause();

      expect(subscription.state).toBe('closed');
    });

    it('resume() is no-op when closed', async () => {
      subscription.pause();
      await subscription.unsubscribe();
      subscription.resume();

      expect(subscription.state).toBe('closed');
    });

    it('event handlers still receive events when paused', () => {
      const handler = vi.fn();
      subscription.on('event', handler);
      subscription.pause();

      subscription._pushEvent({
        subscriptionId: 'sub-123',
        sequenceNumber: 0,
        event: { type: 'agent.registered', timestamp: Date.now() },
      });

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('events are buffered when paused', () => {
      subscription.pause();

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

    it('async iterator waits while paused and resumes', async () => {
      const events: Event[] = [];
      let iteratorDone = false;

      // Start consuming
      const iteratorPromise = (async () => {
        for await (const event of subscription) {
          events.push(event);
        }
        iteratorDone = true;
      })();

      // Push first event
      await new Promise((resolve) => setTimeout(resolve, 10));
      subscription._pushEvent({
        subscriptionId: 'sub-123',
        sequenceNumber: 0,
        event: { type: 'agent.registered', timestamp: 1 },
      });

      // Wait for first event to be received
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(events).toHaveLength(1);

      // Pause
      subscription.pause();

      // Push event while paused (will be buffered)
      subscription._pushEvent({
        subscriptionId: 'sub-123',
        sequenceNumber: 1,
        event: { type: 'agent.registered', timestamp: 2 },
      });

      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(events).toHaveLength(1); // Still 1, iterator is waiting

      // Resume
      subscription.resume();

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(events).toHaveLength(2); // Now received

      // Close
      subscription._close();
      await iteratorPromise;

      expect(iteratorDone).toBe(true);
    });

    it('close while paused properly terminates iterator', async () => {
      const events: Event[] = [];

      // Start consuming
      const iteratorPromise = (async () => {
        for await (const event of subscription) {
          events.push(event);
        }
      })();

      subscription.pause();
      await new Promise((resolve) => setTimeout(resolve, 10));

      subscription._close();
      await iteratorPromise;

      expect(subscription.isClosed).toBe(true);
    });
  });

  // ===========================================================================
  // Overflow Handling (Phase 2 - STREAM-005)
  // ===========================================================================

  describe('overflow handling', () => {
    it('tracks totalDropped count', () => {
      const smallBufferSub = createSubscription('sub-small', unsubscribeFn, {
        bufferSize: 2,
      });

      expect(smallBufferSub.totalDropped).toBe(0);

      // Fill buffer
      smallBufferSub._pushEvent({ subscriptionId: 'sub-small', sequenceNumber: 0, event: { type: 'agent.registered', timestamp: 1 } });
      smallBufferSub._pushEvent({ subscriptionId: 'sub-small', sequenceNumber: 1, event: { type: 'agent.registered', timestamp: 2 } });

      // Overflow
      smallBufferSub._pushEvent({ subscriptionId: 'sub-small', sequenceNumber: 2, event: { type: 'agent.registered', timestamp: 3 } });
      smallBufferSub._pushEvent({ subscriptionId: 'sub-small', sequenceNumber: 3, event: { type: 'agent.registered', timestamp: 4 } });

      expect(smallBufferSub.totalDropped).toBe(2);

      smallBufferSub._close();
    });

    it('calls overflow handlers when buffer is full', () => {
      const smallBufferSub = createSubscription('sub-small', unsubscribeFn, {
        bufferSize: 2,
      });

      const overflowHandler = vi.fn();
      smallBufferSub.on('overflow', overflowHandler);

      // Fill buffer
      smallBufferSub._pushEvent({ subscriptionId: 'sub-small', sequenceNumber: 0, event: { type: 'agent.registered', timestamp: 1 } });
      smallBufferSub._pushEvent({ subscriptionId: 'sub-small', sequenceNumber: 1, event: { type: 'agent.registered', timestamp: 2 } });

      expect(overflowHandler).not.toHaveBeenCalled();

      // Overflow
      smallBufferSub._pushEvent({ subscriptionId: 'sub-small', sequenceNumber: 2, eventId: 'evt-overflow', event: { type: 'agent.registered', timestamp: 3 } });

      expect(overflowHandler).toHaveBeenCalledTimes(1);
      expect(overflowHandler).toHaveBeenCalledWith(expect.objectContaining({
        eventsDropped: 1,
        totalDropped: 1,
        newestDroppedId: 'evt-overflow',
      }));

      smallBufferSub._close();
    });

    it('tracks oldest and newest dropped eventIds', () => {
      const smallBufferSub = createSubscription('sub-small', unsubscribeFn, {
        bufferSize: 1,
      });

      const overflowHandler = vi.fn();
      smallBufferSub.on('overflow', overflowHandler);

      // Fill buffer
      smallBufferSub._pushEvent({ subscriptionId: 'sub-small', sequenceNumber: 0, event: { type: 'agent.registered', timestamp: 1 } });

      // First overflow
      smallBufferSub._pushEvent({ subscriptionId: 'sub-small', sequenceNumber: 1, eventId: 'evt-first', event: { type: 'agent.registered', timestamp: 2 } });

      expect(overflowHandler).toHaveBeenLastCalledWith(expect.objectContaining({
        oldestDroppedId: 'evt-first',
        newestDroppedId: 'evt-first',
      }));

      // Second overflow
      smallBufferSub._pushEvent({ subscriptionId: 'sub-small', sequenceNumber: 2, eventId: 'evt-second', event: { type: 'agent.registered', timestamp: 3 } });

      expect(overflowHandler).toHaveBeenLastCalledWith(expect.objectContaining({
        oldestDroppedId: 'evt-first',
        newestDroppedId: 'evt-second',
        totalDropped: 2,
      }));

      smallBufferSub._close();
    });

    it('can remove overflow handlers with off', () => {
      const smallBufferSub = createSubscription('sub-small', unsubscribeFn, {
        bufferSize: 1,
      });

      const overflowHandler = vi.fn();
      smallBufferSub.on('overflow', overflowHandler);
      smallBufferSub.off('overflow', overflowHandler);

      // Fill buffer
      smallBufferSub._pushEvent({ subscriptionId: 'sub-small', sequenceNumber: 0, event: { type: 'agent.registered', timestamp: 1 } });
      // Overflow
      smallBufferSub._pushEvent({ subscriptionId: 'sub-small', sequenceNumber: 1, event: { type: 'agent.registered', timestamp: 2 } });

      expect(overflowHandler).not.toHaveBeenCalled();

      smallBufferSub._close();
    });

    it('catches overflow handler errors', () => {
      const smallBufferSub = createSubscription('sub-small', unsubscribeFn, {
        bufferSize: 1,
      });

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      smallBufferSub.on('overflow', () => {
        throw new Error('overflow handler error');
      });

      // Fill buffer
      smallBufferSub._pushEvent({ subscriptionId: 'sub-small', sequenceNumber: 0, event: { type: 'agent.registered', timestamp: 1 } });
      // Overflow
      smallBufferSub._pushEvent({ subscriptionId: 'sub-small', sequenceNumber: 1, event: { type: 'agent.registered', timestamp: 2 } });

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();

      smallBufferSub._close();
    });

    it('overflow info includes timestamp', () => {
      const smallBufferSub = createSubscription('sub-small', unsubscribeFn, {
        bufferSize: 1,
      });

      const overflowHandler = vi.fn();
      smallBufferSub.on('overflow', overflowHandler);

      const beforeTime = Date.now();

      // Fill and overflow
      smallBufferSub._pushEvent({ subscriptionId: 'sub-small', sequenceNumber: 0, event: { type: 'agent.registered', timestamp: 1 } });
      smallBufferSub._pushEvent({ subscriptionId: 'sub-small', sequenceNumber: 1, event: { type: 'agent.registered', timestamp: 2 } });

      const afterTime = Date.now();

      const overflowInfo = overflowHandler.mock.calls[0][0];
      expect(overflowInfo.timestamp).toBeGreaterThanOrEqual(beforeTime);
      expect(overflowInfo.timestamp).toBeLessThanOrEqual(afterTime);

      smallBufferSub._close();
    });
  });

  // ===========================================================================
  // Acknowledgment Support (Phase 2 - STREAM-006)
  // ===========================================================================

  describe('acknowledgment support', () => {
    it('supportsAck is false by default', () => {
      expect(subscription.supportsAck).toBe(false);
    });

    it('supportsAck is false when sendAck is provided but server does not support', () => {
      const sendAck = vi.fn();
      const subWithAck = createSubscription('sub-ack', unsubscribeFn, {}, sendAck);

      expect(subWithAck.supportsAck).toBe(false);

      subWithAck._close();
    });

    it('supportsAck is true when sendAck is provided and server supports', () => {
      const sendAck = vi.fn();
      const subWithAck = createSubscription('sub-ack', unsubscribeFn, {}, sendAck);
      subWithAck._setServerSupportsAck(true);

      expect(subWithAck.supportsAck).toBe(true);

      subWithAck._close();
    });

    it('ack() is no-op when supportsAck is false', () => {
      const sendAck = vi.fn();
      const subWithAck = createSubscription('sub-ack', unsubscribeFn, {}, sendAck);

      // Push some events
      subWithAck._pushEvent({
        subscriptionId: 'sub-ack',
        sequenceNumber: 0,
        event: { type: 'agent.registered', timestamp: 1 },
      });

      subWithAck.ack();

      expect(sendAck).not.toHaveBeenCalled();

      subWithAck._close();
    });

    it('ack() sends acknowledgment when supported', () => {
      const sendAck = vi.fn();
      const subWithAck = createSubscription('sub-ack', unsubscribeFn, {}, sendAck);
      subWithAck._setServerSupportsAck(true);

      // Push some events
      subWithAck._pushEvent({
        subscriptionId: 'sub-ack',
        sequenceNumber: 0,
        event: { type: 'agent.registered', timestamp: 1 },
      });

      subWithAck._pushEvent({
        subscriptionId: 'sub-ack',
        sequenceNumber: 1,
        event: { type: 'agent.registered', timestamp: 2 },
      });

      subWithAck.ack();

      expect(sendAck).toHaveBeenCalledTimes(1);
      expect(sendAck).toHaveBeenCalledWith({
        subscriptionId: 'sub-ack',
        upToSequence: 1,
      });

      subWithAck._close();
    });

    it('ack() uses provided sequence number', () => {
      const sendAck = vi.fn();
      const subWithAck = createSubscription('sub-ack', unsubscribeFn, {}, sendAck);
      subWithAck._setServerSupportsAck(true);

      // Push some events
      subWithAck._pushEvent({
        subscriptionId: 'sub-ack',
        sequenceNumber: 0,
        event: { type: 'agent.registered', timestamp: 1 },
      });

      subWithAck._pushEvent({
        subscriptionId: 'sub-ack',
        sequenceNumber: 1,
        event: { type: 'agent.registered', timestamp: 2 },
      });

      subWithAck._pushEvent({
        subscriptionId: 'sub-ack',
        sequenceNumber: 2,
        event: { type: 'agent.registered', timestamp: 3 },
      });

      // Ack only up to sequence 1
      subWithAck.ack(1);

      expect(sendAck).toHaveBeenCalledWith({
        subscriptionId: 'sub-ack',
        upToSequence: 1,
      });

      subWithAck._close();
    });

    it('ack() is no-op when no events received', () => {
      const sendAck = vi.fn();
      const subWithAck = createSubscription('sub-ack', unsubscribeFn, {}, sendAck);
      subWithAck._setServerSupportsAck(true);

      subWithAck.ack();

      expect(sendAck).not.toHaveBeenCalled();

      subWithAck._close();
    });

    it('multiple acks can be sent', () => {
      const sendAck = vi.fn();
      const subWithAck = createSubscription('sub-ack', unsubscribeFn, {}, sendAck);
      subWithAck._setServerSupportsAck(true);

      // Push events
      for (let i = 0; i < 5; i++) {
        subWithAck._pushEvent({
          subscriptionId: 'sub-ack',
          sequenceNumber: i,
          event: { type: 'agent.registered', timestamp: i },
        });
      }

      // Send multiple acks
      subWithAck.ack(1);
      subWithAck.ack(3);
      subWithAck.ack(4);

      expect(sendAck).toHaveBeenCalledTimes(3);
      expect(sendAck).toHaveBeenNthCalledWith(1, { subscriptionId: 'sub-ack', upToSequence: 1 });
      expect(sendAck).toHaveBeenNthCalledWith(2, { subscriptionId: 'sub-ack', upToSequence: 3 });
      expect(sendAck).toHaveBeenNthCalledWith(3, { subscriptionId: 'sub-ack', upToSequence: 4 });

      subWithAck._close();
    });
  });
});
