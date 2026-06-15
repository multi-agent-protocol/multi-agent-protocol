/**
 * Extension framework (defineExtension) — Phase 2.
 *
 * The real implementation of the Phase 0 fit-test: a manifest + a hub-closing
 * handler becomes additionalHandlers + a capability fragment with no bypass,
 * and a typed client round-trips over a real connection.
 */
import { describe, it, expect } from "vitest";
import { MAPServer } from "../server/server";
import { ClientConnection } from "../connection/client";
import { createStreamPair } from "../stream";
import { defineExtension } from "../ext/define-extension";
import { trajectoryExtension } from "../ext/trajectory";

describe("defineExtension: manifest enforcement & capability", () => {
  it("handlers() rejects a method outside the manifest prefix", () => {
    expect(() =>
      trajectoryExtension.handlers({ "wrong/method": async () => ({}) }),
    ).toThrow(/outside methodPrefix/);
  });

  it("capabilityFragment() advertises the extension URI (advertise-only)", () => {
    const frag = trajectoryExtension.capabilityFragment();
    expect(frag.extensions).toContainEqual({
      uri: "urn:map:ext:trajectory:1",
      version: "1.0.0",
    });
  });

  it("rejects a manifest declaring both methodPrefix and payloadProtocol", () => {
    expect(() =>
      defineExtension({
        name: "bad",
        uri: "urn:map:ext:bad:0",
        methodPrefix: "bad/",
        payloadProtocol: "bad",
      }),
    ).toThrow(/both methodPrefix and payloadProtocol/);
  });

  it("default proxy client maps short names to prefixed methods", async () => {
    const ext = defineExtension({
      name: "x-demo",
      uri: "urn:map:ext:x-demo:0",
      methodPrefix: "x-demo/",
    });
    const calls: Array<[string, unknown]> = [];
    const fakeConn = {
      callExtension: async (m: string, p?: unknown) => {
        calls.push([m, p]);
        return { ok: true };
      },
    };
    const api = ext.client(fakeConn) as Record<string, (p?: unknown) => Promise<unknown>>;
    await api.status({ a: 1 });
    expect(calls).toEqual([["x-demo/status", { a: 1 }]]);
  });
});

describe("defineExtension: e2e mount + typed client over a real connection", () => {
  it("mounts a hub-closing handler with no bypass and round-trips", async () => {
    let captured: unknown = null;
    const hub = {
      record: async (p: unknown) => {
        captured = p;
        return { id: "ckpt-1", resource_id: "res-9" };
      },
    };

    // The WHOLE server integration — manifest-derived handlers + capability.
    const server = new MAPServer({
      name: "ExtServer",
      additionalHandlers: trajectoryExtension.handlers({
        "trajectory/checkpoint": async (params) => hub.record(params),
      }),
      capabilities: trajectoryExtension.capabilityFragment() as any,
    });
    expect(server.handlers["trajectory/checkpoint"]).toBeDefined();

    const [clientStream, serverStream] = createStreamPair();
    server.accept(serverStream, { role: "client" }).start();
    const client = new ClientConnection(clientStream, { name: "observer" });
    await client.connect();

    const traj = trajectoryExtension.client(client);
    const res = await traj.checkpoint({ label: "step-3", metadata: { k: 1 } });

    expect(res).toEqual({ id: "ckpt-1", resource_id: "res-9" });
    expect(captured).toEqual({ label: "step-3", metadata: { k: 1 } });

    await client.disconnect();
  });
});
