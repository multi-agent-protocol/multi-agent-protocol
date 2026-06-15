/**
 * MAP extension framework.
 *
 * Re-exports `defineExtension` and its types. Individual extensions are imported
 * from their own subpaths, e.g. `@multi-agent-protocol/sdk/ext/trajectory`.
 */
export {
  defineExtension,
  type ExtensionManifest,
  type ExtensionDef,
  type ExtensionCaller,
  type ExtensionCall,
  type DefineExtensionOptions,
} from "./define-extension";
