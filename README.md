# Page Moderator AI — Enterprise SaaS Studio

Multi-tenant SaaS for AI-powered Facebook Page moderation, Messenger inbox, CRM and subscription management.
Built for the internal businesses (Creative International, Coastal Manpower, SM Enterprise) and for external subscribers.

| Layer | Technology |
|---|---|
| Web | Next.js 16 (App Router, standalone output), React 19, TypeScript 5.9, Tailwind CSS 4 |
| API | Versioned REST under `/api/v1/*` (Next.js route handlers) with zod validation, server-side RBAC, CSRF origin checks, rate limits |
| Database | PostgreSQL 16 + Prisma 7 (driver adapter) — shared DB, `workspaceId` on every tenant row |
| Jobs | Redis 7 + BullMQ, transactional outbox, idempotent consumers |
| AI | OpenAI / Google Gemini / DeepSeek through one metered gateway (platform-managed or BYOK) |
| Meta | Graph API v24: OAuth with state protection, encrypted Page tokens, signed webhooks, verified subscriptions |
| Email | SMTP / Resend / Postmark, branded EN + BN templates, suppression, retries |
| Billing | Plans, trials, grace, invoices, manual payments, Stripe Checkout + verified webhooks |
| Deploy | Docker Compose (web, worker, postgres, redis, caddy) on a Hostinger VPS |

Documentation:

- [docs/GAP-ANALYSIS.md](docs/GAP-ANALYSIS.md) — how the prototype's problems were addressed
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — modules, data flow, safety model
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — VPS deployment, updates, backups, rollback
- [docs/META-APP-SETUP.md](docs/META-APP-SETUP.md) — Facebook Login, permissions, webhooks, App Review
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) — local development, tests, offline Prisma notes
- [docs/STATUS.md](docs/STATUS.md) — what is verified, what needs external credentials

---

## 1. System requirements

- Node.js 22.12+ (LTS) and npm 10 for local development
- PostgreSQL 16, Redis 7
- Docker Engine 24+ and Docker Compose v2 for deployment
- A Meta Developer App (for Facebook features), at least one AI provider key, an SMTP/transactional email account

Minimum VPS: 1 vCPU, 4 GB RAM, 40 GB disk (the pilot runs on Hostinger with these numbers). Set the VPS timezone to anything — the app pins database sessions to UTC.

## 2. Installation (local)

```bash
git clone <repo> page-moderator-ai && cd page-moderator-ai
npm ci
cp .env.example .env
# edit .env — at minimum: APP_URL, DATABASE_URL, REDIS_URL, ENCRYPTION_KEY
openssl rand -base64 32      # → ENCRYPTION_KEY
openssl rand -hex 16         # → META_WEBHOOK_VERIFY_TOKEN
npm run env:check
```

## 3. Database setup

```bash
npm run db:migrate          # prisma migrate deploy (applies prisma/migrations)
npm run db:seed             # permissions, role templates, plans, email templates, platform settings (idempotent)
```

Migrations are additive and documented in `prisma/migrations/*/migration.sql`. Never use `migrate reset` on a database with data.

If your machine cannot reach `binaries.prisma.sh` (some sandboxes), use the WebAssembly migration driver instead:
`npm run db:migrate:wasm` / `npm run db:migrate:wasm:create <name>` (see docs/DEVELOPMENT.md).

## 4. Super Admin setup

```bash
ADMIN_EMAIL=you@company.com ADMIN_PASSWORD='choose-a-strong-one-123' ADMIN_NAME='Jamil' npm run admin:bootstrap
```

Creates (or promotes) the platform Super Admin and the three internal, billing-exempt workspaces (Creative International, Coastal Manpower, SM Enterprise). Safe to re-run. The password is never printed or logged.

## 5. Running locally

```bash
npm run dev          # web on http://localhost:3000
npm run worker:dev   # background worker (webhooks, moderation, outbound actions, email, billing)
```

Sign in at `/login`. Super Admins get the Platform Administration link in the sidebar (`/admin`).

Optional: run `node scripts/dev-mock-services.mjs` and set `OPENAI_BASE_URL=http://localhost:4010/v1`, `META_GRAPH_BASE_URL=http://localhost:4010`, `OPENAI_API_KEY=sk-mock` to exercise the whole pipeline without real credentials (see docs/DEVELOPMENT.md).

## 6. Running with Docker

```bash
cp .env.example .env     # set APP_DOMAIN, ACME_EMAIL, POSTGRES_PASSWORD, APP_URL=https://$APP_DOMAIN, secrets…
./docker/deploy.sh       # build, migrate + seed, start web/worker/caddy, wait for health
docker compose exec web sh -c 'ADMIN_EMAIL=… ADMIN_PASSWORD=… npx tsx scripts/bootstrap-admin.ts'
```

Full guide with updates, backups and rollback: docs/DEPLOYMENT.md.

## 7. Meta App integration

Set `META_APP_ID`, `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN` and configure in the Meta App dashboard:

