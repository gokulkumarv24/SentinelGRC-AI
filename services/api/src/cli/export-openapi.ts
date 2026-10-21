/**
 * Writes the OpenAPI document to docs/openapi.json (or the path given) without starting the server
 * or connecting to the database.
 *
 *   npm run openapi -w services/api [-- <output path>]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp, openApiDocument } from '../bootstrap-app.js';

const target = resolve(process.argv[2] ?? fileURLToPath(new URL('../../../../docs/openapi.json', import.meta.url)));
const app = await createApp({ logger: false });
const document = openApiDocument(app);
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, JSON.stringify(document, null, 2) + '\n');
console.log(`OpenAPI ${document.openapi}: ${Object.keys(document.paths).length} paths written to ${target}`);
await app.close();
