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
  MultiCauseMode,
  ReplayOptions,
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
/** Default replay options */
const DEFAULT_REPLAY_OPTIONS: Required<ReplayOptions> = {
  maxReplayCount: 1000,
  maxReplayAgeMs: 5 * 60 * 1000, // 5 minutes
  applyFilter: true,
};

export class SubscriptionManagerImpl implements SubscriptionManager {
  private readonly eventBus: EventBus;
  private readonly store: SubscriptionStore;
  private readonly scopes?: ScopeManager;
  private readonly causalOrdering: Required<CausalOrderingOptions>;
  private readonly defaultReplayOptions: Required<ReplayOptions>;
  private readonly states: Map<string, SubscriptionState> = new Map();

  constructor(options: SubscriptionManagerOptions) {
    this.eventBus = options.eventBus;
    this.store = options.store ?? new InMemorySubscriptionStore();
    this.scopes = options.scopes;
    this.causalOrdering = {
      enabled: options.causalOrdering?.enabled ?? true,
      maxWaitMs: options.causalOrdering?.maxWaitMs ?? 5000,
      maxBufferSize: options.causalOrdering?.maxBufferSize ?? 1000,
      multiCauseMode: options.causalOrdering?.multiCauseMode ?? "all",
    };
    this.defaultReplayOptions = {
      ...DEFAULT_REPLAY_OPTIONS,
      ...options.defaultReplayOptions,
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
    if (subscription && !subscription.paused) {
      subscription.paused = true;
      subscription.pausedAt = Date.now();
      this.store.save(subscription);
    }
  }

  /**
   * Resume event delivery.
   */
  resume(id: string): void {
    const subscription = this.store.get(id);
    if (subscription && subscription.paused) {
      subscription.paused = false;
      subscription.pausedAt = undefined;
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
   * Get last delivered event ID for a subscription.
   */
  getLastEventId(id: string): string | undefined {
    return this.store.get(id)?.lastEventId;
  }

  /**
   * Replay missed events to a subscription since its lastEventId.
   * Used on session resume to catch up on events that were missed during disconnect.
   */
  replayEvents(id: string, options?: ReplayOptions): MAPEvent[] {
    const subscription = this.store.get(id);
    if (!subscription) {
      return [];
    }

    const opts: Required<ReplayOptions> = {
      ...this.defaultReplayOptions,
      ...options,
    };

    // Store original pause state and pause during replay
    // This prevents the live event handler from interfering with replay
    const wasPaused = subscription.paused;
    subscription.paused = true;
    this.store.save(subscription);

    // Calculate minimum timestamp for replay
    const minTimestamp = Date.now() - opts.maxReplayAgeMs;

    // Query events since lastEventId BEFORE emitting any replay events
    // to avoid the replay events themselves being included or affecting lastEventId
    const events = this.eventBus.getEvents({
      since: subscription.lastEventId,
      limit: opts.maxReplayCount,
    });

    // Filter events by age and optionally by subscription filter
    // Also filter out any subscription.replay.* events to avoid self-referential issues
    const filteredEvents = events.filter((event) => {
      // Skip replay events
      if (event.type.startsWith("subscription.replay.")) {
        return false;
      }

      // Skip events that are too old
      if (event.timestamp < minTimestamp) {
        return false;
      }

      // Apply subscription filter if enabled
      if (opts.applyFilter && !this.matchesFilter(event, subscription.filter)) {
        return false;
      }

      return true;
    });

    // Emit replay started event
    this.eventBus.emit({
      type: "subscription.replay.started",
      data: {
        subscriptionId: id,
        sessionId: subscription.sessionId,
        lastEventId: subscription.lastEventId,
        options: opts,
      },
    });

    // Deliver events to the subscription state
    // Use a direct queue approach to avoid triggering the live event handler
    const state = this.states.get(id);
    if (state) {
      for (const event of filteredEvents) {
        // Directly queue events without going through deliverEvent
        // to avoid lastEventId being updated prematurely by concurrent live events
        if (state.resolvers.length > 0) {
          const resolver = state.resolvers.shift()!;
          resolver({ value: event, done: false });
        } else {
          state.eventQueue.push(event);
        }
      }

      // Update lastEventId to the last replayed event
      if (filteredEvents.length > 0) {
        const lastEvent = filteredEvents[filteredEvents.length - 1];
        subscription.lastEventId = lastEvent.id;
      }

      // Restore original pause state
      subscription.paused = wasPaused;
      this.store.save(subscription);
      state.subscription = subscription;
    } else {
      // No state, just restore pause state
      subscription.paused = wasPaused;
      this.store.save(subscription);
    }

    // Emit replay completed event
    this.eventBus.emit({
      type: "subscription.replay.completed",
      data: {
        subscriptionId: id,
        sessionId: subscription.sessionId,
        replayedCount: filteredEvents.length,
        lastReplayedEventId: filteredEvents[filteredEvents.length - 1]?.id,
      },
    });

    return filteredEvents;
  }

  /**
   * Replay missed events to all subscriptions for a session.
   * Convenience method for session resume.
   */
  replaySessionEvents(sessionId: string, options?: ReplayOptions): Map<string, MAPEvent[]> {
    const subscriptions = this.store.list({ sessionId });
    const result = new Map<string, MAPEvent[]>();

    for (const subscription of subscriptions) {
      const events = this.replayEvents(subscription.id, options);
      result.set(subscription.id, events);
    }

    return result;
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
      multiCauseMode: this.causalOrdering.multiCauseMode,
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
      // Normalize causedBy to array format
      const causedBy = event.causedBy
        ? Array.isArray(event.causedBy)
          ? event.causedBy
          : [event.causedBy]
        : undefined;

      const causalEvent: CausalEvent = {
        eventId: event.id,
        causedBy,
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
    // Track last delivered event ID for replay support
    // Use atomic update if available to prevent race conditions
    if (this.store.updateLastEventId) {
      const updated = this.store.updateLastEventId(state.subscription.id, event.id);
      if (updated) {
        state.subscription = updated;
      }
    } else {
      // Fallback for stores without atomic update (not recommended)
      const subscription = this.store.get(state.subscription.id);
      if (subscription) {
        subscription.lastEventId = event.id;
        this.store.save(subscription);
        state.subscription = subscription;
      }
    }

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
   *
   * Supports:
   * - Basic filters: eventTypes, agents, scopes, messageTypes
   * - Match modes: "all" (default) vs "any"
   * - Logical operators: $or, $and (can be combined - both must be satisfied)
   * - Nested filters with operators
   */
  private matchesFilter(event: MAPEvent, filter: SubscriptionFilter): boolean {
    // Handle combined $or and $and operators
    // When both are present, the event must satisfy both constraints
    const hasOr = filter.$or && filter.$or.length > 0;
    const hasAnd = filter.$and && filter.$and.length > 0;

    if (hasOr && hasAnd) {
      // Both operators present - event must match at least one $or AND all $and filters
      const orMatch = filter.$or!.some((subFilter) => this.matchesFilter(event, subFilter));
      const andMatch = filter.$and!.every((subFilter) => this.matchesFilter(event, subFilter));
      return orMatch && andMatch;
    }

    // Handle $or operator alone - match if ANY sub-filter matches
    if (hasOr) {
      return filter.$or!.some((subFilter) => this.matchesFilter(event, subFilter));
    }

    // Handle $and operator alone - match if ALL sub-filters match
    if (hasAnd) {
      return filter.$and!.every((subFilter) => this.matchesFilter(event, subFilter));
    }

    // Get match mode (default: "all")
    const matchMode = filter.match ?? "all";

    // Collect matching results for each criterion
    const criteria: Array<{ name: string; matches: boolean | null }> = [];

    // Check event types
    if (filter.eventTypes && filter.eventTypes.length > 0) {
      const matches = this.matchesEventTypes(event, filter.eventTypes);
      criteria.push({ name: "eventTypes", matches });
    }

    // Check fromAgents (source agent filter)
    if (filter.fromAgents && filter.fromAgents.length > 0) {
      const eventAgentId = event.source?.agentId;
      const matches = eventAgentId ? filter.fromAgents.includes(eventAgentId) : false;
      criteria.push({ name: "fromAgents", matches });
    }

    // Check scopes (including nested scopes)
    if (filter.scopes && filter.scopes.length > 0) {
      const matches = this.matchesScopes(event, filter.scopes);
      criteria.push({ name: "scopes", matches });
    }

    // Check message types (for message events)
    if (filter.messageTypes && filter.messageTypes.length > 0) {
      const matches = this.matchesMessageTypes(event, filter.messageTypes);
      criteria.push({ name: "messageTypes", matches });
    }

    // If no criteria specified, match everything
    if (criteria.length === 0) {
      return true;
    }

    // Apply match mode
    if (matchMode === "any") {
      // Any criterion matching is sufficient
      return criteria.some((c) => c.matches === true);
    } else {
      // All criteria must match (default "all" mode)
      return criteria.every((c) => c.matches === true);
    }
  }

  /**
   * Normalize event type to use dot notation.
   * Accepts both "agent.registered" and "agent_registered" for compatibility.
   */
  private normalizeEventType(type: string): string {
    return type.replace(/_/g, ".");
  }

  /**
   * Check if event matches any of the event types.
   * Accepts both dot notation (agent.registered) and underscore notation (agent_registered).
   */
  private matchesEventTypes(event: MAPEvent, eventTypes: string[]): boolean {
    const normalizedEventType = this.normalizeEventType(event.type);

    // Normalize all filter types for comparison
    const normalizedFilters = eventTypes.map((t) => this.normalizeEventType(t));

    // Direct match
    if (normalizedFilters.includes(normalizedEventType)) {
      return true;
    }

    // Check for prefix matches (e.g., "agent.*" matches "agent.registered")
    return normalizedFilters.some((type) => {
      if (type.endsWith(".*")) {
        const prefix = type.slice(0, -2);
        return normalizedEventType.startsWith(prefix + ".");
      }
      return false;
    });
  }

  /**
   * Check if event matches any of the scopes (including nested scopes).
   */
  private matchesScopes(event: MAPEvent, scopes: string[]): boolean {
    const eventScopeId = event.source?.scopeId;
    if (!eventScopeId) {
      return false;
    }

    // Check direct scope match
    if (scopes.includes(eventScopeId)) {
      return true;
    }

    // Check if event scope is a descendant of any filter scope
    if (this.scopes) {
      for (const filterScopeId of scopes) {
        try {
          const descendants = this.scopes.getDescendants(filterScopeId);
          if (descendants.some((d) => d.id === eventScopeId)) {
            return true;
          }
        } catch {
          // Invalid scope ID - skip this filter scope and continue checking others
          continue;
        }
      }
    }

    return false;
  }

  /**
   * Check if event matches any of the message types.
   * This checks for a messageType field in the event data.
   */
  private matchesMessageTypes(event: MAPEvent, messageTypes: string[]): boolean {
    // Check if this is a message event with a messageType field
    const eventData = event.data as Record<string, unknown> | undefined;
    if (!eventData) {
      return false;
    }

    // Try to extract messageType from event data
    // Common locations: data.messageType, data.message.messageType
    const messageType =
      (eventData.messageType as string) ??
      ((eventData.message as Record<string, unknown> | undefined)?.messageType as string);

    if (!messageType) {
      return false;
    }

    return messageTypes.includes(messageType);
  }
}
