/**
 * ACP Agent Example
 *
 * This file demonstrates how to implement an ACP-enabled agent using the
 * ACPAgentAdapter class. The agent can:
 * - Handle ACP requests (initialize, newSession, prompt)
 * - Send streaming session updates to clients
 * - Make agent→client requests (permissions, file operations, terminals)
 *
 * In a real application, you would connect to an actual MAP server
 * using AgentConnection.connect(). This example uses TestServer for
 * demonstration purposes.
 */

import { TestServer } from "../../src/testing/server";
import { TestAgent } from "../../src/testing/agent";
import { TestClient } from "../../src/testing/client";
import { ACPAgentAdapter } from "../../src/acp/adapter";
import { ACP_PROTOCOL_VERSION, ACPError } from "../../src/acp/types";
import type {
  ACPSessionId,
  ACPAgentHandler,
  ACPAgentContext,
  ACPPromptRequest,
} from "../../src/acp/types";
import type { AgentConnection } from "../../src/connection/agent";

// =============================================================================
// Session Storage
// =============================================================================

interface SessionData {
  id: ACPSessionId;
  cwd: string;
  createdAt: Date;
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }>;
}

// =============================================================================
// Agent Implementation
// =============================================================================

/**
 * Example ACP agent that demonstrates all agent-side capabilities.
 */
class ExampleACPAgent {
  private readonly adapter: ACPAgentAdapter;
  private readonly sessions = new Map<ACPSessionId, SessionData>();
  private sessionCounter = 0;

  constructor(mapAgent: AgentConnection) {
    // Create the ACP adapter with our handler
    this.adapter = new ACPAgentAdapter(mapAgent, this.createHandler());
    console.log("[Agent] ACP adapter initialized");
  }

  /**
   * Create the ACP handler implementation.
   */
  private createHandler(): ACPAgentHandler {
    return {
      // Handle initialization
      initialize: async (params, ctx) => {
        console.log(`[Agent] Initialize from ${ctx.clientParticipantId}`);
        console.log(`[Agent] Client protocol version: ${params.protocolVersion}`);

        return {
          protocolVersion: ACP_PROTOCOL_VERSION,
          agentInfo: {
            name: "ExampleAgent",
            version: "1.0.0",
          },
          agentCapabilities: {
            loadSession: true,
          },
        };
      },

      // Handle authentication (optional)
      authenticate: async (params, ctx) => {
        console.log(`[Agent] Authenticate with method: ${params.methodId}`);
        // In a real agent, validate credentials here
        return {};
      },

      // Handle new session creation
      newSession: async (params, ctx) => {
        const sessionId = `session-${++this.sessionCounter}` as ACPSessionId;
        console.log(`[Agent] Creating session: ${sessionId}`);

        this.sessions.set(sessionId, {
          id: sessionId,
          cwd: params.cwd,
          createdAt: new Date(),
          conversationHistory: [],
        });

        return { sessionId };
      },

      // Handle loading existing session
      loadSession: async (params, ctx) => {
        console.log(`[Agent] Loading session: ${params.sessionId}`);

        if (!this.sessions.has(params.sessionId)) {
          throw new ACPError(-32002, `Session not found: ${params.sessionId}`);
        }

        return {};
      },

      // Handle session mode changes
      setSessionMode: async (params, ctx) => {
        console.log(`[Agent] Set session mode: ${params.modeId}`);
        return {};
      },

      // Handle prompts - the core agent logic
      prompt: async (params: ACPPromptRequest, ctx: ACPAgentContext) => {
        console.log("[Agent] Processing prompt...");

        const session = this.sessions.get(params.sessionId);
        if (!session) {
          throw new ACPError(-32002, `Session not found: ${params.sessionId}`);
        }

        // Extract text from prompt
        const promptText = params.prompt
          .filter((p): p is { type: "text"; text: string } => p.type === "text")
          .map((p) => p.text)
          .join(" ");

        // Store in conversation history
        session.conversationHistory.push({ role: "user", content: promptText });

        // Process based on content
        await this.processPrompt(promptText, params, ctx);

        return { stopReason: "end_turn" as const };
      },

      // Handle cancellation
      cancel: async (params, ctx) => {
        console.log(`[Agent] Cancel requested for session: ${params.sessionId}`);
        // In a real agent, cancel any ongoing operations
      },
    };
  }

