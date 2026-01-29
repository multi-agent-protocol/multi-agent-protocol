/**
 * Tests for JSON-RPC utilities
 */

import { describe, it, expect } from 'vitest';
import {
  isRequest,
  isNotification,
  isResponse,
  isErrorResponse,
  createRequest,
  createNotification,
  createSuccessResponse,
  createErrorResponse,
} from '../jsonrpc';

describe('JSON-RPC utilities', () => {
  describe('createRequest', () => {
    it('creates a valid request with params', () => {
      const request = createRequest(1, 'test.method', { foo: 'bar' });

      expect(request).toEqual({
        jsonrpc: '2.0',
        id: 1,
        method: 'test.method',
        params: { foo: 'bar' },
      });
    });

    it('creates a valid request without params', () => {
      const request = createRequest(2, 'test.method');

      expect(request).toEqual({
        jsonrpc: '2.0',
        id: 2,
        method: 'test.method',
      });
    });

    it('supports string IDs', () => {
      const request = createRequest('abc-123', 'test.method');

      expect(request.id).toBe('abc-123');
    });
  });

  describe('createNotification', () => {
    it('creates a valid notification with params', () => {
      const notification = createNotification('test.notify', { data: 123 });

      expect(notification).toEqual({
        jsonrpc: '2.0',
        method: 'test.notify',
        params: { data: 123 },
      });
    });

    it('creates a valid notification without params', () => {
      const notification = createNotification('test.notify');

      expect(notification).toEqual({
        jsonrpc: '2.0',
        method: 'test.notify',
      });
    });

    it('does not include id field', () => {
      const notification = createNotification('test.notify');

      expect('id' in notification).toBe(false);
    });
  });

  describe('createSuccessResponse', () => {
    it('creates a valid success response', () => {
      const response = createSuccessResponse(1, { result: 'ok' });

      expect(response).toEqual({
        jsonrpc: '2.0',
        id: 1,
        result: { result: 'ok' },
      });
    });

    it('handles null result', () => {
      const response = createSuccessResponse(1, null);

      expect(response.result).toBeNull();
    });

    it('handles undefined result as null', () => {
      const response = createSuccessResponse(1, undefined);

      expect(response.result).toBeUndefined();
    });
  });

  describe('createErrorResponse', () => {
    it('creates a valid error response', () => {
      const response = createErrorResponse(1, {
        code: -32600,
        message: 'Invalid Request',
      });

      expect(response).toEqual({
        jsonrpc: '2.0',
        id: 1,
        error: {
          code: -32600,
          message: 'Invalid Request',
        },
      });
    });

    it('includes error data when provided', () => {
      const response = createErrorResponse(1, {
        code: -32000,
        message: 'Custom error',
        data: { details: 'more info' },
      });

      expect(response.error.data).toEqual({ details: 'more info' });
    });
  });

  describe('isRequest', () => {
    it('returns true for valid requests', () => {
      expect(isRequest({ jsonrpc: '2.0', id: 1, method: 'test' })).toBe(true);
      expect(isRequest({ jsonrpc: '2.0', id: 'abc', method: 'test' })).toBe(true);
      expect(isRequest({ jsonrpc: '2.0', id: 1, method: 'test', params: {} })).toBe(true);
    });

    it('returns false for notifications (no id)', () => {
      expect(isRequest({ jsonrpc: '2.0', method: 'test' })).toBe(false);
    });

    it('returns false for responses', () => {
      expect(isRequest({ jsonrpc: '2.0', id: 1, result: {} })).toBe(false);
      expect(isRequest({ jsonrpc: '2.0', id: 1, error: { code: 1, message: 'err' } })).toBe(false);
    });

    it('returns false for invalid messages', () => {
      expect(isRequest(null)).toBe(false);
      expect(isRequest(undefined)).toBe(false);
      expect(isRequest({})).toBe(false);
      expect(isRequest({ jsonrpc: '1.0', id: 1, method: 'test' })).toBe(false);
    });
  });

  describe('isNotification', () => {
    it('returns true for valid notifications', () => {
      expect(isNotification({ jsonrpc: '2.0', method: 'test' })).toBe(true);
      expect(isNotification({ jsonrpc: '2.0', method: 'test', params: {} })).toBe(true);
    });

    it('returns false for requests (has id)', () => {
      expect(isNotification({ jsonrpc: '2.0', id: 1, method: 'test' })).toBe(false);
    });

    it('returns false for responses', () => {
      expect(isNotification({ jsonrpc: '2.0', id: 1, result: {} })).toBe(false);
    });

    it('returns false for invalid messages', () => {
      expect(isNotification(null)).toBe(false);
      expect(isNotification({})).toBe(false);
    });
  });

  describe('isResponse', () => {
    it('returns true for success responses', () => {
      expect(isResponse({ jsonrpc: '2.0', id: 1, result: {} })).toBe(true);
      expect(isResponse({ jsonrpc: '2.0', id: 1, result: null })).toBe(true);
    });

    it('returns true for error responses', () => {
      expect(isResponse({ jsonrpc: '2.0', id: 1, error: { code: 1, message: 'err' } })).toBe(true);
    });

    it('returns false for requests', () => {
      expect(isResponse({ jsonrpc: '2.0', id: 1, method: 'test' })).toBe(false);
    });

    it('returns false for notifications', () => {
      expect(isResponse({ jsonrpc: '2.0', method: 'test' })).toBe(false);
    });
  });

  describe('isErrorResponse', () => {
    it('returns true for error responses', () => {
      expect(isErrorResponse({ jsonrpc: '2.0', id: 1, error: { code: 1, message: 'err' } })).toBe(
        true
      );
    });

    it('returns false for success responses', () => {
      expect(isErrorResponse({ jsonrpc: '2.0', id: 1, result: {} })).toBe(false);
    });

    it('returns false for requests and notifications', () => {
      expect(isErrorResponse({ jsonrpc: '2.0', id: 1, method: 'test' })).toBe(false);
      expect(isErrorResponse({ jsonrpc: '2.0', method: 'test' })).toBe(false);
    });
  });
});