- Facebook Login redirect URI: `https://<APP_DOMAIN>/api/meta/callback`
- Webhooks (Page object): callback `https://<APP_DOMAIN>/api/webhooks/meta`, verify token = `META_WEBHOOK_VERIFY_TOKEN`, fields `feed`, `messages`, `messaging_postbacks`, `message_reads`
- Permissions: `pages_show_list`, `pages_read_engagement`, `pages_read_user_content`, `pages_manage_engagement`, `pages_manage_metadata`, `pages_messaging`

Automatic Meta actions stay off until `META_AUTOMATION_ENABLED=true` **and** a Page admin enables them per Page. Step-by-step: docs/META-APP-SETUP.md.

### Negative comments (নেগেটিভ কমেন্ট)

The classifier understands meaning, not keywords: Bengali / Banglish slang, profanity, accusations like "বাটপার", "ঠকবাজ", "পাসপোর্ট দিয়ে জীবনের সর্বনাশ", sarcasm and "negative vibe" comments are recognised as DEFAMATION / ABUSE / NEGATIVE. Spam, scams, defamation, abuse, harassment and hate speech can be auto-hidden once a Page enables automation. Plain complaints and negative opinions go to the review queue by default; a Page admin can turn on **"Also hide negative-sentiment comments"** in the Page's configuration to let the AI hide those automatically as well (same confidence thresholds and hourly caps; every hide is reversible from the queue).

## 8. AI API integration

Platform-managed keys: `OPENAI_API_KEY`, `GEMINI_API_KEY`, `DEEPSEEK_API_KEY` (any subset; `DEFAULT_AI_PROVIDER` picks the default). Customers may bring their own keys in Settings → AI providers; keys are verified with a test call, stored with AES-256-GCM, and never fall back to platform credits unless a Super Admin allows it for that workspace. Budgets: per-plan monthly AI allowance (atomic reservation, no overspend under concurrency) and a platform-wide cap in Platform Settings → AI.

## 9. Email provider configuration

`EMAIL_PROVIDER=smtp|resend|postmark|disabled` plus the matching variables (`SMTP_*`, `RESEND_API_KEY`, `POSTMARK_SERVER_TOKEN`). Emails are queued through the outbox and sent by the worker; failures are visible and retryable in Platform → Email Management. With `disabled` the app still works; deliveries are recorded as FAILED with a clear reason.

## 10. Payment configuration

Manual payments (bank/bKash/Nagad) work out of the box and are recorded by a Super Admin after verification. For card payments set `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`, and point a Stripe webhook at `https://<APP_DOMAIN>/api/webhooks/billing/stripe` (events `checkout.session.completed`, `payment_intent.payment_failed`). An invoice is only marked paid after the signed webhook is verified; the handler is idempotent.

## 11. Production deployment

See docs/DEPLOYMENT.md. Summary: `.env` with real secrets → `./docker/deploy.sh` → bootstrap admin → configure Meta/AI/Email in the Super Admin UI → connect Pages in shadow mode → review results → enable approval, then automatic moderation per category.

## 12. Backup and recovery

`./docker/backup.sh` (nightly via cron, keeps 14 days) and `./docker/restore.sh backups/<file>`. Encrypted secrets in the database require the same `ENCRYPTION_KEY`; keep it in your password manager. Key rotation: set `ENCRYPTION_KEY_PREVIOUS` to the old key and `ENCRYPTION_KEY` to the new one.

## 13. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `Invalid environment configuration` at start | Missing or placeholder secrets; run `npm run env:check`. Production requires https APP_URL. |
| `/api/health` shows `worker: false` | Worker container not running or cannot reach Redis/Postgres: `docker compose logs worker`. |
| Facebook returns `INVALID_OAUTH_STATE` | Cookies blocked, took >10 minutes, or APP_URL differs from the URL in the browser. Start again from the same browser tab. |
| Pages connect but no comments arrive | Webhook not verified: the Pages screen shows "webhook not verified". Check the Meta app webhook subscription, callback URL and verify token; health check runs every 6 h. |
| AI shows `NOT_CONFIGURED` / `BUDGET` | No provider key for the workspace's mode, or the monthly allowance is exhausted — see Usage. |
| Emails `FAILED: provider not configured` | Set `EMAIL_PROVIDER` and credentials; retry from Email Management. |
| Caddy SSL errors | `APP_DOMAIN` must be a real DNS name pointing at the VPS; port 80/443 open; check `docker compose logs caddy`. |
| Top-level await / CJS errors | The project is ESM (`"type": "module"`); the worker is bundled with esbuild to `dist/worker.mjs`. Do not change the module format. |

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` / `npm run worker:dev` | Local web + worker |
| `npm run build` | `prisma generate` + `next build` + worker bundle |
| `npm start` | Not used in Docker (standalone `node server.js`) |
| `npm test` | Vitest unit + integration suites (needs Postgres `pm_test` + Redis) |
| `npm run db:migrate` / `db:seed` / `admin:bootstrap` | Operations |
| `npm run eval:moderation` | Run the Bengali/Banglish/English dataset against a workspace's live classifier |
| `npm run typecheck` | Strict TypeScript check |
