/**
 * Tests for ACP type definitions, type guards, and ACPError class
 */

import { describe, it, expect } from "vitest";
import {
  ACPError,
  ACP_ERROR_CODES,
  ACP_METHODS,
  ACP_PROTOCOL_VERSION,
  isACPRequest,
  isACPNotification,
  isACPResponse,
  isACPErrorResponse,
  isACPSuccessResponse,
  isACPEnvelope,
} from "../acp/types";

describe("ACP Constants", () => {
  it("should export ACP_PROTOCOL_VERSION", () => {
    expect(ACP_PROTOCOL_VERSION).toBe(20241007);
  });

  it("should export all ACP methods", () => {
    expect(ACP_METHODS.INITIALIZE).toBe("initialize");
    expect(ACP_METHODS.AUTHENTICATE).toBe("authenticate");
    expect(ACP_METHODS.SESSION_NEW).toBe("session/new");
    expect(ACP_METHODS.SESSION_LOAD).toBe("session/load");
    expect(ACP_METHODS.SESSION_SET_MODE).toBe("session/set_mode");
    expect(ACP_METHODS.SESSION_PROMPT).toBe("session/prompt");
    expect(ACP_METHODS.SESSION_CANCEL).toBe("session/cancel");
    expect(ACP_METHODS.SESSION_UPDATE).toBe("session/update");
    expect(ACP_METHODS.REQUEST_PERMISSION).toBe("request_permission");
    expect(ACP_METHODS.FS_READ_TEXT_FILE).toBe("fs/read_text_file");
    expect(ACP_METHODS.FS_WRITE_TEXT_FILE).toBe("fs/write_text_file");
    expect(ACP_METHODS.TERMINAL_CREATE).toBe("terminal/create");
    expect(ACP_METHODS.TERMINAL_OUTPUT).toBe("terminal/output");
    expect(ACP_METHODS.TERMINAL_RELEASE).toBe("terminal/release");
    expect(ACP_METHODS.TERMINAL_WAIT_FOR_EXIT).toBe("terminal/wait_for_exit");
    expect(ACP_METHODS.TERMINAL_KILL).toBe("terminal/kill");
  });

  it("should export error codes", () => {
    expect(ACP_ERROR_CODES.PARSE_ERROR).toBe(-32700);
    expect(ACP_ERROR_CODES.INVALID_REQUEST).toBe(-32600);
    expect(ACP_ERROR_CODES.METHOD_NOT_FOUND).toBe(-32601);
    expect(ACP_ERROR_CODES.INVALID_PARAMS).toBe(-32602);
    expect(ACP_ERROR_CODES.INTERNAL_ERROR).toBe(-32603);
  });
});

describe("ACPError", () => {
  it("should create an error with code and message", () => {
    const error = new ACPError(-32600, "Invalid request");

    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe(-32600);
    expect(error.message).toBe("Invalid request");
    expect(error.data).toBeUndefined();
  });

  it("should create an error with data", () => {
    const error = new ACPError(-32602, "Invalid params", { field: "sessionId" });

    expect(error.code).toBe(-32602);
    expect(error.message).toBe("Invalid params");
    expect(error.data).toEqual({ field: "sessionId" });
  });

  it("should convert to error object", () => {
    const error = new ACPError(-32603, "Internal error", { details: "stack overflow" });
    const obj = error.toErrorObject();

    expect(obj).toEqual({
      code: -32603,
      message: "Internal error",
      data: { details: "stack overflow" },
    });
  });

  it("should convert to error object without data", () => {
    const error = new ACPError(-32601, "Method not found");
    const obj = error.toErrorObject();

    expect(obj).toEqual({
      code: -32601,
      message: "Method not found",
    });
    expect(obj.data).toBeUndefined();
  });

  it("should create from error response object", () => {
    const errorObj = {
      code: -32004,
      message: "Session not found",
      data: { sessionId: "abc123" },
    };

    const error = ACPError.fromResponse(errorObj);

    expect(error).toBeInstanceOf(ACPError);
    expect(error.code).toBe(-32004);
    expect(error.message).toBe("Session not found");
    expect(error.data).toEqual({ sessionId: "abc123" });
  });
});

