// Local PostgreSQL without Docker (development / tests only — never production).
// Starts a persistent embedded PostgreSQL server under <repo>/var/pgdata and
// creates the dev and test databases. Stop with Ctrl+C.
// Usage: npm run db:local -w services/api
import EmbeddedPostgres from 'embedded-postgres';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const port = Number(process.env.LOCAL_PG_PORT ?? 54329);
const dataDir = fileURLToPath(new URL('../../../var/pgdata', import.meta.url));
const freshCluster = !existsSync(dataDir);

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: 'sentinel',
  password: 'local-dev-only', // loopback-only development server; never reused elsewhere
  port,
  persistent: true,
  initdbFlags: ['--encoding=UTF8', '--locale=C', '--auth=scram-sha-256'],
  onLog: () => {},
  onError: (message) => console.error(String(message)),
});

if (freshCluster) await pg.initialise();
await pg.start();
for (const db of ['sentinelgrc_dev', 'sentinelgrc_test']) {
  try {
    await pg.createDatabase(db);
  } catch (error) {
    if (!String(error).includes('already exists')) throw error;
  }
}
console.log(`Local PostgreSQL ready on 127.0.0.1:${port} (databases: sentinelgrc_dev, sentinelgrc_test)`);

const shutdown = async () => {
  await pg.stop();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
setInterval(() => {}, 1 << 30);
