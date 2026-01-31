/**
 * ACP Client Example
 *
 * This file demonstrates how to implement an ACP client using the
 * ACPStreamConnection class. The client can:
 * - Connect to an ACP-enabled agent via MAP
 * - Initialize and create sessions
 * - Send prompts and receive streaming responses
 * - Handle agent→client requests (permissions, file operations)
 *
 * In a real application, you would connect to an actual MAP server
 * rather than using TestServer. This example uses TestServer for
 * demonstration purposes.
 */

import { TestServer } from "../../src/testing/server";
import { TestClient } from "../../src/testing/client";
import { createACPTestAgent } from "../../src/testing/test-acp-agent";
import { ACP_PROTOCOL_VERSION, ACPError } from "../../src/acp/types";
import type { ACPSessionId, ACPSessionNotification } from "../../src/acp/types";
import type { ClientConnection } from "../../src/connection/client";
import type { ACPStreamConnection } from "../../src/acp/stream";

// =============================================================================
// Client Implementation
// =============================================================================

/**
 * Example ACP client that demonstrates all client-side capabilities.
 */
class ExampleACPClient {
  readonly connection: ACPStreamConnection;
  private onUpdate?: (update: ACPSessionNotification) => void;

  constructor(
    stream: ACPStreamConnection,
    onUpdate?: (update: ACPSessionNotification) => void
  ) {
    this.connection = stream;
    this.onUpdate = onUpdate;
  }

  /**
   * Create an ACP client connected to a target agent.
   *
   * @param mapClient - The MAP client connection
   * @param targetAgent - The agent ID to connect to
   * @param options - Client configuration options
   */
  static create(
    mapClient: ClientConnection,
    targetAgent: string,
    options: {
      /** Called when streaming updates are received */
      onUpdate?: (update: ACPSessionNotification) => void;
      /** Virtual file system for file operations */
      fileSystem?: Map<string, string>;
      /** Whether to auto-approve permission requests */
      autoApprovePermissions?: boolean;
    } = {}
  ): ExampleACPClient {
    const fileSystem = options.fileSystem ?? new Map();
    const autoApprove = options.autoApprovePermissions ?? false;

    const stream = mapClient.createACPStream({
      targetAgent,
      client: {
        // Handle permission requests from agent
        requestPermission: async (request) => {
          if (autoApprove) {
            console.log("[Client] Auto-approving permission request");
            return {
              outcome: { outcome: "selected" as const, optionId: request.options[0].optionId },
            };
          }

          // In a real app, you'd show a UI dialog here
          console.log("[Client] Permission requested:");
          for (const opt of request.options) {
            console.log(`  - ${opt.optionId}: ${opt.name} (${opt.kind})`);
          }

          // For demo, always allow
          const allowOption = request.options.find((o) =>
            o.kind === "allow_once" || o.kind === "allow_always"
          );
          return {
            outcome: {
              outcome: "selected" as const,
              optionId: allowOption?.optionId ?? request.options[0].optionId,
            },
          };
        },

        // Handle streaming session updates
        sessionUpdate: async (update) => {
          if (options.onUpdate) {
            options.onUpdate(update);
          }
        },

        // Handle file read requests from agent
        readTextFile: async (request) => {
          const content = fileSystem.get(request.path);
          if (content !== undefined) {
            return { content };
          }
          throw new ACPError(-32001, `File not found: ${request.path}`);
        },

        // Handle file write requests from agent
        writeTextFile: async (request) => {
          fileSystem.set(request.path, request.content);
          return {};
        },

        // Handle terminal creation requests
        createTerminal: async (request) => {
          // In a real app, you'd create a PTY here
          console.log(`[Client] Terminal creation requested: ${request.command}`);
          return { terminalId: `terminal-${Date.now()}` };
        },

        // Handle terminal output requests
        terminalOutput: async (request) => {
          // In a real app, you'd read from the PTY buffer
          return { output: "$ command output here\n", truncated: false };
        },

        // Handle terminal release requests
        releaseTerminal: async (request) => {
          console.log(`[Client] Releasing terminal: ${request.terminalId}`);
          return {};
        },

        // Handle terminal wait requests
        waitForTerminalExit: async (request) => {
          console.log(`[Client] Waiting for terminal exit: ${request.terminalId}`);
          return { exitCode: 0 };
        },

        // Handle terminal kill requests
        killTerminal: async (request) => {
          console.log(`[Client] Killing terminal: ${request.terminalId}`);
          return {};
        },
      },
    });

    return new ExampleACPClient(stream, options.onUpdate);
  }

