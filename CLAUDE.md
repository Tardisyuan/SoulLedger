# SoulLedger — Claude Code Configuration

## Rules

- Do what has been asked; nothing more, nothing less
- NEVER create files unless absolutely necessary — prefer editing existing files
- NEVER create documentation files unless explicitly requested
- NEVER save working files or tests to root — use `/src`, `/tests`, `/docs`, `/config`, `/scripts`
- ALWAYS read a file before editing it
- NEVER commit secrets, credentials, or .env files
- Keep files under 500 lines **of code** (comments excluded). Treat the count as a
  prompt to ask whether the file does two things — never as a mandate to move lines.
  *Measured 2026-09-04:* of the eight largest frontend files (490–605 lines), **none
  has 500 lines of code**; the largest is 440 and `app/corpus/page.tsx` is 179 comment
  lines against 319 of code. Counting comments creates pressure to delete the
  institutional memory this repo is built on. Nothing enforces this rule — there is no
  `max-lines` in any eslint config and no test counts lines — so it is applied by eye,
  which is what the rest of this file exists to warn about.
  The canonical *right answer* is already in the tree: `backend/apps/actors/mythology/
  realms.py:16-29` records a split considered at 826 lines and **refused**, because
  "a mechanical split turns twenty true sentences into twenty possibly-false ones,
  silently." Compare `d80ac68`, which split sixteen files for the line count and left
  behind a permanent `Breadcrumb` re-export shim, four stale `AppLayout.tsx:418`
  references (fixed in `29e82df`), and a "42 tests" record that now equals no file and
  no sum. `domainDisplayContract.test.tsx` was back over the ceiling nine days later.
  A split needs a defect to justify it, not a number.
- Validate input at system boundaries

## Agent Comms

Named agents coordinate via `SendMessage`, not polling or shared state.

- ALWAYS name agents — `name: "role"` makes them addressable
- ALWAYS include comms instructions in prompts — who to message, what to send
- Spawn ALL agents in ONE message with `run_in_background: true`
- After spawning: STOP, tell user what's running, wait for results
- NEVER poll status — agents message back or complete automatically

**子代理的 worktree 不保证在分支尖端 —— 每个 prompt 都要让它先确认。**
2026-09-07 一轮里五个代理,**四个的 worktree 停在 `main`(`35e28a5`)**,不含
当时分支上已有的十几个提交。三个自己发现并 reset 了,两个没有,而这两次都造成了
实际后果:

- `audit-rest` 自报「139 suites / 2530 全绿」—— 真的绿,但绿在一棵没有本轮任何
  工作的树上。**那个绿不作数**,重跑才是 2574。
- 同一个代理报告「`--z-toast` 被引用却从未声明」。那个缺陷**在 `c3039a6` 里
  已经修好**,而 `c3039a6` 在 `35e28a5` 之后。它写下那条时缺陷已不存在,而那句话
  被转告了用户、并写进了 `2aa8494` 的提交信息 —— **一条关于已修缺陷的活体报告
  进了 git 历史。**
- `a11y-guard` 在陈旧树上量覆盖率,据此把 `jest.config.js` 的阈值棘轮到
  59/51/50/60。真实的树上是 60.58/52.89/51.12/61.23,**守得住是运气不是验证**:
  若新增代码的覆盖率低些,门禁会红,而红的原因指向「覆盖率不够」,不指向
  「阈值是在别的树上定的」。

所以每个 prompt 里都要写:**动手前先 `git log --oneline -1` 确认在分支尖端,
不在就 `git reset --hard <branch>` 或 `git merge <branch>`;所有门禁数字必须在
更新后的树上重跑。** 主会话侧的对策是一样的一条命令:
`git -C <worktree> merge-base --is-ancestor <tip> HEAD`。

**`SendMessage` 在子代理的工具集里不存在。** 同一轮五个代理**全部**在报告开头
说了这件事。上面那条「ALWAYS include comms instructions — who to message」因此
是一条无法执行的指令:让它们「完成后 SendMessage 给 main」只会换来一句道歉加一份
写在最终回复里的报告 —— 那份回复本来就会回到主会话。**要报告就直说「把报告写在
最终回复里」。**

## Build & Test

