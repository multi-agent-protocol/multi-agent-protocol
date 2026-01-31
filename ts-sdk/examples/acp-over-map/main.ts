/**
 * ACP-over-MAP End-to-End Example
 *
 * This example demonstrates the complete ACP-over-MAP integration:
 * - Setting up a MAP server (TestServer for demonstration)
 * - Registering an ACP-enabled agent
 * - Connecting a client and creating an ACP stream
 * - Full ACP lifecycle: initialize → newSession → prompt
 * - Streaming session updates
 * - Agent→client requests (permissions, file operations)
 * - Error handling
 *
 * Run with: npx tsx examples/acp-over-map/main.ts
 */

import { TestServer } from "../../src/testing/server";
import { TestClient } from "../../src/testing/client";
import { createACPTestAgent } from "../../src/testing/test-acp-agent";
import { ACP_PROTOCOL_VERSION, ACPError } from "../../src/acp/types";
import type {
  ACPSessionId,
  ACPPromptRequest,
  ACPAgentContext,
  ACPSessionNotification,
} from "../../src/acp/types";

// =============================================================================
// Simulated File System (for demonstrating file operations)
// =============================================================================

const mockFileSystem = new Map<string, string>([
  ["/project/README.md", "# My Project\n\nA sample project."],
  ["/project/src/index.ts", 'console.log("Hello, world!");'],
]);

// =============================================================================
// Main Example
// =============================================================================

