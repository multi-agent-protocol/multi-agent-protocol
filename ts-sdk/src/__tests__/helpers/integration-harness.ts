/**
 * Integration Test Harness
 *
 * Wires client SDK connections to server SDK building blocks via stream pairs.
 * Provides utilities for testing end-to-end client-server interactions.
 */

import { createStreamPair, type Stream } from "../../stream";
import { ClientConnection } from "../../connection/client";
import { AgentConnection } from "../../connection/agent";
import {
  EventBusImpl,
  AgentRegistryImpl,
  ScopeManagerImpl,
  SessionManagerImpl,
  SubscriptionManagerImpl,
  MessageRouterImpl,
  RouterConnectionImpl,
  createConnectionHandlers,
  createAgentHandlers,
  createScopeHandlers,
  createMessageHandlers,
  createSubscriptionHandlers,
  combineHandlers,
  type HandlerRegistry,
  type ServerSession,
  type RegisteredAgent,
  type ServerMessage,
  type MAPEvent,
} from "../../server";
import type { Agent, ConnectResponseResult } from "../../types";
import { NOTIFICATION_METHODS } from "../../types";

/**
 * Connected client with its connection and cleanup function.
 */
export interface ConnectedClient {
  /** The client connection */
  connection: ClientConnection;
  /** Connection result from connect() */
  connectResult: ConnectResponseResult;
  /** Disconnect and cleanup, returns resume token */
  disconnect: () => Promise<string | undefined>;
}

/**
 * Connected agent with its connection, registered agent, and cleanup function.
 */
export interface ConnectedAgent {
  /** The agent connection */
  connection: AgentConnection;
  /** Connection result from connect() */
  connectResult: ConnectResponseResult;
  /** The registered agent */
  agent: Agent;
  /** Disconnect and cleanup, returns resume token */
  disconnect: () => Promise<string | undefined>;
}

/**
 * Message delivery record for tracking.
 */
export interface DeliveredMessage {
  agentId: string;
  message: ServerMessage;
}

/**
 * Integration test harness for wiring client SDK to server SDK.
 */
export interface IntegrationTestHarness {
  // Server building blocks (exposed for assertions)
  readonly eventBus: EventBusImpl;
  readonly agents: AgentRegistryImpl;
  readonly scopes: ScopeManagerImpl;
  readonly sessions: SessionManagerImpl;
  readonly subscriptions: SubscriptionManagerImpl;
  readonly messages: MessageRouterImpl;
  readonly handlers: HandlerRegistry;

  /**
   * Create and connect a client.
   * @param name - Optional client name
   * @param resumeToken - Optional resume token to restore a previous session
   * @returns Connected client with connection and disconnect function
   */
  createClient(name?: string, resumeToken?: string): Promise<ConnectedClient>;

  /**
   * Create, connect, and register an agent.
   * @param name - Agent name
   * @param role - Optional agent role
   * @param resumeToken - Optional resume token to restore a previous session
   * @returns Connected agent with connection, agent info, and disconnect function
   */
  createAgent(name: string, role?: string, resumeToken?: string): Promise<ConnectedAgent>;

  /**
   * Get all delivered messages (for assertions).
   */
  getDeliveredMessages(): DeliveredMessage[];

  /**
   * Clear delivered messages.
   */
  clearDeliveredMessages(): void;

  /**
   * Clean up all connections and resources.
   */
  cleanup(): Promise<void>;
}

/**
 * Options for creating an integration test harness.
 */
export interface IntegrationTestHarnessOptions {
  /** Server name for connect response */
  serverName?: string;
  /** Server version for connect response */
  serverVersion?: string;
}

/**
 * Internal tracking for active connections.
 */
interface ActiveConnection {
  clientStream: Stream;
  serverStream: Stream;
  router: RouterConnectionImpl;
  clientConnection?: ClientConnection | AgentConnection;
}

