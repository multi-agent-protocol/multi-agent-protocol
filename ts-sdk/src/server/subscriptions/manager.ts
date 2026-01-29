/**
 * SubscriptionManager implementation
 *
 * Manages event subscriptions with causal ordering support.
 */

import type {
  ServerSubscription,
  SubscriptionFilter,
  SubscriptionStore,
  SubscriptionManager,
  SubscriptionManagerOptions,
  MAPEvent,
  EventBus,
  ScopeManager,
  CausalOrderingOptions,
} from "../types";
import { ulid } from "../../utils/ulid";
import { CausalEventBuffer, type CausalEvent } from "../../utils/causal-buffer";
import { InMemorySubscriptionStore } from "./stores/in-memory";

/**
 * Internal state for a subscription including its event stream.
 */
interface SubscriptionState {
  subscription: ServerSubscription;
  unsubscribe: () => void;
  buffer: CausalEventBuffer;
  eventQueue: MAPEvent[];
  resolvers: Array<(value: IteratorResult<MAPEvent>) => void>;
  closed: boolean;
}

/**
 * SubscriptionManager implementation.
 *
 * Manages subscriptions to events with:
 * - Event type filtering
 * - Agent filtering
 * - Scope filtering (with nested scope support)
 * - Causal ordering via CausalEventBuffer
 * - Pause/resume support
 * - Async iterable event streams
 */
export class SubscriptionManagerImpl implements SubscriptionManager {
  private readonly eventBus: EventBus;
  private readonly store: SubscriptionStore;
  private readonly scopes?: ScopeManager;
  private readonly causalOrdering: Required<CausalOrderingOptions>;
  private readonly states: Map<string, SubscriptionState> = new Map();

  constructor(options: SubscriptionManagerOptions) {
    this.eventBus = options.eventBus;
    this.store = options.store ?? new InMemorySubscriptionStore();
    this.scopes = options.scopes;
    this.causalOrdering = {
      enabled: options.causalOrdering?.enabled ?? true,
      maxWaitMs: options.causalOrdering?.maxWaitMs ?? 5000,
      maxBufferSize: options.causalOrdering?.maxBufferSize ?? 1000,
    };
  }

  /**
   * Create a new subscription.
   */
  create(params: {
    sessionId: string;
    filter: SubscriptionFilter;
    startAfter?: string;
  }): ServerSubscription {
    const subscription: ServerSubscription = {
      id: ulid(),
      sessionId: params.sessionId,
      filter: params.filter,
      createdAt: Date.now(),
      lastEventId: params.startAfter,
      paused: false,
    };

    this.store.save(subscription);

    // Create subscription state with event listener
    const state = this.createSubscriptionState(subscription);
    this.states.set(subscription.id, state);

    return subscription;
  }

  /**
   * Get subscription by ID.
   */
  get(id: string): ServerSubscription | undefined {
    return this.store.get(id);
  }

  /**
   * Cancel a subscription.
   */
  cancel(id: string): boolean {
    const state = this.states.get(id);
    if (state) {
      state.unsubscribe();
      state.closed = true;
      // Resolve any waiting iterators
      for (const resolver of state.resolvers) {
        resolver({ value: undefined, done: true });
      }
      state.resolvers = [];
      this.states.delete(id);
    }

    return this.store.delete(id);
  }

  /**
   * Cancel all subscriptions for a session.
   */
  cancelBySession(sessionId: string): string[] {
    const subscriptions = this.store.list({ sessionId });
    const cancelledIds: string[] = [];

    for (const subscription of subscriptions) {
      if (this.cancel(subscription.id)) {
        cancelledIds.push(subscription.id);
      }
    }

    return cancelledIds;
  }

  /**
   * Pause event delivery.
   */
  pause(id: string): void {
    const subscription = this.store.get(id);
    if (subscription) {
      subscription.paused = true;
      this.store.save(subscription);
    }
  }

  /**
   * Resume event delivery.
   */
  resume(id: string): void {
    const subscription = this.store.get(id);
    if (subscription) {
      subscription.paused = false;
      this.store.save(subscription);

      // Flush any queued events
      const state = this.states.get(id);
      if (state) {
        this.flushEventQueue(state);
      }
    }
  }

  /**
   * Update last delivered event ID.
   */
  acknowledge(id: string, eventId: string): void {
    const subscription = this.store.get(id);
    if (subscription) {
      subscription.lastEventId = eventId;
      this.store.save(subscription);
    }
  }

  /**
   * Find subscriptions that should receive an event.
   */
  match(event: MAPEvent): string[] {
    const subscriptions = this.store.list();
    const matchingIds: string[] = [];

    for (const subscription of subscriptions) {
      if (this.matchesFilter(event, subscription.filter)) {
        matchingIds.push(subscription.id);
      }
    }

    return matchingIds;
  }

