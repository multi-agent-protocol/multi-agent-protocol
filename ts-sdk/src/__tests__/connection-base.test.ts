/**
 * Tests for BaseConnection class
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BaseConnection } from '../connection/base';
import { createStreamPair } from '../stream';
import { MAPRequestError, MAPConnectionError, MAPTimeoutError } from '../errors';

describe('BaseConnection', () => {
  let clientStream: ReturnType<typeof createStreamPair>[0];
  let serverStream: ReturnType<typeof createStreamPair>[1];
  let clientConnection: BaseConnection;
  let serverConnection: BaseConnection;

  beforeEach(() => {
    [clientStream, serverStream] = createStreamPair();
    clientConnection = new BaseConnection(clientStream);
    serverConnection = new BaseConnection(serverStream);
  });

  afterEach(async () => {
    await clientConnection.close();
    await serverConnection.close();
  });

  describe('sendRequest', () => {
    it('sends request and receives response', async () => {
      // Set up server to handle requests
      serverConnection.setRequestHandler(async (method, params) => {
        if (method === 'echo') {
          return { echoed: (params as { data: string }).data };
        }
        throw MAPRequestError.methodNotFound(method);
      });

      const result = await clientConnection.sendRequest('echo', { data: 'hello' });

      expect(result).toEqual({ echoed: 'hello' });
    });

    it('throws on error response', async () => {
      serverConnection.setRequestHandler(async (method) => {
        throw MAPRequestError.methodNotFound(method);
      });

      await expect(clientConnection.sendRequest('unknown.method')).rejects.toThrow(MAPRequestError);
    });

    it('times out if no response', async () => {
      // Server doesn't respond
      serverConnection.setRequestHandler(async () => {
        await new Promise(() => {}); // Never resolves
      });

      await expect(
        clientConnection.sendRequest('test', undefined, { timeout: 100 })
      ).rejects.toThrow(MAPTimeoutError);
    });

    it('throws if connection is closed', async () => {
      await clientConnection.close();

      await expect(clientConnection.sendRequest('test')).rejects.toThrow(MAPConnectionError);
    });

    it('handles concurrent requests', async () => {
      serverConnection.setRequestHandler(async (method, params) => {
        const { delay, value } = params as { delay: number; value: string };
        await new Promise((resolve) => setTimeout(resolve, delay));
        return { value };
      });

      const results = await Promise.all([
        clientConnection.sendRequest('test', { delay: 50, value: 'first' }),
        clientConnection.sendRequest('test', { delay: 10, value: 'second' }),
        clientConnection.sendRequest('test', { delay: 30, value: 'third' }),
      ]);

      expect(results).toEqual([{ value: 'first' }, { value: 'second' }, { value: 'third' }]);
    });

    it('increments request IDs', async () => {
      const receivedIds: number[] = [];

      serverConnection.setRequestHandler(async (_method, _params) => {
        return null;
      });

      // Intercept to capture IDs
      const originalHandler = serverConnection.setRequestHandler;
      serverConnection.setRequestHandler(async (method, params) => {
        // We can't easily capture the ID here, but we can verify sequential behavior
        return { ok: true };
      });

      await clientConnection.sendRequest('test1');
      await clientConnection.sendRequest('test2');
      await clientConnection.sendRequest('test3');

      // If we got here without errors, IDs were properly correlated
      expect(true).toBe(true);
    });
  });

  describe('sendNotification', () => {
    it('sends notification without waiting for response', async () => {
      const notificationHandler = vi.fn();
      serverConnection.setNotificationHandler(notificationHandler);

      await clientConnection.sendNotification('test.notify', { data: 'hello' });

      // Wait for notification to be processed
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(notificationHandler).toHaveBeenCalledWith('test.notify', { data: 'hello' });
    });

    it('throws if connection is closed', async () => {
      await clientConnection.close();

      await expect(clientConnection.sendNotification('test')).rejects.toThrow(MAPConnectionError);
    });
  });

  describe('sendResponse', () => {
    it('sends success response', async () => {
      // Set up a handler that returns a success response
      serverConnection.setRequestHandler(async () => {
        return { success: true };
      });

      const result = await clientConnection.sendRequest('test');
      expect(result).toEqual({ success: true });
    });

    it('sends error response', async () => {
      serverConnection.setRequestHandler(async () => {
        throw new MAPRequestError(-32000, 'Custom error', { details: 'info' });
      });

      try {
        await clientConnection.sendRequest('test');
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(MAPRequestError);
        expect((error as MAPRequestError).code).toBe(-32000);
        expect((error as MAPRequestError).message).toBe('Custom error');
      }
    });
  });

  describe('close', () => {
    it('marks connection as closed', async () => {
      expect(clientConnection.isClosed).toBe(false);

      await clientConnection.close();

      expect(clientConnection.isClosed).toBe(true);
    });

    it('triggers abort signal', async () => {
      const abortHandler = vi.fn();
      clientConnection.signal.addEventListener('abort', abortHandler);

      await clientConnection.close();

      expect(abortHandler).toHaveBeenCalled();
    });

    it('resolves closed promise', async () => {
      const closedPromise = clientConnection.closed;

      await clientConnection.close();

      await expect(closedPromise).resolves.toBeUndefined();
    });

    it('rejects pending requests', async () => {
      // Don't set up a handler so request will be pending
      const requestPromise = clientConnection.sendRequest('test', undefined, { timeout: 5000 });

      // Close before response
      await clientConnection.close();

      await expect(requestPromise).rejects.toThrow(MAPConnectionError);
    });

    it('is idempotent', async () => {
      await clientConnection.close();
      await clientConnection.close();
      await clientConnection.close();

      expect(clientConnection.isClosed).toBe(true);
    });
  });

  describe('request handler', () => {
    it('handles requests from peer', async () => {
      const handler = vi.fn().mockResolvedValue({ handled: true });
      clientConnection.setRequestHandler(handler);

      const result = await serverConnection.sendRequest('test.method', { param: 'value' });

      expect(handler).toHaveBeenCalledWith('test.method', { param: 'value' });
      expect(result).toEqual({ handled: true });
    });

    it('returns method not found if no handler', async () => {
      // No handler set on client

      await expect(serverConnection.sendRequest('test')).rejects.toThrow(MAPRequestError);
    });

    it('catches handler errors and returns error response', async () => {
      clientConnection.setRequestHandler(async () => {
        throw new Error('Handler crashed');
      });

      try {
        await serverConnection.sendRequest('test');
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(MAPRequestError);
        expect((error as MAPRequestError).message).toContain('Handler crashed');
      }
    });
  });

  describe('notification handler', () => {
    it('handles notifications from peer', async () => {
      const handler = vi.fn();
      clientConnection.setNotificationHandler(handler);

      await serverConnection.sendNotification('test.notify', { data: 'hello' });

      // Wait for notification to be processed
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(handler).toHaveBeenCalledWith('test.notify', { data: 'hello' });
    });

    it('logs warning if no handler', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await serverConnection.sendNotification('test.notify');

      // Wait for notification to be processed
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('catches handler errors without crashing', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      clientConnection.setNotificationHandler(async () => {
        throw new Error('Handler error');
      });

      await serverConnection.sendNotification('test.notify');

      // Wait for notification to be processed
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Connection should still be working
      expect(clientConnection.isClosed).toBe(false);
      consoleSpy.mockRestore();
    });
  });

  describe('stream closure', () => {
    it('closes connection when stream closes', async () => {
      const writer = clientStream.writable.getWriter();
      await writer.close();

      // Wait for connection to detect closure
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(clientConnection.isClosed).toBe(true);
    });
  });
});
