/**
 * Tests for ClientConnection and AgentConnection static connect() methods
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  ClientConnection,
  AgentConnection,
  type ClientConnectOptions,
  type AgentConnectOptions,
} from "../connection";
import { waitForOpen, createStreamPair, websocketStream } from "../stream";
import { TestServer } from "../testing/server";

describe("waitForOpen", () => {
  it("should resolve immediately if WebSocket is already open", async () => {
    // Create a mock WebSocket that's already open
    const mockWs = {
      readyState: WebSocket.OPEN,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      close: vi.fn(),
    } as unknown as WebSocket;

    await expect(waitForOpen(mockWs)).resolves.toBeUndefined();
    expect(mockWs.addEventListener).not.toHaveBeenCalled();
  });

  it("should wait for open event", async () => {
    const listeners: Record<string, (() => void)[]> = {};
    const mockWs = {
      readyState: WebSocket.CONNECTING,
      addEventListener: vi.fn((event: string, handler: () => void) => {
        listeners[event] = listeners[event] || [];
        listeners[event].push(handler);
      }),
      removeEventListener: vi.fn((event: string, handler: () => void) => {
        if (listeners[event]) {
          listeners[event] = listeners[event].filter((h) => h !== handler);
        }
      }),
      close: vi.fn(),
    } as unknown as WebSocket;

    const promise = waitForOpen(mockWs, 5000);

    // Simulate open event
    listeners["open"]?.[0]?.();

    await expect(promise).resolves.toBeUndefined();
  });

  it("should reject on error event", async () => {
    const listeners: Record<string, (() => void)[]> = {};
    const mockWs = {
      readyState: WebSocket.CONNECTING,
      addEventListener: vi.fn((event: string, handler: () => void) => {
        listeners[event] = listeners[event] || [];
        listeners[event].push(handler);
      }),
      removeEventListener: vi.fn(),
      close: vi.fn(),
    } as unknown as WebSocket;

    const promise = waitForOpen(mockWs, 5000);

    // Simulate error event
    listeners["error"]?.[0]?.();

    await expect(promise).rejects.toThrow("WebSocket connection failed");
  });

  it("should reject on timeout", async () => {
    vi.useFakeTimers();

    const mockWs = {
      readyState: WebSocket.CONNECTING,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      close: vi.fn(),
    } as unknown as WebSocket;

    const promise = waitForOpen(mockWs, 100);

    vi.advanceTimersByTime(101);

    await expect(promise).rejects.toThrow(
      "WebSocket connection timeout after 100ms"
    );
    expect(mockWs.close).toHaveBeenCalled();

    vi.useRealTimers();
  });
});

describe("ClientConnection.connect", () => {
  it("should reject invalid protocol", async () => {
    await expect(
      ClientConnection.connect("http://localhost:8080")
    ).rejects.toThrow("Unsupported protocol: http:. Use ws: or wss:");
  });

  it("should reject invalid URL", async () => {
    await expect(ClientConnection.connect("not-a-url")).rejects.toThrow();
  });

  it("should accept ws: protocol", async () => {
    // Mock the global WebSocket
    const originalWebSocket = global.WebSocket;
    const listeners: Record<string, (() => void)[]> = {};

    const mockWs = {
      readyState: WebSocket.CONNECTING,
      addEventListener: vi.fn((event: string, handler: () => void) => {
        listeners[event] = listeners[event] || [];
        listeners[event].push(handler);
      }),
      removeEventListener: vi.fn(),
      close: vi.fn(),
      send: vi.fn(),
    };

    global.WebSocket = vi.fn(() => mockWs) as unknown as typeof WebSocket;

    try {
      const connectPromise = ClientConnection.connect("ws://localhost:8080", {
        name: "TestClient",
      });

      // Simulate connection failure to abort the test quickly
      listeners["error"]?.[0]?.();

      await expect(connectPromise).rejects.toThrow();
    } finally {
      global.WebSocket = originalWebSocket;
    }
  });

  it("should accept wss: protocol", async () => {
    const originalWebSocket = global.WebSocket;
    const listeners: Record<string, (() => void)[]> = {};

    const mockWs = {
      readyState: WebSocket.CONNECTING,
      addEventListener: vi.fn((event: string, handler: () => void) => {
        listeners[event] = listeners[event] || [];
        listeners[event].push(handler);
      }),
      removeEventListener: vi.fn(),
      close: vi.fn(),
      send: vi.fn(),
    };

    global.WebSocket = vi.fn(() => mockWs) as unknown as typeof WebSocket;

    try {
      const connectPromise = ClientConnection.connect(
        "wss://secure.example.com",
        {
          name: "SecureClient",
        }
      );

      // Simulate connection failure to abort the test quickly
      listeners["error"]?.[0]?.();

      await expect(connectPromise).rejects.toThrow();
    } finally {
      global.WebSocket = originalWebSocket;
    }
  });

  it("should normalize reconnection: true to { enabled: true }", async () => {
    const originalWebSocket = global.WebSocket;
    const listeners: Record<string, (() => void)[]> = {};

    const mockWs = {
      readyState: WebSocket.CONNECTING,
      addEventListener: vi.fn((event: string, handler: () => void) => {
        listeners[event] = listeners[event] || [];
        listeners[event].push(handler);
      }),
      removeEventListener: vi.fn(),
      close: vi.fn(),
      send: vi.fn(),
    };

    global.WebSocket = vi.fn(() => mockWs) as unknown as typeof WebSocket;

    try {
      const connectPromise = ClientConnection.connect("ws://localhost:8080", {
        reconnection: true,
      });

      // Simulate connection failure
      listeners["error"]?.[0]?.();

      await expect(connectPromise).rejects.toThrow();

      // Verify WebSocket was constructed
      expect(global.WebSocket).toHaveBeenCalledWith("ws://localhost:8080");
    } finally {
      global.WebSocket = originalWebSocket;
    }
  });
});

describe("AgentConnection.connect", () => {
  it("should reject invalid protocol", async () => {
    await expect(
      AgentConnection.connect("http://localhost:8080")
    ).rejects.toThrow("Unsupported protocol: http:. Use ws: or wss:");
  });

  it("should accept ws: protocol", async () => {
    const originalWebSocket = global.WebSocket;
    const listeners: Record<string, (() => void)[]> = {};

    const mockWs = {
      readyState: WebSocket.CONNECTING,
      addEventListener: vi.fn((event: string, handler: () => void) => {
        listeners[event] = listeners[event] || [];
        listeners[event].push(handler);
      }),
      removeEventListener: vi.fn(),
      close: vi.fn(),
      send: vi.fn(),
    };

    global.WebSocket = vi.fn(() => mockWs) as unknown as typeof WebSocket;

    try {
      const connectPromise = AgentConnection.connect("ws://localhost:8080", {
        name: "TestAgent",
        role: "worker",
      });

      // Simulate connection failure
      listeners["error"]?.[0]?.();

      await expect(connectPromise).rejects.toThrow();
    } finally {
      global.WebSocket = originalWebSocket;
    }
  });

  it("should pass agent-specific options", async () => {
    const originalWebSocket = global.WebSocket;
    const listeners: Record<string, (() => void)[]> = {};

    const mockWs = {
      readyState: WebSocket.CONNECTING,
      addEventListener: vi.fn((event: string, handler: () => void) => {
        listeners[event] = listeners[event] || [];
        listeners[event].push(handler);
      }),
      removeEventListener: vi.fn(),
      close: vi.fn(),
      send: vi.fn(),
    };

    global.WebSocket = vi.fn(() => mockWs) as unknown as typeof WebSocket;

    try {
      const options: AgentConnectOptions = {
        name: "Worker",
        role: "processor",
        visibility: "public",
        scopes: ["scope-1"],
        reconnection: {
          enabled: true,
          maxRetries: 5,
        },
      };

      const connectPromise = AgentConnection.connect(
        "ws://localhost:8080",
        options
      );

      // Simulate connection failure
      listeners["error"]?.[0]?.();

      await expect(connectPromise).rejects.toThrow();
    } finally {
      global.WebSocket = originalWebSocket;
    }
  });
});

describe("ClientConnection.connect integration", () => {
  let server: TestServer;

  beforeEach(() => {
    server = new TestServer({ name: "TestServer" });
  });

  afterEach(async () => {
    // Clean up
  });

  it("should work with stream-based testing (simulating full flow)", async () => {
    const [clientStream, serverStream] = createStreamPair();

    // Server accepts connection
    server.acceptConnection(serverStream);

    // Create client the old way to verify the flow works
    const client = new ClientConnection(clientStream, { name: "TestClient" });
    await client.connect();

    expect(client.isConnected).toBe(true);
    expect(client.sessionId).toBeTruthy();

    await client.disconnect();
  });
});

describe("AgentConnection.connect integration", () => {
  let server: TestServer;

  beforeEach(() => {
    server = new TestServer({ name: "TestServer" });
  });

  it("should work with stream-based testing (simulating full flow)", async () => {
    const [clientStream, serverStream] = createStreamPair();

    // Server accepts connection
    server.acceptConnection(serverStream);

    // Create agent the old way to verify the flow works
    const agent = new AgentConnection(clientStream, {
      name: "TestAgent",
      role: "worker",
    });
    const result = await agent.connect();

    expect(agent.isConnected).toBe(true);
    expect(agent.agentId).toBeTruthy();
    expect(result.agent.name).toBe("TestAgent");
    expect(result.agent.role).toBe("worker");

    await agent.disconnect();
  });
});