async function main(): Promise<void> {
  console.log("=== ACP-over-MAP End-to-End Example ===\n");

  // ---------------------------------------------------------------------------
  // Step 1: Create the MAP server
  // ---------------------------------------------------------------------------
  console.log("1. Creating MAP server...");
  const server = new TestServer({ name: "Example MAP Server" });
  console.log("   Server created.\n");

  // ---------------------------------------------------------------------------
  // Step 2: Register an ACP-enabled agent
  // ---------------------------------------------------------------------------
  console.log("2. Registering ACP-enabled agent...");

  const { agent, adapter } = await createACPTestAgent(server, {
    name: "CodingAssistant",
    role: "assistant",
    handler: {
      // Handle initialization
      initialize: async (params, ctx) => {
        console.log(`   [Agent] Received initialize from stream ${ctx.streamId}`);
        console.log(`   [Agent] Client protocol version: ${params.protocolVersion}`);

        return {
          protocolVersion: ACP_PROTOCOL_VERSION,
          agentInfo: {
            name: "CodingAssistant",
            version: "1.0.0",
          },
          agentCapabilities: {
            loadSession: true,
          },
        };
      },

      // Handle new session creation
      newSession: async (params, ctx) => {
        console.log(`   [Agent] Creating new session in ${params.cwd}`);
        const sessionId = `session-${Date.now()}` as ACPSessionId;
        return { sessionId };
      },

      // Handle prompts with streaming and agent→client requests
      prompt: async (params: ACPPromptRequest, ctx: ACPAgentContext) => {
        console.log(`   [Agent] Received prompt: ${JSON.stringify(params.prompt)}`);

        // Send initial acknowledgment
        await adapter.sendSessionUpdate(ctx.streamId, {
          sessionId: params.sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "Let me help you with that.\n\n" },
          },
        });

        // Check the prompt content to decide what to do
        const promptText = params.prompt
          .filter((p): p is { type: "text"; text: string } => p.type === "text")
          .map((p) => p.text)
          .join(" ");

        // Example 1: Reading a file (agent→client request)
        if (promptText.toLowerCase().includes("read")) {
          console.log("   [Agent] Requesting file read from client...");

          // Request permission first
          const permission = await adapter.requestPermission(ctx.streamId, {
            sessionId: params.sessionId,
            toolCall: {
              toolCallId: `tool-${Date.now()}`,
              title: "Read File",
              status: "pending",
            },
            options: [
              { optionId: "allow", kind: "allow_once", name: "Allow" },
              { optionId: "deny", kind: "reject_once", name: "Deny" },
            ],
          });

          if (permission.outcome.outcome === "selected" && permission.outcome.optionId === "allow") {
            // Read the file
            const fileResult = await adapter.readTextFile(ctx.streamId, {
              sessionId: params.sessionId,
              path: "/project/README.md",
            });

            await adapter.sendSessionUpdate(ctx.streamId, {
              sessionId: params.sessionId,
              update: {
                sessionUpdate: "agent_message_chunk",
                content: {
                  type: "text",
                  text: `Here's the file content:\n\`\`\`\n${fileResult.content}\n\`\`\`\n`,
                },
              },
            });
          } else {
            await adapter.sendSessionUpdate(ctx.streamId, {
              sessionId: params.sessionId,
              update: {
                sessionUpdate: "agent_message_chunk",
                content: { type: "text", text: "File read was denied by the client.\n" },
              },
            });
          }
        }

        // Example 2: Simple response with streaming
        else {
          // Simulate streaming text generation
          const words = ["I", "can", "help", "you", "with", "coding", "tasks!"];
          for (const word of words) {
            await adapter.sendSessionUpdate(ctx.streamId, {
              sessionId: params.sessionId,
              update: {
                sessionUpdate: "agent_message_chunk",
                content: { type: "text", text: word + " " },
              },
            });
            // Small delay to simulate streaming
            await new Promise((r) => setTimeout(r, 50));
          }
        }

        return { stopReason: "end_turn" as const };
      },

      // Handle cancellation
      cancel: async (params, ctx) => {
        console.log(`   [Agent] Cancel requested for session ${params.sessionId}`);
      },
    },
    acpCapability: {
      version: "2024-10-07",
      features: ["streaming", "tools", "permissions"],
    },
  });

  console.log(`   Agent registered with ID: ${agent.id}\n`);

  // ---------------------------------------------------------------------------
  // Step 3: Connect a client
  // ---------------------------------------------------------------------------
  console.log("3. Connecting client...");
  const client = await TestClient.create(server);
  console.log(`   Client connected with session: ${client.sessionId}\n`);

  // ---------------------------------------------------------------------------
  // Step 4: Verify agent is discoverable
  // ---------------------------------------------------------------------------
  console.log("4. Discovering agents...");
  const agents = await client.listAgents();
  const codingAgent = agents.find((a) => a.name === "CodingAssistant");
  console.log(`   Found agent: ${codingAgent?.name}`);
  console.log(`   Capabilities: ${JSON.stringify(codingAgent?.capabilities)}\n`);

  // ---------------------------------------------------------------------------
  // Step 5: Create ACP stream and connect to agent
  // ---------------------------------------------------------------------------
  console.log("5. Creating ACP stream...");

  const sessionUpdates: ACPSessionNotification[] = [];

  const acp = client.connection.createACPStream({
    targetAgent: agent.id!,
    client: {
      // Handle permission requests from agent
      requestPermission: async (request) => {
        console.log(`   [Client] Permission requested: ${request.options.length} options`);
        // Auto-approve for this demo
        return {
          outcome: { outcome: "selected" as const, optionId: "allow" },
        };
      },

      // Handle session updates (streaming)
      sessionUpdate: async (update) => {
        sessionUpdates.push(update);
        // Log streaming content
        if (update.update.sessionUpdate === "agent_message_chunk") {
          const content = update.update.content;
          if (content.type === "text") {
            process.stdout.write(content.text);
          }
        }
      },

      // Handle file read requests from agent
      readTextFile: async (request) => {
        console.log(`\n   [Client] File read requested: ${request.path}`);
        const content = mockFileSystem.get(request.path);
        if (content) {
          return { content };
        }
        throw new ACPError(-32001, `File not found: ${request.path}`);
      },

      // Handle file write requests from agent
      writeTextFile: async (request) => {
        console.log(`   [Client] File write requested: ${request.path}`);
        mockFileSystem.set(request.path, request.content);
        return {};
      },
    },
  });

  console.log(`   ACP stream created: ${acp.streamId}\n`);

  // ---------------------------------------------------------------------------
  // Step 6: Initialize ACP connection
  // ---------------------------------------------------------------------------
  console.log("6. Initializing ACP connection...");

  const initResponse = await acp.initialize({
    protocolVersion: ACP_PROTOCOL_VERSION,
    clientInfo: {
      name: "ExampleIDE",
      version: "2.0.0",
    },
  });

  console.log(`   Protocol version: ${initResponse.protocolVersion}`);
  console.log(`   Agent: ${initResponse.agentInfo?.name} v${initResponse.agentInfo?.version}`);
  console.log(`   Capabilities: ${JSON.stringify(initResponse.agentCapabilities)}\n`);

  // ---------------------------------------------------------------------------
  // Step 7: Create a new session
  // ---------------------------------------------------------------------------
  console.log("7. Creating new session...");

  const sessionResponse = await acp.newSession({
    cwd: "/project",
    mcpServers: [],
  });

  console.log(`   Session created: ${sessionResponse.sessionId}\n`);

  // ---------------------------------------------------------------------------
  // Step 8: Send a simple prompt
  // ---------------------------------------------------------------------------
  console.log("8. Sending simple prompt...");
  console.log('   Prompt: "Hello, what can you help me with?"\n');
  console.log("   Agent response: ");

  const promptResponse1 = await acp.prompt({
    sessionId: sessionResponse.sessionId,
    prompt: [{ type: "text", text: "Hello, what can you help me with?" }],
  });

  console.log(`\n   Stop reason: ${promptResponse1.stopReason}\n`);

  // ---------------------------------------------------------------------------
  // Step 9: Send a prompt that triggers file read
  // ---------------------------------------------------------------------------
  console.log("9. Sending prompt with file read...");
  console.log('   Prompt: "Can you read the README file?"\n');
  console.log("   Agent response: ");

  const promptResponse2 = await acp.prompt({
    sessionId: sessionResponse.sessionId,
    prompt: [{ type: "text", text: "Can you read the README file?" }],
  });

  console.log(`\n   Stop reason: ${promptResponse2.stopReason}\n`);

  // ---------------------------------------------------------------------------
  // Step 10: Show streaming updates collected
  // ---------------------------------------------------------------------------
  console.log("10. Session updates received:", sessionUpdates.length);
  const updateTypes = Array.from(new Set(sessionUpdates.map((u) => u.update.sessionUpdate)));
  console.log("    Update types:", updateTypes);
  console.log("");

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------
  console.log("11. Cleaning up...");
  await acp.close();
  await client.disconnect();
  console.log("    Done!\n");

  console.log("=== Example Complete ===");
}

