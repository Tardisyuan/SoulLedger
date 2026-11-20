# ADR 0007: 问数 runs on a read-only role behind row-level security on four tables

Status: accepted (2026-11-21). It adds to ADR 0006 and does not change it: row-level security is still not rolled
out for the application. This ADR puts a policy in front of one new role, and nothing else connects as that role.

## Context

问数 (`docs/ARCHITECTURE-ask-data.md`) lets an officer ask a question about their own hall's data. A model writes
the SQL, so the statement is untrusted text. The gate (`ask_data/gate.py`, §3) parses it and refuses anything that
is not one plain SELECT over the whitelisted tables, but the gate is a parser, and parsers have gaps. The document
asks for a second wall that holds even if the gate fails completely, and it has to hold in the database, not in
Python.

ADR 0006 checked the mechanism on `souls_soul` and `judgment_judgment`: a policy keyed on
`nullif(current_setting('app.tenant_id', true), '')::bigint`, set with `SET LOCAL` so that it ends at COMMIT, which
is the only form that survives pgbouncer's transaction pooling. ADR 0006 also found that the table owner and any
superuser bypass the policy. A rollout to the application would need a non-owner role, FORCE, a transaction per
request and an explicit way to cross halls. None of that is done.

## Decision

1. **A separate login role**, `soulledger_ask_data` by default, with `NOSUPERUSER NOBYPASSRLS NOCREATEDB
   NOCREATEROLE NOINHERIT`. It gets `USAGE` on `public` and column-level `SELECT` on the `granted: true` columns of
   `ask_data/schema.yaml` and on nothing else. Free text, names, contact details, drafts and bookkeeping columns
   are not granted. The `ask_data` database alias (`ASK_DATA_DATABASE_URL`) connects as this role.
2. **RLS is ENABLEd on the four tables and never FORCEd.** The policy `ask_data_tenant` is `FOR SELECT TO` this role
   only: `tenant_id = <the SET LOCAL hall> AND NOT is_deleted`. This is narrower than the ADR 0006 probe, where the
   home hall could also read its souls held elsewhere: 问数 answers for the asking hall only.
3. **The executor** (`ask_data/executor.py`) opens one transaction per question and runs `SET TRANSACTION READ
   ONLY`. It sets `statement_timeout` (`ASK_DATA_TIMEOUT_MS`, 3 s) and `app.tenant_id` as transaction-local settings,
   runs the statement, and keeps at most `ASK_DATA_MAX_ROWS` (200) rows, flagging the result as truncated when
   there are more. The hall comes from `request.tenant` only. With no hall nothing runs, and a hall whose
   civilization's reads have been cut over to a shard gets `not_on_this_database`.
4. **Not a migration.** `manage.py ask_data_setup` runs `setup.apply` once per environment, as the table owner,
   with `CREATEROLE`. The password comes from `ASK_DATA_DB_PASSWORD`, never from the command line. The reasons it is
   not a migration: a role belongs to the whole cluster, not to one database; creating one needs a password and a
   privilege that `migrate` should not need; and a policy has to name the role, which does not exist where
   `migrate` runs first (CI, a fresh test database). The `ask_data` alias is never migrated
   (`ShardRouter.allow_migrate`), and under tests it mirrors `default` instead of getting a test database of its
   own.
5. **Idempotent.** Each run sets the role's attributes and password again, runs `REVOKE ALL` on the four tables
   (column grants go with it) and grants the current column list, so a column removed from `schema.yaml` loses its
   grant on the next run. Each run also drops and recreates the policy.

## Consequences

- **Business queries are unchanged.** The application connects as the owner, and the owner bypasses a policy that
  is not FORCEd. The policy is also scoped `TO` the 问数 role, so the owner has none. The tests check this: the
  owner reads every row with no hall set, and its UPDATE still lands.
- **The cost of not forcing.** If the application ever connects as a role that is not the owner, that role has no
  policy on these four tables, and RLS with no applicable policy denies every row. Its queries would return zero rows,
  with no error. Whoever makes that change (the ADR 0006 rollout) has to write that role's policies first.
- **These DDL statements are not in the migration history.** A database restored from a dump keeps them, but a
  database rebuilt from migrations does not have them until `ask_data_setup` runs again. A table renamed in a
  migration leaves its old grants and policy behind until the next run, and `schema.yaml` has to change with it.
- **Known gap: the hall setting can be forged when the gate is bypassed.** `app.tenant_id` is a custom setting, and
  any role can change it with `set_config` or `SET LOCAL`. psycopg2 sends the statement through the simple query
  protocol, so a text holding several statements runs all of them. A statement that reaches the executor without the
  gate can therefore set another hall's id and then read that hall's rows from the four tables. It still sees only
  the granted columns, still cannot write, and is still subject to the timeout. The gate refuses both forms:
  `set_config` and `current_setting` are `forbidden_function`, and more than one statement is
  `multiple_statements`. `tests/test_ask_data_rls.py::test_a_statement_that_sets_another_hall_still_sees_only_its_own`
  pins this gap: it xfails while the gap exists and passes once it is closed. A fix would make the policy depend
  on something the role cannot write, for example a signed value checked by a `SECURITY DEFINER` function, or a role
  per hall. That is not done in this version (doc §8).
- **The same simple-protocol issue lets a gate-bypassing text run `COMMIT` and keep going** after the read-only
  transaction has ended. What still holds there is what the role has: SELECT on the granted columns, no write
  privilege, and RLS. The 3 s timeout does not hold, because it ended with that transaction. The connection-level
  `statement_timeout` (`DB_STATEMENT_TIMEOUT_MS`) still applies.
- **The readiness probe checks this alias too.** `apps/core/health.py` pings every configured alias, so if
  `ASK_DATA_DATABASE_URL` is set before `ask_data_setup` has run, readiness fails. Run the command first.
- **A dead run can leave a role behind.** The RLS tests create a cluster-wide role, `ask_data_t_<hex>`. To clean
  one up after a hard crash: `select rolname from pg_roles where rolname like 'ask_data_t_%'`, then `DROP OWNED BY
  <name>; DROP ROLE <name>`.

## How to run

    # once per environment, after migrate (as the owner, with CREATEROLE)
    ASK_DATA_DB_PASSWORD=… manage.py ask_data_setup
    # then point the alias at the same database as that role
    ASK_DATA_DATABASE_URL=postgres://soulledger_ask_data:…@host:5432/soulledger

The tests need real PostgreSQL. On SQLite only the three that do not depend on RLS run:

    BOTH_SIDES_OK=1 scripts/run-gates.sh --real-pg --tests tests/test_ask_data_rls.py

## Evidence

- `backend/apps/soul_assist/ask_data/setup.py` (the role, grants and policy, one function)
- `backend/apps/soul_assist/ask_data/executor.py` (the transaction, the limits, the error codes)
- `backend/apps/soul_assist/management/commands/ask_data_setup.py`
- `backend/config/settings.py` (`ASK_DATA_DATABASE_URL`, `ASK_DATA_TIMEOUT_MS`, `ASK_DATA_MAX_ROWS`), `backend/config/sharding.py` (`allow_migrate`)
- `backend/tests/test_ask_data_rls.py`. Its PG-only tests are listed in
  `tests/test_concurrency.py::test_the_postgres_only_set_is_the_set_we_think_it_is`. Each guard was checked by
  breaking what it protects and watching it fail: a policy of `USING (true)`, RLS never enabled, and a
  table-wide `GRANT SELECT`.
