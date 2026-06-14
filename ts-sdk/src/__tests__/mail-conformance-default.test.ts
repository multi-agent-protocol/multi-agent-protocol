/**
 * Runs the mail conformance suite against the SDK's default implementation.
 * Proves the default impl is a conforming reference for urn:map:ext:mail:1 v1.1.
 * agent-inbox runs the SAME suite (Step 4) via its own adapter.
 */
import { describe, it, expect } from "vitest";
import {
  runMailConformance,
  type MailConformanceAdapter,
} from "../ext/mail/conformance";
import { MAPServer } from "../server/server";
import { AgentConnection } from "../connection/agent";
import { createStreamPair } from "../stream";
import { EventBusImpl } from "../server/events";
import {
  createMailHandlers,
  ConversationManagerImpl,
  TurnManagerImpl,
  ThreadManagerImpl,
  InMemoryTurnStore,
} from "../ext/mail";

async function makeSdkAdapter(): Promise<MailConformanceAdapter> {
  const eventBus = new EventBusImpl();
  const conversations = new ConversationManagerImpl({ eventBus });
  const turnStore = new InMemoryTurnStore();
  const turns = new TurnManagerImpl({ eventBus, conversations, store: turnStore });
  const threads = new ThreadManagerImpl({ eventBus, turnStore });

  const server = new MAPServer({
    name: "MailConformanceServer",
    additionalHandlers: createMailHandlers({ conversations, turns, threads }),
  });
  const [clientStream, serverStream] = createStreamPair();
  server.accept(serverStream, { role: "agent" }).start();
  const conn = new AgentConnection(clientStream, { name: "mailer", role: "worker" });
  await conn.connect();

  return {
    send: (method, params) => conn.callExtension(method, params),
  };
}

runMailConformance({ describe, it, expect }, makeSdkAdapter, "SDK default impl");
