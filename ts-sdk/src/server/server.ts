/**
 * MAPServer - Convenience wrapper for MAP Server SDK building blocks
 *
 * Provides a simplified API for creating MAP servers while preserving
 * access to all underlying building blocks for advanced use cases.
 */

import type { Stream } from "../stream";
import { NOTIFICATION_METHODS } from "../types";
import type {
  EventBus,
  AgentRegistry,
  ScopeManager,
  SessionManager,
  SubscriptionManager,
  MessageRouter,
  HandlerRegistry,
  Middleware,
  MAPEvent,
  ServerSubscription,
  EventStore,
  AgentStore,
  SessionStore,
  ScopeStore,
  SubscriptionStore,
  MessageQueueStore,
} from "./types";
import type { ParticipantCapabilities } from "../types";
import type {
  ConversationManager,
  TurnManager,
  ThreadManager,
  ConversationStore,
  TurnStore,
  ThreadStore,
  ParticipantStore,
} from "./types";
import { EventBusImpl } from "./events";
import { AgentRegistryImpl, createAgentHandlers } from "./agents";
import { SessionManagerImpl } from "./sessions";
import { ScopeManagerImpl, createScopeHandlers } from "./scopes";
import { SubscriptionManagerImpl, createSubscriptionHandlers } from "./subscriptions";
import { MessageRouterImpl, createMessageHandlers } from "./messages";
import {
  ConversationManagerImpl,
  TurnManagerImpl,
  ThreadManagerImpl,
  InMemoryTurnStore,
  createMailHandlers,
} from "./mail";
import {
  RouterConnectionImpl,
  combineHandlers,
  createConnectionHandlers,
} from "./router";
import type { MailCapabilityConfig } from "./router/handlers";
import { createCredentialHandlers } from "./credentials";
import { createWorkspaceHandlers } from "./workspace";
import type { WorkspaceCapabilityConfig, WorkspaceFileService } from "./workspace";
import { AuthManagerImpl, authMiddleware } from "./auth";
import type { AuthManager } from "./auth";

/**
 * Options for MAPServer
 */
export interface MAPServerOptions {
  // === Basic Config ===
  /** Server name for connect responses */
  name?: string;
  /** Server version for connect responses */
  version?: string;

  // === Building Block Overrides ===
  /** Replace EventBus entirely */
  eventBus?: EventBus;
  /** Replace AgentRegistry entirely */
  agents?: AgentRegistry;
  /** Replace ScopeManager entirely */
  scopes?: ScopeManager;
  /** Replace SessionManager entirely */
  sessions?: SessionManager;
  /** Replace SubscriptionManager entirely */
  subscriptions?: SubscriptionManager;
  /** Replace MessageRouter entirely */
  messages?: MessageRouter;

  // === Storage Overrides ===
  /** Custom stores (uses default impl with your store) */
  stores?: {
    events?: EventStore;
    agents?: AgentStore;
    sessions?: SessionStore;
    scopes?: ScopeStore;
    subscriptions?: SubscriptionStore;
    messages?: MessageQueueStore;
  };

  // === Handler Customization ===
  /** Replace all handlers entirely */
  handlers?: HandlerRegistry;
  /** Add handlers to defaults (merged after built-in handlers) */
  additionalHandlers?: HandlerRegistry;
  /** Middleware chain (applied to all requests) */
  middleware?: Middleware[];

  // === Event Delivery ===
  /** Event delivery configuration */
  eventDelivery?: {
    /** Enable automatic event delivery (default: true) */
    enabled?: boolean;
    /** Custom filter for event delivery */
    filter?: (event: MAPEvent, subscription: ServerSubscription) => boolean;
  };

  // === Session/Cleanup Config ===
  /** Session resume window in ms (default: 5 minutes) */
  resumeWindowMs?: number;

  // === Capabilities ===
  /** Server capabilities advertised to clients */
  capabilities?: ParticipantCapabilities;