describe("Type Guards", () => {
  describe("isACPRequest", () => {
    it("should return true for valid request", () => {
      const request = {
        jsonrpc: "2.0",
        id: "123",
        method: "initialize",
        params: { protocolVersion: 20241007 },
      };
      expect(isACPRequest(request)).toBe(true);
    });

    it("should return true for request without params", () => {
      const request = {
        jsonrpc: "2.0",
        id: 1,
        method: "session/cancel",
      };
      expect(isACPRequest(request)).toBe(true);
    });

    it("should return false for notification (no id)", () => {
      const notification = {
        jsonrpc: "2.0",
        method: "session/update",
        params: {},
      };
      expect(isACPRequest(notification)).toBe(false);
    });

    it("should return false for response", () => {
      const response = {
        jsonrpc: "2.0",
        id: "123",
        result: {},
      };
      expect(isACPRequest(response)).toBe(false);
    });

    it("should return false for non-object", () => {
      expect(isACPRequest(null)).toBe(false);
      expect(isACPRequest("string")).toBe(false);
      expect(isACPRequest(123)).toBe(false);
    });
  });

  describe("isACPNotification", () => {
    it("should return true for valid notification", () => {
      const notification = {
        jsonrpc: "2.0",
        method: "session/update",
        params: { sessionId: "abc" },
      };
      expect(isACPNotification(notification)).toBe(true);
    });

    it("should return false for request (has id)", () => {
      const request = {
        jsonrpc: "2.0",
        id: "123",
        method: "initialize",
      };
      expect(isACPNotification(request)).toBe(false);
    });

    it("should return false for invalid object", () => {
      expect(isACPNotification({})).toBe(false);
      expect(isACPNotification({ jsonrpc: "2.0" })).toBe(false);
    });
  });

  describe("isACPResponse", () => {
    it("should return true for success response", () => {
      const response = {
        jsonrpc: "2.0",
        id: "123",
        result: { sessionId: "session-1" },
      };
      expect(isACPResponse(response)).toBe(true);
    });

    it("should return true for error response", () => {
      const response = {
        jsonrpc: "2.0",
        id: "123",
        error: { code: -32600, message: "Invalid request" },
      };
      expect(isACPResponse(response)).toBe(true);
    });

    it("should return false for request", () => {
      const request = {
        jsonrpc: "2.0",
        id: "123",
        method: "initialize",
      };
      expect(isACPResponse(request)).toBe(false);
    });

    it("should return false for notification", () => {
      const notification = {
        jsonrpc: "2.0",
        method: "session/update",
      };
      expect(isACPResponse(notification)).toBe(false);
    });
  });

  describe("isACPErrorResponse", () => {
    it("should return true for error response", () => {
      const response = {
        jsonrpc: "2.0",
        id: "123",
        error: { code: -32600, message: "Invalid request" },
      };
      expect(isACPErrorResponse(response)).toBe(true);
    });

    it("should return false for success response", () => {
      const response = {
        jsonrpc: "2.0",
        id: "123",
        result: {},
      };
      expect(isACPErrorResponse(response)).toBe(false);
    });
  });

  describe("isACPSuccessResponse", () => {
    it("should return true for success response", () => {
      const response = {
        jsonrpc: "2.0",
        id: "123",
        result: { protocolVersion: 20241007 },
      };
      expect(isACPSuccessResponse(response)).toBe(true);
    });

    it("should return false for error response", () => {
      const response = {
        jsonrpc: "2.0",
        id: "123",
        error: { code: -32600, message: "Invalid request" },
      };
      expect(isACPSuccessResponse(response)).toBe(false);
    });
  });

  describe("isACPEnvelope", () => {
    it("should return true for valid envelope", () => {
      const envelope = {
        acp: {
          jsonrpc: "2.0",
          id: "123",
          method: "initialize",
        },
        acpContext: {
          streamId: "stream-1",
          sessionId: null,
          direction: "client-to-agent",
        },
      };
      expect(isACPEnvelope(envelope)).toBe(true);
    });

    it("should return true for envelope with session", () => {
      const envelope = {
        acp: {
          jsonrpc: "2.0",
          id: "123",
          result: {},
        },
        acpContext: {
          streamId: "stream-1",
          sessionId: "session-abc",
          direction: "agent-to-client",
        },
      };
      expect(isACPEnvelope(envelope)).toBe(true);
    });

    it("should return false for missing acp", () => {
      const envelope = {
        acpContext: {
          streamId: "stream-1",
          sessionId: null,
          direction: "client-to-agent",
        },
      };
      expect(isACPEnvelope(envelope)).toBe(false);
    });

    it("should return false for missing acpContext", () => {
      const envelope = {
        acp: {
          jsonrpc: "2.0",
          method: "initialize",
        },
      };
      expect(isACPEnvelope(envelope)).toBe(false);
    });

    it("should return false for missing streamId", () => {
      const envelope = {
        acp: { jsonrpc: "2.0", method: "initialize" },
        acpContext: {
          sessionId: null,
          direction: "client-to-agent",
        },
      };
      expect(isACPEnvelope(envelope)).toBe(false);
    });

    it("should return false for non-object", () => {
      expect(isACPEnvelope(null)).toBe(false);
      expect(isACPEnvelope("string")).toBe(false);
      expect(isACPEnvelope(undefined)).toBe(false);
    });
  });
});
