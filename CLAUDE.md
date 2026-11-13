# SoulLedger — Claude Code Configuration

本文件是仓库的公开工作约定。维护者本机的运维笔记(远端门禁机、共享测试库、设备与签名、实测记录)
在 gitignored 的 `CLAUDE.local.md`,Claude Code 会一并加载。

## Rules

- Do what has been asked; nothing more, nothing less
- NEVER create files unless absolutely necessary — prefer editing existing files
- NEVER create documentation files unless explicitly requested
- NEVER save working files or tests to root — use `/src`, `/tests`, `/docs`, `/config`, `/scripts`
- ALWAYS read a file before editing it
- NEVER commit secrets, credentials, or .env files
- Keep files under 500 lines **of code** (comments excluded). The count is a prompt to ask whether
  the file does two things — never a mandate to move lines. Nothing enforces it (no `max-lines`, no
  test). A split needs a defect to justify it, not a number: see `backend/apps/actors/mythology/realms.py:16-29`
  for a split considered and refused, because "a mechanical split turns twenty true sentences into
  twenty possibly-false ones, silently."
- Validate input at system boundaries

## Agent Comms

- 子代理的 worktree 不保证在分支尖端。每个 prompt 都写:**动手前 `git log --oneline -1` 确认在分支尖端,
  不在就 `git reset --hard <branch>` 或 `git merge <branch>`;所有门禁数字在更新后的树上重跑。**
  主会话核对:`git -C <worktree> merge-base --is-ancestor <tip> HEAD`。
- 子代理没有 `SendMessage`。要报告就写「把报告写在最终回复里」。主会话可以用 `SendMessage` 把后续决定发回同一个子代理。
- 子代理报的「N passed」只说明它跑的那部分。改了枚举、迁移、文案、路由、未加租户过滤的查询时,合并后在主会话跑
  `scripts/run-gates.sh`,碰事务的再跑真 PostgreSQL。可在 prompt 里直接点名守卫,如
  `tests/test_frontend_event_types_track_the_backend.py`、`tests/tenancy_unscoped_sites.py`、`domainNamespaceContract.test.ts`。

## Build & Test

**工具链**
- Node 版本见 `.nvmrc`(两份 package.json 要求 >= 20.9.0),先 `nvm use`。版本过低时 `packages/core` 的 vitest 报
  `'node:util' does not provide an export named 'styleText'`,不指向版本。
- 装依赖用 npm 11:`npx -y npm@11 ci`(npm 10 会装出没有 `typescript` / `.bin` 的残树,退出码仍是 0)。
  装完 `npm rebuild @parcel/watcher unrs-resolver fsevents @sentry/cli`,再 `git checkout -- package-lock.json`
  (`npm ci` 会删掉锁文件里的 `libc` 字段);只有有意改依赖时才提交锁文件。
- 后端解释器是 `backend/.venv`(Python 3.11,与镜像和 CI 同一份锁),不是 PATH 上的 `python`:
  `cd backend && uv venv --python 3.11 .venv && uv pip install --python .venv/bin/python --no-deps -r requirements.lock -r requirements-dev.txt`
  报 `No module named 'django'` 时先怀疑解释器。worktree 里没有 `.venv`,用主 checkout 的绝对路径。
- 后端命令需要 `SECRET_KEY`(**至少 32 字节**,`pytest.ini` 把短 key 的 `InsecureKeyLengthWarning` 升成 error)
  和 `DEBUG=true`:`SECRET_KEY=ci-test-key-not-for-production-32-bytes-min DEBUG=true`。
- 测试要**同时隔离数据库和 Redis**(`apps/perm/cache.py` 自开 Redis 客户端,只覆盖数据库仍会写真 Redis)。
  一次性 Redis:`redis-server --port 6399 --daemonize yes --save '' --appendonly no`。

**推送门禁:`scripts/run-gates.sh`**(`bash scripts/install-hooks.sh` 装的 pre-push 钩子就是 exec 它;改脚本当场生效)

    scripts/run-gates.sh                 # 按改动选择:与最近一个通过门禁的树比(见下),含未提交与未跟踪
    scripts/run-gates.sh --base <ref>
    scripts/run-gates.sh --full          # 全量,含覆盖率门槛
    scripts/run-gates.sh --real-pg       # 真 PostgreSQL:选中的 pytest + 全部 PG-only 测试
    scripts/run-gates.sh --real-pg --full  # 含迁移往返;大分支合进 main 前跑一次
    scripts/run-gates.sh --e2e[=auto|all|chromium,mobile-chrome]
    scripts/run-gates.sh --help

