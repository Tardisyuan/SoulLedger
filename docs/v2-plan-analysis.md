# SoulLedger V2 Plan Gap Analysis

**Date**: 2026-05-27
**Analyzed by**: V2 Plan Analyst
**Sources**: ROADMAP_V2.md, MILESTONES.md, current codebase models

---

## 1. Death Sync API (M10)

### Current State
No implementation exists. Only spec in ROADMAP_V2.md section 2.

### Gaps Found

| Priority | Gap | Description |
|----------|-----|-------------|
| P0 | No error response schema | Plan defines success responses only. Need unified error format: `{error: {code, message, details: []}}` |
| P0 | No retry/backoff strategy | External callers (hospitals) have no guidance on retry behavior for 5xx responses. Need Retry-After headers and idempotency guarantees. |
| P0 | No rate limiting spec | External systems could flood the API. Need per-API-key rate limits (e.g. 1000 req/min). |
| P0 | No future date validation | No constraint preventing `death_date > now()`. |
| P1 | No webhook/callback pattern | Pull-only (poll `GET /status/{source_id}`). For >100 async batches, need callback URL for Celery completion notification. |
| P1 | No API versioning strategy | Hardcodes `/api/v1/` but no breaking change policy for external integrations. |
| P1 | Missing `death_cause` in batch | Present in single endpoint, missing from batch schema. |
| P1 | `source_id` uniqueness scope unclear | Unique per API key? Per civilization? Globally? Needs explicit constraint definition. |
| P2 | No audit trail | External API calls should be logged (who, when, what was created). |
| P2 | No health check endpoint | External systems need `GET /death-sync/health` for connectivity verification. |

### Recommendations
- Define OpenAPI schema with error responses before implementation
- Add `callback_url` optional field in batch request body
- Implement per-API-key rate limiting via `django-ratelimit`
- Add `death_date` validation in serializer (`<= now()`)
- Make `source_id` unique per `(api_key, source_id)` pair

---

## 2. WebSocket Notifications (M11)

### Current State
Zero implementation. No Django Channels, no ASGI config, no CHANNEL_LAYERS in settings. Celery is configured but Channels is not.

### Gaps Found

| Priority | Gap | Description |
|----------|-----|-------------|
| P0 | No Django Channels setup | Need `channels` in INSTALLED_APPS, ASGI config, `CHANNEL_LAYERS` with Redis backend. Foundational work not in plan. |
| P0 | No ASGI entrypoint | Currently WSGI only. Need `config/asgi.py` with ProtocolTypeRouter. |
| P0 | Connection lifecycle undefined | No spec for connect/disconnect handling, user-to-channel-group association, or `SoulConsumer` class design. |
| P1 | No message ordering guarantee | Message ID for dedup is specified, but no ordering. Need per-user monotonic sequence counter in Redis. |
| P1 | No scaling spec | Multiple Django workers need explicit Channel Layer group design: `soul:{soul_id}`, `civilization:{type}`, `global`. |
| P1 | No backpressure handling | Unbounded client message queues. Need max queue size + oldest-message-drop. |
| P1 | Duplicate notification type lists | Section 3.1 and 3.4 list same types with 3.4 adding `friend_request`, `friend_request_status`, `system_announcement`. Need consolidation. |
| P2 | No presence tracking | Chat needs online status. No `last_seen` or presence spec. |
| P2 | No message persistence strategy | WS messages are fire-and-forget. Need explicit "store in DB + push via WS" pattern. |

### Recommendations
- Add `channels` and `daphne` to requirements, create `config/asgi.py`
- Design `SoulConsumer` with `connect()`, `disconnect()`, `receive()` lifecycle
- Use Redis INCR per-user for sequence numbers
- Define channel groups: `soul.{uuid}` (personal), `civilization.{type}` (broadcast), `global` (system)
- Consolidate notification types into single authoritative list

---

## 3. Data Isolation (M7)

### Current State
`TenantManager` uses `contextvars.ContextVar` - filters by tenant when set, returns unfiltered when None (admin bypass). User has FK to single tenant (1:1). Soul has FK to tenant.

### Gaps Found

| Priority | Gap | Description |
|----------|-----|-------------|
| P0 | Cross-tenant access has no implementation path | "地藏王菩萨 can access all three civilizations" but TenantManager only does all-or-nothing. Need `CrossTenantAccess` model or permission backend. |
| P0 | No admin audit for cross-tenant reads | Superuser bypasses tenant filtering with no audit log. Compliance gap. |
| P0 | No M:N data migration script | Plan notes `user_tenants` junction table but no migration path for existing `user.tenant_id` FK data. |
| P1 | Soul civilization derivation breaks in M:N | `civilization` derived from tenant code (`CN_DIYU` -> `CHINESE`). In M:N, soul could belong to multiple tenants. Need explicit `civilization` field or "primary tenant" concept. |
| P1 | No per-field visibility enforcement | "Friends see basic info only" but no serializer-level field filtering based on viewer relationship. |
| P1 | TenantManager doesn't handle M:N | Current: `qs.filter(tenant=tenant)`. M:N needs: `qs.filter(tenant__in=user.tenants.all())`. |

