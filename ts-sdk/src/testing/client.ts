/**
 * Test Client Helper
 *
 * Provides a convenient wrapper around ClientConnection for testing.
 * Automatically manages stream pairs and connection lifecycle.
 */

import { ClientConnection, type ClientConnectionOptions } from '../connection/client';
import { createStreamPair } from '../stream';
import type { TestServer } from './server';
import type {
  Agent,
  Scope,
  Event,
  EventType,
  SubscriptionFilter,
  AgentsListRequestParams,
  ScopesListRequestParams,
} from '../types';
import { Subscription } from '../subscription';

/**
 * Options for TestClient
 */
export interface TestClientOptions extends ClientConnectionOptions {
  /** Auto-connect on creation */
  autoConnect?: boolean;
}

/**
 * Test client for integration testing.
 *
 * Wraps ClientConnection with convenience methods and automatic
 * stream management for easier testing.
 */
export class TestClient {
  readonly #connection: ClientConnection;
  #subscriptions: Map<string, Subscription> = new Map();

  private constructor(connection: ClientConnection) {
    this.#connection = connection;
  }

  /**
   * Create and connect a test client
   */
  static async create(server: TestServer, options: TestClientOptions = {}): Promise<TestClient> {
    const [clientStream, serverStream] = createStreamPair();
    const connection = new ClientConnection(clientStream, options);
    server.acceptConnection(serverStream);

    const client = new TestClient(connection);

    if (options.autoConnect !== false) {
      await connection.connect();
    }

    return client;
  }

  /**
   * Get the underlying connection
   */
  get connection(): ClientConnection {
    return this.#connection;
  }

  /**
   * Whether the client is connected
   */
  get isConnected(): boolean {
    return this.#connection.isConnected;
  }

  /**
   * Current session ID
   */
  get sessionId(): string | null {
    return this.#connection.sessionId;
  }

  /**
   * Connect to the server
   */
  async connect(): Promise<void> {
    await this.#connection.connect();
  }

  /**
   * Disconnect from the server
   */
  async disconnect(): Promise<void> {
    // Close all subscriptions
    for (const sub of this.#subscriptions.values()) {
      await sub.unsubscribe();
    }
    this.#subscriptions.clear();

    await this.#connection.disconnect();
  }

  // ===========================================================================
  // Agent Queries
  // ===========================================================================

  /**
   * List all agents
   */
  async listAgents(options?: AgentsListRequestParams): Promise<Agent[]> {
    const result = await this.#connection.listAgents(options);
    return result.agents;
  }

  /**
   * Get agent by ID with optional hierarchy expansion
   */
  async getAgent(
    agentId: string,
    options?: { include?: { children?: boolean; descendants?: boolean } }
  ): Promise<{ agent: Agent; children?: Agent[]; descendants?: Agent[] }> {
    return this.#connection.getAgent(agentId, options);
  }

  /**
   * Find agent by name
   */
  async findAgentByName(name: string): Promise<Agent | undefined> {
    const agents = await this.listAgents();
    return agents.find((a) => a.name === name);
  }

  /**
   * Find agents by role
   */
  async findAgentsByRole(role: string): Promise<Agent[]> {
    const result = await this.#connection.listAgents({ filter: { roles: [role] } });
    return result.agents;
  }

  // ===========================================================================
  // Scope Queries
  // ===========================================================================

  /**
   * List all scopes
   */
  async listScopes(options?: ScopesListRequestParams): Promise<Scope[]> {
    const result = await this.#connection.listScopes(options);
    return result.scopes;
  }

  /**
   * Get scope by ID
   */
  async getScope(scopeId: string): Promise<Scope> {
    return this.#connection.getScope(scopeId);
  }

  // ===========================================================================
  // Messaging
  // ===========================================================================

  /**
   * Send message to agent
   */
  async sendTo(agentId: string, payload: unknown): Promise<string> {
    const result = await this.#connection.sendToAgent(agentId, payload);
    return result.messageId;
  }

  /**
   * Broadcast to all agents
   */
  async broadcast(payload: unknown): Promise<string> {
    const result = await this.#connection.broadcast(payload);
    return result.messageId;
  }

  /**
   * Send to all agents with a specific role
   */
  async sendToRole(role: string, payload: unknown): Promise<string> {
    const result = await this.#connection.sendToRole(role, payload);
    return result.messageId;
  }

  /**
   * Send to all agents in a scope
   */
  async sendToScope(scopeId: string, payload: unknown): Promise<string> {
    const result = await this.#connection.sendToScope(scopeId, payload);
    return result.messageId;
  }

  // ===========================================================================
  // Subscriptions
  // ===========================================================================

  /**
   * Subscribe to events with automatic tracking
   */
  async subscribe(filter?: SubscriptionFilter): Promise<Subscription> {
    const subscription = await this.#connection.subscribe(filter);
    this.#subscriptions.set(subscription.id, subscription);
    return subscription;
  }

  /**
   * Collect events matching filter for a duration
   */
  async collectEvents(
    filter: SubscriptionFilter,
    durationMs: number
  ): Promise<Event[]> {
    const events: Event[] = [];
    const subscription = await this.subscribe(filter);
    subscription.on('event', (event) => events.push(event));

    await new Promise((resolve) => setTimeout(resolve, durationMs));
    await subscription.unsubscribe();
    this.#subscriptions.delete(subscription.id);

    return events;
  }

  /**
   * Wait for a specific event type
   */
  async waitForEvent(
    eventType: EventType,
    timeoutMs: number = 5000
  ): Promise<Event> {
    const subscription = await this.subscribe({ eventTypes: [eventType] });

    try {
      return await new Promise<Event>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error(`Timeout waiting for event: ${eventType}`));
        }, timeoutMs);

        subscription.on('event', (event) => {
          clearTimeout(timeout);
          resolve(event);
        });
      });
    } finally {
      await subscription.unsubscribe();
      this.#subscriptions.delete(subscription.id);
    }
  }

  // ===========================================================================
  // Control
  // ===========================================================================

  /**
   * Stop an agent
   */
  async stopAgent(agentId: string, reason?: string): Promise<void> {
    await this.#connection.stopAgent(agentId, { reason });
  }

  /**
   * Inject context into an agent
   */
  async inject(
    agentId: string,
    content: unknown,
    delivery?: 'interrupt' | 'queue' | 'best-effort'
  ): Promise<void> {
    await this.#connection.inject(agentId, content, delivery);
  }
}
