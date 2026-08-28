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

- **Authentication**: JWT with refresh tokens (djangorestframework-simplejwt)
- **Authorization**: RBAC with permission codenames, data scope isolation
- **Tenant Isolation**: Row-level tenant filtering via TenantManager
- **Audit Trail**: All mutations logged via AuditLog signals
- **Dependency Scanning**: `pip-audit --strict --desc -r requirements.txt` and
  `npm audit --audit-level=high` in `ci.yml`; both block, and neither is
  `continue-on-error`. **Neither runs on its own:** both workflows are
  `workflow_dispatch`-only (GitHub Actions quota exhausted), and
  `security.yml`'s weekly cron is off. A scan happens when somebody starts it.
- **Sentry**: Error tracking with PII masking

## Environment Variables

Never commit `.env` files. Use `.env.example` as a template.

Required secrets for production:
- `SECRET_KEY` — Django secret key (min 32 chars)
- `DATABASE_URL` — PostgreSQL connection string
- `SENTRY_DSN` — Sentry error tracking DSN
- `REDIS_URL` — Redis connection string