  /**
   * Process a prompt and generate a response.
   */
  private async processPrompt(
    text: string,
    params: ACPPromptRequest,
    ctx: ACPAgentContext
  ): Promise<void> {
    const lowercaseText = text.toLowerCase();

    // Example: Handle file read request
    if (lowercaseText.includes("read file") || lowercaseText.includes("show me")) {
      await this.handleFileRead(params, ctx);
      return;
    }

    // Example: Handle file write request
    if (lowercaseText.includes("write file") || lowercaseText.includes("create file")) {
      await this.handleFileWrite(params, ctx);
      return;
    }

    // Example: Handle command execution
    if (lowercaseText.includes("run command") || lowercaseText.includes("execute")) {
      await this.handleCommandExecution(params, ctx);
      return;
    }

    // Default: Simple echo response with streaming
    await this.sendStreamingResponse(
      ctx,
      params.sessionId,
      `I received your message: "${text}"\n\nI can help you with:\n` +
        "- Reading files (say 'read file')\n" +
        "- Writing files (say 'write file')\n" +
        "- Running commands (say 'run command')\n"
    );
  }

  /**
   * Handle a file read request.
   */
  private async handleFileRead(params: ACPPromptRequest, ctx: ACPAgentContext): Promise<void> {
    // Request permission from client
    await this.sendStreamingResponse(
      ctx,
      params.sessionId,
      "I'll read the file for you. Requesting permission...\n"
    );

    const permission = await this.adapter.requestPermission(ctx.streamId, {
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

    if (permission.outcome.outcome !== "selected" || permission.outcome.optionId !== "allow") {
      await this.sendStreamingResponse(
        ctx,
        params.sessionId,
        "File read was denied.\n"
      );
      return;
    }

    // Read the file
    try {
      const result = await this.adapter.readTextFile(ctx.streamId, {
        sessionId: params.sessionId,
        path: "/project/README.md",
      });

      await this.sendStreamingResponse(
        ctx,
        params.sessionId,
        `Here's the file content:\n\`\`\`\n${result.content}\n\`\`\`\n`
      );
    } catch (error) {
      await this.sendStreamingResponse(
        ctx,
        params.sessionId,
        `Error reading file: ${error instanceof Error ? error.message : String(error)}\n`
      );
    }
  }

  /**
   * Handle a file write request.
   */
  private async handleFileWrite(params: ACPPromptRequest, ctx: ACPAgentContext): Promise<void> {
    // Request permission
    await this.sendStreamingResponse(
      ctx,
      params.sessionId,
      "I'll write to the file. Requesting permission...\n"
    );

    const permission = await this.adapter.requestPermission(ctx.streamId, {
      sessionId: params.sessionId,
      toolCall: {
        toolCallId: `tool-${Date.now()}`,
        title: "Write File",
        status: "pending",
      },
      options: [
        { optionId: "allow", kind: "allow_once", name: "Allow" },
        { optionId: "deny", kind: "reject_once", name: "Deny" },
      ],
    });

    if (permission.outcome.outcome !== "selected" || permission.outcome.optionId !== "allow") {
      await this.sendStreamingResponse(
        ctx,
        params.sessionId,
        "File write was denied.\n"
      );
      return;
    }

    // Write the file
    try {
      await this.adapter.writeTextFile(ctx.streamId, {
        sessionId: params.sessionId,
        path: "/project/output.txt",
        content: "This file was created by the agent.\n",
      });

      await this.sendStreamingResponse(
        ctx,
        params.sessionId,
        "File written successfully to /project/output.txt\n"
      );
    } catch (error) {
      await this.sendStreamingResponse(
        ctx,
        params.sessionId,
        `Error writing file: ${error instanceof Error ? error.message : String(error)}\n`
      );
    }
  }

  /**
   * Handle a command execution request.
   */
  private async handleCommandExecution(params: ACPPromptRequest, ctx: ACPAgentContext): Promise<void> {
    // Request permission
    await this.sendStreamingResponse(
      ctx,
      params.sessionId,
      "I'll run a command. Requesting permission...\n"
    );

    const permission = await this.adapter.requestPermission(ctx.streamId, {
      sessionId: params.sessionId,
      toolCall: {
        toolCallId: `tool-${Date.now()}`,
        title: "Run Command",
        status: "pending",
      },
      options: [
        { optionId: "allow", kind: "allow_once", name: "Allow" },
        { optionId: "deny", kind: "reject_once", name: "Deny" },
      ],
    });

    if (permission.outcome.outcome !== "selected" || permission.outcome.optionId !== "allow") {
      await this.sendStreamingResponse(
        ctx,
        params.sessionId,
        "Command execution was denied.\n"
      );
      return;
    }

    // Create a terminal
    try {
      const terminal = await this.adapter.createTerminal(ctx.streamId, {
        sessionId: params.sessionId,
        command: "echo 'Hello from the agent!'",
      });

      await this.sendStreamingResponse(
        ctx,
        params.sessionId,
        `Terminal created: ${terminal.terminalId}\n`
      );

      // Get output
      const output = await this.adapter.terminalOutput(ctx.streamId, {
        sessionId: params.sessionId,
        terminalId: terminal.terminalId,
      });

      await this.sendStreamingResponse(
        ctx,
        params.sessionId,
        `Output:\n${output.output}\n`
      );

      // Wait for exit
      const exit = await this.adapter.waitForTerminalExit(ctx.streamId, {
        sessionId: params.sessionId,
        terminalId: terminal.terminalId,
      });

      await this.sendStreamingResponse(
        ctx,
        params.sessionId,
        `Command completed with exit code: ${exit.exitCode}\n`
      );

      // Release terminal
      await this.adapter.releaseTerminal(ctx.streamId, {
        sessionId: params.sessionId,
        terminalId: terminal.terminalId,
      });
    } catch (error) {
      await this.sendStreamingResponse(
        ctx,
        params.sessionId,
        `Error running command: ${error instanceof Error ? error.message : String(error)}\n`
      );
    }
  }

  /**
   * Send a streaming response.
   */
  private async sendStreamingResponse(
    ctx: ACPAgentContext,
    sessionId: ACPSessionId,
    text: string
  ): Promise<void> {
    // For demonstration, send in chunks
    const chunks = text.match(/.{1,20}/g) ?? [text];

    for (const chunk of chunks) {
      await this.adapter.sendSessionUpdate(ctx.streamId, {
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: chunk },
        },
      });
      // Small delay to simulate streaming
      await new Promise((r) => setTimeout(r, 20));
    }

    // Store in conversation history
    const session = this.sessions.get(sessionId);
    if (session) {
      session.conversationHistory.push({ role: "assistant", content: text });
    }
  }