  // === Authentication ===
  /**
   * Authentication configuration.
   * If not provided, no authentication is enforced.
   *
   * @example
   * ```typescript
   * auth: {
   *   required: true,
   *   authenticators: [
   *     new JWTAuthenticator({ jwksUrl: '...' }),
   *     new APIKeyAuthenticator({ validateKey: ... }),
   *   ],
   * }
   * ```
   */
  auth?: {
    /** Is authentication required for connections? */
    required?: boolean;
    /** Registered authenticators */
    authenticators?: import('./auth').Authenticator[];
    /** OAuth2 authorization server metadata URL */
    oauth2MetadataUrl?: string;
    /** JWKS URL for token verification */
    jwksUrl?: string;
    /** Server realm identifier */
    realm?: string;
    /** Transports that bypass auth (e.g., { stdio: true }) */
    bypassForTransports?: Record<string, boolean>;
    /**
     * Auth expiration notification configuration.
     * If enabled, the server will send `map/auth/expiring` notifications
     * before tokens expire, giving clients time to refresh.
     */
    expirationNotification?: {
      /** Enable expiration notifications (default: true if auth is configured) */
      enabled?: boolean;
      /** How often to check for expiring tokens in ms (default: 30000) */
      checkIntervalMs?: number;
      /** How far in advance to notify before expiration in ms (default: 300000 = 5 min) */
      notifyBeforeMs?: number;
    };
  };

  // === Mail Config ===
  /** Mail feature configuration. Omit or set enabled=false to disable mail. */
  mail?: {
    /** Enable the mail feature (default: false) */
    enabled?: boolean;
    /** Mail capability overrides for connect handshake */
    capabilities?: Omit<MailCapabilityConfig, "enabled">;
    /** Custom stores for mail data */
    stores?: {
      conversations?: ConversationStore;
      turns?: TurnStore;
      threads?: ThreadStore;
      participants?: ParticipantStore;
    };
    /** Replace ConversationManager entirely */
    conversations?: ConversationManager;
    /** Replace TurnManager entirely */
    turns?: TurnManager;
    /** Replace ThreadManager entirely */
    threads?: ThreadManager;
  };

  // === Credential Brokering Config ===
  /**
   * Credential brokering configuration. Omit or set enabled=false to disable.
   * When enabled, `broker` must be provided.
   */
  credentials?: {
    /** Enable credential brokering (default: false) */
    enabled?: boolean;
    /** Broker instance (e.g. agent-iam Broker). Required when enabled=true. */
    broker?: import('./credentials').BrokerLike;
    /** Credential capability overrides for connect handshake */
    capabilities?: Omit<import('./credentials').CredentialCapabilityConfig, 'enabled'>;
    /** If set, only these providers are visible */
    allowedProviders?: string[];
  };

  // === Workspace Config ===
  /** Workspace file access configuration. Omit or set enabled=false to disable. */
  workspace?: {
    /** Enable workspace file access (default: false) */
    enabled?: boolean;
    /** File service implementation. Required when enabled=true. */
    fileService?: WorkspaceFileService;
    /** Workspace capability overrides for connect handshake */
    capabilities?: Omit<WorkspaceCapabilityConfig, 'enabled'>;
  };
}

/**
 * Options for accepting a connection
 */
export interface AcceptOptions {
  /** Connection role (default: 'agent') */
  role?: "client" | "agent" | "gateway";
  /** Name for the session */
  name?: string;
  /** Resume token for reconnection */
  resumeToken?: string;
  /**
   * Transport type for auth bypass configuration.
   * Common values: 'websocket', 'stdio', 'inprocess'
   */
  transportType?: string;
  /** Additional metadata for the session */
  metadata?: Record<string, unknown>;
}

/**
 * Options for closing the server
 */
export interface CloseOptions {
  /** Timeout for graceful shutdown in ms (default: 5000) */
  timeout?: number;
  /** Force close without waiting for graceful disconnect */
  force?: boolean;
}

/**
 * MAPServer - A convenience wrapper that wires together all MAP Server SDK
 * building blocks with sensible defaults.
 *
 * @example Simple usage
 * ```typescript
 * const server = new MAPServer({ name: 'MyServer' });
 *
 * // Accept connections
 * wss.on('connection', (ws) => {
 *   const stream = websocketToStream(ws);
 *   server.accept(stream).start();
 * });
 * ```
 *
 * @example With custom storage
 * ```typescript
 * const server = new MAPServer({
 *   name: 'PersistentServer',
 *   stores: {
 *     agents: new PostgresAgentStore(db),
 *     events: new RedisEventStore(redis),
 *   }
 * });
 * ```
 *
 * @example Direct access to building blocks
 * ```typescript
 * server.agents.list();
 * server.eventBus.on('agent.registered', console.log);
 * ```
 */
