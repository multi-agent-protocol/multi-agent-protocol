/**
 * ext/mail — the @multi-agent-protocol/sdk/ext/mail public surface.
 *
 * Mounts the SDK's default optional mail implementation on a MAPServer and
 * drives it through the typed `mailExtension.client(conn)` over a real
 * connection. This is the SDK-default adapter the conformance suite will reuse.
 */
import { describe, it, expect } from "vitest";
import { MAPServer } from "../server/server";
import { AgentConnection } from "../connection/agent";
import { createStreamPair } from "../stream";
import { EventBusImpl } from "../server/events";
import {
  mailExtension,
  createMailHandlers,
  ConversationManagerImpl,
  TurnManagerImpl,
  ThreadManagerImpl,
  InMemoryTurnStore,
} from "../ext/mail";

function mountMailServer() {
  const eventBus = new EventBusImpl();
  const conversations = new ConversationManagerImpl({ eventBus });
  const turnStore = new InMemoryTurnStore();
  const turns = new TurnManagerImpl({ eventBus, conversations, store: turnStore });
  const threads = new ThreadManagerImpl({ eventBus, turnStore });
  return new MAPServer({
    name: "MailExtServer",
    additionalHandlers: createMailHandlers({ conversations, turns, threads }),
    capabilities: mailExtension.capabilityFragment() as any,
  });
}

describe("ext/mail: typed client + default impl over a connection", () => {
  it("create → close → reopen → presence round-trips via mailExtension.client", async () => {
    const server = mountMailServer();
    const [clientStream, serverStream] = createStreamPair();
    server.accept(serverStream, { role: "agent" }).start();
    const conn = new AgentConnection(clientStream, { name: "mailer", role: "worker" });
    await conn.connect();

    const mail = mailExtension.client(conn);
    const created = await mail.create({});
    const id = created.conversation.id;
    expect(created.conversation.status).toBe("active");

    await mail.close({ conversationId: id });
    const reopened = await mail.reopen({ conversationId: id });
    expect(reopened.conversation.status).toBe("active");

    const pres = await mail.presence({ conversationId: id });
    expect(pres.conversationId).toBe(id);
    expect(Array.isArray(pres.participants)).toBe(true);

    await conn.disconnect();
  });

  it("capabilityFragment advertises the mail extension URI", () => {
    expect(mailExtension.capabilityFragment().extensions).toContainEqual({
      uri: "urn:map:ext:mail:1",
      version: "1.1.0",
    });
  });
});