  /**
   * Get session by ID.
   */
  getSession(sessionId: ACPSessionId): SessionData | undefined {
    return this.sessions.get(sessionId);
  }
}

// =============================================================================
// Usage Example
// =============================================================================

async function main() {
  console.log("=== ACP Agent Example ===\n");

  // Setup: Create a test server for demonstration
  const server = new TestServer({ name: "Demo Server" });

  // Create and register the agent
  console.log("Creating MAP agent connection...");
  const mapAgent = await TestAgent.create(server, {
    name: "ExampleAgent",
    role: "assistant",
    capabilities: {
      protocols: ["acp"],
      acp: { version: "2024-10-07", features: ["streaming", "tools"] },
    },
  });

  // Create the ACP agent
  const _acpAgent = new ExampleACPAgent(mapAgent.connection);
  console.log(`Agent registered with ID: ${mapAgent.id}\n`);

  // Create a test client to interact with the agent
  const testClient = await TestClient.create(server);

  const acp = testClient.connection.createACPStream({
    targetAgent: mapAgent.id!,
    client: {
      requestPermission: async (request) => {
        console.log("[Client] Permission requested");
        return { outcome: { outcome: "selected" as const, optionId: "allow" } };
      },
      sessionUpdate: async (update) => {
        if (update.update.sessionUpdate === "agent_message_chunk") {
          const content = update.update.content;
          if (content.type === "text") {
            process.stdout.write(content.text);
          }
        }
      },
      readTextFile: async (request) => {
        console.log(`\n[Client] Reading file: ${request.path}`);
        return { content: "# Example File\n\nThis is example content." };
      },
      writeTextFile: async (request) => {
        console.log(`\n[Client] Writing file: ${request.path}`);
        return {};
      },
      createTerminal: async (request) => {
        console.log(`\n[Client] Creating terminal: ${request.command}`);
        return { terminalId: "term-1" };
      },
      terminalOutput: async () => ({ output: "Hello from the agent!\n", truncated: false }),
      waitForTerminalExit: async () => ({ exitCode: 0 }),
      releaseTerminal: async () => ({}),
    },
  });

  // Use the agent
  await acp.initialize({ protocolVersion: ACP_PROTOCOL_VERSION });
  await acp.newSession({ cwd: "/project", mcpServers: [] });

  console.log("\n--- Test 1: Simple prompt ---");
  console.log("Response: ");
  await acp.prompt({
    sessionId: acp.sessionId!,
    prompt: [{ type: "text", text: "Hello!" }],
  });
  console.log("\n");

  console.log("--- Test 2: File read ---");
  console.log("Response: ");
  await acp.prompt({
    sessionId: acp.sessionId!,
    prompt: [{ type: "text", text: "Please read file for me" }],
  });
  console.log("\n");

  console.log("--- Test 3: Command execution ---");
  console.log("Response: ");
  await acp.prompt({
    sessionId: acp.sessionId!,
    prompt: [{ type: "text", text: "Run command please" }],
  });
  console.log("\n");

  // Cleanup
  await acp.close();
  await testClient.disconnect();

  console.log("=== Agent Example Complete ===");
}

main().catch(console.error);
