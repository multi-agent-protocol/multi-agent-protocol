import { defineConfig } from 'tsup';

export default defineConfig([
  // Main SDK + testing (has clean types)
  {
    entry: {
      index: 'src/index.ts',
      testing: 'src/testing.ts',
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
