# Development notes

## Prerequisites
PostgreSQL 16 and Redis 7 locally (or `docker compose up postgres redis` with the `ports:` added temporarily). Databases `pm_dev` and `pm_test`.

## Commands
```
npm run dev / npm run worker:dev   # web + worker with hot reload
npm run typecheck                  # strict TS over app, worker, tests
npm test                           # vitest; integration tests reset pm_test and run real Postgres + Redis
npm run build                      # production build (standalone) + worker bundle
```

Tests read `.env.test` (`tests/setup.ts`). They install fetch-level mocks for the Graph API and AI providers (`tests/mocks.ts`) — no network.

## Full pipeline without credentials
```
node scripts/dev-mock-services.mjs      # mock OpenAI + Graph on :4010
# .env: OPENAI_API_KEY=sk-mock OPENAI_BASE_URL=http://localhost:4010/v1 META_GRAPH_BASE_URL=http://localhost:4010
#       META_APP_ID=123456 META_APP_SECRET=<any> META_AUTOMATION_ENABLED=true
```
Insert a `ConnectedPage` + `MetaCredential` (the OAuth flow would do this) and POST signed webhooks to `/api/webhooks/meta`; the worker classifies, the review queue fills, approvals hit the mock Graph.

## Offline Prisma (sandboxes without binaries.prisma.sh)
The Prisma CLI downloads a native schema-engine binary on first use. Where that is blocked:
- `scripts/dev-prisma-engine-stub.sh` installs a stub that satisfies `prisma generate`'s version probe
- `npm run db:migrate:wasm` / `npm run db:migrate:wasm:create <name>` run migrations with Prisma's WebAssembly schema engine through the pg driver adapter — same migration files and `_prisma_migrations` bookkeeping as the CLI

On servers with internet access use the normal `prisma migrate deploy`.

## Conventions
- All raw SQL uses `(NOW() AT TIME ZONE 'UTC')`; the pg pool pins the session timezone to UTC
- No external side effect outside `src/server/actions/outbound.ts`
- Every mutation that matters writes an `AuditLog` row
- Never log secrets — `src/server/log.ts` redacts known shapes, but keep tokens out of log fields anyway
- Keep the project ESM; worker bundling is `esbuild --format=esm`
