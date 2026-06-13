/**
 * Structure handler factory.
 *
 * Implements `map/structure/graph` — the "transparent window" thesis: the agent
 * relationship graph, served from the agent registry. Nodes are agents; edges are
 * derived from spawn relationships (`metadata.parentId`).
 */
import type { AgentRegistry, HandlerRegistry, RegisteredAgent } from "../types";

export interface StructureHandlerOptions {
  agents: AgentRegistry;
}

interface GraphEdge {
  from: string;
  to: string;
  type: "parent-child" | "peer" | "supervisor" | "collaborator";
}

function nodeOf(agent: RegisteredAgent) {
  return {
    id: agent.id,
    name: agent.name,
    role: agent.role,
    state: agent.state,
    metadata: agent.metadata,
    capabilities: agent.capabilities,
    capabilityDescriptor: agent.capabilityDescriptor,
    persistentIdentity: agent.persistentIdentity,
    visibility: "public",
  };
}

export function createStructureHandlers(options: StructureHandlerOptions): HandlerRegistry {
  const { agents } = options;
  return {
    "map/structure/graph": async () => {
      const all = agents.list();
      const ids = new Set(all.map((a) => a.id));
      const edges: GraphEdge[] = [];
      for (const a of all) {
        const parentId = a.metadata?.parentId;
        if (typeof parentId === "string" && ids.has(parentId)) {
          edges.push({ from: parentId, to: a.id, type: "parent-child" });
        }
      }
      return { nodes: all.map(nodeOf), edges };
    },
  };
}