### Recommendations
- Create `CrossTenantAccess` model: `{user, tenant, granted_by, reason, expires_at}`
- Add audit logging for all cross-tenant queries
- Migration plan: (1) create junction table, (2) copy FK data, (3) add `active_tenant` to User, (4) update TenantManager, (5) drop FK column
- Add explicit `civilization` CharField to Soul model (denormalized from tenant)
- Create serializer mixin for relationship-based field filtering

---

## 4. Rush Purchase System (M9)

### Current State
No implementation. Plan spec in ROADMAP_V2 sections 5 and 8. Redis available (`REDIS_URL` in settings). Celery configured.

### Gaps Found

| Priority | Gap | Description |
|----------|-----|-------------|
| P0 | No payment flow | `rush_orders.status` has PENDING -> CONFIRMED but nothing defines how CONFIRMED happens. Payment system is "reserved, not implemented." Dead end in flow. |
| P0 | No double-spend recovery | If Redis loses Set data (restart), user could rush twice. `UNIQUE(soul_id, spot_id)` catches in DB but error path (DB unique violation -> refund Redis stock) unspecified. |
| P0 | No refund mechanism | 15-min timeout releases stock but: (1) who runs cleanup job? (2) partial failure handling? (3) user notification? |
| P1 | No queue fairness | Lua script is counter decrement, not a queue. True FCFS needs Redis List. Current design lets slow-confirming users hold spots. |
| P1 | No idempotency key | Network retry returns `ALREADY_RUSHED`. Need idempotency token for retry after genuine failure. |
| P1 | Stock sync frequency undefined | "Periodically syncs Redis and DB" - how often? SLA for inconsistency window? |
| P1 | No spot quantity validation | `CHECK (quantity >= 0)` allows 0-quantity spots. Need `> 0`. |
| P2 | No CAPTCHA integration | "Graphical CAPTCHA (later)" - no service or integration point specified. |
| P2 | No transaction history | Users need `GET /api/v1/rush-orders/` for purchase history. |

### Recommendations
- For free spots: auto-confirm with Celery task (skip payment). For paid: define explicit payment gateway integration point.
- Add Celery beat task for expired order cleanup (every 1 minute)
- On DB unique violation: catch IntegrityError, log, increment Redis stock back
- Use Redis List for true FCFS: `LPUSH` on rush, `RPOP` on confirm
- Add `idempotency_key` UUID field to rush_orders, unique constraint
- Define stock sync SLA: recommend every 30 seconds with alerting on >1% drift

---

## 5. Multi-tenant M:N Migration (M7)

### Current State
User has `tenant = FK(Tenant)` (1:1). Soul has `tenant = FK(Tenant)`. TenantManager filters by single tenant via contextvars.

### Gaps Found

| Priority | Gap | Description |
|----------|-----|-------------|
| P0 | No migration script | Acknowledges `user_tenants` junction table needed but zero detail on Django migration. Highest-risk item: touches every TenantManager query. |
| P0 | JWT payload change unspecified | Current JWT has single `tenant_code`. M:N needs list + active tenant selector. No `POST /auth/switch-tenant/` endpoint defined. |
| P0 | TenantManager refactor scope undefined | Every model using `objects = TenantManager()` (10+ models) needs M:N logic. Codebase-wide change with no scope estimate. |
| P1 | No rollback strategy | If M:N migration breaks production, what's the rollback path? Need reversible migration. |
| P1 | Soul tenant assignment ambiguous | User in CN + EU creates Soul - which tenant? Need "current active tenant" concept at request level. |
| P1 | No tenant-switching UI spec | Frontend needs tenant selector dropdown. Not mentioned anywhere. |

### Recommendations
- Write detailed Django migration with `RunPython` for data migration
- Add `active_tenant` field to User model, `tenants` M2M field
- JWT payload: `{tenant_codes: [...], active_tenant: "CN_DIYU"}`
- New endpoint: `POST /api/v1/auth/switch-tenant/` - updates active_tenant, returns new JWT
- Frontend: tenant selector in navbar header
- Rollback: keep old `tenant_id` column for 2 releases, remove in v3

---

## 6. Social Features (M12)

### Current State
No implementation. Plan spec in ROADMAP_V2 sections 4.2-4.5 and 7.2-7.8.

### Gaps Found

| Priority | Gap | Description |
|----------|-----|-------------|
| P0 | No content moderation | Chat and moments have no profanity filter, spam detection, or admin review. Critical for system with diverse moral backgrounds. |
| P0 | No image upload/storage spec | Moments support "images" (JSONB) but no: upload endpoint, storage backend, resizing, virus scanning, CDN, size limits. |
| P0 | No block asymmetry handling | "Block = bidirectional" but: can B see old messages after A blocks B? Can B see moments posted before block? |
| P1 | No chat delivery guarantee | Write to DB then push via WS has no transactional guarantee. WS push failure = message sits until poll, but no polling fallback. |
| P1 | No message size limit | `content TEXT NOT NULL` - no max length. Need API validation (e.g. 5000 chars). |
| P1 | No file/image support in chat | Text only. If intentional, document. If not, need attachment infrastructure. |
| P1 | No moment feed pagination | "Friends' moments" requires joining 500 friends' posts. Need cursor-based pagination + fan-out-on-write. |
| P1 | No friend request expiration | "3 days expiry" mentioned but no Celery beat task to auto-expire PENDING requests. |
| P2 | No soul search | How to find souls to add as friends? Need `GET /api/v1/souls/search/?name=xxx`. |
| P2 | No notification grouping | 100 likes = 100 notifications? Need aggregation logic. |

