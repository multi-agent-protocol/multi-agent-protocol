#!/usr/bin/env node

/**
 * Schema validation and sync script
 *
 * The Zod validators in src/schema/zod.gen.ts are hand-crafted rather than
 * auto-generated because json-schema-to-zod doesn't handle complex JSON Schema
 * patterns (oneOf, anyOf, $ref with complex structures) well.
 *
 * This script validates that the schema files exist and can be parsed,
 * and outputs information about the schema structure.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const SCHEMA_DIR = path.resolve(ROOT_DIR, '..', 'schema');

async function main() {
  console.log('MAP Schema Validation\n');

  // Read and validate schema.json
  const schemaPath = path.join(SCHEMA_DIR, 'schema.json');
  if (!fs.existsSync(schemaPath)) {
    console.error('Error: schema.json not found at', schemaPath);
    process.exit(1);
  }

  const schemaContent = fs.readFileSync(schemaPath, 'utf-8');
  let schema;
  try {
    schema = JSON.parse(schemaContent);
  } catch (e) {
    console.error('Error: Failed to parse schema.json:', e.message);
    process.exit(1);
  }

  // Read and validate meta.json
  const metaPath = path.join(SCHEMA_DIR, 'meta.json');
  if (!fs.existsSync(metaPath)) {
    console.error('Error: meta.json not found at', metaPath);
    process.exit(1);
  }

  const metaContent = fs.readFileSync(metaPath, 'utf-8');
  let meta;
  try {
    meta = JSON.parse(metaContent);
  } catch (e) {
    console.error('Error: Failed to parse meta.json:', e.message);
    process.exit(1);
  }

  // Output schema info
  const definitions = schema.$defs || schema.definitions || {};
  const schemaNames = Object.keys(definitions);

  console.log('Schema Info:');
  console.log(`  - Version: ${meta.version || 'unknown'}`);
  console.log(`  - Type definitions: ${schemaNames.length}`);
  console.log(`  - Methods: ${Object.keys(meta.methods || {}).length}`);
  console.log(`  - Notifications: ${Object.keys(meta.notifications || {}).length}`);
  console.log();

  // List type categories
  const categories = {
    primitives: schemaNames.filter(n => ['JsonRpcVersion', 'RequestId', 'ProtocolVersion', 'Timestamp', 'Meta'].includes(n)),
    identifiers: schemaNames.filter(n => n.endsWith('Id')),
    enums: schemaNames.filter(n => definitions[n].enum),
    requests: schemaNames.filter(n => n.endsWith('Request') || n.endsWith('RequestParams')),
    responses: schemaNames.filter(n => n.endsWith('Response') || n.endsWith('ResponseResult')),
    other: [],
  };

  const categorized = new Set([
    ...categories.primitives,
    ...categories.identifiers,
    ...categories.enums,
    ...categories.requests,
    ...categories.responses,
  ]);

  categories.other = schemaNames.filter(n => !categorized.has(n));

  console.log('Type Categories:');
  console.log(`  - Primitives: ${categories.primitives.length}`);
  console.log(`  - Identifiers: ${categories.identifiers.length}`);
  console.log(`  - Enums: ${categories.enums.length}`);
  console.log(`  - Requests: ${categories.requests.length}`);
  console.log(`  - Responses: ${categories.responses.length}`);
  console.log(`  - Other: ${categories.other.length}`);
  console.log();

  console.log('Note: Zod validators are hand-crafted in src/schema/zod.gen.ts');
  console.log('      Update manually when schema changes.\n');

  console.log('Schema validation passed!');
}

main().catch((error) => {
  console.error('Script failed:', error);
  process.exit(1);
});
