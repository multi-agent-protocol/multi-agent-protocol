/**
 * Runs the reusable core conformance suite against the SDK's MAPServer.
 * openhive runs the SAME suite against its MAPServer (its own test), so core
 * conformance is validated across ≥2 deployments of the server.
 */
import { describe, it, expect } from "vitest";
import { runCoreConformance, type CoreConformancePair } from "../conformance/core";
import { MAPServer } from "../server/server";
import { AgentConnection } from "../connection/agent";
import { ClientConnection } from "../connection/client";
import { createStreamPair } from "../stream";

async function mapServerPair(): Promise<CoreConformancePair> {
  const server = new MAPServer({ name: "CoreConfServer" });

  const [aStream, aServer] = createStreamPair();
  server.accept(aServer, { role: "agent" }).start();
  const agent = new AgentConnection(aStream, { name: "worker", role: "worker" });
  const reg = await agent.connect();

  const [cStream, cServer] = createStreamPair();
  server.accept(cServer, { role: "client" }).start();
  const client = new ClientConnection(cStream, { name: "observer" });
  await client.connect();

  return { client, agentId: reg.agent.id };
}

runCoreConformance({ describe, it, expect }, mapServerPair, "SDK MAPServer");
