/**
 * PHASE 0 — TRACK C FIT-TEST SPIKE (throwaway / exit gate)
 *
 * Question (consolidation plan §6.0, the "coupled bet"): can a MAP-EXT manifest +
 * a handler that closes over an external hub context be turned into the SDK's
 * `additionalHandlers` map and capability fragment with NO bypass code?
 *
 * If yes  → BUILD the defineExtension mount framework (P1.2 split + P2.1b proceed).
 * If no   → DESCOPE to typing-only (manifests as typed docs; hubs hand-mount).
 *
 * This stands in openhive's shoes: `hub` below is openhive's hub-driven context
 * (its services, closed over by the handler). The method mirrors a cascade/* method.
 * Uses the `x-` experimental namespace so it touches no real registry range.
 */
import { describe, it, expect } from "vitest";
import { MAPServer } from "../server/server";
import { ClientConnection } from "../connection/client";
import { createStreamPair } from "../stream";
import type { HandlerRegistry, Handler } from "../server/types";

// --- Prototype defineExtension() (the thing under test) -----------------------
// Deliberately minimal: it is a thin adapter over seams the SDK already has.
interface SpikeManifest {
  name: string;
  uri: string;
  methodPrefix: string;
  capabilityKey: string;
}
function defineExtension(manifest: SpikeManifest) {
  return {
    manifest,
    /** 1b — produce a HandlerRegistry for MAPServerOptions.additionalHandlers */
    handlers(impl: Record<string, Handler>): HandlerRegistry {
      for (const method of Object.keys(impl)) {
        if (!method.startsWith(manifest.methodPrefix)) {
          throw new Error(`method "${method}" is outside prefix "${manifest.methodPrefix}"`);
        }
      }
      return impl; // it already IS the HandlerRegistry shape — the whole point
    },
    /** capability fragment for MAPServerOptions.capabilities */
    capabilityFragment(): Record<string, unknown> {
      return { [manifest.capabilityKey]: { enabled: true } };
    },
    /** 1a — typed client accessor over callExtension (short name → prefixed method) */
    client<T extends Record<string, (p: any) => Promise<any>>>(
      conn: ClientConnection
    ): T {
      return new Proxy({} as T, {
        get: (_t, prop: string) => (params: unknown) =>
          conn.callExtension(`${manifest.methodPrefix}${prop}`, params),
      });
    },
  };
}

describe("Phase 0 fit-test spike: defineExtension over additionalHandlers", () => {
  it("mounts a hub-closing cascade method with no bypass, and round-trips", async () => {
    // --- openhive's hub stand-in: external context the handler closes over ----
    let hubCalls = 0;
    const hub = {
      async cascadeStatus(swarmId: string) {
        hubCalls++;
        return { swarmId, state: "running", pending: 3, source: "hub" };
      },
    };

    // --- the extension, from a manifest --------------------------------------
    const cascadeExt = defineExtension({
      name: "x-cascade",
      uri: "urn:map:ext:x-cascade:0",
      methodPrefix: "x-cascade/",
      capabilityKey: "xCascade",
    });

    // --- server wiring: this is the WHOLE integration. If a bypass were needed,
    //     it would show up as extra wiring here. There is none. ----------------
    const server = new MAPServer({
      name: "SpikeServer",
      additionalHandlers: cascadeExt.handlers({
        "x-cascade/status": async (params: any, _ctx) =>
          hub.cascadeStatus(params.swarmId), // closes over hub — the fit-test crux
      }),
      capabilities: cascadeExt.capabilityFragment() as any,
    });

    // Criterion 1: the manifest-derived handler is mounted alongside core.
    expect(server.handlers["x-cascade/status"]).toBeDefined();
    expect(server.handlers["map/connect"]).toBeDefined(); // core intact

    // --- connect a client ----------------------------------------------------
    const [clientStream, serverStream] = createStreamPair();
    server.accept(serverStream, { role: "client" }).start();
    const client = new ClientConnection(clientStream, { name: "SpikeClient" });
    await client.connect();

    // Criterion 3: typed client accessor round-trips to the hub.
    const api = cascadeExt.client<{
      status: (p: { swarmId: string }) => Promise<any>;
    }>(client);
    const result = await api.status({ swarmId: "swarm-42" });

    expect(result).toEqual({ swarmId: "swarm-42", state: "running", pending: 3, source: "hub" });
    expect(hubCalls).toBe(1); // the closure actually reached hub state

    await client.disconnect();
  });

  it("rejects a handler whose method escapes the manifest prefix (format is load-bearing)", () => {
    const ext = defineExtension({
      name: "x-cascade",
      uri: "urn:map:ext:x-cascade:0",
      methodPrefix: "x-cascade/",
      capabilityKey: "xCascade",
    });
    expect(() =>
      ext.handlers({ "wrong/method": async () => ({}) })
    ).toThrow(/outside prefix/);
  });
});
