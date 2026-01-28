/**
 * Stream utilities for MAP protocol transport
 *
 * Provides helpers for converting byte streams to/from MAP message streams.
 */

import type { MAPRequest, MAPResponse, MAPNotification } from '../types';

/** Any MAP message type */
export type AnyMessage = MAPRequest | MAPResponse | MAPNotification | Record<string, unknown>;

/**
 * Bidirectional message stream interface.
 * This is the transport abstraction that connection classes use.
 */
export interface Stream {
  writable: WritableStream<AnyMessage>;
  readable: ReadableStream<AnyMessage>;
}

/**
 * Converts raw byte streams to newline-delimited JSON message streams.
 *
 * This is the primary transport adapter - works with any byte stream
 * (stdio, TCP socket, etc.)
 *
 * @param readable - Input byte stream
 * @param writable - Output byte stream
 * @returns Stream interface for MAP messages
 */
export function ndJsonStream(
  readable: ReadableStream<Uint8Array>,
  writable: WritableStream<Uint8Array>
): Stream {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  // Buffer for incomplete lines
  let buffer = '';

  const messageReadable = new ReadableStream<AnyMessage>({
    async start(controller) {
      const reader = readable.getReader();

      try {
        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            // Process any remaining buffer content
            if (buffer.trim()) {
              try {
                const message = JSON.parse(buffer.trim());
                controller.enqueue(message);
              } catch {
                console.error('MAP: Failed to parse final message:', buffer);
              }
            }
            controller.close();
            break;
          }

          // Decode bytes and add to buffer
          buffer += decoder.decode(value, { stream: true });

          // Process complete lines
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? ''; // Keep incomplete line in buffer

          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed) {
              try {
                const message = JSON.parse(trimmed);
                controller.enqueue(message);
              } catch {
                console.error('MAP: Failed to parse message:', trimmed);
              }
            }
          }
        }
      } catch (error) {
        controller.error(error);
      } finally {
        reader.releaseLock();
      }
    },
  });

  const messageWritable = new WritableStream<AnyMessage>({
    async write(message) {
      const writer = writable.getWriter();
      try {
        const json = JSON.stringify(message) + '\n';
        await writer.write(encoder.encode(json));
      } finally {
        writer.releaseLock();
      }
    },
    async close() {
      await writable.close();
    },
    abort(reason) {
      writable.abort(reason);
    },
  });

  return {
    readable: messageReadable,
    writable: messageWritable,
  };
}

/**
 * Wraps a WebSocket in a Stream interface.
 *
 * @param ws - WebSocket instance (must be open or will wait for open)
 * @returns Stream interface for MAP messages
 */
export function websocketStream(ws: WebSocket): Stream {
  // Queue for messages received before reader is ready
  const messageQueue: AnyMessage[] = [];
  let messageResolver: ((value: IteratorResult<AnyMessage>) => void) | null = null;
  let closed = false;
  let closeError: Error | null = null;

  // Handle incoming messages
  ws.addEventListener('message', (event) => {
    try {
      const message = JSON.parse(event.data as string);
      if (messageResolver) {
        messageResolver({ value: message, done: false });
        messageResolver = null;
      } else {
        messageQueue.push(message);
      }
    } catch {
      console.error('MAP: Failed to parse WebSocket message:', event.data);
    }
  });

  ws.addEventListener('close', () => {
    closed = true;
    if (messageResolver) {
      messageResolver({ value: undefined as unknown as AnyMessage, done: true });
      messageResolver = null;
    }
  });

  ws.addEventListener('error', () => {
    closeError = new Error('WebSocket error');
    closed = true;
    if (messageResolver) {
      messageResolver({ value: undefined as unknown as AnyMessage, done: true });
      messageResolver = null;
    }
  });

  const readable = new ReadableStream<AnyMessage>({
    async pull(controller) {
      if (messageQueue.length > 0) {
        controller.enqueue(messageQueue.shift()!);
        return;
      }

      if (closed) {
        if (closeError) {
          controller.error(closeError);
        } else {
          controller.close();
        }
        return;
      }

      // Wait for next message
      await new Promise<IteratorResult<AnyMessage>>((resolve) => {
        messageResolver = resolve;
      }).then((result) => {
        if (result.done) {
          controller.close();
        } else {
          controller.enqueue(result.value);
        }
      });
    },
  });

  const writable = new WritableStream<AnyMessage>({
    async write(message) {
      if (ws.readyState === WebSocket.CONNECTING) {
        await new Promise<void>((resolve, reject) => {
          const onOpen = () => {
            ws.removeEventListener('error', onError);
            resolve();
          };
          const onError = () => {
            ws.removeEventListener('open', onOpen);
            reject(new Error('WebSocket failed to connect'));
          };
          ws.addEventListener('open', onOpen, { once: true });
          ws.addEventListener('error', onError, { once: true });
        });
      }

      if (ws.readyState !== WebSocket.OPEN) {
        throw new Error('WebSocket is not open');
      }

      ws.send(JSON.stringify(message));
    },
    close() {
      ws.close();
    },
    abort() {
      ws.close();
    },
  });

  return { readable, writable };
}

