/**
 * MAP extension framework — `defineExtension()`.
 *
 * Turns a MAP-EXT manifest into the three things an extension needs, as thin
 * adapters over seams the SDK already has (no new runtime):
 *   - `handlers(impl)`        → a HandlerRegistry for MAPServerOptions.additionalHandlers
 *   - `capabilityFragment()`  → a fragment for MAPServerOptions.capabilities (advertise-only)
 *   - `client(conn)`          → a typed accessor over callExtension
 *
 * Server types are imported type-only, so they are erased at build time — an
 * extension module pulls no server runtime into a client bundle.
 *
 * See docs/map-ext.md and docs/sdk-extension-api.md.
 */
import type { HandlerRegistry, Handler } from "../server/types";
import type { ParticipantCapabilities } from "../types";

export interface ExtensionManifest {
  /** kebab-case extension name (e.g. "trajectory"). */
  name: string;
  /** Capability URI (e.g. "urn:map:ext:trajectory:1"). */
  uri: string;
  /** Semver of the extension (informational). */
  version?: string;
  /** Method-prefix extensions: every mounted method must start with this. */
  methodPrefix?: string;
  /** Payload-protocol extensions (e.g. "acp"): ride map/send with this discriminator. */
  payloadProtocol?: string;
  /** Optional capability flag advertised under capabilities[capabilityKey] = { enabled: true }. */
  capabilityKey?: string;
}

/** The minimal connection surface needed to call extension methods (Client & Agent both satisfy it). */
export interface ExtensionCaller {
  callExtension<TParams = unknown, TResult = unknown>(
    method: string,
    params?: TParams,
  ): Promise<TResult>;
}

/** A raw, prefixed-method caller handed to a custom client builder. */
export type ExtensionCall = <TResult = unknown>(
  method: string,
  params?: unknown,
) => Promise<TResult>;

export interface ExtensionDef<
  TClient = Record<string, (params?: unknown) => Promise<unknown>>,
> {
  readonly manifest: ExtensionManifest;
  /** Build a HandlerRegistry to merge into MAPServerOptions.additionalHandlers. */
  handlers(impl: Record<string, Handler>): HandlerRegistry;
  /** Capability fragment to merge into MAPServerOptions.capabilities (advertise-only). */
  capabilityFragment(): Partial<ParticipantCapabilities>;
  /** Typed client accessor over the connection's callExtension. */
  client(conn: ExtensionCaller): TClient;
}

export interface DefineExtensionOptions<TClient> {
  /**
   * Build the typed client from a raw prefixed-method caller. Omit to get the
   * default Proxy that maps `client.foo(params)` → callExtension(`${prefix}foo`, params).
   */
  client?: (call: ExtensionCall) => TClient;
}

export function defineExtension<
  TClient = Record<string, (params?: unknown) => Promise<unknown>>,
>(
  manifest: ExtensionManifest,
  options: DefineExtensionOptions<TClient> = {},
): ExtensionDef<TClient> {
  if (manifest.methodPrefix && manifest.payloadProtocol) {
    throw new Error(
      `[${manifest.name}] manifest declares both methodPrefix and payloadProtocol; pick one`,
    );
  }

  return {
    manifest,

    handlers(impl: Record<string, Handler>): HandlerRegistry {
      if (manifest.methodPrefix) {
        for (const method of Object.keys(impl)) {
          if (!method.startsWith(manifest.methodPrefix)) {
            throw new Error(
              `[${manifest.name}] handler "${method}" is outside methodPrefix "${manifest.methodPrefix}"`,
            );
          }
        }
      }
      return { ...impl };
    },

    capabilityFragment(): Partial<ParticipantCapabilities> {
      const frag: Partial<ParticipantCapabilities> = {
        extensions: [
          manifest.version
            ? { uri: manifest.uri, version: manifest.version }
            : { uri: manifest.uri },
        ],
      };
      if (manifest.capabilityKey) {
        (frag as Record<string, unknown>)[manifest.capabilityKey] = {
          enabled: true,
        };
      }
      return frag;
    },

    client(conn: ExtensionCaller): TClient {
      const call: ExtensionCall = (method, params) =>
        conn.callExtension(method, params);
      if (options.client) return options.client(call);
      const prefix = manifest.methodPrefix ?? "";
      return new Proxy(
        {},
        {
          get:
            (_t, prop: string) =>
            (params?: unknown) =>
              call(`${prefix}${prop}`, params),
        },
      ) as TClient;
    },
  };
}
