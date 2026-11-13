# Quality evidence

What this repository runs to claim a change is "done", what the last run said, and three cases where a
guard was shown to fail before it was trusted. Numbers in the table are filled from a real run only; a
cell that says `TBD` has not been measured yet.

## The gates

| Command | What it runs |
| --- | --- |
| `scripts/run-gates.sh` | The push gate. Static checks first (tsc and eslint for core, web and both apps; ruff; `makemigrations --check`), then only the tests a change can reach: `jest --findRelatedTests` plus a list of tests that read files instead of importing them; backend pytest selected per Django app. |
| `scripts/run-gates.sh --full` | Everything above, unselected, with the coverage floors enforced (web, core, both apps). |
| `scripts/run-gates.sh --real-pg` | The backend tests against a real PostgreSQL 16, including the tests that only exist there (row locks, column widths, aborted transactions). `--real-pg --full` adds the migration round trips. |
| `scripts/run-gates.sh --e2e` | Playwright against a production build (`--e2e=all` for chromium, firefox, mobile-chrome). |
| CI (`.github/workflows/ci.yml`) | Once a day on `main`, only if `main` changed: full backend on PostgreSQL with coverage floor, web, both apps, a real Synapse, three E2E engines, the demo's E2E, pip and npm audit. |

Selection rules and their measured costs are written down in [`CLAUDE.md`](../../CLAUDE.md).

## Results

| Suite | Command | Exit code | Passed | Skipped | Date |
| --- | --- | --- | --- | --- | --- |
| Backend, SQLite | `scripts/run-gates.sh --full` | TBD (filled after the next gate run) | TBD | TBD | TBD |
| Backend, PostgreSQL | `scripts/run-gates.sh --real-pg --full` | TBD (filled after the next gate run) | TBD | TBD | TBD |
| Web (jest) | `scripts/run-gates.sh --full` | TBD (filled after the next gate run) | TBD | TBD | TBD |
| Soul app / officer app (jest) | `scripts/run-gates.sh --full` | TBD (filled after the next gate run) | TBD | TBD | TBD |
| E2E | `scripts/run-gates.sh --e2e=all` | TBD (filled after the next gate run) | TBD | TBD | TBD |

The last daily CI run is the badge at the top of the [README](../../README.md). It also uploads its suite
counts as the workflow artifact `landing-stats` (same shape as
[`landing-stats.json`](../../frontend/src/config/landing-stats.json)); the numbers on the landing page are
copied from there by hand, and carry their measurement date.

## Why PostgreSQL as well as SQLite

The default test database is SQLite because it is fast, and it hides a class of defects:

- A failed statement aborts the whole transaction on PostgreSQL and does nothing on SQLite, so an
  `except: pass` around a query is harmless in tests and fatal in a migration.
- `varchar(n)` is enforced on PostgreSQL and ignored by SQLite; a seed string longer than its column passed
  every test for months.
- `select_for_update` (two judges claiming one case) only means something on PostgreSQL.

A small, pinned set of tests runs only on PostgreSQL (`backend/tests/test_concurrency.py` fails if the set
grows silently). That is why the two backend runs differ: the SQLite run skips those tests, the PostgreSQL
run executes them, and the difference between the two skip counts should equal the length of that list.
The two rows above are therefore not expected to show the same numbers.

## Guards that were shown to fail

A new check is trusted only after the thing it guards is broken on purpose and the check goes red. Three
commits that record doing so (`git show <id>`):

- `704f71826` — a mutation check showed the time filter of a capture test was never exercised: the
  newest-first ordering hid it in both earlier tests. The test was tightened until the mutation turned it red.
- `9844b6961` — event-log cells for appeals, retrials and reopened conclusions. The code was already right;
  the commit records that moving or swallowing those events turns the new cells red.
- `3e499d55c` — an E2E check for the demo's cover animation: without the cut-out 6 of 7 checks go red,
  without the name's fade 7 of 7.

A fourth kind is a guard that was green for the wrong reason: `deedd5f23` fixes a CI guard that read
`-n auto` off a comment instead of the command line.
