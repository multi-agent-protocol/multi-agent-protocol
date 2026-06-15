/**
 * CORE CONFORMANCE PACK (Phase 1, consolidation plan §Phase 1 item 5)
 *
 * The wire-compatibility regression net that guards the Phase 2 SDK split: it
 * asserts the core method surface (read from schema/core/meta.json — the split
 * output) is registered and the core flows work. If P2 modularization drops a
 * core handler, this goes red.
 *
 * Phase 5 generalizes this to run against ≥2 server implementations via a CLI
 * harness; Phase 1 runs it against the real MAPServer.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { MAPServer } from "../server/server";
import { ClientConnection } from "../connection/client";
import { AgentConnection } from "../connection/agent";
import { createStreamPair } from "../stream";

const core = JSON.parse(
  readFileSync(new URL("../../../schema/core/meta.json", import.meta.url), "utf8")
);
const CORE_METHODS: string[] = Object.keys(core.methods);

describe("Core conformance: method surface", () => {
  it("registers ALL 23 core methods on a default server", () => {
    // The 4-method gap (agents/stop·suspend·resume, structure/graph) was resolved
    // in Phase 1 by implementing them. This is the regression net: any core method
    // that loses its handler (e.g. during the P2 split) fails here.
    const server = new MAPServer({ name: "ConformanceServer" });
    const missing = CORE_METHODS.filter((m) => !server.handlers[m]);
    expect(missing).toEqual([]);
    expect(CORE_METHODS.length).toBe(23);
  });
});

describe("Core conformance: newly-implemented core methods (Phase 1 gap closure)", () => {
  it("structure/graph returns nodes + parent-child edges from the registry", async () => {
    const server = new MAPServer({ name: "ConformanceServer" });
    const parent = server.agents.register({ name: "parent", role: "lead" });
    const child = server.agents.register({
      name: "child",
      role: "worker",
      metadata: { parentId: parent.id },
    });
    const ctx: any = { session: { id: "s" }, requestId: "r", signal: new AbortController().signal };
    const res: any = await server.handlers["map/structure/graph"]({}, ctx);
    const ids = res.nodes.map((n: any) => n.id).sort();
    expect(ids).toEqual([parent.id, child.id].sort());
    expect(res.edges).toContainEqual({ from: parent.id, to: child.id, type: "parent-child" });
  });

  it("agents/suspend then agents/resume drive the state machine", async () => {
    const server = new MAPServer({ name: "ConformanceServer" });
    const a = server.agents.register({ name: "a", role: "worker" }); // starts idle
    const ctx: any = { session: { id: "s" }, requestId: "r", signal: new AbortController().signal };
    const suspended: any = await server.handlers["map/agents/suspend"]({ agentId: a.id }, ctx);
    expect(suspended.agent.state).toBe("suspended");
    const resumed: any = await server.handlers["map/agents/resume"]({ agentId: a.id }, ctx);
    expect(resumed.agent.state).toBe("idle");
  });

  it("agents/stop transitions an agent to the terminal stopped state", async () => {
    const server = new MAPServer({ name: "ConformanceServer" });
    const a = server.agents.register({ name: "a", role: "worker" });
    const ctx: any = { session: { id: "s" }, requestId: "r", signal: new AbortController().signal };
    const stopped: any = await server.handlers["map/agents/stop"]({ agentId: a.id }, ctx);
    expect(stopped.agent.state).toBe("stopped");
  });
});

describe("Core conformance: handshake & lifecycle", () => {
  it("client connect handshake returns sessionId + systemInfo", async () => {
    const server = new MAPServer({ name: "ConformanceServer" });
    const [clientStream, serverStream] = createStreamPair();
    server.accept(serverStream, { role: "client" }).start();

    const client = new ClientConnection(clientStream, { name: "ConfClient" });
    const result = await client.connect();
    expect(result.sessionId).toBeDefined();
    expect(result.systemInfo?.name).toBe("ConformanceServer");
    await client.disconnect();
  });

  it("agent registers into the registry and disconnects", async () => {
    const server = new MAPServer({ name: "ConformanceServer" });
    const [clientStream, serverStream] = createStreamPair();
    server.accept(serverStream, { role: "agent" }).start();

    const agent = new AgentConnection(clientStream, { name: "ConfAgent", role: "worker" });
    const result = await agent.connect();
    expect(result.agent.name).toBe("ConfAgent");
    expect(server.agents.get(result.agent.id)?.name).toBe("ConfAgent");
    await agent.disconnect();
  });
});

describe("Core conformance: extension capability advertisement (Phase 1 item 3)", () => {
  it("a server may advertise extensions via capabilities.extensions (advertise-only)", async () => {
    const server = new MAPServer({
      name: "ConformanceServer",
      capabilities: {
        extensions: [{ uri: "urn:map:ext:mail:1" }, { uri: "urn:map:ext:trajectory:1" }],
      } as any,
    });
    const [clientStream, serverStream] = createStreamPair();
    server.accept(serverStream, { role: "client" }).start();
    const client = new ClientConnection(clientStream, { name: "ConfClient" });
    // Handshake must still succeed with the new optional capability present.
    const result = await client.connect();
    expect(result.sessionId).toBeDefined();
    await client.disconnect();
  });
});

describe("Core conformance: over-the-wire e2e (new core methods through a real connection)", () => {
  it("structure/graph + lifecycle round-trip client → stream → server → handler → client", async () => {
    const server = new MAPServer({ name: "E2EServer" });

    // An agent connects on its own stream and registers into the shared registry.
    const [agentClient, agentServer] = createStreamPair();
    server.accept(agentServer, { role: "agent" }).start();
    const agent = new AgentConnection(agentClient, { name: "worker-1", role: "worker" });
    const reg = await agent.connect();
    const agentId = reg.agent.id;

    // A separate client observes/controls over its own stream.
    const [obsClient, obsServer] = createStreamPair();
    server.accept(obsServer, { role: "client" }).start();
    const client = new ClientConnection(obsClient, { name: "observer" });
    await client.connect();

    // structure/graph over the wire shows the registered agent.
    const graph: any = await client.callExtension("map/structure/graph", {});
    expect(graph.nodes.map((n: any) => n.id)).toContain(agentId);

    // lifecycle methods drive real state transitions over the wire.
    const suspended: any = await client.callExtension("map/agents/suspend", { agentId });
    expect(suspended.agent.state).toBe("suspended");
    const resumed: any = await client.callExtension("map/agents/resume", { agentId });
    expect(resumed.agent.state).toBe("idle");
    const stopped: any = await client.callExtension("map/agents/stop", { agentId });
    expect(stopped.agent.state).toBe("stopped");

    await client.disconnect();
    await agent.disconnect();
  });
});
