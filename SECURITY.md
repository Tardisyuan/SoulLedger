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
  and `/me/mfa/*`); a hall can require it per role (`/tenants/{code}/mfa-roles/`)
- **Authorization**: RBAC with permission codenames, data scope isolation
- **Tenant Isolation**: Row-level tenant filtering in the view layer via
  `apps/core/tenant.py::scope_to_tenant` (every ViewSet is pinned to it by the
  meta-test in `tests/test_tenant_scoping_contract.py`). `TenantManager` filters soft
  deletes only; it does not isolate tenants.
- **Audit Trail**: All mutations logged via AuditLog signals
- **Dependency Scanning**: `pip-audit --strict --desc -r requirements.lock --no-deps --disable-pip` and
  `npm audit --audit-level=high` in `ci.yml`; both block, and neither is
  `continue-on-error`. **Neither runs on its own:** both workflows are
  `workflow_dispatch`-only (GitHub Actions quota exhausted), and
  `security.yml`'s weekly cron is off. A scan happens when somebody starts it.
- **Sentry**: Error tracking with PII masking
- **Encryption at rest**: Fernet for `WebhookConfig.signing_secret` and
  `DeathRegistrationRequest.source_payload`, keyed by `ENCRYPTION_KEY`. With
  `DEBUG=False` and no key the process refuses to start; with `DEBUG=True` and
  no key it warns and stores both columns in plaintext.

## Environment Variables

Never commit `.env` files. Use `.env.example` as a template.

Required for production (`DEBUG=False`; `config/settings.py` refuses to start
without each of these):
- `SECRET_KEY` — Django secret key (at least 32 bytes: only an empty value is refused, but JWT signing warns below 32 bytes)
- `ALLOWED_HOSTS` — comma-separated host list
- `DATABASE_URL` — PostgreSQL connection string (SQLite is refused)
- `ENCRYPTION_KEY` — Fernet key for the encrypted columns above

Optional (missing only produces a warning):
- `REDIS_URL` — Redis connection string (defaults to `redis://localhost:6379/0`)
- `SENTRY_DSN` — Sentry error tracking DSN (unset with `DEBUG=False` only warns)
- `MATRIX_*` — the letters (chat) feature is off unless `MATRIX_ENABLED` is set and its secrets
  (`MATRIX_JWT_SECRET`, `MATRIX_USER_SALT`, ...) are configured; see `backend/config/settings.py`