/**
 * Create an integration test harness.
 *
 * @example
 * ```typescript
 * const harness = createIntegrationHarness();
 *
 * // Create a client
 * const { connection: client, disconnect: disconnectClient } = await harness.createClient();
 *
 * // Create an agent
 * const { connection: agentConn, agent } = await harness.createAgent("TestAgent");
 *
 * // Use client to list agents
 * const agents = await client.listAgents();
 * expect(agents).toContainEqual(expect.objectContaining({ name: "TestAgent" }));
 *
 * // Cleanup
 * await harness.cleanup();
 * ```
 */
export function createIntegrationHarness(
  options: IntegrationTestHarnessOptions = {}
): IntegrationTestHarness {
  const { serverName = "Test Server", serverVersion = "1.0.0" } = options;

  // Create server building blocks
  const eventBus = new EventBusImpl();
  const sessions = new SessionManagerImpl({ eventBus });
  const agents = new AgentRegistryImpl({ eventBus });
  const scopes = new ScopeManagerImpl({ eventBus });
  const subscriptions = new SubscriptionManagerImpl({ eventBus, scopes });
  const messages = new MessageRouterImpl({ eventBus, agents, scopes });

  // Track delivered messages
  const deliveredMessages: DeliveredMessage[] = [];
  messages.onDeliver((agentId, message) => {
    deliveredMessages.push({ agentId, message });
  });

  // Combine handlers
  const handlers = combineHandlers(
    createConnectionHandlers({ sessions, serverName, serverVersion }),
    createAgentHandlers({ agents }),
    createScopeHandlers({ scopes }),
    createMessageHandlers({ messages, scopes }),
    createSubscriptionHandlers({ subscriptions, eventBus })
  );

  // Track active connections for cleanup
  const activeConnections: ActiveConnection[] = [];

  // Track event sequence numbers per subscription
  const subscriptionSequences: Map<string, number> = new Map();

  // Wire up event delivery to subscriptions
  eventBus.on("*", (event: MAPEvent) => {
    // Find matching subscriptions
    const matchingSubIds = subscriptions.match(event);

    for (const subId of matchingSubIds) {
      const subscription = subscriptions.get(subId);
      if (!subscription || subscription.paused) continue;

      // Find the RouterConnection for this subscription's session
      const activeConn = activeConnections.find(
        (conn) => conn.router.session?.id === subscription.sessionId
      );

      // Skip if connection not found
      if (!activeConn) continue;

      // Increment sequence number
      const seq = (subscriptionSequences.get(subId) ?? 0) + 1;
      subscriptionSequences.set(subId, seq);

      // Send event notification (catch errors for closed streams)
      activeConn.router.notify(NOTIFICATION_METHODS.EVENT, {
        subscriptionId: subId,
        sequenceNumber: seq,
        eventId: event.id,
        timestamp: event.timestamp,
        event,
      }).catch(() => {
        // Ignore notification errors for closed connections
      });
    }
  });

  /**
   * Create a server-side router connection for a stream.
   */
  function createServerRouter(
    serverStream: Stream,
    role: "client" | "agent",
    resumeToken?: string
  ): RouterConnectionImpl {
    const router = new RouterConnectionImpl({
      stream: serverStream,
      handlers,
      sessions,
      role,
      name: `${role}-session`,
      resumeToken,
    });
    return router;
  }

  /**
   * Create and connect a client.
   */
  async function createClient(name?: string, resumeToken?: string): Promise<ConnectedClient> {
    const [clientStream, serverStream] = createStreamPair();

    // Create client connection
    const connection = new ClientConnection(clientStream, {
      name: name ?? "TestClient",
    });

    // Create and start server router (with optional resume token)
    const router = createServerRouter(serverStream, "client", resumeToken);
    router.start();

    // Track for cleanup
    const activeConn: ActiveConnection = {
      clientStream,
      serverStream,
      router,
      clientConnection: connection,
    };
    activeConnections.push(activeConn);

    // Connect client (with optional resume token)
    const connectResult = await connection.connect({ resumeToken });

    return {
      connection,
      connectResult,
      disconnect: async () => {
        const token = await connection.disconnect();
        await router.close();
        const idx = activeConnections.indexOf(activeConn);
        if (idx >= 0) {
          activeConnections.splice(idx, 1);
        }
        return token;
      },
    };
  }

  /**
   * Create, connect, and register an agent.
   */
  async function createAgent(
    name: string,
    role?: string,
    resumeToken?: string
  ): Promise<ConnectedAgent> {
    const [clientStream, serverStream] = createStreamPair();

    // Create agent connection with name and role in options
    // AgentConnection.connect() handles registration automatically
    const connection = new AgentConnection(clientStream, {
      name,
      role,
    });

    // Create and start server router (with optional resume token)
    const router = createServerRouter(serverStream, "agent", resumeToken);
    router.start();

    // Track for cleanup
    const activeConn: ActiveConnection = {
      clientStream,
      serverStream,
      router,
      clientConnection: connection,
    };
    activeConnections.push(activeConn);

    // Connect agent (this also registers the agent, with optional resume token)
    const { connection: connResult, agent } = await connection.connect({ resumeToken });

    return {
      connection,
      connectResult: connResult,
      agent,
      disconnect: async () => {
        let token: string | undefined;
        try {
          token = await connection.disconnect();
        } catch {
          // Ignore disconnect errors during cleanup
        }
        await router.close();
        const idx = activeConnections.indexOf(activeConn);
        if (idx >= 0) {
          activeConnections.splice(idx, 1);
        }
        return token;
      },
    };
  }

  /**
   * Get all delivered messages.
   */
  function getDeliveredMessages(): DeliveredMessage[] {
    return [...deliveredMessages];
  }

  /**
   * Clear delivered messages.
   */
  function clearDeliveredMessages(): void {
    deliveredMessages.length = 0;
  }

  /**
   * Clean up all connections and resources.
   */
  async function cleanup(): Promise<void> {
    // Close all active connections
    const closePromises = activeConnections.map(async (conn) => {
      try {
        if (conn.clientConnection) {
          await conn.clientConnection.disconnect();
        }
      } catch {
        // Ignore disconnect errors during cleanup
      }
      try {
        await conn.router.close();
      } catch {
        // Ignore close errors during cleanup
      }
    });

    await Promise.all(closePromises);
    activeConnections.length = 0;
    deliveredMessages.length = 0;
  }

  return {
    eventBus,
    agents,
    scopes,
    sessions,
    subscriptions,
    messages,
    handlers,
    createClient,
    createAgent,
    getDeliveredMessages,
    clearDeliveredMessages,
    cleanup,
  };
}

