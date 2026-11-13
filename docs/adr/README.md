# Architecture decision records

Six decisions that shape SoulLedger, each with the context, the choice, what it costs, and where to check it in the code.
Written 2026-11-12 from the project's own design notes and test comments; every path below exists in this repository.

| # | Decision |
|---|---|
| [0001](0001-tenant-isolation-in-the-view-layer.md) | Tenant isolation lives in one view-layer function, guarded by a contract test |
| [0002](0002-event-log-in-the-business-transaction.md) | The event log is part of the business record and shares its transaction |
| [0003](0003-gates-select-tests-and-run-remotely.md) | Push gates run only what a change can break, on a separate build machine, and real PostgreSQL is a separate path |
| [0004](0004-split-by-domain-not-by-tenant.md) | Split by business domain, not by tenant; database-per-tenant is deferred until measured |
| [0005](0005-demo-site-is-a-frontend-only-replay.md) | The public demo is a front end replaying recorded API answers, with no backend |
| [0006](0006-row-level-security-verified-not-rolled-out.md) | Row-level security is verified on two tables as PG-only tests, not rolled out |

Format: Status, Context, Decision, Consequences (including the cost), Evidence.
