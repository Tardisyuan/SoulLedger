# Engineering notes: incidents and measurements

**English summary.** `CLAUDE.md` keeps only the rules. This folder keeps the reasons: what went wrong, how
it was found, and the measurements behind each rule. Most rules in this repository exist because of one
of the incidents below.

The notes are in Chinese, as they were first written. Commit ids can be checked with `git show <id>`.
Machine-specific details (host names, addresses, paths) are left out; "the build machine" is a separate
Linux box that runs the gates, and "the shared test database" is a PostgreSQL instance on the LAN.

| # | 主题 | 变成了哪条规矩 |
|---|---|---|
| 1 | [「Production Ready」报告被审计推翻](#1-production-ready报告被审计推翻) | 没有执行证据，不许宣称已修复 / 已验证 |
| 2 | [一轮里四次未经验证的断言](#2-一轮里四次未经验证的断言) | 注释、mock、聊天消息都是替没跑过的代码作的声明 |
| 3 | [读退出码，不读输出](#3-读退出码不读输出) | `cmd; echo "exit: $?"`，管道用 `${PIPESTATUS[0]}` |
| 4 | [SQLite 藏住的一整类缺陷](#4-sqlite-藏住的一整类缺陷) | 碰事务、约束、列宽的改动，再跑一遍真 PostgreSQL |
| 5 | [子代理的 worktree 不在分支尖端](#5-子代理的-worktree-不在分支尖端) | 动手前先确认在尖端；门禁数字在更新后的树上重跑 |
| 6 | [子代理的「N passed」只说明它跑的那部分](#6-子代理的n-passed只说明它跑的那部分) | 合并后由主会话跑一次门禁 |
| 7 | [500 行规则的来历](#7-500-行规则的来历) | 拆文件要有缺陷做理由，不能只看行数 |
| 8 | [测试库残留与断线](#8-测试库残留与断线) | 会话结束先关连接；断一次连接只赔一条测试 |
| 9 | [挂死的测试与顺序相关的失败](#9-挂死的测试与顺序相关的失败) | 单条测试限时；每条测试后还原全局事件表 |
| 10 | [选择性门禁：怎么选、为什么不用 testmon、怎么验证](#10-选择性门禁怎么选为什么不用-testmon怎么验证) | 按 import 图和 app 选，读文件的测试另列清单 |
| 11 | [npm 10 与 npm 11](#11-npm-10-与-npm-11) | 装依赖用 npm 11，装完还原锁文件 |
| 12 | [提交 type 的实测分布](#12-提交-type-的实测分布) | 八个 type，scope 可省 |

---

## 1. 「Production Ready」报告被审计推翻

- 2026-05-30 的 `docs/PRODUCTION_READINESS_REPORT.md`（`45a4a6358`）宣称「Production Ready / Security 8.5」。
- 2026-08-07 的 M15 多租户审计，在同一份代码里找到 4 个 CRITICAL 级的租户隔离缺口。其中一个是
  `death_sync.cleanup_old_requests`：一条物理 `DELETE`，跨所有租户执行，没有租户边界。另有 4 个 HIGH、15 个 MEDIUM。
- 2026-08 的 61 个修复提交里，不少是在补上一次修复漏掉的。例如 `580302ecc`「close the last two
  tenant-scoping gaps the M15 pass missed」。
- 结构性修法：2026-08-14 把租户过滤收口成一个函数，并用元测试钉住每个 ViewSet（`c4ed08402`，ADR 0001）。
- 那份报告没有删，加了「SUPERSEDED」抬头，留作记录。

## 2. 一轮里四次未经验证的断言

2026-08-14 那一轮（BRIEF §4.6），同一个形状出现了四次：

- `app/dispatch/page.tsx` 的注释写着「the raw member goes to `title` instead」，可它上面那个徽章没有
  `title` 属性。这条注释通过了评审。
- `WorkflowPage.test.tsx` 里的 Jest 桩（`DomainEnum: ({value}) => <span>{value}</span>`）原样复现了被测的缺陷，
  所以那条测试测的是桩，不是代码。
- `domainDisplayContract.test.tsx` 的一条契约规则，只检查枚举渲染附近有 `title={...}`，不检查括号里是什么。
  `title={t("some.key")}` 也能通过，而这条规则本来就是为了让原始值可以找回来。
- 一个代理跑了 `git branch --show-current`，读到 `main`，就报告某个分支不存在。其实那个分支在本地和远端都在。

## 3. 读退出码，不读输出

三次事故都出在这里：

- 2026-08-30：两条 ruff 错误躺在 main 上。`ruff check . | tail -1` 失败时给的最后一行是
  「[*] 1 fixable…」，不是「Found 1 error.」。
- 2026-08-31：把 playwright 的「3 failed」读成了绿。
- 2026-09-01：又有一条 ruff 错误跟着提交进了 main。

`cmd | tail` 的退出码是 `tail` 的，永远是 0；`| grep` 只给你要找的那一行，不会告诉你还有别的。
另有一条同类：Node 18 下 eslint 配置在加载规则时崩溃、退出码 2，可一经管道就看不出和 0 的区别。

## 4. SQLite 藏住的一整类缺陷

2026-08-27，代码第一次连上真 PostgreSQL，冒出两个早已发布的缺陷。在那之前，2665 条测试一直是绿的：

- PostgreSQL 上一条语句失败会**中止整个事务**，SQLite 不会。所以查询外面包一层 `except Exception: pass`，
  在测试里什么都不做，在生产里会杀死一次迁移。见 `apps/perm/migrations/0017`：一个缺失的列被报成
  `current transaction is aborted`，报错位置还在一行与故障无关的代码上。
- PostgreSQL **强制** `varchar(n)` 的长度，SQLite 不管。`Statute.source` 是 `CharField(500)`，而
  `INFERNO_SOURCE` 有 524 个字符，从那份语料进来的第一天起就是这样。

这两种都没法在 SQLite 上测：在那里加一条断言，就成了一条永远不会触发的检查。

两条路径的对照（同一份代码）：

| 日期 | SQLite | 真 PostgreSQL | 差值 |
|---|---|---|---|
| 2026-09-05 | 3478 passed / 7 skipped | 3483 passed / 2 skipped | +5 / −5 |
| 2026-09-25 | 4809 / 25 | 4829 / 5 | +20 / −20，等于当时 PG-only 名单的长度 |

**差值应当等于 PG-only 名单的长度**（`test_the_postgres_only_set_is_the_set_we_think_it_is` 钉着它），
不是一个固定数。`tests/test_concurrency.py` 里 `skipif(SQLITE)` 的那几条，是全仓库唯一真正检验
`select_for_update` 的测试。

## 5. 子代理的 worktree 不在分支尖端

2026-09-07 一轮五个代理，**四个的 worktree 停在 `main`（`de7c61a`）**，没有当时分支上已有的十几个提交。
三个自己发现并 reset 了，两个没有，结果都造成了实际后果：

- 一个代理自报「139 suites / 2530 全绿」。确实是绿的，但绿在一棵没有本轮任何工作的树上，那个绿不作数。
  重跑后是 2574。
- 同一个代理报告「`--z-toast` 被引用却从未声明」。这个缺陷在 `8d7b725` 里已经修好，而 `8d7b725` 在 `de7c61a`
  之后。这条关于已修缺陷的报告被转告了用户，还写进了 `ed33975` 的提交信息，进了 git 历史。
- 另一个代理在陈旧的树上量覆盖率，据此把 `jest.config.js` 的阈值调到 59/51/50/60。真实的树上是
  60.58/52.89/51.12/61.23，所以门禁守得住是运气，不是验证。

对策只有一条命令：`git -C <worktree> merge-base --is-ancestor <tip> HEAD`。

## 6. 子代理的「N passed」只说明它跑的那部分

2026-10-09/10 两天里，同一个形状出现了三次，每次子代理的定向测试都是绿的：

- 一条迁移改成「读写被迁移的库」：定向测试全过，合并后全量 **18 条红**。三个测试文件仍然把 `None` 当
  `schema_editor` 传进去，代理没有搜到它们。
- 把 `REINCARNATION_COMPLETED` 补进事件类型枚举：定向 2284 条全过，真 PostgreSQL 全量 **7 条红**。
  前端的事件清单镜像、标签表、时间线处理器、三份语言包各有一道守卫
  （`tests/test_frontend_event_types_track_the_backend.py`），还有一处新加的 `_base_manager` 没有登记。
- 紧接着 pre-push 的 jest 又红了一条：`domainNamespaceContract.test.ts` 不认 `egyPendingKeys.json`。

## 7. 500 行规则的来历

2026-09-04 实测：前端最大的八个文件（490–605 行）里，**没有一个的代码行数到 500**。最大的是 440 行；
`app/corpus/page.tsx` 是 179 行注释对 319 行代码。把注释也算进行数，会逼人删掉这个仓库赖以为生的那些记录。

正确做法已经在树里：`backend/apps/actors/mythology/realms.py` 文件头记录了一次 826 行时考虑过、最后**拒绝**的
拆分，理由是「a mechanical split turns twenty true sentences into twenty possibly-false ones, silently」。

对照是 `d15890a`。它为了行数一次拆了十六个文件，留下了：
- 一个 `Breadcrumb` 转发壳（2026-10-23 删掉）；
- 四处过期的 `AppLayout.tsx:418` 引用（`c3d4269` 修掉）；
- 一条「42 tests」的记录，从此不等于任何一个文件，也不等于合计。

## 8. 测试库残留与断线

- **残留的测试库**：2026-08-31 清理时，共享测试库里躺着 8 个 `test_soulledger*`，最老的是 2026-06-06 的。
  陈旧的测试库会造成上千条「环境错误」。
  - 2026-09-26 查到根因（`d1d2e5eb`）：`database_sync_to_async` 的单线程 executor 因 `conn_max_age` 一直握着
    一条连接，DROP 失败；pytest-django 把它降成一条 warning，于是 exit 0、汇总行照打、残留照留。
  - 修法：根 `conftest.py` 在会话结束前关掉那条连接，`pytest.ini` 把那条 warning 升成 error。
- **断一次连接赔 150 条**：2026-10-19，真 PG `-n 4` 时一个 worker 到数据库的连接断了，服务端还把会话当 idle 握着。
  - 结果：Django 留着死连接，那个 worker 之后的每条测试都报 `InterfaceError: connection already closed`，
    收尾的 DROP 又被那个 idle 会话挡住。
  - 修法：`config/testdb.py` 在测试抛出连接级错误后关掉连接，下一条测试重新连；测试连接带 TCP keepalive
    和 `connect_timeout`；收尾前先终止本次测试库上残留的会话。
  - 守卫：`tests/test_dropped_connection_costs_one_test.py`。

## 9. 挂死的测试与顺序相关的失败

- **挂死**：2026-10-19，一次真 PG 全量在 96% 停了五个半小时。一个 worker 在数据库上 `idle in transaction`，
  另一个卡在 Python 线程锁上，四个 worker 的 CPU 全是 0，没有任何输出。重跑没有复现。
  现在门禁的 pytest 带 `-o faulthandler_timeout=… -o faulthandler_exit_on_timeout=true`：单条测试超时就打印
  全部线程的栈、退出那个 worker，整轮照样跑完。
- **顺序相关**：2026-10-28 打开 xdist 的 `--dist worksteal` 后，实时类测试随顺序变红（两次分别 9 条、11 条）。
  - 根因：`test_event_bus.py` 的 `EventBus().reset()` 清空了全进程共用的事件处理器表，之后同一个 worker 上的
    通知、事件、WebSocket 推送全丢。
  - 修法：根 `conftest.py` 每条测试后还原（`e56a6a2e`），之后 worksteal 全量两轮 8076 passed。
  - 为什么要 worksteal：不用它时，xdist 预先分块，1–2 分钟一条的迁移往返堆在同一个 worker 上，
    全量会在 99% 停 30–40 分钟，其余七个 worker 空等。

## 10. 选择性门禁：怎么选、为什么不用 testmon、怎么验证

- **pytest-testmon 实测过，没有采用**（2026-09-30，`-n 4`，同一棵树）：

  | 运行 | 结果 | 用时 |
  |---|---|---|
  | 全量，不记录 | 5647 passed | 130 s |
  | 全量，testmon 记录 | 5647 passed | 277 s |
  | 选择性，什么都没改 | 1145 passed | 101 s（读文件的测试每次都要跑） |

  testmon 只把**测试运行期间**执行到的行算作依赖。Django 在 import 时求值的东西它都看不见：模型字段、
  serializer 的 Meta、viewset 的类属性、urls。把 souls 的 router 前缀改掉，`apps/souls` 的 177 条里红了 72 条，
  testmon 只选中其中 4 条。
- **现在的做法**：
  - jest 用 `--findRelatedTests`，加上一份推导出来的「读文件而不是 import」的测试清单（`frontend/jest.always-run.txt`）。
  - 后端按 app 选，再加一层反向依赖，再加上读别区文件的清单（`backend/tests/reads-outside-backend.txt`）。
  - 两份清单都由测试推导和核对，少一条、多一条都红。
- **验证**（2026-09-30）：取 6 个真实提交，各跑选择性与全量，再各注入一处会让测试红的破坏。
  方法：在尖端上 `git revert` 再 `cherry-pick` 回来，使改动集恰好是那个提交的 diff。
  六处注入的破坏，在选择性与全量里**红在同一组测试上**：

  | 提交 | 内容 | 注入的破坏 → 两边都红 |
  |---|---|---|
  | `4bd22aba` | 前端组件 | Breadcrumb 不再跳过无页前缀 → `AppLayout.test` |
  | `3650953b` | core hook | `useBatchRecycleSouls` 判断取反 → `useSouls.test` 4 条 |
  | `43136a88` | 语言包 | egy.json 改一个值 → `egyLexiconRules` 2 条 |
  | `1ed1dca5` | 后端 view | `views.py` 一个分支取反 → 6 条 |
  | `afc159a1` | 迁移 | 0002 反向迁移不删官员会话 → 1 条 |
  | `d90fd854` | 语料 md + 语言包 | md 里加一个未知 code → 语料测试 2 条 |

  `3650953b` 那条的 `useSouls.test.ts` 不在 always-run 清单里。它能被选中，只是因为门禁在 jest 的 `--roots`
  上补了 `packages/core`；不补那一项，这次破坏在选择性运行里会是绿的。
- **SQLite 模板库**（2026-10-19）：worker 不再各自迁移，而是从一份迁移好的模板拷贝。同一组 31 条测试，
  用模板 4 s，真迁移 42–49 s。`--full` 时真迁移一次，并和模板逐表比对；不一致就报 `TemplateDriftError`。

## 11. npm 10 与 npm 11

- 2026-09-17：npm 10.8.2 的 `npm ci` 报告「added 1529 packages」、退出码 0，但根 `node_modules` 里**没有
  `typescript`，也没有 `.bin`**。随后所有门禁都是 127（命令找不到），读起来像代码坏了。
- 2026-09-18 补正：npm 11 的 `npm ci` 同样会删掉锁文件里的 204 行 `libc` 字段。npm 10 与 11 的真正区别在于
  装出来的树是否完整。
- 所以：用 npm 11 装，装完 `git checkout -- package-lock.json`，只有有意改依赖时才提交锁文件。

## 12. 提交 type 的实测分布

2026-09-06 统计了 818 条提交：

| 写法 | 条数 | 占比 |
|---|---|---|
| 带 scope：`type(scope):` | 543 | 66% |
| 不带 scope：`type:` | 250 | 31% |
| 两者都不是（多为 Merge） | 25 | 3% |

八个 type 覆盖 765 / 802 = 95.4%。其余是 `merge`、`i18n`、`security`、`perf`、`build` 等，合计不到 5%，
刻意不收进清单。复核命令：

```bash
git log --format="%s" | grep -oE '^[a-z0-9]+' | sort | uniq -c | sort -rn
```