// =============================================================================
// Error Handling Example
// =============================================================================

async function errorHandlingExample(): Promise<void> {
  console.log("\n=== Error Handling Example ===\n");

  const server = new TestServer({ name: "Error Example Server" });

  // Create an agent that throws errors
  const { agent } = await createACPTestAgent(server, {
    name: "ErrorAgent",
    handler: {
      initialize: async () => ({
        protocolVersion: ACP_PROTOCOL_VERSION,
        agentInfo: { name: "ErrorAgent", version: "1.0" },
      }),
      newSession: async () => {
        // Simulate an error
        throw new ACPError(-32001, "Session limit exceeded");
      },
      prompt: async () => ({ stopReason: "end_turn" as const }),
      cancel: async () => {},
    },
  });

  const client = await TestClient.create(server);

  const acp = client.connection.createACPStream({
    targetAgent: agent.id!,
    client: {
      requestPermission: async () => ({
        outcome: { outcome: "selected" as const, optionId: "allow" },
      }),
      sessionUpdate: async () => {},
    },
  });

  await acp.initialize({ protocolVersion: ACP_PROTOCOL_VERSION });

  try {
    await acp.newSession({ cwd: "/project", mcpServers: [] });
  } catch (error) {
    if (error instanceof ACPError) {
      console.log("Caught ACP error:");
      console.log(`  Code: ${error.code}`);
      console.log(`  Message: ${error.message}`);
    } else {
      console.log("Caught error:", error);
    }
  }

  await acp.close();
  await client.disconnect();

  console.log("\n=== Error Handling Example Complete ===\n");
}

// =============================================================================
// Run Examples
// =============================================================================

main()
  .then(() => errorHandlingExample())
  .catch(console.error);
