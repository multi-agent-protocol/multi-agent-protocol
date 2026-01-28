/**
 * Test Agent Helper
 *
 * Provides a convenient wrapper around AgentConnection for testing.
 * Automatically manages stream pairs and connection lifecycle.
 */

import { AgentConnection, type AgentConnectionOptions } from '../connection/agent';
import { createStreamPair } from '../stream';
import type { TestServer } from './server';
import type {
  Agent,
  AgentId,
  Scope,
  ScopeId,
  Message,
  Event,
  EventType,
  SubscriptionFilter,
} from '../types';
import { Subscription } from '../subscription';

/**
 * Options for TestAgent
 */
export interface TestAgentOptions extends AgentConnectionOptions {
  /** Auto-connect on creation */
  autoConnect?: boolean;
  /** Pre-assigned agent ID */
  agentId?: AgentId;
}

/**
 * Test agent for integration testing.
 *
 * Wraps AgentConnection with convenience methods and automatic
 * stream management for easier testing.
 */
export class TestAgent {
  readonly #connection: AgentConnection;
  readonly #receivedMessages: Message[] = [];
  #subscriptions: Map<string, Subscription> = new Map();

  private constructor(connection: AgentConnection) {
    this.#connection = connection;

    // Auto-track received messages
    connection.onMessage((msg) => {
      this.#receivedMessages.push(msg);
    });
  }

  /**
   * Create and connect a test agent
   */
  static async create(server: TestServer, options: TestAgentOptions = {}): Promise<TestAgent> {
    const [clientStream, serverStream] = createStreamPair();
    const connection = new AgentConnection(clientStream, options);
    server.acceptConnection(serverStream);

    const agent = new TestAgent(connection);

    if (options.autoConnect !== false) {
      await connection.connect({ agentId: options.agentId });
    }

    return agent;
  }

  /**
   * Get the underlying connection
   */
  get connection(): AgentConnection {
    return this.#connection;
  }

  /**
   * Whether the agent is connected
   */
  get isConnected(): boolean {
    return this.#connection.isConnected;
  }

  /**
   * Agent ID
   */
  get id(): AgentId | null {
    return this.#connection.agentId;
  }

  /**
   * Current state
   */
  get state(): string {
    return this.#connection.state;
  }

  /**
   * Session ID
   */
  get sessionId(): string | null {
    return this.#connection.sessionId;
  }

  /**
   * All messages received by this agent
   */
  get receivedMessages(): readonly Message[] {
    return this.#receivedMessages;
  }

  /**
   * Get the last received message
   */
  get lastMessage(): Message | undefined {
    return this.#receivedMessages[this.#receivedMessages.length - 1];
  }

  /**
   * Clear received messages
   */
  clearMessages(): void {
    this.#receivedMessages.length = 0;
  }

  /**
   * Connect to the server
   */
  async connect(agentId?: AgentId): Promise<Agent> {
    const result = await this.#connection.connect({ agentId });
    return result.agent;
  }

  /**
   * Disconnect from the server
   */
  async disconnect(reason?: string): Promise<void> {
    // Close all subscriptions
    for (const sub of this.#subscriptions.values()) {
      await sub.unsubscribe();
    }
    this.#subscriptions.clear();

    await this.#connection.disconnect(reason);
  }

  // ===========================================================================
  // State Management
  // ===========================================================================

  /**
   * Update state
   */
  async setState(state: 'idle' | 'busy' | 'suspended' | 'stopping' | 'stopped'): Promise<Agent> {
    return this.#connection.updateState(state);
  }

  /**
   * Mark as busy
   */
  async busy(): Promise<Agent> {
    return this.#connection.busy();
  }

  /**
   * Mark as idle
   */
  async idle(): Promise<Agent> {
    return this.#connection.idle();
  }

  /**
   * Mark as done
   */
  async done(exitCode?: number, exitReason?: string): Promise<void> {
    await this.#connection.done({ exitCode, exitReason });
  }