  /**
   * Get ordered event stream for a subscription.
   */
  getEventStream(id: string): AsyncIterable<MAPEvent> {
    const state = this.states.get(id);
    if (!state) {
      // Return empty iterable for unknown subscription
      return {
        [Symbol.asyncIterator]: () => ({
          next: async () => ({ value: undefined, done: true as const }),
        }),
      };
    }

    return {
      [Symbol.asyncIterator]: () => ({
        next: async (): Promise<IteratorResult<MAPEvent>> => {
          if (state.closed) {
            return { value: undefined, done: true };
          }

          // If there are queued events, return the next one
          if (state.eventQueue.length > 0) {
            const event = state.eventQueue.shift()!;
            return { value: event, done: false };
          }

          // Wait for next event
          return new Promise<IteratorResult<MAPEvent>>((resolve) => {
            state.resolvers.push(resolve);
          });
        },
      }),
    };
  }

  /**
   * Create subscription state with event listener.
   */
  private createSubscriptionState(subscription: ServerSubscription): SubscriptionState {
    const buffer = new CausalEventBuffer({
      maxWaitTime: this.causalOrdering.enabled ? this.causalOrdering.maxWaitMs : 0,
      maxBufferSize: this.causalOrdering.maxBufferSize,
    });

    const state: SubscriptionState = {
      subscription,
      buffer,
      eventQueue: [],
      resolvers: [],
      closed: false,
      unsubscribe: () => {}, // Will be set below
    };

    // Subscribe to all events
    state.unsubscribe = this.eventBus.on("*", (event) => {
      this.handleEvent(state, event);
    });

    return state;
  }

  /**
   * Handle an incoming event for a subscription.
   */
  private handleEvent(state: SubscriptionState, event: MAPEvent): void {
    // Check if subscription matches this event
    const subscription = this.store.get(state.subscription.id);
    if (!subscription || !this.matchesFilter(event, subscription.filter)) {
      return;
    }

    // Update subscription reference in state
    state.subscription = subscription;

    // Check if paused
    if (subscription.paused) {
      return;
    }

    // Process through causal buffer if enabled
    if (this.causalOrdering.enabled) {
      const causalEvent: CausalEvent = {
        eventId: event.id,
        causedBy: event.causedBy ? [event.causedBy] : undefined,
        event: event as any, // MAPEvent is compatible with Event type
      };

      const result = state.buffer.push(causalEvent);

      // Deliver ready events
      for (const readyEvent of result.ready) {
        this.deliverEvent(state, readyEvent.event as MAPEvent);
      }
    } else {
      // No causal ordering - deliver immediately
      this.deliverEvent(state, event);
    }
  }

  /**
   * Deliver an event to the subscription.
   */
  private deliverEvent(state: SubscriptionState, event: MAPEvent): void {
    // If there are waiting iterators, resolve the first one
    if (state.resolvers.length > 0) {
      const resolver = state.resolvers.shift()!;
      resolver({ value: event, done: false });
    } else {
      // Queue the event for later
      state.eventQueue.push(event);
    }
  }

  /**
   * Flush queued events to waiting iterators.
   */
  private flushEventQueue(state: SubscriptionState): void {
    while (state.eventQueue.length > 0 && state.resolvers.length > 0) {
      const event = state.eventQueue.shift()!;
      const resolver = state.resolvers.shift()!;
      resolver({ value: event, done: false });
    }
  }

  /**
   * Check if an event matches a subscription filter.
   */
  private matchesFilter(event: MAPEvent, filter: SubscriptionFilter): boolean {
    // Check event types
    if (filter.eventTypes && filter.eventTypes.length > 0) {
      if (!filter.eventTypes.includes(event.type)) {
        // Check for prefix matches (e.g., "agent.*" matches "agent.registered")
        const matches = filter.eventTypes.some((type) => {
          if (type.endsWith(".*")) {
            const prefix = type.slice(0, -2);
            return event.type.startsWith(prefix + ".");
          }
          return false;
        });
        if (!matches) {
          return false;
        }
      }
    }

    // Check agents
    if (filter.agents && filter.agents.length > 0) {
      const eventAgentId = event.source?.agentId;
      if (!eventAgentId || !filter.agents.includes(eventAgentId)) {
        return false;
      }
    }

    // Check scopes (including nested scopes)
    if (filter.scopes && filter.scopes.length > 0) {
      const eventScopeId = event.source?.scopeId;
      if (!eventScopeId) {
        return false;
      }

      // Check direct scope match
      if (filter.scopes.includes(eventScopeId)) {
        return true;
      }

      // Check if event scope is a descendant of any filter scope
      if (this.scopes) {
        for (const filterScopeId of filter.scopes) {
          const descendants = this.scopes.getDescendants(filterScopeId);
          if (descendants.some((d) => d.id === eventScopeId)) {
            return true;
          }
        }
      }

      return false;
    }

    return true;
  }
}