export class MAPServer {
  // === Building Blocks (readonly access) ===
  readonly eventBus: EventBus;
  readonly agents: AgentRegistry;
  readonly scopes: ScopeManager;
  readonly sessions: SessionManager;
  readonly subscriptions: SubscriptionManager;
  readonly messages: MessageRouter;
  readonly handlers: HandlerRegistry;
  /** Authentication manager (if auth is configured) */
  readonly auth: AuthManager | null;
  /** Mail managers (null if mail is disabled) */
  readonly conversations: ConversationManager | null;
  readonly turns: TurnManager | null;
  readonly threads: ThreadManager | null;

  // === Private State ===
  readonly #options: MAPServerOptions;
  readonly #routers: Map<string, RouterConnectionImpl> = new Map();
  readonly #sessionToRouter: Map<string, string> = new Map(); // sessionId -> routerId for O(1) lookup
  readonly #subscriptionSequences: Map<string, number> = new Map();
  #eventDeliveryUnsubscribe?: () => void;
  #sessionTrackingUnsubscribe?: () => void;
  #authExpirationInterval?: ReturnType<typeof setInterval>;
  #notifiedSessions: Set<string> = new Set(); // Sessions that have been notified about expiring auth
  #nextRouterId = 1;

  constructor(options: MAPServerOptions = {}) {
    // Create building blocks in dependency order
    this.eventBus =
      options.eventBus ??
      new EventBusImpl({
        store: options.stores?.events,
      });

    this.sessions =
      options.sessions ??
      new SessionManagerImpl({
        eventBus: this.eventBus,
        store: options.stores?.sessions,
        resumeWindowMs: options.resumeWindowMs,
      });

    this.agents =
      options.agents ??
      new AgentRegistryImpl({
        eventBus: this.eventBus,
        store: options.stores?.agents,
      });

    this.scopes =
      options.scopes ??
      new ScopeManagerImpl({
        eventBus: this.eventBus,
        store: options.stores?.scopes,
      });

    this.subscriptions =
      options.subscriptions ??
      new SubscriptionManagerImpl({
        eventBus: this.eventBus,
        scopes: this.scopes,
        store: options.stores?.subscriptions,
      });

    this.messages =
      options.messages ??
      new MessageRouterImpl({
        eventBus: this.eventBus,
        agents: this.agents,
        scopes: this.scopes,
        queueStore: options.stores?.messages,
      });

    // Create mail managers if enabled
    if (options.mail?.enabled) {
      const turnStore = options.mail.stores?.turns ?? new InMemoryTurnStore();
      this.conversations =
        options.mail.conversations ??
        new ConversationManagerImpl({
          eventBus: this.eventBus,
          store: options.mail.stores?.conversations,
          participantStore: options.mail.stores?.participants,
        });
      this.turns =
        options.mail.turns ??
        new TurnManagerImpl({
          eventBus: this.eventBus,
          store: turnStore,
          conversations: this.conversations,
        });
      this.threads =
        options.mail.threads ??
        new ThreadManagerImpl({
          eventBus: this.eventBus,
          store: options.mail.stores?.threads,
          turnStore,
        });
    } else {
      this.conversations = null;
      this.turns = null;
      this.threads = null;
    }

    // Validate credential brokering config
    if (options.credentials?.enabled && !options.credentials.broker) {
      throw new Error(
        'MAPServer: credentials.broker is required when credentials.enabled is true',
      );
    }

    // Validate workspace config
    if (options.workspace?.enabled && !options.workspace.fileService) {
      throw new Error(
        'MAPServer: workspace.fileService is required when workspace.enabled is true',
      );
    }

    // Set up authentication if configured
    if (options.auth?.authenticators?.length) {
      this.auth = new AuthManagerImpl({
        required: options.auth.required ?? false,
        authenticators: options.auth.authenticators,
        oauth2MetadataUrl: options.auth.oauth2MetadataUrl,
        jwksUrl: options.auth.jwksUrl,
        realm: options.auth.realm,
        bypassForTransports: options.auth.bypassForTransports,
      });
    } else {
      this.auth = null;
    }

    // Build middleware chain (auth middleware first if configured)
    const middleware: Middleware[] = [];
    if (this.auth) {
      middleware.push(authMiddleware(this.auth));
    }
    if (options.middleware) {
      middleware.push(...options.middleware);
    }

    // Compose handlers
    this.handlers =
      options.handlers ??
      combineHandlers(
        createConnectionHandlers({
          sessions: this.sessions,
          agents: this.agents,
          subscriptions: this.subscriptions,
          scopes: this.scopes,
          serverName: options.name ?? "MAPServer",
          serverVersion: options.version ?? "1.0.0",
          authManager: this.auth ?? undefined,
          mailCapabilities: options.mail?.enabled
            ? { enabled: true, ...options.mail.capabilities }
            : undefined,
          credentialCapabilities: options.credentials?.enabled
            ? { enabled: true, ...options.credentials.capabilities }
            : undefined,
          workspaceCapabilities: options.workspace?.enabled
            ? { enabled: true, ...options.workspace.capabilities }
            : undefined,
        }),
        createAgentHandlers({ agents: this.agents, sessions: this.sessions }),
        createScopeHandlers({ scopes: this.scopes }),
        createMessageHandlers({
          messages: this.messages,
          scopes: this.scopes,
          agents: this.agents,
          turns: this.turns ?? undefined,
        }),
        createSubscriptionHandlers({
          subscriptions: this.subscriptions,
          eventBus: this.eventBus,
          sessions: this.sessions,
        }),
        ...(this.conversations && this.turns && this.threads
          ? [
              createMailHandlers({
                conversations: this.conversations,
                turns: this.turns,
                threads: this.threads,
              }),
            ]
          : []),
        ...(options.credentials?.enabled
          ? [
              createCredentialHandlers({
                broker: options.credentials.broker!,
                eventBus: this.eventBus,
                allowedProviders: options.credentials.allowedProviders,
              }),
            ]
          : []),
        ...(options.workspace?.enabled
          ? [
              createWorkspaceHandlers({
                fileService: options.workspace.fileService!,
              }),
            ]
          : []),
        options.additionalHandlers ?? {}
      );

    // Store middleware for router creation
    this.#options = { ...options, middleware };

    // Wire event delivery
    if (options.eventDelivery?.enabled !== false) {
      this.#wireEventDelivery();
    }

    // Wire session tracking for O(1) router lookup
    this.#wireSessionTracking();

    // Start auth expiration monitoring if configured
    if (this.auth && options.auth?.expirationNotification?.enabled !== false) {
      this.startAuthExpirationMonitor();
    }
  }

