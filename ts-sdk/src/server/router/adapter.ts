/**
 * MAPRouter adapter
 *
 * Converts a MAPRouterInterface implementation to a HandlerRegistry.
 */

import type {
  MAPRouterInterface,
  HandlerRegistry,
  HandlerContext,
} from "../types";

/**
 * Method name mapping from MAPRouterInterface methods to protocol methods.
 */
const METHOD_MAPPING: Record<string, keyof MAPRouterInterface> = {
  "map/connect": "connect",
  "map/disconnect": "disconnect",
  "map/resume": "resume",
  "map/agents/register": "registerAgent",
  "map/agents/unregister": "unregisterAgent",
  "map/agents/list": "listAgents",
  "map/agents/get": "getAgent",
  "map/agents/update/state": "updateAgentState",
  "map/agents/update/metadata": "updateAgentMetadata",
  "map/scopes/create": "createScope",
  "map/scopes/delete": "deleteScope",
  "map/scopes/list": "listScopes",
  "map/scopes/get": "getScope",
  "map/scopes/join": "joinScope",
  "map/scopes/leave": "leaveScope",
  "map/send": "send",
  "map/subscribe": "subscribe",
  "map/unsubscribe": "unsubscribe",
  "map/replay": "replay",
};

/**
 * Convert a MAPRouterInterface implementation to a HandlerRegistry.
 *
 * This allows users to implement the OOP interface and use it with
 * RouterConnection.
 *
 * @param router - The MAPRouterInterface implementation
 * @returns A HandlerRegistry with all protocol methods
 */
export function routerToHandlers(router: MAPRouterInterface): HandlerRegistry {
  const handlers: HandlerRegistry = {};

  for (const [protocolMethod, interfaceMethod] of Object.entries(METHOD_MAPPING)) {
    const method = router[interfaceMethod];
    if (typeof method === "function") {
      // Bind the method to the router instance
      handlers[protocolMethod] = async (params: unknown, ctx: HandlerContext) => {
        return (method as Function).call(router, params, ctx);
      };
    }
  }

  return handlers;
}

/**
 * Get the list of protocol methods supported by MAPRouterInterface.
 */
export function getProtocolMethods(): string[] {
  return Object.keys(METHOD_MAPPING);
}

/**
 * Get the interface method name for a protocol method.
 */
export function getInterfaceMethod(
  protocolMethod: string
): keyof MAPRouterInterface | undefined {
  return METHOD_MAPPING[protocolMethod];
}
