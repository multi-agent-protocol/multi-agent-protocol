/**
 * MAP Debug Server
 *
 * A standalone MAP server that logs all JSON-RPC traffic for debugging.
 * Uses the TestServer under the hood so all MAP protocol methods work.
 *
 * Modes:
 *   stdio:     npx tsx examples/debug-server/main.ts
 *   WebSocket: npx tsx examples/debug-server/main.ts --port 8080
 *
 * In stdio mode, send ndjson on stdin, receive responses on stdout, logs go to stderr.
 * In WebSocket mode, connect any MAP client to ws://localhost:<port>.
 */

import { TestServer } from "../../src/testing/server";
import { ndJsonStream } from "../../src/stream";
import type { AnyMessage, Stream } from "../../src/stream";
import { Readable, Writable } from "node:stream";

// =============================================================================
// ANSI color helpers
// =============================================================================

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const BLUE = "\x1b[34m";
const MAGENTA = "\x1b[35m";
const CYAN = "\x1b[36m";

// =============================================================================
// Logging
// =============================================================================

function log(...args: unknown[]) {
  const timestamp = new Date().toISOString().slice(11, 23); // HH:mm:ss.SSS
  process.stderr.write(`${DIM}[${timestamp}]${RESET} ${args.join(" ")}\n`);
}

function prettyJson(obj: unknown): string {
  return JSON.stringify(obj, null, 2)
    .split("\n")
    .map((line) => `  ${DIM}${line}${RESET}`)
    .join("\n");
}

function logMessage(
  direction: "in" | "out",
  message: AnyMessage,
  label: string,
) {
  const msg = message as Record<string, unknown>;

  const arrow =
    direction === "in"
      ? `${GREEN}${BOLD}\u2192 IN ${RESET}`
      : `${BLUE}${BOLD}\u2190 OUT${RESET}`;

  const fmtMethod = (m: string) => `${BOLD}${CYAN}${m}${RESET}`;
  const fmtId = (id: unknown) => `${DIM}id=${id}${RESET}`;

  if ("method" in msg && "id" in msg) {
    // JSON-RPC Request
    log(
      `${arrow} ${YELLOW}[REQ]${RESET} ${fmtMethod(msg.method as string)} ${fmtId(msg.id)} ${DIM}(${label})${RESET}`,
    );
    if (msg.params) log(prettyJson(msg.params));
  } else if ("method" in msg && !("id" in msg)) {
    // JSON-RPC Notification
    log(
      `${arrow} ${MAGENTA}[NTF]${RESET} ${fmtMethod(msg.method as string)} ${DIM}(${label})${RESET}`,
    );
    if (msg.params) log(prettyJson(msg.params));
  } else if ("result" in msg) {
    // Success Response
    log(
      `${arrow} ${GREEN}[RES]${RESET} ${fmtId(msg.id)} ${DIM}(${label})${RESET}`,
    );
    if (msg.result) log(prettyJson(msg.result));
  } else if ("error" in msg) {
    // Error Response
    log(
      `${arrow} ${RED}[ERR]${RESET} ${fmtId(msg.id)} ${DIM}(${label})${RESET}`,
    );
    log(prettyJson(msg.error));
  } else {
    // Unknown message shape
    log(`${arrow} ${DIM}[???]${RESET} ${DIM}(${label})${RESET}`);
    log(prettyJson(msg));
  }
}

// =============================================================================
// Stream logging proxy
//
// Wraps a Stream with TransformStreams that log every message flowing through.
// =============================================================================

function createLoggingProxy(rawStream: Stream, label: string): Stream {
  // Incoming: raw.readable → log → server reads
  const incoming = new TransformStream<AnyMessage, AnyMessage>({
    transform(message, controller) {
      logMessage("in", message, label);
      controller.enqueue(message);
    },
  });

  // Outgoing: server writes → log → raw.writable
  const outgoing = new TransformStream<AnyMessage, AnyMessage>({
    transform(message, controller) {
      logMessage("out", message, label);
      controller.enqueue(message);
    },
  });

  // Wire up the pipes
  rawStream.readable.pipeTo(incoming.writable).catch(() => {});
  outgoing.readable.pipeTo(rawStream.writable).catch(() => {});

  return {
    readable: incoming.readable, // server reads logged incoming messages
    writable: outgoing.writable, // server writes to logged outgoing stream
  };
}

// =============================================================================
// Stdio mode
// =============================================================================

function runStdio(server: TestServer) {
  log(`${BOLD}MAP Debug Server${RESET} ${DIM}v1.0.0${RESET}`);
  log(`Mode: ${CYAN}stdio${RESET} (ndjson)`);
  log(
    `  Send JSON-RPC messages on ${BOLD}stdin${RESET}, responses on ${BOLD}stdout${RESET}, logs on ${BOLD}stderr${RESET}`,
  );
  log(`${DIM}${"─".repeat(70)}${RESET}`);

  const stdinWeb = Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>;
  const stdoutWeb = Writable.toWeb(
    process.stdout,
  ) as WritableStream<Uint8Array>;
  const rawStream = ndJsonStream(stdinWeb, stdoutWeb);

  const loggedStream = createLoggingProxy(rawStream, "stdio");
  server.acceptConnection(loggedStream);

  log(`${GREEN}Ready. Waiting for messages...${RESET}`);
  log("");
  log(`${DIM}Try pasting:${RESET}`);
  log(
    `${DIM}  {"jsonrpc":"2.0","id":1,"method":"map/connect","params":{"name":"test","protocolVersion":1,"capabilities":{}}}${RESET}`,
  );
  log("");
}

// =============================================================================
// WebSocket mode
// =============================================================================