/**
 * Helper to wait for an event to be emitted.
 */
export function waitForEvent(
  harness: IntegrationTestHarness,
  eventType: string,
  timeoutMs = 1000
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error(`Timeout waiting for event: ${eventType}`));
    }, timeoutMs);

    const unsubscribe = harness.eventBus.on(eventType, (event) => {
      clearTimeout(timeout);
      unsubscribe();
      resolve(event);
    });
  });
}

/**
 * Helper to wait for a specific number of messages to be delivered.
 */
export function waitForMessages(
  harness: IntegrationTestHarness,
  count: number,
  timeoutMs = 1000
): Promise<DeliveredMessage[]> {
  return new Promise((resolve, reject) => {
    const startCount = harness.getDeliveredMessages().length;
    const targetCount = startCount + count;

    const checkInterval = setInterval(() => {
      const current = harness.getDeliveredMessages();
      if (current.length >= targetCount) {
        clearInterval(checkInterval);
        clearTimeout(timeout);
        resolve(current.slice(startCount, targetCount));
      }
    }, 10);

    const timeout = setTimeout(() => {
      clearInterval(checkInterval);
      reject(
        new Error(
          `Timeout waiting for ${count} messages. Got ${harness.getDeliveredMessages().length - startCount}`
        )
      );
    }, timeoutMs);
  });
}
