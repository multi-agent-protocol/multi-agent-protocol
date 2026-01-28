/**
 * Tests for stream utilities
 */

import { describe, it, expect } from 'vitest';
import { createStreamPair, ndJsonStream, type Stream } from '../stream';

describe('createStreamPair', () => {
  it('creates two connected streams', () => {
    const [clientStream, serverStream] = createStreamPair();

    expect(clientStream.readable).toBeDefined();
    expect(clientStream.writable).toBeDefined();
    expect(serverStream.readable).toBeDefined();
    expect(serverStream.writable).toBeDefined();
  });

  it('messages from client reach server', async () => {
    const [clientStream, serverStream] = createStreamPair();

    const message = { jsonrpc: '2.0' as const, id: 1, method: 'test' };

    // Write from client
    const writer = clientStream.writable.getWriter();
    await writer.write(message);
    writer.releaseLock();

    // Read from server
    const reader = serverStream.readable.getReader();
    const { value, done } = await reader.read();
    reader.releaseLock();

    expect(done).toBe(false);
    expect(value).toEqual(message);
  });

  it('messages from server reach client', async () => {
    const [clientStream, serverStream] = createStreamPair();

    const message = { jsonrpc: '2.0' as const, id: 1, result: { success: true } };

    // Write from server
    const writer = serverStream.writable.getWriter();
    await writer.write(message);
    writer.releaseLock();

    // Read from client
    const reader = clientStream.readable.getReader();
    const { value, done } = await reader.read();
    reader.releaseLock();

    expect(done).toBe(false);
    expect(value).toEqual(message);
  });

  it('supports multiple messages in sequence', async () => {
    const [clientStream, serverStream] = createStreamPair();

    const messages = [
      { jsonrpc: '2.0' as const, id: 1, method: 'first' },
      { jsonrpc: '2.0' as const, id: 2, method: 'second' },
      { jsonrpc: '2.0' as const, id: 3, method: 'third' },
    ];

    // Write all messages
    const writer = clientStream.writable.getWriter();
    for (const msg of messages) {
      await writer.write(msg);
    }
    writer.releaseLock();

    // Read all messages
    const reader = serverStream.readable.getReader();
    const received = [];
    for (let i = 0; i < messages.length; i++) {
      const { value } = await reader.read();
      received.push(value);
    }
    reader.releaseLock();

    expect(received).toEqual(messages);
  });

  it('closing writable signals end to readable', async () => {
    const [clientStream, serverStream] = createStreamPair();

    // Close client writable
    const writer = clientStream.writable.getWriter();
    await writer.close();

    // Server readable should signal done
    const reader = serverStream.readable.getReader();
    const { done } = await reader.read();
    reader.releaseLock();

    expect(done).toBe(true);
  });

  it('supports bidirectional communication', async () => {
    const [clientStream, serverStream] = createStreamPair();

    // Client sends request
    const request = { jsonrpc: '2.0' as const, id: 1, method: 'echo', params: { data: 'hello' } };
    const clientWriter = clientStream.writable.getWriter();
    await clientWriter.write(request);
    clientWriter.releaseLock();

    // Server receives request
    const serverReader = serverStream.readable.getReader();
    const { value: receivedRequest } = await serverReader.read();
    serverReader.releaseLock();

    expect(receivedRequest).toEqual(request);

    // Server sends response
    const response = { jsonrpc: '2.0' as const, id: 1, result: { echoed: 'hello' } };
    const serverWriter = serverStream.writable.getWriter();
    await serverWriter.write(response);
    serverWriter.releaseLock();

    // Client receives response
    const clientReader = clientStream.readable.getReader();
    const { value: receivedResponse } = await clientReader.read();
    clientReader.releaseLock();

    expect(receivedResponse).toEqual(response);
  });
});

