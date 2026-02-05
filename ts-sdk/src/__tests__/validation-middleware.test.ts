/**
 * Tests for Zod validation middleware
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import {
  zodValidationMiddleware,
  DEFAULT_VALIDATION_SCHEMAS,
  AgentsRegisterParamsSchema,
  AgentsUpdateParamsSchema,
  SendParamsSchema,
} from "../server/middleware/validation";
import { MAPRequestError } from "../errors";
import type { HandlerContext, ServerSession } from "../server/types";

describe("zodValidationMiddleware", () => {
  // Create a mock context
  const mockContext: HandlerContext = {
    session: {
      id: "session-1",
      role: "client",
      status: "connected",
      connectedAt: Date.now(),
      lastActivity: Date.now(),
      metadata: {},
      agentIds: [],
      subscriptionIds: [],
    } as ServerSession,
    requestId: "req-1",
    signal: new AbortController().signal,
  };

  describe("with default schemas", () => {
    const middleware = zodValidationMiddleware();

    it("should allow valid params for map/agents/register", async () => {
      const next = vi.fn().mockResolvedValue({ id: "agent-1" });

      const result = await middleware(
        "map/agents/register",
        { name: "TestAgent", role: "worker" },
        mockContext,
        next
      );

      expect(next).toHaveBeenCalled();
      expect(result).toEqual({ id: "agent-1" });
    });

    it("should reject invalid params for map/agents/register", async () => {
      const next = vi.fn();

      await expect(
        middleware("map/agents/register", {}, mockContext, next)
      ).rejects.toThrow(MAPRequestError);

      expect(next).not.toHaveBeenCalled();
    });

    it("should include detailed error information", async () => {
      const next = vi.fn();

      try {
        await middleware("map/agents/register", {}, mockContext, next);
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(MAPRequestError);
        const mapError = error as MAPRequestError;
        expect(mapError.code).toBe(-32602); // INVALID_PARAMS
        expect(mapError.data?.details).toBeDefined();
        expect(mapError.data?.details).toHaveProperty("issues");
        expect(mapError.data?.details).toHaveProperty("summary");
      }
    });

    it("should allow methods without schemas by default", async () => {
      const next = vi.fn().mockResolvedValue("ok");

      const result = await middleware(
        "custom/unknown/method",
        { anything: "goes" },
        mockContext,
        next
      );

      expect(next).toHaveBeenCalled();
      expect(result).toBe("ok");
    });

    it("should validate map/agents/update requires at least one field", async () => {
      const next = vi.fn();

      // Just agentId without state or metadata should fail
      await expect(
        middleware(
          "map/agents/update",
          { agentId: "agent-1" },
          mockContext,
          next
        )
      ).rejects.toThrow(MAPRequestError);

      expect(next).not.toHaveBeenCalled();
    });

    it("should allow map/agents/update with state", async () => {
      const next = vi.fn().mockResolvedValue({ id: "agent-1" });

      await middleware(
        "map/agents/update",
        { agentId: "agent-1", state: "busy" },
        mockContext,
        next
      );

      expect(next).toHaveBeenCalled();
    });

    it("should allow map/agents/update with metadata", async () => {
      const next = vi.fn().mockResolvedValue({ id: "agent-1" });

      await middleware(
        "map/agents/update",
        { agentId: "agent-1", metadata: { foo: "bar" } },
        mockContext,
        next
      );

      expect(next).toHaveBeenCalled();
    });

    it("should validate custom agent states", async () => {
      const next = vi.fn().mockResolvedValue({ id: "agent-1" });

      // Valid custom state
      await middleware(
        "map/agents/update/state",
        { agentId: "agent-1", state: "custom:thinking" },
        mockContext,
        next
      );

      expect(next).toHaveBeenCalled();
    });

    it("should reject invalid custom agent states", async () => {
      const next = vi.fn();

      // Invalid state (not in enum and doesn't start with custom:)
      await expect(
        middleware(
          "map/agents/update/state",
          { agentId: "agent-1", state: "invalid-state" },
          mockContext,
          next
        )
      ).rejects.toThrow(MAPRequestError);
    });

    it("should validate map/send params", async () => {
      const next = vi.fn().mockResolvedValue({ id: "msg-1" });

      await middleware(
        "map/send",
        { to: "agent-1", payload: { text: "hello" } },
        mockContext,
        next
      );

      expect(next).toHaveBeenCalled();
    });

    it("should validate map/send with array of recipients", async () => {
      const next = vi.fn().mockResolvedValue({ id: "msg-1" });

      await middleware(
        "map/send",
        { to: ["agent-1", "agent-2"], payload: {} },
        mockContext,
        next
      );

      expect(next).toHaveBeenCalled();
    });

    it("should reject map/send with empty recipients array", async () => {
      const next = vi.fn();

      await expect(
        middleware("map/send", { to: [], payload: {} }, mockContext, next)
      ).rejects.toThrow(MAPRequestError);
    });

    it("should validate subscription filter with nested $or", async () => {
      const next = vi.fn().mockResolvedValue({ id: "sub-1" });

      await middleware(
        "map/subscriptions/subscribe",
        {
          filter: {
            $or: [
              { eventTypes: ["agent.registered"] },
              { scopes: ["scope-1"] },
            ],
          },
        },
        mockContext,
        next
      );

      expect(next).toHaveBeenCalled();
    });
  });

  describe("with strictMode", () => {
    const strictMiddleware = zodValidationMiddleware({ strictMode: true });

    it("should reject unknown methods in strict mode", async () => {
      const next = vi.fn();

      await expect(
        strictMiddleware(
          "unknown/method",
          { foo: "bar" },
          mockContext,
          next
        )
      ).rejects.toThrow(MAPRequestError);

      expect(next).not.toHaveBeenCalled();
    });
  });

  describe("with skipMethods", () => {
    const skipMiddleware = zodValidationMiddleware({
      skipMethods: ["map/agents/register"],
    });

    it("should skip validation for specified methods", async () => {
      const next = vi.fn().mockResolvedValue({ id: "agent-1" });

      // Invalid params but should be skipped
      await skipMiddleware(
        "map/agents/register",
        { invalid: "params" },
        mockContext,
        next
      );

      expect(next).toHaveBeenCalled();
    });

    it("should still validate other methods", async () => {
      const next = vi.fn();

      await expect(
        skipMiddleware(
          "map/agents/unregister",
          { invalid: "params" },
          mockContext,
          next
        )
      ).rejects.toThrow(MAPRequestError);
    });
  });

  describe("with custom schemas", () => {
    const customSchema = z.object({
      customField: z.string(),
    });

    const customMiddleware = zodValidationMiddleware({
      schemas: {
        ...DEFAULT_VALIDATION_SCHEMAS,
        "custom/method": customSchema,
      },
    });

    it("should validate using custom schema", async () => {
      const next = vi.fn().mockResolvedValue("ok");

      await customMiddleware(
        "custom/method",
        { customField: "value" },
        mockContext,
        next
      );

      expect(next).toHaveBeenCalled();
    });

    it("should reject invalid params for custom schema", async () => {
      const next = vi.fn();

      await expect(
        customMiddleware(
          "custom/method",
          { wrongField: "value" },
          mockContext,
          next
        )
      ).rejects.toThrow(MAPRequestError);
    });
  });

  describe("with onValidationError callback", () => {
    it("should call error callback on validation failure", async () => {
      const errorCallback = vi.fn();
      const middleware = zodValidationMiddleware({
        onValidationError: errorCallback,
      });
      const next = vi.fn();

      try {
        await middleware(
          "map/agents/register",
          { invalid: "params" },
          mockContext,
          next
        );
      } catch {
        // Expected
      }

      expect(errorCallback).toHaveBeenCalledTimes(1);
      expect(errorCallback).toHaveBeenCalledWith(
        "map/agents/register",
        { invalid: "params" },
        expect.objectContaining({ issues: expect.any(Array) })
      );
    });
  });

  describe("edge cases", () => {
    const middleware = zodValidationMiddleware();

    it("should handle undefined params", async () => {
      const next = vi.fn().mockResolvedValue({});

      // map/scopes/list allows empty params
      await middleware("map/scopes/list", undefined, mockContext, next);

      expect(next).toHaveBeenCalled();
    });

    it("should handle null params as empty object", async () => {
      const next = vi.fn().mockResolvedValue({});

      await middleware("map/scopes/list", null, mockContext, next);

      expect(next).toHaveBeenCalled();
    });

    it("should reject extra properties with strict schemas", async () => {
      const next = vi.fn();

      await expect(
        middleware(
          "map/agents/register",
          { name: "Test", extraProp: "not allowed" },
          mockContext,
          next
        )
      ).rejects.toThrow(MAPRequestError);
    });
  });
});

describe("Individual schema validations", () => {
  describe("AgentsRegisterParamsSchema", () => {
    it("should accept valid registration params", () => {
      const result = AgentsRegisterParamsSchema.safeParse({
        name: "TestAgent",
        role: "worker",
        metadata: { version: "1.0" },
        capabilities: ["translate:en"],
      });

      expect(result.success).toBe(true);
    });

    it("should require name", () => {
      const result = AgentsRegisterParamsSchema.safeParse({
        role: "worker",
      });

      expect(result.success).toBe(false);
    });

    it("should reject empty name", () => {
      const result = AgentsRegisterParamsSchema.safeParse({
        name: "",
      });

      expect(result.success).toBe(false);
    });
  });

  describe("AgentsUpdateParamsSchema", () => {
    it("should require at least state or metadata", () => {
      const result = AgentsUpdateParamsSchema.safeParse({
        agentId: "agent-1",
      });

      expect(result.success).toBe(false);
    });

    it("should accept state alone", () => {
      const result = AgentsUpdateParamsSchema.safeParse({
        agentId: "agent-1",
        state: "busy",
      });

      expect(result.success).toBe(true);
    });

    it("should accept metadata alone", () => {
      const result = AgentsUpdateParamsSchema.safeParse({
        agentId: "agent-1",
        metadata: { foo: "bar" },
      });

      expect(result.success).toBe(true);
    });

    it("should accept both state and metadata", () => {
      const result = AgentsUpdateParamsSchema.safeParse({
        agentId: "agent-1",
        state: "idle",
        metadata: { foo: "bar" },
      });

      expect(result.success).toBe(true);
    });
  });

  describe("SendParamsSchema", () => {
    it("should accept single recipient", () => {
      const result = SendParamsSchema.safeParse({
        to: "agent-1",
        payload: { text: "hello" },
      });

      expect(result.success).toBe(true);
    });

    it("should accept array of recipients", () => {
      const result = SendParamsSchema.safeParse({
        to: ["agent-1", "agent-2"],
        payload: null,
      });

      expect(result.success).toBe(true);
    });

    it("should reject empty array", () => {
      const result = SendParamsSchema.safeParse({
        to: [],
        payload: {},
      });

      expect(result.success).toBe(false);
    });

    it("should accept optional fields", () => {
      const result = SendParamsSchema.safeParse({
        to: "agent-1",
        payload: {},
        replyTo: "msg-0",
        priority: 1,
        ttlMs: 5000,
        messageType: "chat",
      });

      expect(result.success).toBe(true);
    });
  });
});
