/**
 * Trajectory - Agent Work Trajectory Tracking
 *
 * Storage interfaces, in-memory implementations, and managers
 * for the Trajectory protocol extension.
 */

// Re-export types
export type {
  TrajectoryStore,
  TrajectoryFilter,
  TrajectoryContentProvider,
  TrajectoryManager,
  TrajectoryManagerOptions,
} from "../types";

// In-memory store implementation
export { InMemoryTrajectoryStore } from "./stores/in-memory";

// Manager implementation
export { TrajectoryManagerImpl } from "./manager";

// Handler factory
export { createTrajectoryHandlers, type TrajectoryHandlerOptions } from "./handlers";
