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
  // Server module — runtime only. rollup-dts (tsup's dts) can't bundle the
  // server's declarations because of pre-existing strict errors in
  // federation/auth/messages; the declaration TREE is emitted separately by
  // `tsc` (see the `build:server-types` script) into dist/server-types/, which
  // the package's `./server` export points at. tsc emits best-effort `.d.ts`
  // even with those errors, where rollup-dts hard-fails.
  {
    entry: {
      server: 'src/server/index.ts',
    },
    format: ['cjs', 'esm'],
    dts: false,
    clean: false,
    sourcemap: true,
    splitting: false,
    treeshake: true,
    outDir: 'dist',
  },
]);
