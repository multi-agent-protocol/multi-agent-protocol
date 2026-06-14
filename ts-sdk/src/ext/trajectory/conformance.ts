/**
 * Trajectory extension conformance suite (`urn:map:ext:trajectory:1`).
 *
 * Covers the **stable nucleus** — `trajectory/checkpoint` (report → ack). The
 * query surface (`list`/`get`/`content`) is staging/federation-gated (see the
 * consolidation plan §Appendix C) and is intentionally NOT asserted here.
 *
 * Transport-agnostic: pass a `send(method, params)` adapter + your test
 * framework's primitives. The SDK default trajectory handler and any flagship
 * (e.g. openhive's hub) run the same suite.
 */

export interface TrajectoryConformanceAdapter {
  send<R = unknown>(method: string, params?: Record<string, unknown>): Promise<R>;
}

export interface TrajectoryConformanceHarness {
  describe(name: string, fn: () => void): void;
  it(name: string, fn: () => void | Promise<void>): void;
  expect(actual: unknown): {
    toBe(expected: unknown): void;
    toBeDefined(): void;
  };
}

export function runTrajectoryConformance(
  harness: TrajectoryConformanceHarness,
  makeAdapter: () => TrajectoryConformanceAdapter | Promise<TrajectoryConformanceAdapter>,
  label = "trajectory v1 (checkpoint nucleus)",
): void {
  const { describe, it, expect } = harness;

  describe(`trajectory conformance: ${label}`, () => {
    // The reporter assigns the checkpoint `id` (claude-code-swarm generates a
    // 12-char hex); the server records it and fills `timestamp`/`agentId`.
    it("checkpoint echoes the client-assigned id and fills the timestamp", async () => {
      const a = await makeAdapter();
      const res = await a.send<{ checkpoint: { id: string; label?: string; timestamp?: unknown } }>(
        "trajectory/checkpoint",
        { checkpoint: { id: "ckpt-1", label: "step-1", metadata: { k: 1 } } },
      );
      expect(res.checkpoint).toBeDefined();
      expect(res.checkpoint.id).toBe("ckpt-1");
      expect(res.checkpoint.label).toBe("step-1");
      expect(res.checkpoint.timestamp).toBeDefined();
    });

    it("checkpoint preserves sessionId when provided", async () => {
      const a = await makeAdapter();
      const res = await a.send<{ checkpoint: { sessionId?: string } }>("trajectory/checkpoint", {
        checkpoint: { id: "ckpt-2", label: "s", sessionId: "sess-1" },
      });
      expect(res.checkpoint.sessionId).toBe("sess-1");
    });
  });
}
