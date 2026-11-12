# ADR 0002: The event log is part of the business record and shares its transaction

Status: accepted (decided 2026-10-10, unified entry points 2026-10-30).

## Context

Every state change to a soul (judgment, disposition, reincarnation, dispatch) writes a `SoulEvent` row. Originally the write
was treated as best-effort logging: failures were caught and logged, and some calls sat after the business transaction or
inside an inner `atomic` block whose exception was then swallowed.

That produced two silent failure shapes. A log written after the commit cannot roll anything back, so a failed log leaves a
committed change with no record. A log written in an inner `atomic` whose error is swallowed rolls back on its own
and reports success. An audit pass found 17 call sites of the second kind. On PostgreSQL there is a third effect: a failed
statement aborts the surrounding transaction, so a swallowed error resurfaces later as `current transaction is aborted`
on a line unrelated to the fault.

## Decision

1. The event row is part of the business record. If it cannot be written, the whole business operation rolls back and the
   caller sees the original exception.
2. Therefore `EventService.log*` must be called inside the transaction of the write it describes. Only user-facing
   notifications and pushes go in `transaction.on_commit`.
3. Two entry points, one rule: `EventService.log*` for events that only go on the soul's timeline, and
   `event_bus.publish_soul_event(...)` for events that must also reach the WebSocket and tenant webhooks. Both end in
   `AuditHandler`. Nothing writes `SoulEvent.objects.create` directly, because such a row reaches no other handler.
4. `AuditHandler` raises `SoulEventTargetError` when the soul cannot be found (soft-deleted, unknown tenant, wrong tenant)
   instead of skipping it quietly.

## Consequences

- A business write and its audit trail cannot disagree: either both exist or neither does.
- A failure in the event pipeline now blocks the business operation. That is deliberate, and it means the event path has
  to stay boring and fast.
- Adding a new event type has a visible cost: the type must be registered, and the front end, label tables and language packs
  each have a guard test that asks for an entry.
- The behaviour is tested by injecting a failure into every context (no transaction, caller already in a transaction, caller
  that queries afterwards). New business paths that write events get a new cell in that grid.

## Evidence

- `backend/apps/events/services.py` (file header states the rule and the two entry points)
- `backend/apps/events/handlers/audit_handler.py` (`SoulEventTargetError`, no swallowed errors)
- `backend/tests/test_event_log_inside_transactions.py` (failure injection in three transaction contexts)
- `backend/tests/test_frontend_event_types_track_the_backend.py` (the guard that follows from adding an event type)