**前端命令需要 node >= 20.9.0**(两份 package.json 都声明了),而这台机器的默认
PATH 上是 **v18.20.8**。仓库根的 `.nvmrc` 钉了 20.19.5,`nvm use` 即可。
不切版本的话有两道门禁**根本起不来**,而且失败信息不指向版本:
`next build` 直说需要 >=20.9.0,但 `packages/core` 的 vitest 报的是
`SyntaxError: 'node:util' does not provide an export named 'styleText'`。
2026-09-04 实测:v18.20.8 下这两条红,v20.19.5 与 v22.22.1 下都绿。

**下面的后端命令里的 `python` 几乎肯定不是你要的那个。** 2026-09-05 同一天内
这台机器上量到两种情况,而**第二种更坏**:

    早些时候   python / ruff / pip-audit 三个 command -v 全空(只有 python3)
    之后       /opt/anaconda3/bin 上了 PATH:python 与 ruff 有了,
               pip-audit 与 psql 仍然没有

第二种坏在:`python` 存在,但它是 anaconda **base**,里面没有 Django。
`python -m pytest` 于是退出 **4** 并报 `ModuleNotFoundError: No module named
'django'` —— 那句话指向「缺依赖」,而真正的原因是「解释器选错了」。
`command not found` 反而不会把人带偏。(`ruff check .` 用 base 的那个是 exit 0。)

`.git/hooks/pre-push` 不受影响:它从 gitignored 的 `.prepush.env` 读
`PYTHON_BIN` / `RUFF_BIN`。~~找不到就带着「Set PYTHON_BIN in .prepush.env」拒绝~~
**这句只在 PATH 上连 `python` 都没有时成立。** 2026-09-11 在 worktree 里推送:
钩子在 worktree 根找 `.prepush.env`(gitignored,worktree 里没有),`PYTHON_BIN`
于是退回裸 `python` —— 正是上面那个没有 Django 的 base —— 而它把
`ModuleNotFoundError` 报成「a model changed without a migration」,拒了两次。
现在钩子会退回主 checkout 的 `.prepush.env`,并且只在输出里真有
`Migrations for '…'` 时才说「缺迁移」。

**worktree 里还缺 `SECRET_KEY`。** `backend/.env` 同样 gitignored,
`.claude/worktrees/*` 里没有它,`config/settings.py:14-16` 于是直接拒绝加载 ——
每一条后端命令都先死在这里;只补 `SECRET_KEY` 还不够,`DEBUG=False` 时
`ALLOWED_HOSTS` 也必填(2026-09-11 两个都实测撞到)。照 CI(`ci.yml:14-15`)
在下面每条后端命令前加 `SECRET_KEY=ci-test-key-not-for-production DEBUG=true`。
**不要**把主 checkout 的 `backend/.env` 拷过来:它的 DATABASE_URL 与 REDIS_URL
都指向 115。钩子在没有 `backend/.env` 时自己补这两个值,并打印一行说明。

复制粘贴下面的命令没有这一层 —— 要么先 activate 装了后端依赖的那个环境,
要么照 `.prepush.env` 里 `PYTHON_BIN` 的值把 `python` 换成绝对路径。
**这不是可有可无的注脚:这一整轮里每一条后端命令都得这样改写才能跑。**
而且 PATH 会在同一天里变,所以「上次能跑」不是「这次能跑」的证据 —— 先
`python -c "import django"` 问一句,比读一条 pytest 的 collection error 快。

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
# 2026-09-05 起 `lint` 是 `eslint . --max-warnings 0`。此前是裸 `eslint .`,
# 于是 **warning 不改变退出码**:唯一会拦下 warning 的是 pre-commit 钩子里那条
# `--max-warnings 0`,而它只扫暂存文件。pre-push 和 CI 走的都是这个脚本,所以
# 本地提交被挡、CI 却是绿的。真踩过一次:一条 `no-unused-vars` warning 让
# pre-commit 拒了提交,而在那之前刚跑的 `npm run lint` 退出码是 0。
# `packages/core` 的 lint 脚本同时收紧。收紧当天两个 workspace 的 warning 数都是 0。
cd frontend && npm run build
# `test:coverage`, NOT `npm test`. `npm test` is bare `jest`, and
# `jest.config.js` sets `coverageThreshold` without `collectCoverage` — so the
# threshold is only evaluated when `--coverage` is passed. Measured 2026-09-05:
# `npm test` prints the word "coverage" zero times. The gate this repo lowered
# deliberately (with the arithmetic written into jest.config.js) is invisible
# to the command this file used to name.
cd frontend && npm run test:coverage

