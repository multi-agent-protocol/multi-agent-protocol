/**
 * AgentConnection.onRequest — Phase 2 friction fix.
 *
 * Agents can now answer inbound JSON-RPC requests (real request/response),
 * replacing the notification-pair + correlation-id workaround consumers used
 * because AgentConnection exposed no request handler.
 */
import { describe, it, expect } from "vitest";
import { AgentConnection } from "../connection/agent";
import { BaseConnection } from "../connection/base";
import { createStreamPair } from "../stream";

describe("AgentConnection.onRequest", () => {
  it("answers an inbound request with the handler's result", async () => {
    const [agentStream, peerStream] = createStreamPair();
    const agent = new AgentConnection(agentStream, { name: "responder", role: "worker" });
    agent.onRequest("x-dispatch/ping", async (params) => {
      const { n } = params as { n: number };
      return { pong: n };
    });

    const peer = new BaseConnection(peerStream);
    const res = await peer.sendRequest("x-dispatch/ping", { n: 42 });
    expect(res).toEqual({ pong: 42 });
  });

  it("returns methodNotFound for an unregistered request method", async () => {
    const [agentStream, peerStream] = createStreamPair();
    new AgentConnection(agentStream, { name: "responder", role: "worker" }); // no onRequest
    const peer = new BaseConnection(peerStream);
    await expect(peer.sendRequest("x-dispatch/unknown", {})).rejects.toMatchObject({
      code: -32601, // method not found
    });
  });

  it("offRequest removes the handler", async () => {
    const [agentStream, peerStream] = createStreamPair();
    const agent = new AgentConnection(agentStream, { name: "responder", role: "worker" });
    const handler = async () => ({ ok: true });
    agent.onRequest("x-dispatch/ping", handler);
    agent.offRequest("x-dispatch/ping");

    const peer = new BaseConnection(peerStream);
    await expect(peer.sendRequest("x-dispatch/ping", {})).rejects.toMatchObject({
      code: -32601,
    });
  });
});
