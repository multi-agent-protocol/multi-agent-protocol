/**
 * Trajectory manager implementation.
 *
 * Manages checkpoint lifecycle and content retrieval.
 * Emits events via EventBus for subscriber notifications.
 */

import type { TrajectoryCheckpoint, TrajectoryContentField, TrajectoryContentResult } from "../../types";
import { EVENT_TYPES, TRAJECTORY_ERROR_CODES } from "../../types";
import { MAPRequestError } from "../../errors";
import type {
  TrajectoryManager,
  TrajectoryManagerOptions,
  TrajectoryContentProvider,
  TrajectoryFilter,
  EventBus,
  TrajectoryStore,
} from "../types";

export class TrajectoryManagerImpl implements TrajectoryManager {
  private store: TrajectoryStore;
  private eventBus: EventBus;
  private contentProvider?: TrajectoryContentProvider;

  constructor(options: TrajectoryManagerOptions) {
    this.store = options.store;
    this.eventBus = options.eventBus;
    this.contentProvider = options.contentProvider;
  }

  reportCheckpoint(
    checkpoint: Omit<TrajectoryCheckpoint, "timestamp"> & { timestamp?: number },
    reportedBy: string
  ): TrajectoryCheckpoint {
    const stored: TrajectoryCheckpoint = {
      ...checkpoint,
      timestamp: checkpoint.timestamp ?? Date.now(),
    };

    this.store.save(stored);

    // Emit trajectory.checkpoint event
    this.eventBus.emit({
      type: EVENT_TYPES.TRAJECTORY_CHECKPOINT,
      data: { checkpoint: stored },
      source: { agentId: reportedBy },
    });

    return stored;
  }

  get(id: string): TrajectoryCheckpoint | undefined {
    return this.store.get(id);
  }

  list(
    filter?: TrajectoryFilter,
    limit = 50,
    cursor?: string
  ): { checkpoints: TrajectoryCheckpoint[]; hasMore: boolean; nextCursor?: string } {
    const all = this.store.list(filter);

    // Cursor-based pagination: cursor is the last checkpoint ID seen
    let startIndex = 0;
    if (cursor) {
      const cursorIndex = all.findIndex((c) => c.id === cursor);
      if (cursorIndex >= 0) {
        startIndex = cursorIndex + 1;
      }
    }

    const page = all.slice(startIndex, startIndex + limit + 1);
    const hasMore = page.length > limit;
    const items = hasMore ? page.slice(0, limit) : page;

    return {
      checkpoints: items,
      hasMore,
      nextCursor: hasMore ? items[items.length - 1].id : undefined,
    };
  }

  setContentProvider(provider: TrajectoryContentProvider): void {
    this.contentProvider = provider;
  }

  async requestContent(
    checkpointId: string,
    include?: TrajectoryContentField[]
  ): Promise<TrajectoryContentResult> {
    // Verify checkpoint exists
    const checkpoint = this.store.get(checkpointId);
    if (!checkpoint) {
      throw new MAPRequestError(
        TRAJECTORY_ERROR_CODES.TRAJECTORY_CHECKPOINT_NOT_FOUND,
        `Checkpoint not found: ${checkpointId}`,
        { category: "trajectory" }
      );
    }

    if (!this.contentProvider) {
      throw new MAPRequestError(
        TRAJECTORY_ERROR_CODES.TRAJECTORY_CONTENT_UNAVAILABLE,
        "No content provider configured",
        { category: "trajectory" }
      );
    }

    return this.contentProvider.getContent(checkpointId, include);
  }
}