# packages/core — three separate gates, and `.git/hooks/pre-push` runs all
# three on any `^packages/` change. They were missing from this list, so the
# way to find out they exist was to be refused by the hook.
# `test` is vitest, not jest: `domBoundary.test.ts` builds a TS program from
# the package's own tsconfig and asserts that ~146 DOM type names leaked in by
# `@types/react` stay unresolvable. `typecheck` alone does NOT catch that —
# they are empty interfaces, so `const el: HTMLElement = {}` compiles.
npm run --workspace packages/core typecheck
npm run --workspace packages/core lint
npm run --workspace packages/core test

# E2E —— **三个 project,不是一个,而且要先 build**。
# `playwright.config.ts:51-53` 定义 chromium / firefox / mobile-chrome,而
# `.github/workflows/ci.yml` 的 matrix 三个都跑。这份文件此前只给了 chromium,
# 于是「跑过 E2E」在本地和在 CI 是两件不同的事 —— 393px 下工作流工具栏的按钮
# 压在输入框上那条真缺陷,在 main 上待了一整轮,因为没有人跑过那个 project。
#
# `webServer` 现在跑 `npm run start:e2e`(构建产物),不再是 `next dev`。
# 所以**先 build,再 playwright**。理由见 playwright.config.ts 里那段注释:
# dev server 按需编译,于是 `waitForLoadState("networkidle")` 等的是「编译完
# 没有」;实测同一份代码连跑三次,失败 3/4/2 条且中招路由每次都换,而任何一条
# 单独跑都过。换成构建产物之后,三个 project 各 108 passed,且快三倍。
cd frontend && npm run build
cd frontend && npx playwright test --project=chromium
cd frontend && npx playwright test --project=firefox
cd frontend && npx playwright test --project=mobile-chrome

# 真 PostgreSQL 上跑一遍 —— 上面那条 SQLite 命令跑不到的东西在这里
# 不设 DATABASE_URL,让 Django 读 .env 指向 115;pytest-django 自建 test_soulledger
# 再删掉,不碰真库。`--create-db` 是必需的:陈旧的 test_soulledger 会造成上千条
# 「环境错误」,那正是这条路径当初被判成不可用的原因。
#
# **只放开数据库,Redis 仍然用一次性的那台(见最上面)。** 这条命令此前什么都
# 不覆盖,于是 REDIS_URL 也读 `.env` 指向 115 —— 最上面那段 2026-08-27 验证过的
# 情形:`apps/perm/cache.py` 自开 Redis 客户端(conftest 的 LocMem 覆盖不到它),
# 套件往 115 写权限缓存键,每次无前缀的 `invalidate_all_permissions()` 还会删掉
# 那里所有 `perm:*`。`28a374a` 给 pre-push 修的是同一件事,这条漏了。
# 另:`test_invalidate_all_clears_its_own_prefix_and_only_its_own` 在 REDIS_URL
# 不是本机时跳过(它不往共享 Redis 写)—— 不带下面三个变量跑,skip 会多一条。
cd backend && REDIS_URL="redis://127.0.0.1:6399/0" \
  CELERY_BROKER_URL="redis://127.0.0.1:6399/1" \
  CELERY_RESULT_BACKEND="redis://127.0.0.1:6399/2" \
  python -m pytest -q --no-cov --create-db
