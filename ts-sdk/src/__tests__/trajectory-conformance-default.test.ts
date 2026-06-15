/**
 * Runs the trajectory conformance suite against the SDK's default trajectory
 * handler — the conforming reference for the trajectory/checkpoint nucleus.
 */
import { describe, it, expect } from "vitest";
import {
  runTrajectoryConformance,
  type TrajectoryConformanceAdapter,
} from "../ext/trajectory/conformance";
import { MAPServer } from "../server/server";
import { AgentConnection } from "../connection/agent";
import { createStreamPair } from "../stream";
import { EventBusImpl } from "../server/events";
import {
  createTrajectoryHandlers,
  TrajectoryManagerImpl,
  InMemoryTrajectoryStore,
} from "../server/trajectory";

async function makeAdapter(): Promise<TrajectoryConformanceAdapter> {
  const eventBus = new EventBusImpl();
  const trajectory = new TrajectoryManagerImpl({
    store: new InMemoryTrajectoryStore(),
    eventBus,
  });
  const server = new MAPServer({
    name: "TrajectoryConformanceServer",
    additionalHandlers: createTrajectoryHandlers({ trajectory }),
  });
  const [clientStream, serverStream] = createStreamPair();
  server.accept(serverStream, { role: "agent" }).start();
  const conn = new AgentConnection(clientStream, { name: "reporter", role: "worker" });
  await conn.connect();
  return { send: (method, params) => conn.callExtension(method, params) };
}

runTrajectoryConformance({ describe, it, expect }, makeAdapter, "SDK default trajectory handler");
