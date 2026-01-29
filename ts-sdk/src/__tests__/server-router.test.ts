/**
 * Tests for server RouterConnection and middleware
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  RouterConnectionImpl,
  createRouterConnection,
  loggingMiddleware,
  timingMiddleware,
  rateLimitMiddleware,
  validationMiddleware,
  timeoutMiddleware,
  composeMiddleware,
  type HandlerRegistry,
  type Middleware,
} from "../server/router";
import { EventBusImpl } from "../server/events";
import { SessionManagerImpl } from "../server/sessions";
import { createStreamPair, type Stream } from "../stream";

describe("RouterConnectionImpl", () => {
  let eventBus: EventBusImpl;
  let sessions: SessionManagerImpl;
  let clientStream: Stream;
  let serverStream: Stream;

  beforeEach(() => {
    eventBus = new EventBusImpl();
    sessions = new SessionManagerImpl({ eventBus });
    [clientStream, serverStream] = createStreamPair();
  });

  const createHandlers = (
    overrides: Partial<HandlerRegistry> = {}
  ): HandlerRegistry => ({
    echo: async (params) => params,
    add: async (params: any) => ({ sum: params.a + params.b }),
    error: async () => {
      throw new Error("Test error");
    },
    ...overrides,
  });

  describe("start and session creation", () => {
    it("should create a new session on start", async () => {
      const conn = createRouterConnection({
        stream: serverStream,
        handlers: createHandlers(),
        sessions,
        role: "client",
        name: "Test Client",
      });

      await conn.start();

      expect(conn.session).toBeDefined();
      expect(conn.session.role).toBe("client");
      expect(conn.session.name).toBe("Test Client");

      await conn.close();
    });

    it("should resume session with valid token", async () => {
      // Create initial session
      const original = sessions.create({ role: "client" });
      const resumeToken = sessions.disconnect(original.id);

      const conn = createRouterConnection({
        stream: serverStream,
        handlers: createHandlers(),
        sessions,
        role: "client",
        resumeToken,
      });

      await conn.start();

      expect(conn.session.id).toBe(original.id);
      expect(conn.session.status).toBe("connected");

      await conn.close();
    });

    it("should create new session if resume token is invalid", async () => {
      const conn = createRouterConnection({
        stream: serverStream,
        handlers: createHandlers(),
        sessions,
        role: "client",
        resumeToken: "invalid-token",
      });

      await conn.start();

      expect(conn.session).toBeDefined();
      // Should be a new session
      expect(sessions.list().length).toBe(1);

      await conn.close();
    });

    it("should throw if start called twice", async () => {
      const conn = createRouterConnection({
        stream: serverStream,
        handlers: createHandlers(),
        sessions,
        role: "client",
      });

      await conn.start();

      await expect(conn.start()).rejects.toThrow("already started");

      await conn.close();
    });

    it("should throw if session accessed before start", () => {
      const conn = createRouterConnection({
        stream: serverStream,
        handlers: createHandlers(),
        sessions,
        role: "client",
      });

      expect(() => conn.session).toThrow("not started");
    });
  });

  describe("request handling", () => {
    it("should handle requests and return responses", async () => {
      const conn = createRouterConnection({
        stream: serverStream,
        handlers: createHandlers(),
        sessions,
        role: "client",
      });
      await conn.start();

      // Send request from client
      const writer = clientStream.writable.getWriter();
      await writer.write({
        jsonrpc: "2.0",
        id: 1,
        method: "echo",
        params: { message: "hello" },
      });
      writer.releaseLock();

      // Read response
      const reader = clientStream.readable.getReader();
      const { value: response } = await reader.read();
      reader.releaseLock();

      expect(response).toEqual({
        jsonrpc: "2.0",
        id: 1,
        result: { message: "hello" },
      });

      await conn.close();
    });

    it("should handle multiple requests", async () => {
      const conn = createRouterConnection({
        stream: serverStream,
        handlers: createHandlers(),
        sessions,
        role: "client",
      });
      await conn.start();

      const writer = clientStream.writable.getWriter();
      await writer.write({
        jsonrpc: "2.0",
        id: 1,
        method: "add",
        params: { a: 2, b: 3 },
      });
      await writer.write({
        jsonrpc: "2.0",
        id: 2,
        method: "add",
        params: { a: 10, b: 20 },
      });
      writer.releaseLock();

      const reader = clientStream.readable.getReader();
      const responses = [];
      responses.push((await reader.read()).value);
      responses.push((await reader.read()).value);
      reader.releaseLock();

      expect(responses).toContainEqual({
        jsonrpc: "2.0",
        id: 1,
        result: { sum: 5 },
      });
      expect(responses).toContainEqual({
        jsonrpc: "2.0",
        id: 2,
        result: { sum: 30 },
      });

      await conn.close();
    });

    it("should return error for unknown method", async () => {
      const conn = createRouterConnection({
        stream: serverStream,
        handlers: createHandlers(),
        sessions,
        role: "client",
      });
      await conn.start();

      const writer = clientStream.writable.getWriter();
      await writer.write({
        jsonrpc: "2.0",
        id: 1,
        method: "unknown",
        params: {},
      });
      writer.releaseLock();

      const reader = clientStream.readable.getReader();
      const { value: response } = await reader.read();
      reader.releaseLock();

      expect(response.error).toBeDefined();
      expect(response.error.code).toBe(-32601); // Method not found
      expect(response.error.message).toContain("unknown");

      await conn.close();
    });

    it("should return error when handler throws", async () => {
      const conn = createRouterConnection({
        stream: serverStream,
        handlers: createHandlers(),
        sessions,
        role: "client",
      });
      await conn.start();

      const writer = clientStream.writable.getWriter();
      await writer.write({
        jsonrpc: "2.0",
        id: 1,
        method: "error",
        params: {},
      });
      writer.releaseLock();

      const reader = clientStream.readable.getReader();
      const { value: response } = await reader.read();
      reader.releaseLock();

      expect(response.error).toBeDefined();
      expect(response.error.code).toBe(-32603); // Internal error
      expect(response.error.message).toBe("Test error");

      await conn.close();
    });
  });

  describe("notify", () => {
    it("should send notifications to peer", async () => {
      const conn = createRouterConnection({
        stream: serverStream,
        handlers: createHandlers(),
        sessions,
        role: "client",
      });
      await conn.start();

      await conn.notify("event", { type: "test", data: { foo: "bar" } });

      const reader = clientStream.readable.getReader();
      const { value: notification } = await reader.read();
      reader.releaseLock();

      expect(notification).toEqual({
        jsonrpc: "2.0",
        method: "event",
        params: { type: "test", data: { foo: "bar" } },
      });

      await conn.close();
    });
  });

  describe("middleware", () => {
    it("should execute middleware in order", async () => {
      const order: string[] = [];

      const middleware1: Middleware = async (method, params, ctx, next) => {
        order.push("before-1");
        const result = await next();
        order.push("after-1");
        return result;
      };

      const middleware2: Middleware = async (method, params, ctx, next) => {
        order.push("before-2");
        const result = await next();
        order.push("after-2");
        return result;
      };

      const conn = createRouterConnection({
        stream: serverStream,
        handlers: createHandlers(),
        middleware: [middleware1, middleware2],
        sessions,
        role: "client",
      });
      await conn.start();

      const writer = clientStream.writable.getWriter();
      await writer.write({
        jsonrpc: "2.0",
        id: 1,
        method: "echo",
        params: {},
      });
      writer.releaseLock();

      // Wait for response
      const reader = clientStream.readable.getReader();
      await reader.read();
      reader.releaseLock();

      expect(order).toEqual(["before-1", "before-2", "after-2", "after-1"]);

      await conn.close();
    });

    it("should allow middleware to short-circuit", async () => {
      const shortCircuit: Middleware = async () => {
        return { shortCircuited: true };
      };

      const neverCalled: Middleware = async (method, params, ctx, next) => {
        throw new Error("Should not be called");
      };

      const conn = createRouterConnection({
        stream: serverStream,
        handlers: createHandlers(),
        middleware: [shortCircuit, neverCalled],
        sessions,
        role: "client",
      });
      await conn.start();

      const writer = clientStream.writable.getWriter();
      await writer.write({
        jsonrpc: "2.0",
        id: 1,
        method: "echo",
        params: {},
      });
      writer.releaseLock();

      const reader = clientStream.readable.getReader();
      const { value: response } = await reader.read();
      reader.releaseLock();

      expect(response.result).toEqual({ shortCircuited: true });

      await conn.close();
    });
  });

  describe("close", () => {
    it("should resolve closed promise", async () => {
      const conn = createRouterConnection({
        stream: serverStream,
        handlers: createHandlers(),
        sessions,
        role: "client",
      });
      await conn.start();

      const closedPromise = conn.closed;
      await conn.close();

      await expect(closedPromise).resolves.toBeUndefined();
    });

    it("should disconnect session on close", async () => {
      const conn = createRouterConnection({
        stream: serverStream,
        handlers: createHandlers(),
        sessions,
        role: "client",
      });
      await conn.start();

      const sessionId = conn.session.id;
      await conn.close();

      const session = sessions.get(sessionId);
      expect(session?.status).toBe("disconnected");
    });
  });
});

describe("Middleware helpers", () => {
  describe("loggingMiddleware", () => {
    it("should log requests and responses", async () => {
      const logs: string[] = [];
      const logger = {
        log: (...args: any[]) => logs.push(args.join(" ")),
        error: (...args: any[]) => logs.push("ERROR: " + args.join(" ")),
      };

      const middleware = loggingMiddleware(logger);

      const result = await middleware(
        "test.method",
        { foo: "bar" },
        { session: {} as any, requestId: "req-1", signal: new AbortController().signal },
        async () => ({ success: true })
      );

      expect(result).toEqual({ success: true });
      expect(logs.some((l) => l.includes("test.method"))).toBe(true);
      expect(logs.some((l) => l.includes("OK"))).toBe(true);
    });

    it("should log errors", async () => {
      const logs: string[] = [];
      const logger = {
        log: (...args: any[]) => logs.push(args.join(" ")),
        error: (...args: any[]) => logs.push("ERROR: " + args.join(" ")),
      };

      const middleware = loggingMiddleware(logger);

      await expect(
        middleware(
          "test.method",
          {},
          { session: {} as any, requestId: "req-1", signal: new AbortController().signal },
          async () => {
            throw new Error("Test error");
          }
        )
      ).rejects.toThrow("Test error");

      expect(logs.some((l) => l.includes("ERROR"))).toBe(true);
    });
  });

  describe("timingMiddleware", () => {
    it("should report timing", async () => {
      let timing: any = null;

      const middleware = timingMiddleware((data) => {
        timing = data;
      });

      await middleware(
        "test.method",
        {},
        { session: {} as any, requestId: "req-1", signal: new AbortController().signal },
        async () => {
          await new Promise((r) => setTimeout(r, 10));
          return {};
        }
      );

      expect(timing).toBeDefined();
      expect(timing.method).toBe("test.method");
      expect(timing.requestId).toBe("req-1");
      expect(timing.durationMs).toBeGreaterThanOrEqual(10);
    });
  });

  describe("rateLimitMiddleware", () => {
    it("should allow requests under limit", async () => {
      const middleware = rateLimitMiddleware({ maxRequestsPerSecond: 10 });

      const ctx = {
        session: { id: "session-1" } as any,
        requestId: "req-1",
        signal: new AbortController().signal,
      };

      for (let i = 0; i < 5; i++) {
        await middleware("test", {}, ctx, async () => ({}));
      }
      // Should not throw
    });

    it("should reject requests over limit", async () => {
      const onLimitExceeded = vi.fn();
      const middleware = rateLimitMiddleware({
        maxRequestsPerSecond: 2,
        onLimitExceeded,
      });

      const ctx = {
        session: { id: "session-1" } as any,
        requestId: "req-1",
        signal: new AbortController().signal,
      };

      await middleware("test", {}, ctx, async () => ({}));
      await middleware("test", {}, ctx, async () => ({}));

      await expect(middleware("test", {}, ctx, async () => ({}))).rejects.toThrow(
        "Rate limit"
      );
      expect(onLimitExceeded).toHaveBeenCalled();
    });
  });

  describe("validationMiddleware", () => {
    it("should pass valid params", async () => {
      const middleware = validationMiddleware({
        "test.method": (params: any) => ({
          valid: params && typeof params.name === "string",
          error: "name is required",
        }),
      });

      const result = await middleware(
        "test.method",
        { name: "test" },
        { session: {} as any, requestId: "req-1", signal: new AbortController().signal },
        async () => ({ success: true })
      );

      expect(result).toEqual({ success: true });
    });

    it("should reject invalid params", async () => {
      const middleware = validationMiddleware({
        "test.method": (params: any) => ({
          valid: params && typeof params.name === "string",
          error: "name is required",
        }),
      });

      await expect(
        middleware(
          "test.method",
          {},
          { session: {} as any, requestId: "req-1", signal: new AbortController().signal },
          async () => ({})
        )
      ).rejects.toThrow("name is required");
    });
  });

  describe("timeoutMiddleware", () => {
    it("should allow fast requests", async () => {
      const middleware = timeoutMiddleware(100);

      const result = await middleware(
        "test",
        {},
        { session: {} as any, requestId: "req-1", signal: new AbortController().signal },
        async () => ({ success: true })
      );

      expect(result).toEqual({ success: true });
    });

    it("should timeout slow requests", async () => {
      const middleware = timeoutMiddleware(10);

      await expect(
        middleware(
          "test",
          {},
          { session: {} as any, requestId: "req-1", signal: new AbortController().signal },
          async () => {
            await new Promise((r) => setTimeout(r, 100));
            return {};
          }
        )
      ).rejects.toThrow("timeout");
    });
  });

  describe("composeMiddleware", () => {
    it("should compose multiple middleware", async () => {
      const order: string[] = [];

      const mw1: Middleware = async (m, p, c, next) => {
        order.push("1");
        return next();
      };
      const mw2: Middleware = async (m, p, c, next) => {
        order.push("2");
        return next();
      };
      const mw3: Middleware = async (m, p, c, next) => {
        order.push("3");
        return next();
      };

      const composed = composeMiddleware(mw1, mw2, mw3);

      await composed(
        "test",
        {},
        { session: {} as any, requestId: "req-1", signal: new AbortController().signal },
        async () => {
          order.push("handler");
          return {};
        }
      );

      expect(order).toEqual(["1", "2", "3", "handler"]);
    });
  });
});