  /**
   * Update metadata
   */
  async setMetadata(metadata: Record<string, unknown>): Promise<Agent> {
    return this.#connection.updateMetadata(metadata);
  }

  // ===========================================================================
  // Child Agent Management
  // ===========================================================================

  /**
   * Spawn a child agent
   */
  async spawn(options: {
    name?: string;
    role?: string;
    agentId?: AgentId;
  } = {}): Promise<Agent> {
    const result = await this.#connection.spawn(options);
    return result.agent;
  }

  /**
   * Spawn and return a connected TestAgent for the child
   */
  async spawnTestAgent(
    server: TestServer,
    options: TestAgentOptions = {}
  ): Promise<TestAgent> {
    // Spawn the agent on the server
    await this.#connection.spawn({
      name: options.name,
      role: options.role,
      agentId: options.agentId,
    });

    // Create a new test agent that represents the spawned child
    const child = await TestAgent.create(server, {
      ...options,
      parent: this.id!,
      autoConnect: false,
    });

    return child;
  }

  // ===========================================================================
  // Scope Management
  // ===========================================================================

  /**
   * Create a scope
   */
  async createScope(name: string, options?: { description?: string }): Promise<Scope> {
    return this.#connection.createScope({ name, ...options });
  }

  /**
   * Join a scope
   */
  async joinScope(scopeId: ScopeId): Promise<{ scope: Scope; agent: Agent }> {
    return this.#connection.joinScope(scopeId);
  }

  /**
   * Leave a scope
   */
  async leaveScope(scopeId: ScopeId): Promise<{ scope: Scope; agent: Agent }> {
    return this.#connection.leaveScope(scopeId);
  }

  // ===========================================================================
  // Messaging
  // ===========================================================================

  /**
   * Send to another agent
   */
  async sendTo(agentId: AgentId, payload: unknown): Promise<string> {
    const result = await this.#connection.sendToAgent(agentId, payload);
    return result.messageId;
  }

  /**
   * Send to parent
   */
  async sendToParent(payload: unknown): Promise<string> {
    const result = await this.#connection.sendToParent(payload);
    return result.messageId;
  }

  /**
   * Send to children
   */
  async sendToChildren(payload: unknown): Promise<string> {
    const result = await this.#connection.sendToChildren(payload);
    return result.messageId;
  }

  /**
   * Send to siblings
   */
  async sendToSiblings(payload: unknown): Promise<string> {
    const result = await this.#connection.sendToSiblings(payload);
    return result.messageId;
  }

  /**
   * Send to scope
   */
  async sendToScope(scopeId: ScopeId, payload: unknown): Promise<string> {
    const result = await this.#connection.sendToScope(scopeId, payload);
    return result.messageId;
  }

  /**
   * Reply to a message
   */
  async reply(message: Message, payload: unknown): Promise<string> {
    const result = await this.#connection.reply(message, payload);
    return result.messageId;
  }

  /**
   * Wait for a message
   */
  async waitForMessage(timeoutMs: number = 5000): Promise<Message> {
    const startLen = this.#receivedMessages.length;

    return new Promise<Message>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout waiting for message'));
      }, timeoutMs);

      const checkInterval = setInterval(() => {
        if (this.#receivedMessages.length > startLen) {
          clearTimeout(timeout);
          clearInterval(checkInterval);
          resolve(this.#receivedMessages[this.#receivedMessages.length - 1]);
        }
      }, 10);
    });
  }

  // ===========================================================================
  // Subscriptions
  // ===========================================================================

  /**
   * Subscribe to events
   */
  async subscribe(filter?: SubscriptionFilter): Promise<Subscription> {
    const subscription = await this.#connection.subscribe(filter);
    this.#subscriptions.set(subscription.id, subscription);
    return subscription;
  }

  /**
   * Wait for a specific event
   */
  async waitForEvent(eventType: EventType, timeoutMs: number = 5000): Promise<Event> {
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
}
