# SentinelGRC API

The NestJS REST API, the background worker and the operator CLI for SentinelGRC. For setup see the [root README](../../README.md); for the architecture see [docs/architecture.md](../../docs/architecture.md).

| Command | Purpose |
|---|---|
| `npm run start:dev` / `npm run dev:worker` | API with watch mode / worker with watch mode |
| `npm run build` / `npm start` / `npm run start:worker` | Compile to `dist/` and run the API or worker |
| `npm test` / `npm run test:cov` | Unit tests (with coverage) |
| `npm run test:api` | Integration tests against `TEST_DATABASE_URL` (migrated from empty) |
| `npm run lint` / `npm run typecheck` | oxlint (type-aware) / TypeScript |
| `npm run db:local` | Embedded PostgreSQL for local development (127.0.0.1:54329) |
| `npm run db:migrate` / `db:migrate:status` / `db:check-drift` | Apply migrations / show status / compare the schema with the migrations |
| `npm run db:schema` | After editing `prisma/schema.prisma`: column maps, format, generate the client |
| `npm run reference:sync` | Load roles, permissions, frameworks, templates and questionnaires (idempotent) |
| `npm run admin:create -- --email … --name … [--org-name … --org-slug …] [--platform-admin]` | Secure first-admin bootstrap |
| `npm run seed:demo [-- --no-force-change --credentials-file <path>]` | Synthetic demo data (only with `DEMO_MODE=true`) |
| `npm run openapi [-- <path>]` | Write the OpenAPI document (default `docs/openapi.json`) |
| `npm run restore:verify -- [--manifest <file>] [--json]` | Verify a restored database and storage |
| `npm run sessions:revoke -- (--all\|--user <email>\|--org <slug>) --reason "…"` | Incident response: revoke sessions |
| `npm run users:reset-password -- --email <email> --reason "…"` | Operator password reset |

The CLI commands (`admin:create` and below) run from `dist/`, so build first. Configuration is read from the repository root `.env`, filling only variables that aren't already set, and validated at startup by `src/config/env.ts`.
