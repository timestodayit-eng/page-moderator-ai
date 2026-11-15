# Gap analysis — prototype → Page Moderator AI

The original *Page Moderator Studio* source was not supplied in this session, so this is a rebuild from the
requirements document rather than a branch of the prototype. The prototype's documented problems were treated as
acceptance criteria. Nothing from the original repository was modified.

| Prototype problem (from the audit) | How it is addressed here | Verified by |
|---|---|---|
| Invitation account takeover | Existing accounts must be signed in as the invited email to accept; anonymous or other-user acceptance is refused; tokens are hashed, one-time, 7-day | `tests/integration/tenant-team.test.ts` |
| Duplicate Facebook replies | Every external write is an `OutboundAction` with a unique idempotency key (`reply:<comment>:<decision>`); workers claim with one conditional UPDATE; ambiguous failures go to reconciliation which checks Meta before any retry | `meta-moderation.test.ts` (reply idempotency, atomic claim, reconciliation) |
| Webhook event recovery | Raw events stored durably with dedupe keys before ACK; transactional outbox; failed events replayed every 10 min; signature-invalid events kept for forensics but never processed | `meta-moderation.test.ts` (signature/dedupe) |
| Production placeholder secrets | `src/server/env.ts` refuses to start in production with placeholder-looking secrets, short verify tokens, http APP_URL or default DB credentials | `tests/unit/crypto.test.ts` (env validation) |
| API rate limiting failures | Redis fixed-window limiter with in-memory fallback — never fails open; login/reset/registration/API limits | `auth.test.ts` + unit tests |
| Concurrent AI budget enforcement | Quota reserved by a single conditional UPDATE on `UsageCounter` (reserved + value) before any provider call; settled/released after | `platform-billing.test.ts` (6 concurrent calls → exactly 3 admitted) |
| AI Agent permission checks | Agent create/version/activate require `agents.configure`; training `agents.train`; keys `ai.credentials`; all agent lookups scoped by `workspaceId` | `inbox-crm-agents.test.ts` |
| Privileged Super Admin access | Super Admin oversight is read-only without membership; private Messenger requires an owner-approved, time-boxed, audited `SupportAccessGrant`; privileged role changes audited under a distinct action | `platform-billing.test.ts`, `tenant-team.test.ts` |
| `npm Invalid Version` | Exact-pinned dependencies, committed `package-lock.json`, `npm ci` in Docker | build |
| Worker `Top-level await … cjs` | Project is ESM; worker bundled with esbuild (`format=esm`) to `dist/worker.mjs`; verified to boot and heartbeat | manual + Docker command |
| Dashboard `ReferenceError: name is not defined` | Strict TypeScript across app + worker, `next build` in CI path, every screen loaded in a headless browser with console error capture | build + browser tour |
| `INVALID_OAUTH_STATE` | State is random, hashed in DB with 10-minute TTL, bound to user + workspace, double-submitted via SameSite cookie, single-use; clear user-facing messages | `meta-moderation.test.ts` (OAuth) |
| Invalid Meta scopes | Granted/declined scopes recorded per Page; `PERMISSION_MISSING` status with reconnect flow; Messenger features gated on `pages_messaging` | code + tests |
| Caddy SSL / env duplication | Domain only from `APP_DOMAIN`/`APP_URL`; `docker compose config` validated in deploy script; no duplicate keys in `.env.example` | deploy script |
| Worker reliability visibility | Structured JSON logs with secret redaction, heartbeat + queue counts in `PlatformSetting`, surfaced in `/api/health` and the System Health screen | manual |

## Implementation plan that was executed

1. Foundation — schema (40+ models), env validation, crypto, sessions, RBAC, API wrapper
2. Auth + email outbox + workspaces/teams
3. Super Admin services and APIs
4. Meta OAuth/webhooks, outbound action engine, AI gateway, moderation engine
5. Agents/training/evaluation, inbox, CRM, billing lifecycle + providers
6. Worker (BullMQ) with outbox dispatcher and maintenance schedulers
7. Frontend (public, auth, workspace app, admin center) — OxygenOS-inspired design system
8. Tests (7 suites, 54 tests), production build, browser verification, end-to-end run with mock providers
9. Docker/Caddy, docs

## Known limits (honest)

- Docker images were authored and the standalone runtime verified, but `docker build` could not be executed in the build sandbox (no Docker daemon). Run `./docker/deploy.sh` on the VPS; see docs/STATUS.md.
- Real Meta / OpenAI / SMTP / Stripe calls require credentials; integration paths were exercised against protocol-faithful mocks and unit tests.
- Knowledge retrieval is keyword/full-text based (no embeddings). Small corpora are passed whole so cross-language questions work; large corpora use Postgres FTS. pgvector is a natural upgrade.
- MFA is modelled (`mfaEnabled`, `mfaSecretEnc`) but the TOTP enrolment UI is not built.
- Meta Marketing API is intentionally not included (per requirements).
