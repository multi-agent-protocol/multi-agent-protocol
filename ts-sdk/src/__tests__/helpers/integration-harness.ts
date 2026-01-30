/**
 * Integration Test Harness
 *
 * Uses MAPServer convenience wrapper to wire client SDK connections to server SDK.
 * Provides utilities for testing end-to-end client-server interactions.
 */

import { createStreamPair, type Stream } from "../../stream";
import { ClientConnection } from "../../connection/client";
import { AgentConnection } from "../../connection/agent";
import {
  MAPServer,
  type HandlerRegistry,
  type ServerMessage,
  type MAPEvent,
} from "../../server";
import type { Agent, ConnectResponseResult } from "../../types";

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
  // Server (provides access to all building blocks)
  readonly server: MAPServer;

  // Convenience accessors for building blocks
  readonly eventBus: MAPServer["eventBus"];
  readonly agents: MAPServer["agents"];
  readonly scopes: MAPServer["scopes"];
  readonly sessions: MAPServer["sessions"];
  readonly subscriptions: MAPServer["subscriptions"];
  readonly messages: MAPServer["messages"];
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
 * Internal tracking for active client connections.
 */
interface ActiveClientConnection {
  clientStream: Stream;
  connection: ClientConnection | AgentConnection;
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

  // Create server with MAPServer convenience wrapper
  const server = new MAPServer({
    name: serverName,
    version: serverVersion,
  });

  // Track delivered messages
  const deliveredMessages: DeliveredMessage[] = [];
  server.messages.onDeliver((agentId, message) => {
    deliveredMessages.push({ agentId, message });
  });

  // Track active client connections for cleanup
  const activeClientConnections: ActiveClientConnection[] = [];

  /**
   * Create and connect a client.
   */
  async function createClient(name?: string, resumeToken?: string): Promise<ConnectedClient> {
    const [clientStream, serverStream] = createStreamPair();

    // Create client connection
    const connection = new ClientConnection(clientStream, {
      name: name ?? "TestClient",
    });

    // Accept connection on server and start
    const router = server.accept(serverStream, {
      role: "client",
      resumeToken,
    });
    router.start();

    // Track for cleanup
    activeClientConnections.push({ clientStream, connection });

    // Connect client (with optional resume token)
    const connectResult = await connection.connect({ resumeToken });

    return {
      connection,
      connectResult,
      disconnect: async () => {
        const token = await connection.disconnect();
        const idx = activeClientConnections.findIndex(c => c.connection === connection);
        if (idx >= 0) {
          activeClientConnections.splice(idx, 1);
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
    const connection = new AgentConnection(clientStream, {
      name,
      role,
    });

    // Accept connection on server and start
    const router = server.accept(serverStream, {
      role: "agent",
      resumeToken,
    });
    router.start();

    // Track for cleanup
    activeClientConnections.push({ clientStream, connection });

    // Connect agent (this also registers the agent)
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
        const idx = activeClientConnections.findIndex(c => c.connection === connection);
        if (idx >= 0) {
          activeClientConnections.splice(idx, 1);
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
    // Close all active client connections
    const disconnectPromises = activeClientConnections.map(async (conn) => {
      try {
        await conn.connection.disconnect();
      } catch {
        // Ignore disconnect errors during cleanup
      }
    });

    await Promise.all(disconnectPromises);
    activeClientConnections.length = 0;

    // Close server (cleans up all server-side connections)
    await server.close({ force: true });

    deliveredMessages.length = 0;
  }

  return {
    server,
    eventBus: server.eventBus,
    agents: server.agents,
    scopes: server.scopes,
    sessions: server.sessions,
    subscriptions: server.subscriptions,
    messages: server.messages,
    handlers: server.handlers,
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
): Promise<MAPEvent> {
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
