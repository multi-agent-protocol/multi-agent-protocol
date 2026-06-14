/**
 * Core conformance suite — the MAP machinery core, over the wire.
 *
 * Transport-agnostic: pass a `makePair()` adapter that returns a connected
 * client plus the id of an agent registered on the same server, and your test
 * framework's primitives. Asserts the wire behavior of the core methods that
 * every conformant MAP server must implement — focused on the "transparent
 * window" surface (`structure/graph`) and lifecycle control, which were the
 * methods most servers were missing.
 *
 * Published at `@multi-agent-protocol/sdk/conformance` so any server
 * implementation (the SDK's MAPServer, openhive's hub, …) runs the same suite.
 */

export interface CoreConformancePair {
  /** A connected client able to call core methods. */
  client: { callExtension<R = unknown>(method: string, params?: unknown): Promise<R> };
  /** The id of an agent registered on the same server. */
  agentId: string;
}

export interface CoreConformanceHarness {
  describe(name: string, fn: () => void): void;
  it(name: string, fn: () => void | Promise<void>): void;
  expect(actual: unknown): {
    toBe(expected: unknown): void;
    toContain(expected: unknown): void;
    toBeDefined(): void;
  };
}

export function runCoreConformance(
  harness: CoreConformanceHarness,
  makePair: () => CoreConformancePair | Promise<CoreConformancePair>,
  label = "MAP core",
): void {
  const { describe, it, expect } = harness;

  describe(`core conformance: ${label}`, () => {
    it("structure/graph exposes the registered agent (the transparent window)", async () => {
      const { client, agentId } = await makePair();
      const graph = await client.callExtension<{ nodes: Array<{ id: string }> }>(
        "map/structure/graph",
        {},
      );
      expect(graph.nodes.map((n) => n.id)).toContain(agentId);
    });

    it("agents/suspend → resume → stop round-trips over the wire", async () => {
      const { client, agentId } = await makePair();
      const suspended = await client.callExtension<{ agent: { state: string } }>(
        "map/agents/suspend",
        { agentId },
      );
      expect(suspended.agent.state).toBe("suspended");

      const resumed = await client.callExtension<{ agent: { state: string } }>(
        "map/agents/resume",
        { agentId },
      );
      expect(resumed.agent.state).toBe("idle");

      const stopped = await client.callExtension<{ agent: { state: string } }>(
        "map/agents/stop",
        { agentId },
      );
      expect(stopped.agent.state).toBe("stopped");
    });
  });
}
