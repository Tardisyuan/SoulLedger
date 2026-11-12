# ADR 0004: Split by business domain, not by tenant; database-per-tenant is deferred until measured

Status: accepted. Chat is already separate (Matrix); the core stays one deployable; sharding is a plan, not code.

## Context

When the soul-facing mobile app was added, three options were on the table: stay on one database, split by business domain
(for example a separate chat service), or give each tenant its own database. The author's first stated preference was the last
one: it matches how the domain thinks (four civilizations as four independent worlds), and it matches how Matrix federation
works (one homeserver per civilization).

The cost was worked out on the code, not guessed: cross-tenant joint judgment and dispatch would become sagas with compensation,
foreign keys across tenants would have to go, every query would need routing, and global tables (users, roles, menus, corpus)
need an owner. There was also no production workload and no data-residency rule that would force the split.

## Decision

1. Split by business domain where the domain really is separate: chat runs on its own Matrix homeserver, the soul-facing
   API is a distinct surface (`/api/v1/me/`) with its own token type, and the soul app has its own login.
2. Do not split the database by tenant yet. The destination stays on record, so new code is written to the sharding constraints:
   UUID primary keys on new tables, no cross-tenant foreign keys, cross-civilization actions go through events.
3. Departure conditions are written as things to measure (load, storage, a legal requirement), not as dates.
4. Do not split into services for the sake of a diagram. A multi-database test setup (`tenant_shadow` alias plus a test router)
   exists to exercise the routing rules without committing to the split.

## Consequences

- One database, one deploy unit for the core, and ordinary transactions across judgment, disposition and reincarnation.
- The "later" work is real: if sharding starts, the sagas and the foreign-key removal are the first tasks, and the plan
  lists them with counts of what would break.
- Some code carries constraints that look unnecessary today (UUID keys, string tenant codes in the sentence-plan tables).
  They are cheap and they keep the option open.
- The honest limit: every claim about future load is unmeasured. The documents mark such numbers "not measured".

## Evidence

- `docs/ARCHITECTURE-soul-app-and-domain-split.md` (options, decisions, dated additions)
- `docs/ARCHITECTURE-tenant-sharding.md` (what database-per-tenant would break, and when to start)
- `backend/tests/test_multidb_shadow.py` (the multi-database guard, opt-in settings)
- `backend/apps/chat/` (the separated chat domain)
