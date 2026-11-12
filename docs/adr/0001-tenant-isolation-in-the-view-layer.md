# ADR 0001: Tenant isolation lives in one view-layer function, guarded by a contract test

Status: accepted (the single entry point is in place; the "only a hall-less ADMIN is global" rule dates from 2026-10-29).

## Context

SoulLedger is multi-tenant: each tenant (a "hall") belongs to one of four afterlife civilizations. A row must never be
visible across tenants except through explicit, audited cross-tenant flows.

Isolation was first written as a four-line idiom (admin bypass, read `request.tenant`, filter, `.none()` when absent)
copy-pasted into about ten `get_queryset()` bodies across seven apps. Each copy was an independent chance to drop the
`else`, filter the wrong field, or guard with `if tenant is not None:` so the check never fired. One of them
(the death-sync API-key axis) failed open. Tenant gaps kept turning up in batches, and an early audit found four critical
ones in code that had been described as production ready.

The default manager does not help: `TenantManager` filters only soft deletes (`is_deleted=False`). The name is historical.
A `get_queryset()` that forgets to scope returns every tenant's rows, not an empty page.

## Decision

1. One function, `scope_to_tenant`, expresses scoping. Every tenant-aware queryset goes through it.
2. Fail closed: if no tenant can be resolved, the result is `qs.none()`, never the unfiltered queryset.
3. Only a user with the ADMIN role and no tenant is global. An ADMIN bound to a hall is scoped like everyone else.
   The role check uses `getattr`, so an anonymous user (no `role`) can never be mistaken for it.
4. A contract test walks every router-registered ViewSet and requires it to be scoped, or to be listed as deliberately
   exempt with a reason. Adding an unscoped query site fails the build until someone writes the reason down.
5. The tenant `contextvar` is used only to attribute audit writes, not to filter reads.

## Consequences

- One place to audit and one place to test. The "forgot to filter" mistake becomes a red test instead of a data leak.
- There is no database-level backstop (no row-level security, no manager-level filter). The call sites are the whole of the
  isolation, so the guarantee is only as strong as the contract test. The test also has to be kept honest: a
  check that cannot fail is worse than none, so new guards are proven by mutating what they guard and watching them go red.
- Cross-tenant features (joint judgment between halls, dispatch) must opt out explicitly, which makes them easy to find.
- Choosing the view layer over a manager-level filter was a trade: ORM-level filtering would catch more, but it also hides
  the legitimate cross-tenant flows and makes them hard to reason about.

## Evidence

- `backend/apps/core/tenant.py` (the entry point and the written rules in its header)
- `backend/tests/test_tenant_scoping_contract.py` (the contract test)
- `backend/tests/tenancy_unscoped_sites.py` (the registered exceptions)
- `backend/apps/tenants/managers.py` (what the manager does and does not do)