describe('ndJsonStream', () => {
  /**
   * Helper to create a readable stream from strings
   */
  function createReadableFromStrings(strings: string[]): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    let index = 0;

    return new ReadableStream({
      pull(controller) {
        if (index < strings.length) {
          controller.enqueue(encoder.encode(strings[index]));
          index++;
        } else {
          controller.close();
        }
      },
    });
  }

  /**
   * Helper to collect writes to a writable stream
   */
  function createWritableCollector(): {
    writable: WritableStream<Uint8Array>;
    getWritten: () => string;
  } {
    const decoder = new TextDecoder();
    const chunks: string[] = [];

    const writable = new WritableStream({
      write(chunk) {
        chunks.push(decoder.decode(chunk));
      },
    });

    return {
      writable,
      getWritten: () => chunks.join(''),
    };
  }

  it('parses newline-delimited JSON', async () => {
    const input = ['{"jsonrpc":"2.0","id":1,"method":"test"}\n'];
    const readable = createReadableFromStrings(input);
    const { writable } = createWritableCollector();

    const stream = ndJsonStream(readable, writable);

    const reader = stream.readable.getReader();
    const { value, done } = await reader.read();
    reader.releaseLock();

    expect(done).toBe(false);
    expect(value).toEqual({ jsonrpc: '2.0', id: 1, method: 'test' });
  });

  it('handles multiple messages', async () => {
    const input = [
      '{"jsonrpc":"2.0","id":1,"method":"first"}\n',
      '{"jsonrpc":"2.0","id":2,"method":"second"}\n',
    ];
    const readable = createReadableFromStrings(input);
    const { writable } = createWritableCollector();

    const stream = ndJsonStream(readable, writable);
    const reader = stream.readable.getReader();

    const results = [];
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      results.push(value);
    }
    reader.releaseLock();

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ jsonrpc: '2.0', id: 1, method: 'first' });
    expect(results[1]).toEqual({ jsonrpc: '2.0', id: 2, method: 'second' });
  });

  it('handles chunked input (message split across chunks)', async () => {
    // Message split across multiple chunks
    const input = ['{"jsonrpc":"2.0",', '"id":1,', '"method":"test"}\n'];
    const readable = createReadableFromStrings(input);
    const { writable } = createWritableCollector();

    const stream = ndJsonStream(readable, writable);
    const reader = stream.readable.getReader();

    const { value, done } = await reader.read();
    reader.releaseLock();

    expect(done).toBe(false);
    expect(value).toEqual({ jsonrpc: '2.0', id: 1, method: 'test' });
  });

  it('handles multiple messages in single chunk', async () => {
    const input = [
      '{"jsonrpc":"2.0","id":1,"method":"first"}\n{"jsonrpc":"2.0","id":2,"method":"second"}\n',
    ];
    const readable = createReadableFromStrings(input);
    const { writable } = createWritableCollector();

    const stream = ndJsonStream(readable, writable);
    const reader = stream.readable.getReader();

    const results = [];
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      results.push(value);
    }
    reader.releaseLock();

    expect(results).toHaveLength(2);
  });

  it('skips empty lines', async () => {
    const input = ['{"jsonrpc":"2.0","id":1,"method":"test"}\n\n\n'];
    const readable = createReadableFromStrings(input);
    const { writable } = createWritableCollector();

    const stream = ndJsonStream(readable, writable);
    const reader = stream.readable.getReader();

    const { value } = await reader.read();
    const { done } = await reader.read();
    reader.releaseLock();

    expect(value).toEqual({ jsonrpc: '2.0', id: 1, method: 'test' });
    expect(done).toBe(true);
  });

  it('writes messages as newline-delimited JSON', async () => {
    const readable = createReadableFromStrings([]);
    const { writable, getWritten } = createWritableCollector();

    const stream = ndJsonStream(readable, writable);
    const writer = stream.writable.getWriter();

    await writer.write({ jsonrpc: '2.0', id: 1, method: 'test' });
    await writer.write({ jsonrpc: '2.0', id: 2, result: { ok: true } });
    await writer.close();

    const written = getWritten();
    const lines = written.trim().split('\n');

    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toEqual({ jsonrpc: '2.0', id: 1, method: 'test' });
    expect(JSON.parse(lines[1])).toEqual({ jsonrpc: '2.0', id: 2, result: { ok: true } });
  });

  it('handles incomplete final message (no trailing newline)', async () => {
    const input = ['{"jsonrpc":"2.0","id":1,"method":"test"}'];
    const readable = createReadableFromStrings(input);
    const { writable } = createWritableCollector();

    const stream = ndJsonStream(readable, writable);
    const reader = stream.readable.getReader();

    const { value, done } = await reader.read();
    reader.releaseLock();

    expect(done).toBe(false);
    expect(value).toEqual({ jsonrpc: '2.0', id: 1, method: 'test' });
  });
});
