# ADR 0006: Row-level security is verified on two tables, not rolled out

Status: accepted (2026-11-14). It adds to ADR 0001 and does not replace it. The view layer is still the only tenant wall in production.
A rollout would be a new ADR that supersedes this one.

## Context

Tenant isolation is application-layer only (ADR 0001). The guards around it are `scope_to_tenant`, the ViewSet contract
test and `tenancy_unscoped_sites.py`. All of them work at development time, and none of them works at run time. If a
service-layer `Model.objects` query forgets its filter, or someone writes raw SQL, the query returns every hall's rows.
The 2026-11-14 security review (be-sec, finding 1 and §3.5) proposed PostgreSQL row-level security as a second wall.

The architecture review found that the wiring the report proposed (`connection_created` plus a per-request `set_config`) does not hold here:

- Production connects through **pgbouncer in transaction pooling** (`docker-compose.production.yml`, `POOL_MODE: transaction`).
  With session-level settings, `set_config(..., false)` or a plain `SET`, the setting stays on the server connection and
  is passed on to the next client pgbouncer hands that connection to.
- `settings.py` has **no `ATOMIC_REQUESTS`**. Each autocommit statement in a request is its own transaction, so a
  transaction-scoped setting would have to be set again before each one.
- Channels consumers and Celery tasks reach the database by their own paths, outside the request cycle.

In short, a rollout is larger than the report's estimate, and each step of it can only be checked on real PostgreSQL.

## Decision

1. Verify the mechanism, but do not deploy it. The verification is `backend/tests/test_row_level_security_probe.py`,
   which is PostgreSQL-only and is listed in the PG-only set in `tests/test_concurrency.py`. It covers two tables:
   - `souls_soul`, the root that every other tenant row hangs off. Its policy is deliberately wider than the app layer:
     the home hall may still read a soul resident elsewhere, and writes are checked against `tenant_id` only.
   - `judgment_judgment`, the main case record, keyed on `tenant_id` only.
2. The policy reads `nullif(current_setting('app.tenant_id', true), '')::bigint`. The setting is written by
   `set_config('app.tenant_id', id, true)`, which is the same as `SET LOCAL`, inside `transaction.atomic()`. That is the
   only variant that survives transaction pooling: the setting ends at COMMIT. The `nullif` is needed because once a
   `SET LOCAL` ends, the session reads the setting back as `''` rather than NULL.
3. The tests check four things:
   - With hall A set, raw `cursor.execute` and the ORM see only A's rows.
   - UPDATE and DELETE of B's rows touch zero rows.
   - Moving a row into B fails `WITH CHECK`.
   - With no setting, the query returns zero rows (fail closed), and the same pooled connection reads zero again after the transaction commits.
   - The table owner bypasses RLS unless the table has `FORCE ROW LEVEL SECURITY`.
4. The schema is unchanged. There is no migration. The test fixture enables RLS, creates the policies and a throwaway role,
   and removes all of it after each test.

A rollout needs all of the following. Each item is its own piece of work:

- A **separate database role** for the web, ASGI and Celery processes that is not the table owner, not a superuser and
  `NOBYPASSRLS`. Migrations and management commands keep the owner role. Without this split, RLS does nothing:
  the owner and any superuser bypass it, and the fourth test shows this.
- `ENABLE` **and** `FORCE ROW LEVEL SECURITY` on every tenant table.
- A **transaction-scoped setting** that works under pgbouncer transaction mode. In practice that means a request-level transaction
  (`ATOMIC_REQUESTS` or a middleware) that issues `set_config(..., true)` first, plus the same step in each Channels
  consumer and each Celery task. Never a session-level `SET`.
- An explicit `cross_tenant(reason)` context for the paths that legitimately cross halls: dispatch, cross-hall
  joint judgment, cross-civilization rebirth and the hall-less ADMIN. It would set a bypass flag that the policies honour,
  and it would be counted in metrics. Today these paths are the `is_tenant_exempt(` call sites (54 outside tests, counted by be-sec on 2026-11-14) and the entries in
  `tenancy_unscoped_sites.py`. Each one has to be mapped to the new context.
- A measurement on real PostgreSQL of the cost per query, both the extra predicate and the extra `set_config` round trip.
  `test_datascope_b8_pg_performance.py` already has the right shape for this.

## Consequences

- Isolation is still one layer. The question "what if a developer forgets the filter" now has a tested answer for later,
  with the conditions written down, but there is no second wall today.
- The PG-only set grows by four tests. SQLite cannot test RLS at all, which is one more case of the "SQLite hides a
  whole class of defect" note in `CLAUDE.md`.
- The probe's fixture creates a cluster-wide role (`rls_probe_<hex>`) when Django's role is a superuser, which it is on
  the usual docker image. If a run dies hard, a NOLOGIN role with no grants can be left behind. To clean up, list the roles with
  `select rolname from pg_roles where rolname like 'rls_probe_%'` and drop each one with `DROP ROLE <name>`.
- Not measured: the per-query overhead, and the behaviour through pgbouncer itself. The tests run on one
  direct connection and stand in for a pooled one by reusing that connection after COMMIT.

## How to run

The tests need real PostgreSQL. On SQLite they are collected and skipped.

    . scripts/gate-lock.sh; gate_lock "rls probe"
    cd backend && SECRET_KEY=ci-test-key-not-for-production-32-bytes-min \
      REDIS_URL="redis://127.0.0.1:6399/0" CELERY_BROKER_URL="redis://127.0.0.1:6399/1" \
      CELERY_RESULT_BACKEND="redis://127.0.0.1:6399/2" \
      .venv/bin/python -m pytest tests/test_row_level_security_probe.py tests/test_concurrency.py::test_the_postgres_only_set_is_the_set_we_think_it_is \
      -q --no-cov --create-db

`scripts/run-gates.sh --real-pg` also picks them up, because it runs every test in the PG-only set.

## Evidence

- `backend/tests/test_row_level_security_probe.py` (the policy SQL, the wrapper, the four tests)
- `backend/tests/test_concurrency.py::test_the_postgres_only_set_is_the_set_we_think_it_is`
- `docs/ARCHITECTURE-tenant-sharding.md` §2.1 (RLS as option (a), the residence predicate, the ADMIN bypass)
- `docker-compose.production.yml` (pgbouncer `POOL_MODE: transaction`)
