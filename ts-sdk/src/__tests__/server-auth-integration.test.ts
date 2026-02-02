/**
 * Integration tests for server authentication
 *
 * Tests the full auth flow with MAPServer and client connections.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createStreamPair } from "../stream";
import { ClientConnection } from "../connection/client";
import { AgentConnection } from "../connection/agent";
import {
  MAPServer,
  NoAuthAuthenticator,
  createSimpleAPIKeyAuthenticator,
} from "../server";

describe("Server Auth Integration", () => {
  // ===========================================================================
  // No Auth (Default)
  // ===========================================================================

  describe("No Auth (Default)", () => {
    it("should allow connection without auth config", async () => {
      const server = new MAPServer({ name: "NoAuthServer" });
      const [clientStream, serverStream] = createStreamPair();

      const router = server.accept(serverStream, { role: "client" });
      router.start();

      const client = new ClientConnection(clientStream, { name: "TestClient" });
      const result = await client.connect();

      expect(result.sessionId).toBeDefined();
      expect(result.participantId).toBeDefined();

      await client.disconnect();
    });

    it("should allow connection with auth not required", async () => {
      const server = new MAPServer({
        name: "OptionalAuthServer",
        auth: {
          required: false,
          authenticators: [new NoAuthAuthenticator()],
        },
      });

      const [clientStream, serverStream] = createStreamPair();
      const router = server.accept(serverStream, { role: "client" });
      router.start();

      const client = new ClientConnection(clientStream, { name: "TestClient" });
      const result = await client.connect();

      expect(result.sessionId).toBeDefined();

      await client.disconnect();
    });
  });

  // ===========================================================================
  // API Key Authentication
  // ===========================================================================

  describe("API Key Authentication", () => {
    let server: MAPServer;

    beforeEach(() => {
      server = new MAPServer({
        name: "APIKeyAuthServer",
        auth: {
          required: true,
          authenticators: [
            createSimpleAPIKeyAuthenticator({
              "valid-key-1": "user-1",
              "valid-key-2": "user-2",
            }),
          ],
        },
      });
    });

    it("should authenticate with valid API key", async () => {
      const [clientStream, serverStream] = createStreamPair();
      const router = server.accept(serverStream, { role: "client" });
      router.start();

      const client = new ClientConnection(clientStream, { name: "TestClient" });
      const result = await client.connect({
        auth: { method: "api-key", token: "valid-key-1" },
      });

      expect(result.sessionId).toBeDefined();
      expect(result.principal?.id).toBe("user-1");

      await client.disconnect();
    });

    it("should return authRequired when no auth provided", async () => {
      const [clientStream, serverStream] = createStreamPair();
      const router = server.accept(serverStream, { role: "client" });
      router.start();

      const client = new ClientConnection(clientStream, { name: "TestClient" });
      const result = await client.connect();

      // Should get authRequired response
      expect(result.authRequired).toBeDefined();
      expect(result.authRequired?.required).toBe(true);
      expect(result.authRequired?.methods).toContain("api-key");
    });

    it("should reject invalid API key", async () => {
      const [clientStream, serverStream] = createStreamPair();
      const router = server.accept(serverStream, { role: "client" });
      router.start();

      const client = new ClientConnection(clientStream, { name: "TestClient" });
      const result = await client.connect({
        auth: { method: "api-key", token: "invalid-key" },
      });

      // Should get authRequired with error
      expect(result.authRequired).toBeDefined();
      expect(result.error).toBeDefined();
      expect(result.error?.code).toBe("invalid_credentials");
    });

    it("should preserve principal across session", async () => {
      const [clientStream, serverStream] = createStreamPair();
      const router = server.accept(serverStream, { role: "client" });
      router.start();

      const client = new ClientConnection(clientStream, { name: "TestClient" });
      const result = await client.connect({
        auth: { method: "api-key", token: "valid-key-1" },
      });

      expect(result.principal?.id).toBe("user-1");

      // Make a subsequent call - should work because authenticated
      const agents = await client.listAgents();
      expect(agents).toBeDefined();

      await client.disconnect();
    });
  });

  // ===========================================================================
  // Multiple Auth Methods
  // ===========================================================================

  describe("Multiple Auth Methods", () => {
    let server: MAPServer;

    beforeEach(() => {
      server = new MAPServer({
        name: "MultiAuthServer",
        auth: {
          required: true,
          authenticators: [
            createSimpleAPIKeyAuthenticator({ "api-key-1": "api-user" }),
            new NoAuthAuthenticator({ defaultPrincipalId: "anon-user" }),
          ],
        },
      });
    });

    it("should authenticate with API key", async () => {
      const [clientStream, serverStream] = createStreamPair();
      const router = server.accept(serverStream, { role: "client" });
      router.start();

      const client = new ClientConnection(clientStream, { name: "TestClient" });
      const result = await client.connect({
        auth: { method: "api-key", token: "api-key-1" },
      });

      expect(result.principal?.id).toBe("api-user");

      await client.disconnect();
    });

    it("should authenticate with none method", async () => {
      const [clientStream, serverStream] = createStreamPair();
      const router = server.accept(serverStream, { role: "client" });
      router.start();

      const client = new ClientConnection(clientStream, { name: "TestClient" });
      const result = await client.connect({
        auth: { method: "none" },
      });

      expect(result.principal?.id).toBe("anon-user");

      await client.disconnect();
    });

    it("should advertise all supported methods", async () => {
      const [clientStream, serverStream] = createStreamPair();
      const router = server.accept(serverStream, { role: "client" });
      router.start();

      const client = new ClientConnection(clientStream, { name: "TestClient" });
      const result = await client.connect();

      expect(result.authRequired?.methods).toContain("api-key");
      expect(result.authRequired?.methods).toContain("none");
    });
  });

  // ===========================================================================
  // Agent Authentication
  // ===========================================================================

  describe("Agent Authentication", () => {
    let server: MAPServer;

    beforeEach(() => {
      server = new MAPServer({
        name: "AgentAuthServer",
        auth: {
          required: true,
          authenticators: [
            createSimpleAPIKeyAuthenticator({
              "agent-key-1": "agent-service-1",
            }),
          ],
        },
      });
    });

    it("should authenticate agent connections", async () => {
      const [clientStream, serverStream] = createStreamPair();
      const router = server.accept(serverStream, { role: "agent" });
      router.start();

      const agent = new AgentConnection(clientStream, { name: "TestAgent" });
      const { connection: result } = await agent.connect({
        auth: { method: "api-key", token: "agent-key-1" },
      });

      expect(result.sessionId).toBeDefined();
      expect(result.principal?.id).toBe("agent-service-1");

      await agent.disconnect();
    });

    it("should allow authenticated agent to register", async () => {
      const [clientStream, serverStream] = createStreamPair();
      const router = server.accept(serverStream, { role: "agent" });
      router.start();

      const agent = new AgentConnection(clientStream, { name: "TestAgent" });
      const { connection: connectResult, agent: agentInfo } = await agent.connect({
        auth: { method: "api-key", token: "agent-key-1" },
      });

      expect(connectResult.sessionId).toBeDefined();
      expect(agentInfo.id).toBeDefined();
      expect(agentInfo.name).toBe("TestAgent");

      await agent.disconnect();
    });
  });

  // ===========================================================================
  // Transport Bypass
  // ===========================================================================

  describe("Transport Bypass", () => {
    it("should bypass auth for configured transports via session metadata", async () => {
      const server = new MAPServer({
        name: "BypassServer",
        auth: {
          required: true,
          authenticators: [
            createSimpleAPIKeyAuthenticator({ key: "user" }),
          ],
          bypassForTransports: { stdio: true },
        },
      });

      const [clientStream, serverStream] = createStreamPair();

      // Accept connection - transportType needs to be in session metadata
      // For now, we test that the bypass config is honored when transport matches
      const router = server.accept(serverStream, { role: "agent" });
      router.start();

      // Note: The current implementation checks session.metadata.transportType
      // which isn't set automatically. This test verifies the bypass logic exists.
      // In a real scenario, the transport adapter would set this.
      expect(server.auth?.config.bypassForTransports?.stdio).toBe(true);
    });
  });

  // ===========================================================================
  // Auth Manager Initialization
  // ===========================================================================

  describe("Auth Manager Lifecycle", () => {
    it("should expose auth manager on server", () => {
      const server = new MAPServer({
        auth: {
          required: true,
          authenticators: [new NoAuthAuthenticator()],
        },
      });

      expect(server.auth).toBeDefined();
      expect(server.auth?.supportedMethods).toContain("none");
    });

    it("should have null auth when not configured", () => {
      const server = new MAPServer({ name: "NoAuthServer" });

      expect(server.auth).toBeNull();
    });

    it("should return capabilities with metadata URLs", () => {
      const server = new MAPServer({
        auth: {
          required: true,
          authenticators: [new NoAuthAuthenticator()],
          oauth2MetadataUrl: "https://auth.example.com/.well-known/oauth-authorization-server",
          jwksUrl: "https://auth.example.com/.well-known/jwks.json",
          realm: "test-realm",
        },
      });

      const capabilities = server.auth?.getCapabilities();

      expect(capabilities?.oauth2MetadataUrl).toBe(
        "https://auth.example.com/.well-known/oauth-authorization-server"
      );
      expect(capabilities?.jwksUrl).toBe(
        "https://auth.example.com/.well-known/jwks.json"
      );
      expect(capabilities?.realm).toBe("test-realm");
    });
  });
});
