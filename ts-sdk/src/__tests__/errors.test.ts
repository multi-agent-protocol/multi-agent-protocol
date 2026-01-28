/**
 * Tests for error classes
 */

import { describe, it, expect } from 'vitest';
import { MAPRequestError, MAPConnectionError, MAPTimeoutError } from '../errors';
import { ERROR_CODES, AUTH_ERROR_CODES, ROUTING_ERROR_CODES } from '../types';

describe('MAPRequestError', () => {
  describe('constructor', () => {
    it('creates error with code and message', () => {
      const error = new MAPRequestError(-32600, 'Invalid Request');

      expect(error.code).toBe(-32600);
      expect(error.message).toBe('Invalid Request');
      expect(error.data).toBeUndefined();
      expect(error.name).toBe('MAPRequestError');
    });

    it('includes data when provided', () => {
      const error = new MAPRequestError(-32000, 'Custom error', { category: 'internal' });

      expect(error.data).toEqual({ category: 'internal' });
    });
  });

  describe('toError', () => {
    it('converts to MAPError format', () => {
      const error = new MAPRequestError(-32600, 'Invalid Request', { category: 'protocol' });
      const mapError = error.toError();

      expect(mapError).toEqual({
        code: -32600,
        message: 'Invalid Request',
        data: { category: 'protocol' },
      });
    });

    it('omits data when undefined', () => {
      const error = new MAPRequestError(-32600, 'Invalid Request');
      const mapError = error.toError();

      expect(mapError).toEqual({
        code: -32600,
        message: 'Invalid Request',
      });
    });
  });

  describe('fromError', () => {
    it('creates from MAPError object', () => {
      const mapError = { code: -32601, message: 'Method not found', data: { category: 'protocol' } };
      const error = MAPRequestError.fromError(mapError);

      expect(error.code).toBe(-32601);
      expect(error.message).toBe('Method not found');
      expect(error.data).toEqual({ category: 'protocol' });
    });
  });

  describe('factory methods', () => {
    it('parseError creates correct error', () => {
      const error = MAPRequestError.parseError('bad json');

      expect(error.code).toBe(ERROR_CODES.PARSE_ERROR);
      expect(error.message).toBe('bad json');
      expect(error.data?.category).toBe('protocol');
    });

    it('parseError with no details uses default message', () => {
      const error = MAPRequestError.parseError();

      expect(error.message).toBe('Parse error');
    });

    it('invalidRequest creates correct error', () => {
      const error = MAPRequestError.invalidRequest('missing id');

      expect(error.code).toBe(ERROR_CODES.INVALID_REQUEST);
      expect(error.message).toBe('missing id');
      expect(error.data?.category).toBe('protocol');
    });

    it('methodNotFound creates correct error', () => {
      const error = MAPRequestError.methodNotFound('unknown.method');

      expect(error.code).toBe(ERROR_CODES.METHOD_NOT_FOUND);
      expect(error.message).toContain('unknown.method');
      expect(error.data?.category).toBe('protocol');
    });

    it('invalidParams creates correct error', () => {
      const error = MAPRequestError.invalidParams({ field: 'missing' });

      expect(error.code).toBe(ERROR_CODES.INVALID_PARAMS);
      expect(error.message).toBe('Invalid params');
      expect(error.data?.category).toBe('protocol');
    });

    it('internalError creates correct error', () => {
      const error = MAPRequestError.internalError('unexpected failure');

      expect(error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
      expect(error.message).toBe('unexpected failure');
      expect(error.data?.category).toBe('internal');
    });

    it('authFailed creates correct error', () => {
      const error = MAPRequestError.authFailed('bad token');

      expect(error.code).toBe(AUTH_ERROR_CODES.AUTH_FAILED);
      expect(error.message).toBe('bad token');
      expect(error.data?.category).toBe('auth');
    });

    it('insufficientPermissions creates correct error', () => {
      const error = MAPRequestError.insufficientPermissions('write access');

      expect(error.code).toBe(ERROR_CODES.INSUFFICIENT_PERMISSIONS);
      expect(error.message).toContain('write access');
      expect(error.data?.category).toBe('auth');
    });

    it('agentNotFound creates correct error', () => {
      const error = MAPRequestError.agentNotFound('agent-123');

      expect(error.code).toBe(ERROR_CODES.AGENT_NOT_FOUND);
      expect(error.message).toContain('agent-123');
      expect(error.data?.category).toBe('routing');
    });

    it('scopeNotFound creates correct error', () => {
      const error = MAPRequestError.scopeNotFound('scope-456');

      expect(error.code).toBe(ERROR_CODES.SCOPE_NOT_FOUND);
      expect(error.message).toContain('scope-456');
      expect(error.data?.category).toBe('routing');
    });

    it('deliveryFailed creates correct error', () => {
      const error = MAPRequestError.deliveryFailed('no recipients');

      expect(error.code).toBe(ERROR_CODES.DELIVERY_FAILED);
      expect(error.message).toBe('no recipients');
      expect(error.data?.retryable).toBe(true);
    });

    it('rateLimited creates correct error with retry time', () => {
      const error = MAPRequestError.rateLimited(5000);

      expect(error.code).toBe(ERROR_CODES.RATE_LIMITED);
      expect(error.message).toContain('Rate limited');
      expect(error.data?.retryAfterMs).toBe(5000);
      expect(error.data?.retryable).toBe(true);
    });
  });

  describe('retryable getter', () => {
    it('returns true when retryable in data', () => {
      const error = MAPRequestError.rateLimited(1000);

      expect(error.retryable).toBe(true);
    });

    it('returns false when not retryable', () => {
      const error = MAPRequestError.agentNotFound('agent-1');

      expect(error.retryable).toBe(false);
    });
  });

  describe('retryAfterMs getter', () => {
    it('returns retry delay when set', () => {
      const error = MAPRequestError.rateLimited(5000);

      expect(error.retryAfterMs).toBe(5000);
    });

    it('returns undefined when not set', () => {
      const error = MAPRequestError.agentNotFound('agent-1');

      expect(error.retryAfterMs).toBeUndefined();
    });
  });

  describe('category getter', () => {
    it('returns category from data', () => {
      const error = MAPRequestError.authFailed();

      expect(error.category).toBe('auth');
    });
  });
});

describe('MAPConnectionError', () => {
  describe('constructor', () => {
    it('creates error with message', () => {
      const error = new MAPConnectionError('Connection failed');

      expect(error.message).toBe('Connection failed');
      expect(error.name).toBe('MAPConnectionError');
    });
  });

  describe('factory methods', () => {
    it('closed creates correct error', () => {
      const error = MAPConnectionError.closed();

      expect(error.message).toContain('closed');
    });

    it('timeout creates correct error', () => {
      const error = MAPConnectionError.timeout();

      expect(error.message).toContain('timeout');
    });
  });
});

describe('MAPTimeoutError', () => {
  describe('constructor', () => {
    it('creates error with operation and timeout', () => {
      const error = new MAPTimeoutError('connect', 5000);

      expect(error.timeoutMs).toBe(5000);
      expect(error.message).toContain('connect');
      expect(error.message).toContain('5000');
      expect(error.name).toBe('MAPTimeoutError');
    });
  });
});
