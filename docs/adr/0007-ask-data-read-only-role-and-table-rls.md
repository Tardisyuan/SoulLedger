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
   there are more. The hall comes from `request.tenant` only. With no hall nothing runs.
6. **Sharded, the hall's shard** (user decision 2026-11-21, replacing the earlier `not_on_this_database` 409). When
   `settings.SHARDED`, the four tables' rows live on the hall's civilization shard and control holds none of them,
   so the executor connects to `ask_data_civ_<civ>`, the same role on that shard (a hall of no known civilization
   keeps its rows on control, D2, and reads `ask_data`). `ask_data_setup` builds the same role, password, column
   grants and policy on control and on every `civ_*` alias. **Connection settings: one URL.** The shard aliases are
   derived in `config/settings.py` by `config/shard_db.ask_data_shard_databases`: the `ASK_DATA_DATABASE_URL` entry
   (its user, password and options) with the shard's `HOST` / `PORT` / `NAME` from `SHARD_DATABASE_URL_<CIV>`. So the
   role's password is written once, in `ASK_DATA_DATABASE_URL`, and never in a shard owner's URL; there is no
   `ASK_DATA_DATABASE_URL_<CIV>`. Chosen over per-shard URLs because it needs no new variable and cannot drift from
   the shard list. Its limit: the role has to reach each shard at the shard owner's host and port (the same
   pgbouncer, if any, must know the role). A shard with no derived alias would be a misconfiguration and answers
   503 `ask_data_not_configured` before the model is called.
4. **Not a migration.** `manage.py ask_data_setup` runs `setup.apply` once per environment, as the table owner,
   with `CREATEROLE`. The password comes from `ASK_DATA_DB_PASSWORD`, never from the command line. The reasons it is
   not a migration: a role belongs to the whole cluster, not to one database; creating one needs a password and a
   privilege that `migrate` should not need; and a policy has to name the role, which does not exist where
   `migrate` runs first (CI, a fresh test database). The `ask_data` aliases (`ask_data`, `ask_data_civ_*`) are never
   migrated (`ShardRouter.allow_migrate`), and under tests each mirrors its database (`default`, the shard) instead of
   getting a test database of its own.
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
- **The hall setting is a value any role can write; the executor makes sure only it writes it.** `app.tenant_id`
  is a custom setting: any role can change it with `set_config` or `SET`. psycopg2 sends a statement through the
  simple query protocol, so a text holding several statements runs all of them. Until 2026-11-21 that was a known
  gap whenever the gate was bypassed: `SELECT set_config('app.tenant_id', '<B>', true); SELECT …` read hall B,
  and `COMMIT; SELECT …` ran the rest outside the read-only transaction and its 3 s timeout.
  `tests/test_ask_data_rls.py::test_a_statement_that_sets_another_hall_still_sees_only_its_own` pinned it as an
  xfail. It is closed in the executor itself, not only in the gate (defence in depth):
  `executor._one_statement` parses the text with sqlglot before anything is sent and refuses
  - anything that is not exactly one statement (`multiple_statements`; unparseable text is `unparseable`);
  - a root that is not a query or a DML statement (`not_a_select`). This is an allow-list on purpose: sqlglot
    reads `START TRANSACTION`, `ABORT`, `SAVEPOINT x` and `DISCARD ALL` as a column or an alias, so a deny-list
    of transaction-control node types would let them through. `SET`, `RESET`, `COMMIT`, `BEGIN`, `DO` are
    refused the same way. DML is still sent, so the role and `READ ONLY` are what refuse it, as the wall tests
    require;
  - any call of `set_config`, anywhere in the tree (`forbidden_function`), which also covers a single statement
    that sets the hall in a materialised CTE before the table is scanned.
  The codes are the gate's. The former xfail is now an ordinary test on PostgreSQL (three forms, through the
  wall), and `test_the_executor_sends_one_statement_and_never_a_setting` checks fourteen forms on every engine.
  Removing the call to `_one_statement` turns 17 of them red (checked 2026-11-21).
  **What remains:** the check trusts sqlglot to split statements the way PostgreSQL's lexer does. The obvious
  disagreements were tried (backslashes in standard and `E''` strings, dollar quoting, nested comments) and both
  agree; a disagreement nobody tried would reopen the gap for a text that also gets past the gate. Closing it for
  good would make the policy depend on something the role cannot write (a signed value checked by a
  `SECURITY DEFINER` function, or a role per hall). Not done in this version (doc §8).
- **The readiness probe checks this alias too.** `apps/core/health.py` pings every configured alias, so if
  `ASK_DATA_DATABASE_URL` is set before `ask_data_setup` has run, readiness fails. Run the command first.
- **A dead run can leave a role behind.** The RLS tests create a cluster-wide role, `ask_data_t_<hex>`. To clean
  one up after a hard crash: `select rolname from pg_roles where rolname like 'ask_data_t_%'`, then `DROP OWNED BY
  <name>; DROP ROLE <name>`.

## How to run

    # once per environment, after migrate / migrate_shards (as the owner, with CREATEROLE): control and every shard
    ASK_DATA_DB_PASSWORD=… manage.py ask_data_setup
    # then point the alias at control as that role; sharded, ask_data_civ_* follow from it and the shard URLs
    ASK_DATA_DATABASE_URL=postgres://soulledger_ask_data:…@host:5432/soulledger

The wall tests need real PostgreSQL. On SQLite only the ones that do not depend on RLS run (no alias, no hall, the
alias a sharded hall reads through, the derived shard settings, and the executor's refusals before sending):

    scripts/run-gates.sh --real-pg --tests tests/test_ask_data_rls.py
    # the sharded form (four shards)
    scripts/run-gates.sh --real-pg --tests --ds=config.settings_sharded -m sharded tests/test_ask_data_sharded.py

## Evidence

- `backend/apps/soul_assist/ask_data/setup.py` (the role, grants and policy, one function)
- `backend/apps/soul_assist/ask_data/executor.py` (the transaction, the limits, the error codes, `_one_statement`)
- `backend/apps/soul_assist/management/commands/ask_data_setup.py`
- `backend/config/settings.py` (`ASK_DATA_DATABASE_URL`, `ASK_DATA_TIMEOUT_MS`, `ASK_DATA_MAX_ROWS`), `backend/config/shard_db/__init__.py` (`ask_data_shard_databases`), `backend/config/sharding.py` (`allow_migrate`)
- `backend/tests/ask_data_wall.py` (the test role and alias, shared by the RLS, eval and API tests)
- `backend/tests/test_ask_data_sharded.py` (decision 6: two halls on one shard and one on another, as the role,
  through the walls `ask_data_setup` built on every shard)
- `backend/tests/test_ask_data_rls.py`. Its PG-only tests are listed in
  `tests/test_concurrency.py::test_the_postgres_only_set_is_the_set_we_think_it_is`. Each guard was checked by
  breaking what it protects and watching it fail: a policy of `USING (true)`, RLS never enabled, and a
  table-wide `GRANT SELECT`.
