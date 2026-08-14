# SoulLedger — Claude Code Configuration

## Rules

- Do what has been asked; nothing more, nothing less
- NEVER create files unless absolutely necessary — prefer editing existing files
- NEVER create documentation files unless explicitly requested
- NEVER save working files or tests to root — use `/src`, `/tests`, `/docs`, `/config`, `/scripts`
- ALWAYS read a file before editing it
- NEVER commit secrets, credentials, or .env files
- Keep files under 500 lines
- Validate input at system boundaries

## Agent Comms

Named agents coordinate via `SendMessage`, not polling or shared state.

- ALWAYS name agents — `name: "role"` makes them addressable
- ALWAYS include comms instructions in prompts — who to message, what to send
- Spawn ALL agents in ONE message with `run_in_background: true`
- After spawning: STOP, tell user what's running, wait for results
- NEVER poll status — agents message back or complete automatically

## Build & Test

```bash
# Backend — matches CI pipeline exactly
cd backend && python manage.py makemigrations --check --dry-run
cd backend && python -m pytest --tb=short -q
cd backend && ruff check .
cd backend && pip-audit --strict --desc

# Frontend — matches CI pipeline exactly
cd frontend && npx tsc --noEmit
cd frontend && npm run lint
cd frontend && npm run build
cd frontend && npm test

# E2E
cd frontend && npx playwright test --project=chromium
```

**CI/Local Differences:**
- CI runs `python manage.py migrate` before tests (local uses existing DB)
- CI runs `pip-audit --strict` (local can skip)
- CI runs `npm audit --audit-level=high` (local can skip)
- CI runs E2E separately (local can run on demand)

## Verification & Root Cause

- NEVER claim `fixed`, `verified`, or `production ready` without execution evidence
- Claiming a suite passed requires the command, its exit code, and the passed count
- A green run from before the change is not evidence — re-run after editing
- Before fixing a bug, write it out first: symptom → root cause → proposed fix
- If the root cause is unknown, say so — do not ship a patch that only hides the symptom
- After fixing, check whether the same root cause exists elsewhere in the codebase
- A new check must be proven to fail: mutate the thing it guards, watch it go red, then trust the green
- Assert absence as well as presence — "the right value is shown" stays green while the wrong one sits beside it
- A test double that behaves like the bug is worse than no test: it makes correct code look broken and broken code look fine
- Do not state as fact anything you did not execute or query — an adjacent command does not answer a different question
- A comment, a mock, and a chat message each make a claim on behalf of code you did not run; the ones that read as settled are the ones nobody re-derives

*Why:* `docs/PRODUCTION_READINESS_REPORT.md` claimed "Production Ready / Security 8.5" on
2026-05-30; the 2026-08-07 M15 audit found 4 CRITICAL tenant-isolation gaps in that same code.
Many of the 61 fix commits in 2026-08 patch what the previous fix missed — e.g. `d879960`
"close the last two tenant-scoping gaps the M15 pass missed".

*Why:* the 2026-08-14 BRIEF §4.6 session hit the same unverified-claim shape four times.
A comment in `app/dispatch/page.tsx` said "the raw member goes to `title` instead" above a badge
with no `title` attribute; it shipped through review. A Jest stub in
`src/__tests__/WorkflowPage.test.tsx` (`DomainEnum: ({value}) => <span>{value}</span>`) reproduced
the exact defect under test, so the test measured the stub. A contract rule in
`src/__tests__/domainDisplayContract.test.tsx` checked that `title={...}` existed near an enum
render but never what was inside it, so `title={t("some.key")}` would have passed a rule whose
whole point is that the raw member stays recoverable. And an agent ran `git branch --show-current`,
read `main`, and reported that a named branch did not exist — it existed locally and on origin.

## Setup

```bash
# Install Git hooks (run after cloning)
bash scripts/install-hooks.sh
```

## Git

- Format: `type(scope): description`
- Types: feat, fix, docs, style, refactor, test, ci, chore

## Lazy-Load Reference

Load `docs/claude-reference.md` only when explicitly required for:
- Agent communication patterns and examples
- Swarm routing and topology configuration
- Memory/learning MCP tools and hooks
- CLI commands and setup
