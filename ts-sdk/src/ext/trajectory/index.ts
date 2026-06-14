/**
 * Trajectory extension (`urn:map:ext:trajectory:1`).
 *
 * Reference MAP-owned extension demonstrating the framework. Server-side, mount
 * with `additionalHandlers: trajectoryExtension.handlers({ ... })`; client-side,
 * call with `trajectoryExtension.client(conn).checkpoint({ ... })`.
 *
 * Stable nucleus: `trajectory/checkpoint`. Query surface (`list`/`get`/`content`)
 * is staging/federation-gated — see docs/14-consolidation-plan.md.
 */
import { defineExtension } from "../define-extension";

export interface TrajectoryCheckpointInput {
  label?: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
}

export interface TrajectoryCheckpointResult {
  id: string;
  /** Optional resource linkage (see D12). */
  resource_id?: string;
}

export interface TrajectoryListInput {
  agentId?: string;
  limit?: number;
}

export interface TrajectoryClient {
  /** Report a trajectory checkpoint (stable). */
  checkpoint(params: TrajectoryCheckpointInput): Promise<TrajectoryCheckpointResult>;
  /** List checkpoints (staging, federation-gated). */
  list(params?: TrajectoryListInput): Promise<{ checkpoints: unknown[] }>;
  /** Get a checkpoint by id (staging, federation-gated). */
  get(params: { id: string }): Promise<unknown>;
}

export const trajectoryExtension = defineExtension<TrajectoryClient>(
  {
    name: "trajectory",
    uri: "urn:map:ext:trajectory:1",
    version: "1.0.0",
    methodPrefix: "trajectory/",
  },
  {
    client: (call) => ({
      checkpoint: (params) =>
        call<TrajectoryCheckpointResult>("trajectory/checkpoint", params),
      list: (params) =>
        call<{ checkpoints: unknown[] }>("trajectory/list", params),
      get: (params) => call("trajectory/get", params),
    }),
  },
);