  // === Connection Tracking ===

  /**
   * Get active connections by ID
   */
  get connections(): ReadonlyMap<string, RouterConnectionImpl> {
    return this.#routers;
  }

  // === Connection Lifecycle ===

  /**
   * Accept a new connection.
   *
   * Creates a RouterConnection, tracks it, and sets up cleanup on close.
   * The returned router must have `start()` called to begin processing.
   *
   * @param stream - Bidirectional message stream
   * @param options - Connection options
   * @returns RouterConnection ready to start
   *
   * @example
   * ```typescript
   * const router = server.accept(stream, { role: 'agent' });
   * router.start();
   * ```
   */
  accept(stream: Stream, options?: AcceptOptions): RouterConnectionImpl {
    const routerId = `router-${this.#nextRouterId++}`;

    // Build metadata including transportType
    const metadata: Record<string, unknown> = {
      ...options?.metadata,
    };
    if (options?.transportType) {
      metadata.transportType = options.transportType;
    }

    const router = new RouterConnectionImpl({
      stream,
      handlers: this.handlers,
      sessions: this.sessions,
      middleware: this.#options.middleware,
      role: options?.role ?? "agent",
      name: options?.name,
      resumeToken: options?.resumeToken,
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    });

    // Track the router
    this.#routers.set(routerId, router);

    // Auto-cleanup on close
    router.closed.then(() => {
      // Clean up session mapping if exists (use try-catch since session may not exist)
      try {
        const sessionId = router.session?.id;
        if (sessionId) {
          this.#sessionToRouter.delete(sessionId);
        }
      } catch {
        // Session not established, nothing to clean
      }
      this.#routers.delete(routerId);
    });

    // Store routerId on router for session tracking callback
    (router as RouterConnectionImpl & { __routerId?: string }).__routerId = routerId;

    return router;
  }