- 选择方式:jest 用 `--findRelatedTests` 加 `frontend/jest.always-run.txt`(读文件而非 import 的测试,清单由
  `jestAlwaysRunList.test.ts` 推导核对);后端 pytest 按 app 选(`scripts/select-backend-tests.py`),加
  `backend/tests/reads-outside-backend.txt` 里命中的测试。新写了读文件的测试要登记进对应清单,守卫会点名。
- 配置、依赖、删改名、门禁脚本本身等改动会强制全量,输出里写明是哪条规则。没有强制选择性运行的开关。
- 在干净工作区跑通后,树哈希会被记账,推送同一棵树时钩子直接放行。所以先提交、再跑 `scripts/run-gates.sh`、再推送。
- 不带 `--base` 时,基准是 HEAD 最近 300 个提交里最新的、树记过账的那个(全量通过;或选择性通过且覆盖了它相对 merge-base 的全部改动),
  找不到才退回与 origin/main 的 merge-base;输出第一行 `base: …` 写明取了哪个、为什么(2026-11-14 用户决定)。`--full`、`--real-pg`、`--e2e` 与推送不用这条。
- 静态检查(tsc / eslint / ruff / makemigrations)排在测试之前;测试运行器默认 2 个 worker
  (`JEST_WORKERS` / `PYTEST_WORKERS` / `VITEST_WORKERS` 覆盖)。重门禁拿 `scripts/gate-lock.sh` 的锁。

**单项命令(与 CI 同形)**

```bash
# Backend(在 backend/ 下,先起上面的一次性 Redis)
SECRET_KEY=ci-test-key-not-for-production-32-bytes-min DATABASE_URL="sqlite:///:memory:" \
  REDIS_URL="redis://127.0.0.1:6399/0" CELERY_BROKER_URL="redis://127.0.0.1:6399/1" \
  CELERY_RESULT_BACKEND="redis://127.0.0.1:6399/2" .venv/bin/python -m pytest --tb=short -q
# pre-push 另加:--no-cov -m "not migration" -n 2(覆盖率下限只在 CI 与 --full 查;迁移往返只在改了迁移时跑)
DATABASE_URL="sqlite:///:memory:" .venv/bin/python manage.py makemigrations --check --dry-run
.venv/bin/ruff check .
uvx pip-audit --strict --desc -r requirements.lock --no-deps --disable-pip

# Frontend(在 frontend/ 下)
npx tsc --noEmit
npm run lint                 # eslint --max-warnings 0
npm run build
npm run test:coverage        # 不是 `npm test`:覆盖率门槛只在 --coverage 时生效

# packages/core 与两个 App
npm run --workspace packages/core typecheck && npm run --workspace packages/core lint && npm run --workspace packages/core test
npm run --workspace mobile typecheck && npm run --workspace mobile lint && npm run --workspace mobile test

# E2E(先 build;webServer 跑构建产物,不是 next dev)
npx playwright test --project=chromium
```

- `packages/core` 的测试是 vitest,`domBoundary.test.ts` 守着它不碰 DOM 类型(`typecheck` 抓不到)。
  core 的覆盖率由前端 jest 的 `coverageThreshold` 按路径把关。
- E2E 按改动挑 project:日常 chromium;改布局或样式加 mobile-chrome;合进 main 前 chromium + mobile-chrome;
  firefox 交给每日 CI。跑前确认 3333 端口上不是别的 worktree 留下的 `next-server`(`reuseExistingServer`)。
- App(`mobile/`、`mobile-officer/`):dev client,不能用 Expo Go。改了原生依赖或 `app.json` 的 plugins 要
  `npx expo prebuild` 再重编(`scripts/build-mobile-dev.sh <mobile|mobile-officer> <ios|android>`,按原生指纹判断是否需要);
  改 JS 只要 Metro。换了文件而 App 没变,先 `npx expo start --clear`(不带 `CI=1`)。只收字母数字的输入框用
  `mobile/src/ui.tsx` 的 `Input` 并设 `keyboardType="ascii-capable"`。界面改动合并后要上一次模拟器,jest 全绿不够。

**SQLITE HIDES A WHOLE CLASS OF DEFECT.** 本地与推送门禁默认跑 SQLite,而它:
- 不会因失败语句**中止事务**:`except Exception: pass` 包住的查询在测试里无害,在 PostgreSQL 上会让后续语句全报
  `current transaction is aborted`(见 `apps/perm/migrations/0017`)。
