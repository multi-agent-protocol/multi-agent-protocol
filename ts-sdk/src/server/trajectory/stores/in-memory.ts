/**
 * In-memory trajectory store implementation.
 */

import type { TrajectoryCheckpoint } from "../../../types";
import type { TrajectoryStore, TrajectoryFilter } from "../../types";

export class InMemoryTrajectoryStore implements TrajectoryStore {
  private checkpoints = new Map<string, TrajectoryCheckpoint>();

  save(checkpoint: TrajectoryCheckpoint): void {
    this.checkpoints.set(checkpoint.id, checkpoint);
  }

  get(id: string): TrajectoryCheckpoint | undefined {
    return this.checkpoints.get(id);
  }

  list(filter?: TrajectoryFilter): TrajectoryCheckpoint[] {
    let results = Array.from(this.checkpoints.values());

    if (filter?.agentId) {
      results = results.filter((c) => c.agentId === filter.agentId);
    }
    if (filter?.sessionId) {
      results = results.filter((c) => c.sessionId === filter.sessionId);
    }
    if (filter?.afterTimestamp) {
      results = results.filter((c) => c.timestamp > filter.afterTimestamp!);
    }
    if (filter?.beforeTimestamp) {
      results = results.filter((c) => c.timestamp < filter.beforeTimestamp!);
    }

    // Sort by timestamp descending (newest first)
    results.sort((a, b) => b.timestamp - a.timestamp);

    return results;
  }

  delete(id: string): boolean {
    return this.checkpoints.delete(id);
  }

  clear(): void {
    this.checkpoints.clear();
  }
}