  /**
   * Close the server.
   *
   * Gracefully disconnects all clients with optional timeout.
   *
   * @param options - Close options
   *
   * @example
   * ```typescript
   * // Graceful shutdown
   * await server.close();
   *
   * // Force shutdown
   * await server.close({ force: true });
   *
   * // Custom timeout
   * await server.close({ timeout: 10000 });
   * ```
   */
  async close(options?: CloseOptions): Promise<void> {
    const { timeout = 5000, force = false } = options ?? {};

    // Stop event delivery
    if (this.#eventDeliveryUnsubscribe) {
      this.#eventDeliveryUnsubscribe();
      this.#eventDeliveryUnsubscribe = undefined;
    }

    // Stop session tracking
    if (this.#sessionTrackingUnsubscribe) {
      this.#sessionTrackingUnsubscribe();
      this.#sessionTrackingUnsubscribe = undefined;
    }

    // Stop auth expiration monitoring
    this.stopAuthExpirationMonitor();

    const routers = Array.from(this.#routers.values());

    if (force) {
      // Immediately close all
      await Promise.all(routers.map((r) => r.close()));
      // Force-expire all disconnected sessions
      this.sessions.expireStale(0);
      return;
    }

    // Graceful: attempt close with timeout
    const closePromises = routers.map(async (router) => {
      try {
        await Promise.race([
          router.close(),
          new Promise<void>((_, reject) =>
            setTimeout(() => reject(new Error("Timeout")), timeout)
          ),
        ]);
      } catch {
        // Force close on timeout
        await router.close();
      }
    });

    await Promise.all(closePromises);

    // Expire disconnected sessions on graceful shutdown
    this.sessions.expireStale(0);
  }

  // === Convenience Methods ===

  /**
   * Subscribe to events.
   *
   * Convenience method that delegates to eventBus.on().
   *
   * @param type - Event type(s) to listen for, or '*' for all
   * @param handler - Callback invoked for each matching event
   * @returns Unsubscribe function
   */
  on(
    type: string | string[],
    handler: (event: MAPEvent) => void
  ): () => void {
    return this.eventBus.on(type, handler);
  }

  /**
   * Emit an event.
   *
   * Convenience method that delegates to eventBus.emit().
   *
   * @param event - Event to emit (id and timestamp are added automatically)
   * @returns The complete event with id and timestamp
   */
  emit(event: Omit<MAPEvent, "id" | "timestamp">): MAPEvent {
    return this.eventBus.emit(event);
  }

  // === Private Methods ===

  /**
   * Wire automatic event delivery from EventBus to subscriptions
   */
  #wireEventDelivery(): void {
    this.#eventDeliveryUnsubscribe = this.eventBus.on("*", (event: MAPEvent) => {
      // Find matching subscriptions
      const matchingSubIds = this.subscriptions.match(event);

      for (const subId of matchingSubIds) {
        const subscription = this.subscriptions.get(subId);
        if (!subscription || subscription.paused) continue;

        // Apply custom filter if provided
        if (this.#options.eventDelivery?.filter) {
          if (!this.#options.eventDelivery.filter(event, subscription)) {
            continue;
          }
        }

        // Find the router for this subscription's session
        const router = this.#findRouterForSession(subscription.sessionId);
        if (!router) continue;

        // Increment sequence number
        const seq = (this.#subscriptionSequences.get(subId) ?? 0) + 1;
        this.#subscriptionSequences.set(subId, seq);

        // Send notification (remove dead connections on error)
        router
          .notify(NOTIFICATION_METHODS.EVENT, {
            subscriptionId: subId,
            sequenceNumber: seq,
            eventId: event.id,
            timestamp: event.timestamp,
            event,
          })
          .catch(() => {
            // Remove dead connection on notification failure
            this.#removeDeadConnection(subscription.sessionId);
          });
      }
    });
  }

  /**
   * Find the RouterConnection for a given session ID (O(1) lookup with fallback)
   */
  #findRouterForSession(sessionId: string): RouterConnectionImpl | undefined {
    // Try O(1) lookup first
    const routerId = this.#sessionToRouter.get(sessionId);
    if (routerId) {
      const router = this.#routers.get(routerId);
      if (router) return router;
    }

    // Fallback: O(n) search and cache the result
    for (const [id, router] of this.#routers.entries()) {
      try {
        if (router.session?.id === sessionId) {
          // Cache for future lookups
          this.#sessionToRouter.set(sessionId, id);
          return router;
        }
      } catch {
        // Session not available yet, skip this router
      }
    }
    return undefined;
  }

  /**
   * Wire session tracking to maintain session ID -> router ID mapping
   */
  #wireSessionTracking(): void {
    this.#sessionTrackingUnsubscribe = this.eventBus.on(
      "session.connected",
      (event: MAPEvent) => {
        // Session.connected event data is { session: ServerSession }
        const data = event.data as { session?: { id?: string } } | undefined;
        const sessionId = data?.session?.id;
        if (!sessionId) return;

        // Find the router that just established this session
        for (const router of this.#routers.values()) {
          try {
            if (router.session?.id === sessionId) {
              const routerId = (router as RouterConnectionImpl & { __routerId?: string }).__routerId;
              if (routerId) {
                this.#sessionToRouter.set(sessionId, routerId);
              }
              break;
            }
          } catch {
            // Session not available yet, skip this router
          }
        }
      }
    );
  }

  /**
   * Remove a dead connection by session ID
   */
  #removeDeadConnection(sessionId: string): void {
    const routerId = this.#sessionToRouter.get(sessionId);
    if (routerId) {
      const router = this.#routers.get(routerId);
      if (router) {
        // Close the dead router (this triggers cleanup in the closed promise)
        router.close().catch(() => {
          // Ignore close errors
        });
      }
      this.#sessionToRouter.delete(sessionId);
    }
  }

  /**
   * Start auth expiration monitoring.
   *
   * Periodically checks for sessions with expiring auth and sends
   * `map/auth/expiring` notifications to give clients time to refresh.
   *
   * @param options - Override default configuration
   */
  startAuthExpirationMonitor(options?: {
    checkIntervalMs?: number;
    notifyBeforeMs?: number;
  }): void {
    if (this.#authExpirationInterval) {
      return; // Already running
    }

    const checkIntervalMs = options?.checkIntervalMs ??
      this.#options.auth?.expirationNotification?.checkIntervalMs ?? 30000;
    const notifyBeforeMs = options?.notifyBeforeMs ??
      this.#options.auth?.expirationNotification?.notifyBeforeMs ?? 300000; // 5 minutes

    this.#authExpirationInterval = setInterval(() => {
      this.#checkAuthExpiration(notifyBeforeMs);
    }, checkIntervalMs);
  }

  /**
   * Stop auth expiration monitoring.
   */
  stopAuthExpirationMonitor(): void {
    if (this.#authExpirationInterval) {
      clearInterval(this.#authExpirationInterval);
      this.#authExpirationInterval = undefined;
    }
    this.#notifiedSessions.clear();
  }

  /**
   * Check for sessions with expiring auth and send notifications.
   */
  #checkAuthExpiration(notifyBeforeMs: number): void {
    const now = Date.now();
    const expirationThreshold = now + notifyBeforeMs;

    for (const router of this.#routers.values()) {
      try {
        const session = router.session;
        if (!session?.principal?.expiresAt) {
          continue;
        }

        const expiresAt = session.principal.expiresAt;

        // Skip if already notified or not expiring soon
        if (this.#notifiedSessions.has(session.id)) {
          // Clear notification flag if token was refreshed (expiresAt changed)
          continue;
        }

        // Check if expiring within threshold
        if (expiresAt <= expirationThreshold && expiresAt > now) {
          // Send expiring notification
          router
            .notify(NOTIFICATION_METHODS.AUTH_EXPIRING, {
              expiresAt,
              expiresInMs: expiresAt - now,
            })
            .then(() => {
              this.#notifiedSessions.add(session.id);
            })
            .catch(() => {
              // Connection may be dead
              this.#removeDeadConnection(session.id);
            });
        }
      } catch {
        // Session not available, skip
      }
    }

    // Clean up notified sessions that are no longer active
    for (const sessionId of this.#notifiedSessions) {
      if (!this.#sessionToRouter.has(sessionId)) {
        this.#notifiedSessions.delete(sessionId);
      }
    }
  }
}