  /** Get the stream ID */
  get streamId(): string {
    return this.connection.streamId;
  }

  /** Get the current session ID */
  get sessionId(): string | null {
    return this.connection.sessionId;
  }

  /** Whether the stream is initialized */
  get initialized(): boolean {
    return this.connection.initialized;
  }

  /**
   * Initialize the ACP connection with the agent.
   */
  async initialize(clientInfo: { name: string; version: string }) {
    console.log("[Client] Initializing ACP connection...");

    const response = await this.connection.initialize({
      protocolVersion: ACP_PROTOCOL_VERSION,
      clientInfo,
    });

    console.log(`[Client] Connected to: ${response.agentInfo?.name} v${response.agentInfo?.version}`);
    console.log(`[Client] Agent capabilities: ${JSON.stringify(response.agentCapabilities)}`);

    return response;
  }

  /**
   * Create a new ACP session.
   */
  async createSession(cwd: string) {
    console.log(`[Client] Creating session in ${cwd}...`);

    const response = await this.connection.newSession({
      cwd,
      mcpServers: [],
    });

    console.log(`[Client] Session created: ${response.sessionId}`);
    return response;
  }

  /**
   * Send a prompt and wait for response.
   * Streaming updates are delivered via the onUpdate callback.
   */
  async prompt(text: string) {
    if (!this.sessionId) {
      throw new Error("No active session. Call createSession first.");
    }

    console.log(`[Client] Sending prompt: "${text.substring(0, 50)}..."`);

    const response = await this.connection.prompt({
      sessionId: this.sessionId as ACPSessionId,
      prompt: [{ type: "text", text }],
    });

    console.log(`[Client] Prompt completed: ${response.stopReason}`);
    return response;
  }

  /**
   * Cancel ongoing operations.
   */
  async cancel() {
    console.log("[Client] Cancelling...");
    await this.connection.cancel();
  }

  /**
   * Close the ACP stream.
   */
  async close() {
    console.log("[Client] Closing ACP stream...");
    await this.connection.close();
  }
}

// =============================================================================
// Usage Example
// =============================================================================

async function main() {
  console.log("=== ACP Client Example ===\n");

  // Setup: Create a test server and agent for demonstration
  const server = new TestServer({ name: "Demo Server" });

  const { agent, adapter } = await createACPTestAgent(server, {
    name: "DemoAgent",
    handler: {
      initialize: async () => ({
        protocolVersion: ACP_PROTOCOL_VERSION,
        agentInfo: { name: "DemoAgent", version: "1.0.0" },
        agentCapabilities: { loadSession: true },
      }),
      newSession: async () => ({
        sessionId: `session-${Date.now()}` as ACPSessionId,
      }),
      prompt: async (params, ctx) => {
        // Send streaming response
        const words = "Hello! I received your message.".split(" ");
        for (const word of words) {
          await adapter.sendSessionUpdate(ctx.streamId, {
            sessionId: params.sessionId,
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: word + " " },
            },
          });
          await new Promise((r) => setTimeout(r, 100));
        }
        return { stopReason: "end_turn" as const };
      },
      cancel: async () => {},
    },
  });

  // Connect via MAP
  const testClient = await TestClient.create(server);

  // Create ACP client with streaming handler
  const acpClient = ExampleACPClient.create(
    testClient.connection,
    agent.id!,
    {
      onUpdate: (update) => {
        if (update.update.sessionUpdate === "agent_message_chunk") {
          const content = update.update.content;
          if (content.type === "text") {
            process.stdout.write(content.text);
          }
        }
      },
      fileSystem: new Map([
        ["/project/file.txt", "Hello, world!"],
      ]),
      autoApprovePermissions: true,
    }
  );

  // Use the client
  await acpClient.initialize({ name: "MyIDE", version: "1.0" });
  await acpClient.createSession("/project");

  console.log("\nAgent response: ");
  await acpClient.prompt("Hello, agent!");
  console.log("\n");

  // Cleanup
  await acpClient.close();
  await testClient.disconnect();

  console.log("=== Client Example Complete ===");
}

main().catch(console.error);
