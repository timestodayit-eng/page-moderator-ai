# Architecture

Modular monolith: one Next.js application (UI + REST API) and one worker process, sharing `src/server/*` services.

```
Browser ──► Next.js (web)  ──► src/server/* ──► PostgreSQL
                │                                   ▲
                │ WebhookOutbox rows (same tx)       │
                ▼                                   │
          worker/outbox.ts ──► BullMQ (Redis) ──► worker/jobs/* ──► Meta Graph / AI providers / SMTP
```

## Modules (`src/server`)

| Module | Responsibility |
|---|---|
| `env.ts` | Validated config, production strictness (`APP_STAGE`) |
| `crypto.ts` | AES-256-GCM (key rotation), tokens, HMAC |
| `auth/*` | Argon2id passwords, sessions (hashed tokens, revocation, password-change invalidation), register/login/reset/verify |
| `rbac/*` | Permission catalogue, role templates, `resolveWorkspaceContext`, privilege-escalation guards |
| `http.ts` | `api()` route wrapper: auth modes, workspace resolution, permission checks, CSRF origin check, rate limits, zod body parsing, error envelope |
| `platform/*` | Workspaces, teams/invitations, Super Admin operations, email center, support access |
| `meta/*` | Graph client, OAuth + Page selection, webhooks ingest, page health |
| `actions/outbound.ts` | The only path to external side effects: idempotency, atomic claim, retry/backoff, reconciliation |
| `ai/gateway.ts` | Provider adapters (OpenAI, Gemini, DeepSeek), credential resolution (platform/BYOK), metered `complete()` |
| `moderation/*` | Signals, classifier prompt + deterministic rules, policy engine, review/feedback |
| `agents/*` | Agent versions, knowledge chunking/retrieval, ingest, evaluations |
| `inbox/*` | Messenger ingest, lifecycle, reply lock, 24h window, AI suggestions |
| `crm/*` | Contacts, leads, activities, follow-up tasks, reminders |
| `billing/*` | Plans/limits, atomic usage counters, lifecycle (trial/grace/expiry), invoices/payments, providers |
| `email/*` | Templates (EN/BN), renderer, transports, queue + delivery, campaigns |
| `analytics/*` | Workspace analytics |

## Tenant isolation

Every tenant-owned table has `workspaceId`. Services receive a `WorkspaceContext` (user + workspace + permission set) and include `workspaceId` in every query. Users who are not members get **404**, not 403, so workspace existence is not leaked. Suspended workspaces keep only billing permissions. Super Admin oversight is read-only; private Messenger data needs an approved `SupportAccessGrant`.

## Moderation safety model

```
comment → signals (urls, repeats, author history)
        → LLM classification (JSON, 16 categories)
        → deterministic rules (protected categories can never be HIDE, low-confidence → UNCERTAIN, repeats → REPEATED_PROMO)
        → policy: SHADOW | APPROVAL | AUTO
             AUTO requires: autoHideEnabled (explicit) ∧ category enabled ∧ platform allow-list ∧ confidence ≥ max(page, platform) ∧ hourly cap
        → decision row (always) → outbound action (only if allowed) → audit
guards at execution time: META_AUTOMATION_ENABLED, workspace active, emergency pause, Page kill switch, token valid
```

Every decision stores reasoning, confidence, risk, model, policy version, latency, tokens, cost and the review outcome. Reviewer corrections become `TrainingExample` rows used in prompts and evaluations.

## Reliability primitives

- **Transactional outbox**: business transaction + outbox row commit together; dispatcher uses `FOR UPDATE SKIP LOCKED`; job ids = outbox ids.
- **OutboundAction claims**: `UPDATE … WHERE status='PENDING'` → exactly one worker executes; lock expiry → reconciliation.
- **UsageCounter reservations**: `UPDATE … WHERE value + reserved + est <= budget` → no overspend under concurrency.
- **UTC everywhere**: Prisma stores `timestamp(3)` in UTC; the pg pool pins `timezone=UTC`; raw SQL uses `NOW() AT TIME ZONE 'UTC'`.
