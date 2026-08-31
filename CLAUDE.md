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
# ISOLATE BOTH BACKING SERVICES. `.env` points DATABASE_URL *and* REDIS_URL at
# the shared box (192.168.2.115). Overriding only the database still lets the
# suite write permission-cache keys into the real Redis — verified 2026-08-27.
# Throwaway Redis first:
#   redis-server --port 6399 --daemonize yes --save '' --appendonly no
cd backend && DATABASE_URL="sqlite:///:memory:" REDIS_URL="redis://127.0.0.1:6399/0" \
  CELERY_BROKER_URL="redis://127.0.0.1:6399/1" \
  CELERY_RESULT_BACKEND="redis://127.0.0.1:6399/2" \
  python -m pytest --tb=short -q
cd backend && DATABASE_URL="sqlite:///:memory:" python manage.py makemigrations --check --dry-run
cd backend && ruff check .
cd backend && pip-audit --strict --desc

# Frontend — matches CI pipeline exactly
cd frontend && npx tsc --noEmit
cd frontend && npm run lint
cd frontend && npm run build
cd frontend && npm test

# E2E
cd frontend && npx playwright test --project=chromium

# 真 PostgreSQL 上跑一遍 —— 上面那条 SQLite 命令跑不到的东西在这里
# 不设 DATABASE_URL,让 Django 读 .env 指向 115;pytest-django 自建 test_soulledger
# 再删掉,不碰真库。`--create-db` 是必需的:陈旧的 test_soulledger 会造成上千条
# 「环境错误」,那正是这条路径当初被判成不可用的原因。
cd backend && python -m pytest -q --no-cov --create-db
```

**`tests/test_concurrency.py` 里有 4 条 `skipif(SQLITE)` 的测试,是这个仓库里唯一
真正检验 `select_for_update` 的东西** —— 上面那条 SQLite 命令一条都不跑它们。
`test_the_postgres_only_set_is_the_set_we_think_it_is` 钉住这个集合,
让它不能再无声地增长。

**两条路径实跑对照(2026-08-31,同一份代码):**

    SQLite 内存库     3435 passed /  7 skipped / exit 0
    真 PostgreSQL     3440 passed /  2 skipped / exit 0

多的 5 条正是那 4 条并发测试加 `test_two_judges_cannot_both_decide_one_node.py`;
剩下的 2 个 skip 是 `Menu` / `MenuButton`,它们**确实没有 tenant 字段**。
**「7 skipped」不是噪音,是 5 条从没在这条路径上跑过的测试。**

跑完记得看 115 上有没有留下 `test_soulledger*`:pytest-django 正常会删掉它,
中断或 xdist 会留下。2026-08-31 清理时那里躺着 **8 个**(最老的是 2026-06-06 的),
每一个都是空库,而**陈旧的 test_soulledger 正是那上千条「环境错误」的成因**。

    psql -U soulledger -d postgres -Atc \
      "select datname from pg_database where datname like 'test_soulledger%'"

**SQLITE HIDES A WHOLE CLASS OF DEFECT, AND THE SUITE ONLY RUNS ON SQLITE.**
Two shipped bugs surfaced the first time this code met a real PostgreSQL
(2026-08-27), with 2665 tests green throughout:

- A failed statement **aborts the transaction** on PostgreSQL and does not on
  SQLite. So `except Exception: pass` around a query is a no-op in tests and a
  migration-killer in production — see `apps/perm/migrations/0017`, where it
  turned a missing column into `current transaction is aborted` reported
  against a line that had nothing to do with the fault.
- `varchar(n)` length is **enforced** on PostgreSQL and ignored by SQLite.
  `Statute.source` was `CharField(500)` while `INFERNO_SOURCE` was 524
  characters, from the day that corpus landed.

Neither is testable on SQLite: an assertion added there would be one of the
checks that can never fire. Before trusting a green suite on anything touching
transactions, constraints, or column widths, run it against PostgreSQL.

**CI/Local Differences:**
- CI runs `python manage.py migrate` before tests (local uses existing DB)
- CI runs `pip-audit --strict` (local can skip)
- CI runs `npm audit --audit-level=high` (local can skip)
- CI runs E2E separately (local can run on demand)

## Verification & Root Cause

- NEVER claim `fixed`, `verified`, or `production ready` without execution evidence
- Claiming a suite passed requires the command, its exit code, and the passed count
- **读退出码,不读输出。** `ruff check . | tail -1` 在失败时给的是
  「[*] 1 fixable…」而不是「Found 1 error.」;`cmd | tail` 的退出码是 `tail` 的,
  永远是 0;`| grep` 只给你要找的,不会告诉你还有别的。三次事故全出在这里 ——
  2026-08-30 的两条 ruff 错误躺在 main 上、2026-08-31 把 playwright 的
  「3 failed」读成绿的、2026-09-01 又让一条 ruff 错误跟着提交合进 main。
  写成 `cmd >/dev/null 2>&1; echo "exit: $?"`,或对管道用 `${PIPESTATUS[0]}`
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
