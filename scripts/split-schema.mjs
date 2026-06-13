#!/usr/bin/env node
// Splits schema/schema.json $defs into schema/core/schema.json + schema/ext/<name>/schema.json.
// Only LEAF extension message defs (those carrying an `x-method` that belongs to an extension)
// are relocated; structural defs, core message defs, and the aggregate unions
// (MAPRequest/MAPResponse/MAPNotification) stay verbatim in core. build-schema.mjs reunites them.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const s = JSON.parse(readFileSync(join(root, 'schema/schema.json'), 'utf8'));

const EXT_PREFIX = {
  sessions: 'map/session/', mail: 'mail/', trajectory: 'trajectory/', tasks: 'map/tasks/',
  workspace: 'workspace/', credentials: 'cred/', resources: 'map/resources/',
  federation: 'map/federation/', steering: 'map/inject',
};
function routeMethod(method) {
  let best = null, len = -1;
  for (const [ext, p] of Object.entries(EXT_PREFIX)) {
    if (method.startsWith(p) && p.length > len) { best = ext; len = p.length; }
  }
  return best;
}

const coreDefs = {};
const extDefs = {};
for (const [name, def] of Object.entries(s.$defs)) {
  const method = def && def['x-method'];
  const ext = method ? routeMethod(method) : null;
  if (ext) { (extDefs[ext] ??= {})[name] = def; }
  else { coreDefs[name] = def; }
}

// Core keeps top-level structure (oneOf + aggregate unions live here, as the
// union-of-all-messages is inherently cross-cutting/core-owned).
mkdirSync(join(root, 'schema/core'), { recursive: true });
const core = {
  $schema: s.$schema,
  $id: s.$id,
  title: s.title + ' (Core)',
  description: s.description,
  oneOf: s.oneOf,
  $defs: coreDefs,
};
writeFileSync(join(root, 'schema/core/schema.json'), JSON.stringify(core, null, 2) + '\n');

for (const [ext, defs] of Object.entries(extDefs)) {
  const frag = {
    $schema: s.$schema,
    'x-extension': ext,
    $comment: `Message schemas for the ${ext} MAP extension (docs/map-ext.md). Merged into schema/schema.json by scripts/build-schema.mjs.`,
    $defs: defs,
  };
  mkdirSync(join(root, `schema/ext/${ext}`), { recursive: true });
  writeFileSync(join(root, `schema/ext/${ext}/schema.json`), JSON.stringify(frag, null, 2) + '\n');
}

console.log('core defs:', Object.keys(coreDefs).length);
console.log('ext defs:', JSON.stringify(Object.fromEntries(
  Object.entries(extDefs).map(([k, v]) => [k, Object.keys(v).length])
)));