/**
 * Convert a `ws` WebSocket into a MAP Stream.
 */
function wsToStream(ws: import("ws").WebSocket): Stream {
  const messageQueue: AnyMessage[] = [];
  let resolver: ((msg: AnyMessage | null) => void) | null = null;
  let closed = false;

  ws.on("message", (data) => {
    try {
      const message = JSON.parse(data.toString());
      if (resolver) {
        const r = resolver;
        resolver = null;
        r(message);
      } else {
        messageQueue.push(message);
      }
    } catch {
      // skip unparseable messages
    }
  });

  ws.on("close", () => {
    closed = true;
    if (resolver) {
      const r = resolver;
      resolver = null;
      r(null);
    }
  });

  ws.on("error", () => {
    closed = true;
    if (resolver) {
      const r = resolver;
      resolver = null;
      r(null);
    }
  });

  const readable = new ReadableStream<AnyMessage>({
    async pull(controller) {
      if (messageQueue.length > 0) {
        controller.enqueue(messageQueue.shift()!);
        return;
      }

      if (closed) {
        controller.close();
        return;
      }

      const msg = await new Promise<AnyMessage | null>((resolve) => {
        resolver = resolve;
      });

      if (msg === null) {
        controller.close();
      } else {
        controller.enqueue(msg);
      }
    },
  });

  const writable = new WritableStream<AnyMessage>({
    write(message) {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify(message));
      }
    },
    close() {
      ws.close();
    },
  });

  return { readable, writable };
}

async function runWebSocket(server: TestServer, port: number) {
  // Dynamic import — user only needs `ws` installed if using WebSocket mode
  let WsServer: typeof import("ws").WebSocketServer;
  try {
    const ws = await import("ws");
    WsServer = ws.WebSocketServer;
  } catch {
    log(
      `${RED}${BOLD}Error:${RESET} ${RED}'ws' package is required for WebSocket mode.${RESET}`,
    );
    log(`  Install it with: ${CYAN}npm install ws${RESET}`);
    process.exit(1);
    return; // unreachable but satisfies TS
  }

  log(`${BOLD}MAP Debug Server${RESET} ${DIM}v1.0.0${RESET}`);
  log(`Mode: ${CYAN}WebSocket${RESET}`);
  log(`Listening on: ${BOLD}${CYAN}ws://localhost:${port}${RESET}`);
  log(`${DIM}${"─".repeat(70)}${RESET}`);

  const wss = new WsServer({ port });
  let connectionCount = 0;

  wss.on("connection", (ws, req) => {
    connectionCount++;
    const addr = req.socket.remoteAddress ?? "unknown";
    const label = `ws#${connectionCount} ${addr}`;

    log(`${GREEN}${BOLD}+ Connection opened:${RESET} ${label}`);

    const rawStream = wsToStream(ws);
    const loggedStream = createLoggingProxy(rawStream, label);
    server.acceptConnection(loggedStream);

    ws.on("close", (code, reason) => {
      log(
        `${RED}${BOLD}- Connection closed:${RESET} ${label} ${DIM}(code=${code}${reason.length ? `, reason=${reason}` : ""})${RESET}`,
      );
    });
  });

  wss.on("error", (err) => {
    log(`${RED}${BOLD}Server error:${RESET} ${err.message}`);
  });

  log(`${GREEN}Ready. Waiting for connections...${RESET}`);
  log("");
  log(`${DIM}Connect with any MAP client, e.g.:${RESET}`);
  log(
    `${DIM}  const ws = new WebSocket("ws://localhost:${port}");${RESET}`,
  );
  log(
    `${DIM}  const stream = websocketStream(ws);${RESET}`,
  );
  log(
    `${DIM}  const client = new ClientConnection(stream, { name: "test" });${RESET}`,
  );
  log("");

  // Graceful shutdown
  const shutdown = () => {
    log(`\n${YELLOW}Shutting down...${RESET}`);
    wss.close(() => {
      log(`${DIM}Server closed.${RESET}`);
      process.exit(0);
    });
    // Force exit after 3 seconds
    setTimeout(() => process.exit(0), 3000);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

// =============================================================================
// CLI argument parsing
// =============================================================================

function parseArgs(): { port: number | null } {
  const args = process.argv.slice(2);
  let port: number | null = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--port" || args[i] === "-p") {
      port = parseInt(args[i + 1], 10);
      if (isNaN(port) || port < 1 || port > 65535) {
        console.error(`Invalid port: ${args[i + 1]}`);
        process.exit(1);
      }
      i++;
    } else if (args[i] === "--help" || args[i] === "-h") {
      console.error(`${BOLD}MAP Debug Server${RESET}

A standalone MAP server that logs all JSON-RPC traffic for debugging.

${BOLD}Usage:${RESET}
  npx tsx examples/debug-server/main.ts              ${DIM}# stdio mode${RESET}
  npx tsx examples/debug-server/main.ts --port 8080  ${DIM}# WebSocket mode${RESET}

${BOLD}Options:${RESET}
  --port, -p <port>  Start a WebSocket server on <port>
  --help, -h         Show this help

${BOLD}Stdio mode:${RESET}
  Reads newline-delimited JSON from stdin, writes responses to stdout.
  All debug logging goes to stderr so it doesn't interfere with the protocol.

${BOLD}WebSocket mode:${RESET}
  Starts a WebSocket server. Connect any MAP client to ws://localhost:<port>.
  Requires the 'ws' package: npm install ws
`);
      process.exit(0);
    }
  }

  return { port };
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  const { port } = parseArgs();
  const server = new TestServer({ name: "MAP Debug Server" });

  if (port !== null) {
    await runWebSocket(server, port);
  } else {
    runStdio(server);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
