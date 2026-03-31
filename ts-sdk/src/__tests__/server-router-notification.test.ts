/**
 * Tests for RouterConnectionImpl notification handling
 *
 * Covers:
 * - onNotification registers a handler that receives incoming notifications
 * - Notifications without a handler are silently ignored
 * - Notifications have method and params but no id
 * - Requests (with id) are NOT forwarded to the notification handler
 * - Handler errors don't break message processing
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  RouterConnectionImpl,
  createRouterConnection,
  type HandlerRegistry,
} from "../server/router";
import { EventBusImpl } from "../server/events";
import { SessionManagerImpl } from "../server/sessions";
import { createStreamPair, type Stream } from "../stream";

describe("RouterConnectionImpl - notification handling", () => {
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
    ...overrides,
  });

  // Helper to wait for async message processing
  const waitForProcessing = () =>
    new Promise((resolve) => setTimeout(resolve, 50));

  describe("onNotification", () => {
    it("should forward notifications to the registered handler", async () => {
      const conn = createRouterConnection({
        stream: serverStream,
        handlers: createHandlers(),
        sessions,
        role: "client",
      });

      const received: Array<{ method: string; params: unknown }> = [];
      conn.onNotification((method, params) => {
        received.push({ method, params });
      });

      await conn.start();

      // Send a notification (no id field) from the client
      const writer = clientStream.writable.getWriter();
      await writer.write({
        jsonrpc: "2.0",
        method: "custom/event",
        params: { data: "hello" },
      });
      writer.releaseLock();

      await waitForProcessing();

      expect(received).toHaveLength(1);
      expect(received[0].method).toBe("custom/event");
      expect(received[0].params).toEqual({ data: "hello" });

      await conn.close();
    });

    it("should silently ignore notifications when no handler is registered", async () => {
      const conn = createRouterConnection({
        stream: serverStream,
        handlers: createHandlers(),
        sessions,
        role: "client",
      });

      // No onNotification handler registered
      await conn.start();

      // Send a notification — should not throw or cause errors
      const writer = clientStream.writable.getWriter();
      await writer.write({
        jsonrpc: "2.0",
        method: "some/notification",
        params: { value: 42 },
      });
      writer.releaseLock();

      await waitForProcessing();

      // Connection should still be alive and working — verify with a request
      const writer2 = clientStream.writable.getWriter();
      await writer2.write({
        jsonrpc: "2.0",
        id: 1,
        method: "echo",
        params: { test: true },
      });
      writer2.releaseLock();

      const reader = clientStream.readable.getReader();
      const { value: response } = await reader.read();
      reader.releaseLock();

      expect(response).toEqual({
        jsonrpc: "2.0",
        id: 1,
        result: { test: true },
      });

      await conn.close();
    });

    it("should distinguish notifications (no id) from requests (with id)", async () => {
      const conn = createRouterConnection({
        stream: serverStream,
        handlers: createHandlers(),
        sessions,
        role: "client",
      });

      const notificationReceived: Array<{ method: string; params: unknown }> =
        [];
      conn.onNotification((method, params) => {
        notificationReceived.push({ method, params });
      });

      await conn.start();

      const writer = clientStream.writable.getWriter();

      // Send a request (has id) — should NOT go to notification handler
      await writer.write({
        jsonrpc: "2.0",
        id: 1,
        method: "echo",
        params: { from: "request" },
      });

      // Send a notification (no id) — SHOULD go to notification handler
      await writer.write({
        jsonrpc: "2.0",
        method: "notify/test",
        params: { from: "notification" },
      });

      writer.releaseLock();

      // Read the request response to ensure it was processed
      const reader = clientStream.readable.getReader();
      const { value: response } = await reader.read();
      reader.releaseLock();

      expect(response).toEqual({
        jsonrpc: "2.0",
        id: 1,
        result: { from: "request" },
      });

      await waitForProcessing();

      // Only the notification should have been forwarded
      expect(notificationReceived).toHaveLength(1);
      expect(notificationReceived[0].method).toBe("notify/test");
      expect(notificationReceived[0].params).toEqual({ from: "notification" });

      await conn.close();
    });

    it("should handle notifications with missing params", async () => {
      const conn = createRouterConnection({
        stream: serverStream,
        handlers: createHandlers(),
        sessions,
        role: "client",
      });

      const received: Array<{ method: string; params: unknown }> = [];
      conn.onNotification((method, params) => {
        received.push({ method, params });
      });

      await conn.start();

      // Send notification without params field
      const writer = clientStream.writable.getWriter();
      await writer.write({
        jsonrpc: "2.0",
        method: "ping",
      });
      writer.releaseLock();

      await waitForProcessing();

      expect(received).toHaveLength(1);
      expect(received[0].method).toBe("ping");
      expect(received[0].params).toBeUndefined();

      await conn.close();
    });

    it("should not break message processing when handler throws", async () => {
      const conn = createRouterConnection({
        stream: serverStream,
        handlers: createHandlers(),
        sessions,
        role: "client",
      });

      const handlerCallCount = vi.fn();
      conn.onNotification((method, _params) => {
        handlerCallCount();
        if (method === "bad/notification") {
          throw new Error("Handler explosion!");
        }
      });

      await conn.start();

      const writer = clientStream.writable.getWriter();

      // Send a notification that will cause the handler to throw
      await writer.write({
        jsonrpc: "2.0",
        method: "bad/notification",
        params: {},
      });

      // Send a normal request after the throwing notification
      await writer.write({
        jsonrpc: "2.0",
        id: 1,
        method: "echo",
        params: { still: "working" },
      });

      // Send another notification after the error
      await writer.write({
        jsonrpc: "2.0",
        method: "good/notification",
        params: {},
      });

      writer.releaseLock();

      // The request should still get a response
      const reader = clientStream.readable.getReader();
      const { value: response } = await reader.read();
      reader.releaseLock();

      expect(response).toEqual({
        jsonrpc: "2.0",
        id: 1,
        result: { still: "working" },
      });

      await waitForProcessing();

      // Both notifications should have been delivered to the handler
      expect(handlerCallCount).toHaveBeenCalledTimes(2);

      await conn.close();
    });

    it("should handle multiple notifications in sequence", async () => {
      const conn = createRouterConnection({
        stream: serverStream,
        handlers: createHandlers(),
        sessions,
        role: "client",
      });

      const received: Array<{ method: string; params: unknown }> = [];
      conn.onNotification((method, params) => {
        received.push({ method, params });
      });

      await conn.start();

      const writer = clientStream.writable.getWriter();
      await writer.write({
        jsonrpc: "2.0",
        method: "event/first",
        params: { seq: 1 },
      });
      await writer.write({
        jsonrpc: "2.0",
        method: "event/second",
        params: { seq: 2 },
      });
      await writer.write({
        jsonrpc: "2.0",
        method: "event/third",
        params: { seq: 3 },
      });
      writer.releaseLock();

      await waitForProcessing();

      expect(received).toHaveLength(3);
      expect(received[0].method).toBe("event/first");
      expect(received[1].method).toBe("event/second");
      expect(received[2].method).toBe("event/third");

      await conn.close();
    });

    it("should replace previous handler when onNotification is called again", async () => {
      const conn = createRouterConnection({
        stream: serverStream,
        handlers: createHandlers(),
        sessions,
        role: "client",
      });

      const firstHandler = vi.fn();
      const secondHandler = vi.fn();

      conn.onNotification(firstHandler);
      conn.onNotification(secondHandler);

      await conn.start();

      const writer = clientStream.writable.getWriter();
      await writer.write({
        jsonrpc: "2.0",
        method: "test/event",
        params: {},
      });
      writer.releaseLock();

      await waitForProcessing();

      // Only the second (latest) handler should receive the notification
      expect(firstHandler).not.toHaveBeenCalled();
      expect(secondHandler).toHaveBeenCalledTimes(1);

      await conn.close();
    });
  });
});
