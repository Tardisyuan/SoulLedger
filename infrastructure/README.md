# Infrastructure — Lightweight Local Dev

This directory provides a **lightweight** Docker Compose setup with only PostgreSQL and Redis.

## When to use which?

| Setup | Use case | Command |
|-------|----------|---------|
| `infrastructure/` | Local dev with Django/Next.js running on host | `cd infrastructure && docker compose up -d` |
| Root `docker-compose.yml` | Full stack in Docker (backend + frontend + celery) | `docker compose up -d` |
| Root `docker-compose.staging.yml` | Staging overrides | `docker compose -f docker-compose.yml -f docker-compose.staging.yml up -d` |
| Root `docker-compose.production.yml` | Production with nginx + SSL | `docker compose -f docker-compose.yml -f docker-compose.production.yml up -d` |

## Services

- **postgres**: PostgreSQL 16 on port 5432
- **redis**: Redis 7 on port 6379

Data is stored in `./docker/postgres/` and `./docker/redis/`.
