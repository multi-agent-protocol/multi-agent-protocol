#!/usr/bin/env node
// Merges schema/core/meta.json + schema/ext/*/manifest.json back into schema/meta.json.
// Usage:
//   node scripts/build-meta.mjs           # regenerate schema/meta.json from the split sources
//   node scripts/build-meta.mjs --check    # assert merged == committed (modulo ordering); CI guard
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const extDir = join(root, 'schema/ext');
const core = JSON.parse(readFileSync(join(root, 'schema/core/meta.json'), 'utf8'));

const manifests = readdirSync(extDir)
  .filter((d) => existsSync(join(extDir, d, 'manifest.json')))
  .map((d) => JSON.parse(readFileSync(join(extDir, d, 'manifest.json'), 'utf8')));

// Reconstruct the flat meta.json shape.
const methods = { ...core.methods };
const notifications = { ...core.notifications };
const errorCodes = { ...core.errorCodes };
const seenErr = new Set();

for (const m of manifests) {
  // Invariant: every method key starts with methodPrefix.
  if (m.methodPrefix) {
    for (const name of Object.keys(m.methods ?? {})) {
      if (!name.startsWith(m.methodPrefix)) {
        throw new Error(`${m.name}: method "${name}" outside prefix "${m.methodPrefix}"`);
      }
    }
  }
  // Invariant: error ranges disjoint.
  if (Array.isArray(m.errorRange)) {
    const key = m.errorRange.join('-');
    if (seenErr.has(key)) throw new Error(`${m.name}: duplicate error range ${key}`);
    seenErr.add(key);
  }
  Object.assign(methods, m.methods ?? {});
  Object.assign(notifications, m.notifications ?? {});
  Object.assign(errorCodes, m.errorCodes ?? {});
}

const merged = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Multi-Agent Protocol Method Metadata',
  description: 'Metadata for MAP protocol methods including tier, implementer, and capability requirements',
  protocolVersion: core.protocolVersion,
  methods,
  notifications,
  errorCodes,
  tiers: core.tiers,
};

// Canonical (deep key-sorted) JSON for "byte-equivalent modulo ordering" comparison.
function canon(v) {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])]));
  }
  return v;
}
const committed = JSON.parse(readFileSync(join(root, 'schema/meta.json'), 'utf8'));
const equal = JSON.stringify(canon(merged)) === JSON.stringify(canon(committed));

if (process.argv.includes('--check')) {
  if (!equal) {
    console.error('build-meta: MERGED != committed schema/meta.json. The split has drifted.');
    // tiny diff aid: report method-set differences
    const a = new Set(Object.keys(merged.methods)), b = new Set(Object.keys(committed.methods));
    const only = (x, y) => [...x].filter((k) => !y.has(k));
    console.error('  methods only in merged:', only(a, b));
    console.error('  methods only in committed:', only(b, a));
    process.exit(1);
  }
  console.log(`build-meta: OK — merge of core + ${manifests.length} manifests is byte-equivalent to schema/meta.json (${Object.keys(methods).length} methods).`);
} else {
  writeFileSync(join(root, 'schema/meta.json'), JSON.stringify(merged, null, 2) + '\n');
  console.log(`build-meta: regenerated schema/meta.json from core + ${manifests.length} manifests (${Object.keys(methods).length} methods). Byte-equivalent to previous: ${equal}`);
}
