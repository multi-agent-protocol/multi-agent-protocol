import { defineConfig } from 'tsup';

export default defineConfig([
  // Main SDK + testing (has clean types)
  {
    entry: {
      index: 'src/index.ts',
      testing: 'src/testing.ts',
      // Extension framework + per-extension subpaths (@multi-agent-protocol/sdk/ext/*)
      'ext/index': 'src/ext/index.ts',
      'ext/trajectory': 'src/ext/trajectory/index.ts',
    },
    format: ['cjs', 'esm'],
    dts: true,
    clean: true,
    sourcemap: true,
    splitting: false,
    treeshake: true,
    outDir: 'dist',
  },
  // Server module — now has clean types, bundled declarations enabled.
  {
    entry: {
      server: 'src/server/index.ts',
    },
    format: ['cjs', 'esm'],
    dts: true,
    clean: false,
    sourcemap: true,
    splitting: false,
    treeshake: true,
    outDir: 'dist',
  },
]);
