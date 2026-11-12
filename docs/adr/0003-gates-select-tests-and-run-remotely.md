# ADR 0003: Push gates run only what a change can break, on a separate build machine, and real PostgreSQL is its own path

Status: accepted; selection rules revised several times between 2026-09 and 2026-11. Numbers below are dated readings, not constants.

## Context

The project has a Django back end, a Next.js web app, a platform-independent shared package, and two React Native apps, with
thousands of tests. A full run took 15 to 50 minutes and, with several test runners at once, pushed a developer laptop into
swap (one night of four full runs froze the machine). Two further facts shaped the design:

- The default test run uses SQLite, which hides a whole class of defects: on PostgreSQL a failed statement aborts the
  transaction (SQLite does not), `varchar(n)` length is enforced (SQLite ignores it), and row locks from `select_for_update`
  are not exercised. Two shipped bugs surfaced the first time the code met PostgreSQL, with 2,665 tests green.
- Sub-agents and humans report "N passed" for the subset they chose, and the guard test that fails is often not in it.

## Decision

1. One script, `scripts/run-gates.sh`, is the only place gate logic lives. The git pre-push hook is a thin shell around it.
2. Run what a change can break, not everything. Front-end tests are selected by import graph (`jest --findRelatedTests`) plus an
   always-run list of tests that read files instead of importing them (the list is derived by a test that scans test
   sources, so it cannot drift). Back-end tests are selected per Django app, with one extra layer of reverse dependencies.
   Changes to configuration, lock files, conftests or the gate script itself force a full run, and the output names the rule.
3. Static checks (type check, lint, migrations check) run before any test runner.
4. The whole run executes on a separate always-on build machine in a container; the laptop only decides what to run and syncs the
   tree. If the machine is unreachable the gate refuses instead of falling back to the laptop.
5. Real PostgreSQL is a separate path (`--real-pg`) with a throwaway database cloned from a template. The tests that only make sense
   on PostgreSQL are listed by name and pinned by a test, so the set cannot grow silently.
6. A tree that has already passed a full run is recorded by its tree hash, and an identical push is waved through.
7. A new check must be proven to fail: mutate the thing it guards, watch it go red, then trust the green.

## Consequences

- Day-to-day pushes cost minutes instead of tens of minutes, and the laptop stays usable.
- Selection can miss a test that reaches an app only indirectly. This is accepted and documented; a full run is still available
  and is used before large merges.
- The build machine is a single point of failure for pushes. The escape hatch is explicit and logged rather than automatic.
- Because selection is itself code, it has its own tests (including mutations that remove a rule and expect a red).
- Coverage floors and the full PostgreSQL run are checked on a daily CI schedule rather than on every push, so a coverage
  regression can be found a day late.

## Evidence

- `scripts/run-gates.sh` and `scripts/select-backend-tests.py`
- `backend/tests/test_backend_test_selection.py`
- `frontend/jest.always-run.txt` and `frontend/src/__tests__/jestAlwaysRunList.test.ts`
- `backend/tests/test_concurrency.py` (the PostgreSQL-only set, pinned by name)
- `backend/config/testdb.py` (template databases, per-run names)
- `.github/workflows/ci.yml` (the daily fallback that checks coverage, full PostgreSQL and three browsers)
- The Build & Test section of `CLAUDE.md` records each measurement with its date.
