/**
 * Tests for linked capability documents (Proposal 3).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { AgentRegistryImpl } from "../server/agents/registry";
import { InMemoryAgentStore } from "../server/agents/stores/in-memory";
import { createAgentHandlers } from "../server/agents/handlers";
import type { EventBus, HandlerContext, ServerSession, AgentFilter } from "../server/types";
import type { MAPAgentCapabilityDescriptor } from "../types";

// ============================================================================
// Helpers
// ============================================================================

function createMockEventBus(): EventBus {
  return {
    emit: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  } as any;
}

function createMockContext(): HandlerContext {
  return {
    session: {
      id: "test-session",
      status: "connected",
      role: "agent",
      agentIds: [],
      subscriptionIds: [],
      permissions: {},
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
    } as unknown as ServerSession,
    requestId: "req-1",
    signal: new AbortController().signal,
  };
}

const DOC_PROCESSOR_DESCRIPTOR: MAPAgentCapabilityDescriptor = {
  version: 1,
  description: "Processes documents: text extraction and summarization",
  capabilities: [
    {
      id: "doc:extract-text",
      name: "Text Extraction",
      description: "Extracts text from PDF and DOCX files",
    },
    {
      id: "doc:summarize",
      name: "Document Summarization",
      description: "Generates concise summaries",
      interface: {
        contentType: "application/json",
        schema: {
          type: "object",
          properties: {
            text: { type: "string" },
            maxLength: { type: "integer" },
          },
        },
      },
    },
  ],
  accepts: [
    { contentType: "application/pdf" },
    { contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  ],
  produces: [
    { contentType: "text/plain" },
    { contentType: "application/json" },
  ],
  tags: ["document-processing", "nlp", "extraction"],
};

const IMAGE_PROCESSOR_DESCRIPTOR: MAPAgentCapabilityDescriptor = {
  version: 1,
  description: "Processes images: OCR and classification",
  capabilities: [
    {
      id: "image:ocr",
      name: "OCR",
      description: "Extracts text from images",
    },
    {
      id: "image:classify",
      name: "Image Classification",
      description: "Classifies image content",
    },
  ],
  accepts: [
    { contentType: "image/png" },
    { contentType: "image/jpeg" },
  ],
  tags: ["image-processing", "nlp", "ocr"],
};

// ============================================================================
// Tests: AgentRegistry with capability descriptors
// ============================================================================

describe("Agent capability descriptors", () => {
  let registry: AgentRegistryImpl;
  let eventBus: EventBus;

  beforeEach(() => {
    eventBus = createMockEventBus();
    registry = new AgentRegistryImpl({ eventBus });
  });

  describe("Registration with capabilityDescriptor", () => {
    it("should store capabilityDescriptor on registration", () => {
      const agent = registry.register({
        name: "doc-processor",
        role: "processor",
        sessionId: "session-1",
        capabilityDescriptor: DOC_PROCESSOR_DESCRIPTOR,
      });

      expect(agent.capabilityDescriptor).toEqual(DOC_PROCESSOR_DESCRIPTOR);
    });

    it("should return capabilityDescriptor on get", () => {
      const registered = registry.register({
        name: "doc-processor",
        role: "processor",
        sessionId: "session-1",
        capabilityDescriptor: DOC_PROCESSOR_DESCRIPTOR,
      });

      const retrieved = registry.get(registered.id);
      expect(retrieved?.capabilityDescriptor).toEqual(DOC_PROCESSOR_DESCRIPTOR);
    });

    it("should work without capabilityDescriptor (backwards-compatible)", () => {
      const agent = registry.register({
        name: "simple-agent",
        role: "worker",
        sessionId: "session-1",
      });

      expect(agent.capabilityDescriptor).toBeUndefined();
    });
  });

  describe("Listing with capability filters", () => {
    beforeEach(() => {
      registry.register({
        name: "doc-processor",
        role: "processor",
        sessionId: "session-1",
        capabilityDescriptor: DOC_PROCESSOR_DESCRIPTOR,
      });
      registry.register({
        name: "image-processor",
        role: "processor",
        sessionId: "session-1",
        capabilityDescriptor: IMAGE_PROCESSOR_DESCRIPTOR,
      });
      registry.register({
        name: "simple-worker",
        role: "worker",
        sessionId: "session-1",
      });
    });

    it("should filter by capabilityId", () => {
      const results = registry.list({ capabilityId: "doc:summarize" });
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe("doc-processor");
    });

    it("should filter by capabilityId returning multiple matches", () => {
      // Both doc and image processors have "extraction" in tags but different capability IDs
      const results = registry.list({ capabilityId: "image:ocr" });
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe("image-processor");
    });

    it("should return empty for non-matching capabilityId", () => {
      const results = registry.list({ capabilityId: "video:transcode" });
      expect(results).toHaveLength(0);
    });

    it("should filter by tag", () => {
      const results = registry.list({ tag: "nlp" });
      expect(results).toHaveLength(2);
      const names = results.map((a) => a.name).sort();
      expect(names).toEqual(["doc-processor", "image-processor"]);
    });

    it("should filter by unique tag", () => {
      const results = registry.list({ tag: "document-processing" });
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe("doc-processor");
    });

    it("should filter by accepted content type", () => {
      const results = registry.list({ accepts: "application/pdf" });
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe("doc-processor");
    });

    it("should filter by image content type", () => {
      const results = registry.list({ accepts: "image/png" });
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe("image-processor");
    });

    it("should return empty for non-matching content type", () => {
      const results = registry.list({ accepts: "video/mp4" });
      expect(results).toHaveLength(0);
    });

    it("should combine capabilityId with role filter", () => {
      // All processors, but only the one with doc:summarize
      const results = registry.list({
        role: "processor",
        capabilityId: "doc:summarize",
      });
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe("doc-processor");
    });

    it("should exclude agents without capabilityDescriptor", () => {
      // simple-worker has no descriptor, should not match any capability filter
      const results = registry.list({ capabilityId: "doc:summarize" });
      expect(results.every((a) => a.name !== "simple-worker")).toBe(true);
    });

    it("should return all agents when no filter applied", () => {
      const results = registry.list();
      expect(results).toHaveLength(3);
    });
  });
});

// ============================================================================
// Tests: Agent handlers with capability descriptors
// ============================================================================

describe("Agent handlers with capability descriptors", () => {
  let registry: AgentRegistryImpl;
  let handlers: ReturnType<typeof createAgentHandlers>;

  beforeEach(() => {
    const eventBus = createMockEventBus();
    registry = new AgentRegistryImpl({ eventBus });
    handlers = createAgentHandlers({ agents: registry });
  });

  it("should register agent with capabilityDescriptor via handler", async () => {
    const ctx = createMockContext();
    const result = await handlers["map/agents/register"](
      {
        name: "doc-processor",
        role: "processor",
        capabilityDescriptor: DOC_PROCESSOR_DESCRIPTOR,
      },
      ctx
    );

    expect(result.agent.capabilityDescriptor).toEqual(DOC_PROCESSOR_DESCRIPTOR);
  });

  it("should include capabilityDescriptor in list response", async () => {
    const ctx = createMockContext();
    await handlers["map/agents/register"](
      {
        name: "doc-processor",
        role: "processor",
        capabilityDescriptor: DOC_PROCESSOR_DESCRIPTOR,
      },
      ctx
    );

    const result = await handlers["map/agents/list"]({}, ctx);
    expect(result.agents).toHaveLength(1);
    expect(result.agents[0].capabilityDescriptor).toEqual(DOC_PROCESSOR_DESCRIPTOR);
  });

  it("should include capabilityDescriptor in get response", async () => {
    const ctx = createMockContext();
    const registered = await handlers["map/agents/register"](
      {
        name: "doc-processor",
        role: "processor",
        capabilityDescriptor: DOC_PROCESSOR_DESCRIPTOR,
      },
      ctx
    );

    const result = await handlers["map/agents/get"](
      { agentId: registered.agent.id },
      ctx
    );
    expect(result.agent.capabilityDescriptor).toEqual(DOC_PROCESSOR_DESCRIPTOR);
  });

  it("should filter by capabilityId in list handler", async () => {
    const ctx = createMockContext();
    await handlers["map/agents/register"](
      {
        name: "doc-processor",
        capabilityDescriptor: DOC_PROCESSOR_DESCRIPTOR,
      },
      ctx
    );
    await handlers["map/agents/register"](
      {
        name: "image-processor",
        capabilityDescriptor: IMAGE_PROCESSOR_DESCRIPTOR,
      },
      ctx
    );

    const result = await handlers["map/agents/list"](
      { capabilityId: "doc:summarize" },
      ctx
    );
    expect(result.agents).toHaveLength(1);
    expect(result.agents[0].name).toBe("doc-processor");
  });

  it("should filter by tags in list handler", async () => {
    const ctx = createMockContext();
    await handlers["map/agents/register"](
      {
        name: "doc-processor",
        capabilityDescriptor: DOC_PROCESSOR_DESCRIPTOR,
      },
      ctx
    );
    await handlers["map/agents/register"](
      {
        name: "image-processor",
        capabilityDescriptor: IMAGE_PROCESSOR_DESCRIPTOR,
      },
      ctx
    );

    const result = await handlers["map/agents/list"](
      { tags: ["ocr"] },
      ctx
    );
    expect(result.agents).toHaveLength(1);
    expect(result.agents[0].name).toBe("image-processor");
  });

  it("should filter by accepts in list handler", async () => {
    const ctx = createMockContext();
    await handlers["map/agents/register"](
      {
        name: "doc-processor",
        capabilityDescriptor: DOC_PROCESSOR_DESCRIPTOR,
      },
      ctx
    );
    await handlers["map/agents/register"](
      {
        name: "image-processor",
        capabilityDescriptor: IMAGE_PROCESSOR_DESCRIPTOR,
      },
      ctx
    );

    const result = await handlers["map/agents/list"](
      { accepts: "image/jpeg" },
      ctx
    );
    expect(result.agents).toHaveLength(1);
    expect(result.agents[0].name).toBe("image-processor");
  });
});