```

**`tests/test_concurrency.py` 里有 4 条 `skipif(SQLITE)` 的测试,是这个仓库里唯一
真正检验 `select_for_update` 的东西** —— 上面那条 SQLite 命令一条都不跑它们。
`test_the_postgres_only_set_is_the_set_we_think_it_is` 钉住这个集合,
让它不能再无声地增长。

**两条路径实跑对照(2026-09-05,同一份代码):**

    SQLite 内存库     3478 passed /  7 skipped / exit 0
    真 PostgreSQL     3483 passed /  2 skipped / exit 0

(2026-08-31 那次是 3435 / 3440。绝对值会随测试增长,**+5/−5 这个差值才是结论**。)

多的 5 条正是那 4 条并发测试加 `test_two_judges_cannot_both_decide_one_node.py`;
剩下的 2 个 skip 是 `Menu` / `MenuButton`,它们**确实没有 tenant 字段**。
**「7 skipped」不是噪音,是 5 条从没在这条路径上跑过的测试。**

跑完记得看 115 上有没有留下 `test_soulledger*`:pytest-django 正常会删掉它,
中断或 xdist 会留下。2026-08-31 清理时那里躺着 **8 个**(最老的是 2026-06-06 的),
每一个都是空库,而**陈旧的 test_soulledger 正是那上千条「环境错误」的成因**。

    psql -U soulledger -d postgres -Atc \
      "select datname from pg_database where datname like 'test_soulledger%'"

**这台机器上没有 `psql`**(2026-09-05 实测 `command -v psql` 为空),所以上面那条
按原样跑不了。用 Django 自己的连接参数问同一个问题:

    # 用你环境里的解释器(这台机器上就是 `.prepush.env` 的 PYTHON_BIN 指的那个)。
    # **不要 source `.prepush.env`**:它的职责就是把 DATABASE_URL 覆盖成 SQLite,
    # 一旦 source,下面这段会去连本地 socket 而不是 115 —— 问错了数据库,
    # 而它会安静地失败在「连不上」而不是「查不到」。2026-09-05 两种都试过。
    cd backend && <你的 python> -c "
    import os, django; os.environ.setdefault('DJANGO_SETTINGS_MODULE','config.settings'); django.setup()
    from django.db import connection as c; import psycopg2
    d=c.settings_dict
    k=psycopg2.connect(dbname='postgres',user=d['USER'],password=d['PASSWORD'],host=d['HOST'],port=d['PORT'] or 5432)
    q=k.cursor(); q.execute(\"select datname from pg_database where datname like 'test_soulledger%'\")
    print(q.fetchall() or 'NONE')"

2026-09-05 实跑这条:`NONE`。
2026-09-05 复核了这条路径的两个说法:**teardown 本身没坏** —— 一次真建库的
`--create-db` 跑完(12 秒、有迁移)之后是 `NONE`;而当时确实躺着一个 17MB / 58 张表的
残留,**不是空库**。删它之前先确认 `pg_stat_activity` 里对它的连接数为 0。
成因没查出来:我自己那次全量跑是正常结束的(exit 0、打了汇总行),
所以要么残留早于它,要么有一次没被观察到的 teardown 被打断 —— **分不出是哪种**。

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

**这里是提交格式的唯一权威。** `CONTRIBUTING.md` 与 `AGENTS.md` 都指回这一节 ——
此前三处各写一份清单,三份互不相同,而没有 commit-msg 钩子会发现这件事。

- Format: `type(scope): description`
- Types: feat, fix, docs, style, refactor, test, ci, chore

scope 可省,但**多数派是带的**。2026-09-06 实测 818 条提交:

    带 scope   type(scope):   543  (66%)
    不带 scope type:          250  (31%)
    两者都不是                 25  ( 3%)   ← 多为 Merge,及早期的 "fix + feat:" 写法

上面八个 type 覆盖 **765 / 802 = 95.4%**。落在外面的是 `merge`(21)、`i18n`(4)、
`security`(3)、`perf`(3)、`build`(3)、`misc`/`migrate`/`infra` 各 1 ——
**刻意不收进清单**:它们合计不到 5%,为八个类之外的长尾扩表,只会让清单再次
和实践脱节。要用就用,别为它改这一行。

复核命令(数字会随提交增长,别信这里的绝对值,信这条命令):

```bash
git log --format="%s" | grep -oE '^[a-z0-9]+' | sort | uniq -c | sort -rn
```

## Lazy-Load Reference

Load `docs/claude-reference.md` only when explicitly required for:
- Agent communication patterns and examples
- Swarm routing and topology configuration
- Memory/learning MCP tools and hooks
- CLI commands and setup
