/**
 * Writes the OpenAPI document to docs/openapi.json (or the path given) without starting the server
 * or connecting to the database (placeholder settings suffice, e.g. in CI or on a fresh checkout).
 *
 *   npm run openapi -w services/api [-- <output path>]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Configuration is validated at startup, but nothing here connects anywhere: fill in what is missing
// so the export also works in CI and on a fresh checkout.
process.env.DATABASE_URL ??= 'postgresql://openapi-export@127.0.0.1:1/unused';
process.env.AUTH_SECRET ??= 'openapi-export-only-value-never-used-for-signing';
process.env.APP_ENV ??= 'development';
// Imported only now: some modules read the configuration while being loaded.
const { createApp, openApiDocument } = await import('../bootstrap-app.js');

const target = resolve(process.argv[2] ?? fileURLToPath(new URL('../../../../docs/openapi.json', import.meta.url)));
const app = await createApp({ logger: false });
const document = openApiDocument(app);
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, JSON.stringify(document, null, 2) + '\n');
console.log(`OpenAPI ${document.openapi}: ${Object.keys(document.paths).length} paths written to ${target}`);
await app.close();
