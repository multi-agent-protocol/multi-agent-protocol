#!/usr/bin/env node
// Merges schema/core/schema.json + schema/ext/*/schema.json back into the full message schema.
// Usage:
//   node scripts/build-schema.mjs --check   # assert merge == committed schema/schema.json (modulo ordering)
//   node scripts/build-schema.mjs           # regenerate schema/schema.json from the split sources
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const extDir = join(root, 'schema/ext');
const core = JSON.parse(readFileSync(join(root, 'schema/core/schema.json'), 'utf8'));

const fragments = readdirSync(extDir)
  .filter((d) => existsSync(join(extDir, d, 'schema.json')))
  .map((d) => JSON.parse(readFileSync(join(extDir, d, 'schema.json'), 'utf8')));

const mergedDefs = { ...core.$defs };
for (const frag of fragments) Object.assign(mergedDefs, frag.$defs ?? {});

const merged = {
  $schema: core.$schema,
  $id: core.$id,
  title: core.title.replace(/ \(Core\)$/, ''), // restore original title
  description: core.description,
  oneOf: core.oneOf,
  $defs: mergedDefs,
};

// Canonical (deep key-sorted; array order preserved) compare for "modulo ordering".
function canon(v) {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])]));
  }
  return v;
}
const committed = JSON.parse(readFileSync(join(root, 'schema/schema.json'), 'utf8'));
const equal = JSON.stringify(canon(merged)) === JSON.stringify(canon(committed));

if (process.argv.includes('--check')) {
  if (!equal) {
    console.error('build-schema: MERGED != committed schema/schema.json. The split has drifted.');
    const a = new Set(Object.keys(mergedDefs)), b = new Set(Object.keys(committed.$defs));
    const only = (x, y) => [...x].filter((k) => !y.has(k));
    console.error('  $defs only in merged:', only(a, b));
    console.error('  $defs only in committed:', only(b, a));
    process.exit(1);
  }
  console.log(`build-schema: OK — merge of core + ${fragments.length} ext fragments is byte-equivalent to schema/schema.json (${Object.keys(mergedDefs).length} $defs).`);
} else {
  writeFileSync(join(root, 'schema/schema.json'), JSON.stringify(merged, null, 2) + '\n');
  console.log(`build-schema: regenerated schema/schema.json (${Object.keys(mergedDefs).length} $defs). Byte-equivalent to previous: ${equal}`);
}