### Recommendations
- Implement basic keyword filter + admin report queue (don't build full AI moderation)
- Image storage: local `MEDIA_ROOT` for MVP, S3 for production. Add `max_upload_size=5MB` validation.
- Block: hide all content from blocked user retroactively, preserve in DB for audit
- Chat: store in DB first, then async push via Celery. Add REST polling fallback endpoint.
- Feed: fan-out-on-write (copy moment ID to `soul_moment_feed` table for each friend)
- Celery beat: expire PENDING friend requests older than 3 days

---

## 7. Reincarnation Queue

### Current State
`ReincarnationSpot` table defined in plan but not implemented. No queue system. Current reincarnation app has basic models only.

### Gaps Found

| Priority | Gap | Description |
|----------|-----|-------------|
| P0 | No starvation prevention | "FCFS" but no priority rules defined. What about high-karma souls? Pure FCFS vs karma-weighted vs lottery? Need explicit policy. |
| P0 | No atomic spot allocation | Redis DECR then DB write. If DB fails after Redis success, user sees "success" but loses spot. Need 2-phase commit or compensating transaction. |
| P1 | No waitlist | All spots gone = "try again next batch"? No queue/waitlist for next release. |
| P1 | No spot release cascade | Confirmed reincarnation fails (target realm unavailable) - spot goes back to pool? Or to original holder? |
| P1 | Conditions enforcement unclear | `{min_karma: 100, max_sins: 5}` - validated in Redis Lua? Django? Both? Single source of truth needed. |
| P1 | No batch spot creation | Admin needs bulk creation ("100 spots for CN realm X on date Y"). Plan only shows individual creation. |
| P2 | No priority queue integration | Karma-based priority would require sorted set in Redis, not simple counter. |

### Recommendations
- Define explicit allocation policy: FCFS with karma tiebreaker (document, don't guess)
- Use Redis transaction (MULTI/EXEC) for atomic check-decrement-confirm
- On DB failure: Celery task to refund Redis stock + notify user of allocation failure
- Add `waitlist` table for souls who missed out, auto-notify on next release
- Validate conditions in Django only (single source of truth), Lua does counter only
- Add `POST /api/v1/reincarnation/spots/bulk-create/` for admin

---

## 8. Cross-cutting Missing Items

### P0 - Missing Entirely

| Gap | Impact |
|-----|--------|
| No Celery task files | Every async feature (death sync, rush cleanup, notification delivery, friend expiry) needs tasks. Celery is configured but has zero tasks. |
| No monitoring/observability | No health check, no metrics, no structured logging. Essential for real-time features. |
| No DB connection pooling | WebSocket long-lived connections + REST need pool tuning (pgbouncer or CONN_MAX_AGE). |

### P1 - Under-specified

| Gap | Impact |
|-----|--------|
| No unified rate limiting | Mentioned in multiple sections but no middleware. Need single `django-ratelimit` solution. |
| No API documentation | No OpenAPI/Swagger. Need `drf-spectacular` for machine-readable schema. |
| No V2 testing strategy | M1-M5 have tests. V2 needs concurrency tests (rush purchase) and connection lifecycle tests (WebSocket). |
| No error handling middleware | "Unified error response" only for death sync. Need project-wide custom DRF exception handler. |

### P2 - Nice to Have

| Gap | Impact |
|-----|--------|
| No feature flags | Cross-civilization chat, payment are "later." Need toggle mechanism. |
| No data retention policy | Chat, moments, audit logs - no archival spec. |

---

## Priority Summary

| Priority | Count | Key Items |
|----------|-------|-----------|
| P0 | 14 | M:N migration script, JWT changes, Channels setup, rush purchase payment dead-end, content moderation, cross-tenant permissions |
| P1 | 18 | Message ordering, queue fairness, chat delivery, tenant-switching UI, Celery tasks, rate limiting |
| P2 | 7 | Presence tracking, feature flags, data retention, CAPTCHA, audit trails |

## Top 3 Blockers

1. **M:N user-tenant migration + TenantManager refactor** - Blocks cross-tenant features, social features, rush purchase. Touches every model with TenantManager.
2. **Django Channels + ASGI setup** - Blocks WebSocket, chat, real-time notifications, presence. Zero infrastructure exists.
3. **Rush purchase payment flow dead-end** - CONFIRMED status has no trigger. Entire flow incomplete without defining how payment/confirmation happens.

---

*Analysis date: 2026-05-27*
*Based on: ROADMAP_V2.md (1033 lines), MILESTONES.md, current codebase models*
