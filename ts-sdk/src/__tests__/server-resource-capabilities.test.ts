/**
 * Tests for MAP Resource Protocol capabilities advertisement.
 *
 * Verifies that the resource capability config flows through the connect
 * handler and appears in the connect response.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { EventBusImpl } from "../server/events";
import { SessionManagerImpl } from "../server/sessions";
import {
  createConnectionHandlers,
  type ResourceCapabilityConfig,
} from "../server/router";
import type { HandlerContext } from "../server/types";

function makeCtx(sessions: SessionManagerImpl): HandlerContext {
  const session = sessions.create({ role: "agent" });
  return {
    session,
    requestId: "req-1",
    signal: new AbortController().signal,
  } as HandlerContext;
}

describe("Resource capabilities advertisement", () => {
  let eventBus: EventBusImpl;
  let sessions: SessionManagerImpl;

  beforeEach(() => {
    eventBus = new EventBusImpl();
    sessions = new SessionManagerImpl({ eventBus });
  });

  it("should include resources in connect response when enabled", async () => {
    const kinds = ["x-workspace/repo", "x-minimem/memory-bank", "x-sessionlog/session"];
    const handlers = createConnectionHandlers({
      sessions,
      resourceCapabilities: { enabled: true, kinds },
    });

    const ctx = makeCtx(sessions);
    const result = (await handlers["map/connect"]({}, ctx)) as Record<string, unknown>;
    const caps = result.capabilities as Record<string, unknown>;

    expect(caps.resources).toEqual({
      enabled: true,
      kinds,
    });
  });

  it("should omit resources from connect response when disabled", async () => {
    const handlers = createConnectionHandlers({
      sessions,
      resourceCapabilities: { enabled: false, kinds: ["x-workspace/repo"] },
    });

    const ctx = makeCtx(sessions);
    const result = (await handlers["map/connect"]({}, ctx)) as Record<string, unknown>;
    const caps = result.capabilities as Record<string, unknown>;

    expect(caps.resources).toBeUndefined();
  });

  it("should omit resources when config not provided", async () => {
    const handlers = createConnectionHandlers({ sessions });

    const ctx = makeCtx(sessions);
    const result = (await handlers["map/connect"]({}, ctx)) as Record<string, unknown>;
    const caps = result.capabilities as Record<string, unknown>;

    expect(caps.resources).toBeUndefined();
  });

  it("should default kinds to empty array when omitted", async () => {
    const handlers = createConnectionHandlers({
      sessions,
      resourceCapabilities: { enabled: true },
    });

    const ctx = makeCtx(sessions);
    const result = (await handlers["map/connect"]({}, ctx)) as Record<string, unknown>;
    const caps = result.capabilities as Record<string, unknown>;

    expect(caps.resources).toEqual({
      enabled: true,
      kinds: [],
    });
  });

  it("should coexist with other capabilities", async () => {
    const handlers = createConnectionHandlers({
      sessions,
      resourceCapabilities: { enabled: true, kinds: ["x-workspace/repo"] },
      mailCapabilities: { enabled: true },
    });

    const ctx = makeCtx(sessions);
    const result = (await handlers["map/connect"]({}, ctx)) as Record<string, unknown>;
    const caps = result.capabilities as Record<string, unknown>;

    expect(caps.resources).toBeDefined();
    expect(caps.mail).toBeDefined();
  });

  it("ResourceCapabilityConfig type is exported", () => {
    const config: ResourceCapabilityConfig = { enabled: true, kinds: ["test/kind"] };
    expect(config.enabled).toBe(true);
    expect(config.kinds).toEqual(["test/kind"]);
  });
});