- 不强制 `varchar(n)` 长度(`Statute.source` 曾是 `CharField(500)` 而数据有 524 字符)。
- 不检验 `select_for_update` 行锁:`tests/test_concurrency.py` 等 PG-only 测试只在真 PostgreSQL 上跑,名单由
  `test_the_postgres_only_set_is_the_set_we_think_it_is` 钉住。

碰事务、约束、列宽、并发认领时,用 `scripts/run-gates.sh --real-pg` 再跑一遍。测试库名带每次运行的后缀
(`test_soulledger_<hex>`),跑完由 conftest 删除。

**事件日志是业务记录的一部分。** 写 `SoulEvent` 失败整笔业务回滚,所以 `EventService.log*` 必须写在它描述的那笔业务的
事务里面,通知与推送放 `transaction.on_commit`(`tests/test_event_log_inside_transactions.py` 逐路径注入失败;新路径就加一格)。
只上灵魂时间线用 `EventService.log*`;还要实时推送、租户 webhook 或记在原属租户的用 `event_bus.publish_soul_event(...)`。
**不要直接 `SoulEvent.objects.create`。** `AuditUserFields.save(update_fields=[…])` 会自动补写 `version` / `update_user` /
`update_time`。新事件类型先登记进 `EventType`,随后前端与语言包的守卫会要词条;egy 暂无词的键写进
`frontend/src/__tests__/support/egyPendingKeys.json`。

**按业务域拆:先上线再量。** 只读副本与聊天独立部署(`docs/ARCHITECTURE-soul-app-and-domain-split.md` 第 2 档)等到
`/me/` 的 p95 超过 500 ms 或主库 CPU 持续一周超过 60% 再做。在那之前,核心域(judgment / souls / workflow / disposition /
sentence_plan / dispatch)对 `apps.chat` / `apps.social` 的 import 不得新增
(`backend/tests/test_core_domains_do_not_reach_into_chat_and_social.py`)。

**CI/Local Differences:**
- `ci.yml` 每天 03:00 UTC 跑 main(24 小时无新提交则跳过)、推 `v*` tag 与手动;`security.yml` 每周一与手动。
  不在分支推送与 PR 上跑。CI 兜底:覆盖率下限、真 PostgreSQL 全量(含迁移往返与多库守卫)、三个 E2E 引擎、
  真 Synapse、npm / pip audit。守卫 `backend/tests/test_ci_runs_on_a_budget.py`。
- CI runs `python manage.py migrate` before tests; local uses a migrated template database.

## Verification & Root Cause

- NEVER claim `fixed`, `verified`, or `production ready` without execution evidence
- Claiming a suite passed requires the command, its exit code, and the passed count
- **读退出码,不读输出。** `cmd | tail` 的退出码是 `tail` 的;写成 `cmd >/dev/null 2>&1; echo "exit: $?"`,
  或对管道用 `${PIPESTATUS[0]}`
- A green run from before the change is not evidence — re-run after editing
- Before fixing a bug, write it out first: symptom → root cause → proposed fix
- If the root cause is unknown, say so — do not ship a patch that only hides the symptom
- After fixing, check whether the same root cause exists elsewhere in the codebase
- A new check must be proven to fail: mutate the thing it guards, watch it go red, then trust the green
- Assert absence as well as presence — "the right value is shown" stays green while the wrong one sits beside it
- A test double that behaves like the bug is worse than no test: it makes correct code look broken and broken code look fine
- Do not state as fact anything you did not execute or query — an adjacent command does not answer a different question
- A comment, a mock, and a chat message each make a claim on behalf of code you did not run; the ones that read as settled are the ones nobody re-derives

## Setup

```bash
# Install Git hooks (run after cloning)
bash scripts/install-hooks.sh
```

## Git

**这里是提交格式的唯一权威。** `CONTRIBUTING.md` 与 `AGENTS.md` 都指回这一节。

- Format: `type(scope): description`(scope 可省,多数提交带)
- Types: feat, fix, docs, style, refactor, test, ci, chore

这八个 type 覆盖约 95% 的历史提交;`perf`、`build` 等长尾要用就用,不为它们扩表。复核:

```bash
git log --format="%s" | grep -oE '^[a-z0-9]+' | sort | uniq -c | sort -rn
```

## Lazy-Load Reference

Load `docs/claude-reference.md` only when explicitly required for:
- Agent communication patterns and examples
- Swarm routing and topology configuration
- Memory/learning MCP tools and hooks
- CLI commands and setup
