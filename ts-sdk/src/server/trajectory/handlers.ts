/**
 * Trajectory handler factories.
 *
 * Creates JSON-RPC handlers for all trajectory/* protocol methods.
 */

import type { TrajectoryManager, HandlerContext, HandlerRegistry } from "../types";
import type {
  TrajectoryCheckpointRequestParams,
  TrajectoryListRequestParams,
  TrajectoryGetRequestParams,
  TrajectoryContentRequestParams,
} from "../../types";
import { TRAJECTORY_ERROR_CODES } from "../../types";
import { MAPRequestError } from "../../errors";

/**
 * Options for creating trajectory handlers.
 */
export interface TrajectoryHandlerOptions {
  trajectory: TrajectoryManager;
}

/**
 * Derive agent ID from handler context.
 * Uses first registered agent, or session ID as fallback.
 */
function getAgentId(ctx: HandlerContext): string {
  return ctx.session.agentIds[0] ?? ctx.session.id;
}

/**
 * Create handlers for trajectory/* protocol methods.
 *
 * Methods:
 * - `trajectory/checkpoint` - Report a checkpoint
 * - `trajectory/list` - List checkpoints
 * - `trajectory/get` - Get a checkpoint
 * - `trajectory/content` - Request checkpoint content
 */
export function createTrajectoryHandlers(
  options: TrajectoryHandlerOptions
): HandlerRegistry {
  const { trajectory } = options;

  return {
    "trajectory/checkpoint": async (params: unknown, ctx: HandlerContext) => {
      const p = params as TrajectoryCheckpointRequestParams;
      const agentId = getAgentId(ctx);

      const checkpoint = trajectory.reportCheckpoint(p.checkpoint, agentId);
      return { checkpoint };
    },

    "trajectory/list": async (params: unknown) => {
      const p = (params ?? {}) as TrajectoryListRequestParams;
      const limit = p.limit ?? 50;

      const result = trajectory.list(p.filter, limit, p.cursor);
      return result;
    },

    "trajectory/get": async (params: unknown) => {
      const p = params as TrajectoryGetRequestParams;

      const checkpoint = trajectory.get(p.checkpointId);
      if (!checkpoint) {
        throw new MAPRequestError(
          TRAJECTORY_ERROR_CODES.TRAJECTORY_CHECKPOINT_NOT_FOUND,
          `Checkpoint not found: ${p.checkpointId}`,
          { category: "trajectory" }
        );
      }

      return { checkpoint };
    },

    "trajectory/content": async (params: unknown) => {
      const p = params as TrajectoryContentRequestParams;

      const content = await trajectory.requestContent(
        p.checkpointId,
        p.include
      );

      return { content };
    },
  };
}
