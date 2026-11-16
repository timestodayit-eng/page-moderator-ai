# Verification status

Legend: ✅ verified by automated tests and/or a running instance in this build · ⚠️ implemented, needs real external credentials to exercise end-to-end · ❌ not implemented

| Area | Status | Evidence |
|---|---|---|
| Schema, migrations, seed, admin bootstrap | ✅ | `prisma/migrations/*`, seed/bootstrap executed against Postgres 16 |
| Registration, email verification, login, lockout, logout | ✅ | `tests/integration/auth.test.ts` |
| Forgot/reset password (hashed one-time token, 30 min, session revocation, notification) | ✅ | `auth.test.ts` |
| Change password, session management, suspended users | ✅ | `auth.test.ts` |
| Tenant isolation (404 for non-members, suspended → billing only) | ✅ | `tenant-team.test.ts` |
| Invitations (no takeover), custom roles, privilege-escalation guard, role-change audit | ✅ | `tenant-team.test.ts` |
| Super Admin: overview, customers, status changes, users, sessions, password reset, plans, subscriptions, settings, audit, email center, support access | ✅ | `platform-billing.test.ts` + browser tour |
| Meta webhooks: verify handshake, signature, dedupe, durable storage, replay | ✅ | `meta-moderation.test.ts` + live run against the running app |
| Meta OAuth: state (cookie + DB, single-use, user-bound), Page discovery, selection, encrypted tokens, webhook subscription verification | ✅ (mocked Graph) ⚠️ (real Meta) | `meta-moderation.test.ts` |
| Disconnect Page (confirmation, credentials removed, actions cancelled, history kept, other Pages untouched) | ✅ | `meta-moderation.test.ts` |
| AI classification pipeline, deterministic rules, policy engine, modes, thresholds, caps, kill switch, emergency pause | ✅ (mocked model) ⚠️ (model quality) | `meta-moderation.test.ts`, `classifier-rules.test.ts`, live run |
| Automatic hide off by default; explicit activation; negative-sentiment hiding is a per-Page opt-in (defamation / slang / negative vibe hidden automatically when on — verified live with Bengali comments) | ✅ | `meta-moderation.test.ts`, live run |
| Outbound actions: idempotency, atomic claim, retry/backoff, reconciliation, auth-error handling | ✅ | `meta-moderation.test.ts` |
| Review queue, approve/reject/correct → training examples, unhide = false-positive | ✅ | tests + browser (approved a hide through the UI, Graph mock received `is_hidden=true`) |
| Agent Studio (versions, activation, playground), Training Center (knowledge text/upload, examples, bulk import), evaluations with metrics | ✅ (mocked model) | `inbox-crm-agents.test.ts` |
| BYOK: verify-before-store, encryption, no silent fallback, platform fallback flag | ✅ | `inbox-crm-agents.test.ts`, `platform-billing.test.ts` |
| AI budgets: concurrent reservation, request/cost limits, platform cap | ✅ | `platform-billing.test.ts` |
| Messenger: ingest, lifecycle, scoping, reply lock, 24h window + tags, no unsolicited messages, AI suggestions | ✅ (mocked Graph) ⚠️ (real Messenger) | `inbox-crm-agents.test.ts` |
| CRM: contacts, leads, Kanban/table, assignment scoping, activities, follow-up reminders, CSV export permission | ✅ | `inbox-crm-agents.test.ts` |
| Billing: trial → invoice → grace → expiry, manual payment, Stripe webhook signature + idempotency, plan change, cancellation, exempt internal workspaces | ✅ (Stripe signature mocked) ⚠️ (live Stripe) | `platform-billing.test.ts` |
| Email: templates EN/BN, rendering, suppression, queue/outbox, retry, campaigns, test send | ✅ (provider disabled in tests) ⚠️ (SMTP delivery) | tests + preview in browser |
| Analytics / usage / platform AI usage queries | ✅ | `analytics.test.ts` |
| Worker: ESM bundle, 7 queues, outbox dispatcher, maintenance schedulers, heartbeat | ✅ | ran locally; heartbeat visible in System Health |
| Production build (`next build`, standalone) | ✅ | built; standalone server served login/health |
| All 25 screens load without console/network errors, light + dark, mobile | ✅ | headless Chrome tour |
| Docker image build + compose on the VPS | ⚠️ | Dockerfile/compose/Caddyfile written; no Docker daemon in the build sandbox — run `./docker/deploy.sh` on the VPS |
| MFA enrolment UI | ❌ | schema fields present; TOTP UI not built |
| Meta Marketing API | ❌ (by design) | out of scope |