/**
 * Creates a pair of connected in-memory streams for testing.
 *
 * Messages written to one stream's writable appear on the other's readable.
 *
 * @returns Tuple of [clientStream, serverStream]
 */
export function createStreamPair(): [Stream, Stream] {
  // Queues for each direction
  const clientToServer: AnyMessage[] = [];
  const serverToClient: AnyMessage[] = [];

  // Resolvers for blocking reads
  let clientToServerResolver: ((msg: AnyMessage) => void) | null = null;
  let serverToClientResolver: ((msg: AnyMessage) => void) | null = null;

  // Closed flags
  let clientToServerClosed = false;
  let serverToClientClosed = false;

  function createReadable(
    queue: AnyMessage[],
    _getResolver: () => ((msg: AnyMessage) => void) | null,
    setResolver: (r: ((msg: AnyMessage) => void) | null) => void,
    isClosed: () => boolean
  ): ReadableStream<AnyMessage> {
    return new ReadableStream({
      async pull(controller) {
        if (queue.length > 0) {
          controller.enqueue(queue.shift()!);
          return;
        }

        if (isClosed()) {
          controller.close();
          return;
        }

        const message = await new Promise<AnyMessage | null>((resolve) => {
          setResolver((msg) => {
            setResolver(null);
            resolve(msg);
          });
        });

        if (message === null) {
          controller.close();
        } else {
          controller.enqueue(message);
        }
      },
    });
  }

  function createWritable(
    queue: AnyMessage[],
    getResolver: () => ((msg: AnyMessage) => void) | null,
    setClosed: () => void
  ): WritableStream<AnyMessage> {
    return new WritableStream({
      write(message) {
        const resolver = getResolver();
        if (resolver) {
          resolver(message);
        } else {
          queue.push(message);
        }
      },
      close() {
        setClosed();
        const resolver = getResolver();
        if (resolver) {
          resolver(null as unknown as AnyMessage);
        }
      },
    });
  }

  const clientStream: Stream = {
    // Client writes to server
    writable: createWritable(
      clientToServer,
      () => clientToServerResolver,
      () => {
        clientToServerClosed = true;
      }
    ),
    // Client reads from server
    readable: createReadable(
      serverToClient,
      () => serverToClientResolver,
      (r) => {
        serverToClientResolver = r;
      },
      () => serverToClientClosed
    ),
  };

  const serverStream: Stream = {
    // Server writes to client
    writable: createWritable(
      serverToClient,
      () => serverToClientResolver,
      () => {
        serverToClientClosed = true;
      }
    ),
    // Server reads from client
    readable: createReadable(
      clientToServer,
      () => clientToServerResolver,
      (r) => {
        clientToServerResolver = r;
      },
      () => clientToServerClosed
    ),
  };

  return [clientStream, serverStream];
}
