# Security Policy

## Reporting Vulnerabilities

If you discover a security vulnerability, please report it responsibly:

1. **Do NOT** open a public GitHub issue
2. Email the maintainer directly or use GitHub's private vulnerability reporting
3. Include a description, steps to reproduce, and potential impact

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | Yes |

## Security Measures

- **Authentication**: JWT with refresh tokens (djangorestframework-simplejwt). Officers log in under
  `/auth/`, souls under `/soul-auth/`, with separate token families. Optional two-step verification
  (TOTP with recovery codes: `apps/authentication/mfa.py`, `/auth/mfa/*`; for souls `/soul-auth/mfa/verify/`
  and `/me/mfa/*`); a hall can require it per role (`/tenants/{code}/mfa-roles/`), and a required officer without it gets
  403 `mfa_setup_required` everywhere but setting it up (2026-10-29). The web client keeps its refresh token in an
  httpOnly `SameSite=Strict` cookie (`apps/authentication/refresh_cookie.py`); the two apps do not use the cookie
- **Authorization**: RBAC with permission codenames (`apps/perm/checker.py`) and per-role data scopes
  (`RoleDataScope`, `apps/perm/data_scope.py`); only the ADMIN with no hall is global
- **Tenant Isolation**: Row-level tenant filtering in the view layer via
  `apps/core/tenant.py::scope_to_tenant` (every ViewSet is pinned to it by the
  meta-test in `tests/test_tenant_scoping_contract.py`). `TenantManager` filters soft
  deletes only; it does not isolate tenants.
- **Audit Trail**: All mutations logged via AuditLog signals
- **Dependency Scanning**: `pip-audit --strict --desc -r requirements.lock --no-deps --disable-pip` and
  `npm audit --audit-level=high` in `ci.yml`; both block, and neither is
  `continue-on-error`. **Neither runs on a push:** since 2026-10-30
  `security.yml` runs weekly (Monday 04:00 UTC) and by hand, and `ci.yml` daily,
  on a `v*` tag and by hand (GitHub Actions quota). A new advisory is caught within a week.
- **Sentry**: Error tracking with PII masking
- **Encryption at rest**: Fernet for `WebhookConfig.signing_secret`,
  `DeathRegistrationRequest.source_payload`, the officer and soul two-step `secret`s,
  a soul account's initial credentials and the assistant's platform API keys, keyed by
  `ENCRYPTION_KEY`. With `DEBUG=False` and no key the process refuses to start; with
  `DEBUG=True` and no key it warns and stores those columns in plaintext.
- **Key rotation without downtime** (procedure: `docs/DEPLOYMENT.md`「密钥轮换」):
  - `SECRET_KEY`: put the old key in `SECRET_KEY_FALLBACKS`. Django verifies sessions and password-reset
    links signed with it; JWTs signed with it also still verify until they expire
    (`backend/apps/core/jwt_fallback.py` — SimpleJWT itself has no fallback support). New signatures use
    `SECRET_KEY` only. Drop the fallback after `JWT_REFRESH_LIFETIME` (7 days by default).
  - `ENCRYPTION_KEY`: put the old key in `ENCRYPTION_KEY_FALLBACKS` (reads try every key, writes use
    `ENCRYPTION_KEY`; an invalid key refuses startup), run `manage.py rotate_encryption_key`, and drop the
    fallback only after it exits 0 — it exits non-zero, touching nothing, for a value no configured key reads.
  - Webhook signing secrets are per webhook, server-generated, shown once; there is no in-place rotation yet
    (overlap two webhooks to the same URL; see the deployment doc).
- **Metrics**: `/metrics/` is closed (404) unless `METRICS_TOKEN` (Bearer) or `METRICS_ALLOWED_IPS` is set;
  nginx does not route it. It exposes counts only — no identifiers, no tenant names.

## Environment Variables

Never commit `.env` files. Use `.env.example` as a template.

Required for production (`DEBUG=False`; `config/settings.py` refuses to start
without each of these):
- `SECRET_KEY` — Django secret key (at least 32 bytes: only an empty value is refused, but JWT signing warns below 32 bytes)
- `ALLOWED_HOSTS` — comma-separated host list
- `DATABASE_URL` — PostgreSQL connection string (SQLite is refused)
- `ENCRYPTION_KEY` — Fernet key for the encrypted columns above

Optional (missing only produces a warning):
- `SECRET_KEY_FALLBACKS` / `ENCRYPTION_KEY_FALLBACKS` — previous keys during a rotation (comma-separated)
- `METRICS_TOKEN` / `METRICS_ALLOWED_IPS` — open `/metrics/` to a scraper
- `LOG_FORMAT` — `json` (default when `DEBUG=False`) or `text`
- `REDIS_URL` — Redis connection string (defaults to `redis://localhost:6379/0`)
- `SENTRY_DSN` — Sentry error tracking DSN (unset with `DEBUG=False` only warns)
- `MATRIX_*` — the letters (chat) feature is off unless `MATRIX_ENABLED` is set and its secrets
  (`MATRIX_JWT_SECRET`, `MATRIX_USER_SALT`, ...) are configured; see `backend/config/settings.py`
