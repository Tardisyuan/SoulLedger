# 审判认领、暂缓、改派与队列分组 —— 报告

分支 `feat/judgment-claim`,起点 `main` @ `4e0b778`。

> **本分支含迁移**:`backend/apps/judgment/migrations/0023_judgment_claim_and_defer.py`。
> **PostgreSQL-only 的测试必须由维护者在真 PostgreSQL 上再跑一遍**(见「门禁」):
> 我在云端容器里起了一个一次性的 PostgreSQL 16 跑过,但那不是 CI、也不是 115。

维护者决定照办:**没有**做「落判后 5 秒撤回」,结案(`conclude/`)的提交流程与时序一行未动。

---

## 1. 模型选择与迁移

**列加在 `Judgment` 上,不另起一张表。**

| 列 | 类型 | 说明 |
|---|---|---|
| `claimed_by` | FK → `authentication.User`,null,`SET_NULL` | 办案官员。**不是 `judge`**(那是神话里的审判者,一个 Actor),本分支没有碰 `judge`。 |
| `claimed_at` | DateTime,null | |
| `deferred_at` | DateTime,null | 非空即「暂缓」 |
| `deferred_by` | FK → User,null,`SET_NULL` | |
| `defer_reason` | `CharField(500)`,默认 `""` | 必填由序列化器保证;`max_length=500` 在序列化器上拦(PostgreSQL 强制 varchar 宽度、SQLite 不管 —— CLAUDE.md 的 `Statute.source` 那一回) |

外加一个索引 `(tenant, deferred_at, claimed_by)`,对应分组查询。

为什么不是单独的模型:

- 一件案子同一时刻只有一个认领人;认领竞争锁的就是案子这一行(与 `conclude` 读的是同一行),不用再去锁另一张表的「当前那一条」。
- 四个分组都是单表谓词,列表与计数不需要「最新一条认领」的子查询。
- **历史不靠第二张表**:所有写入走 `save(update_fields=…)`,经过审计信号,每次认领 / 释放 / 改派 / 暂缓 / 撤销暂缓都留下一行带前后值的 `AuditLog`(`changes={"claimed_by": [old, new]}`,有测试钉住)。`QuerySet.update()` 会绕过信号,所以写入路径全部集中在 `apps/judgment/claims.py`。
- **结案不清认领信息**(需求 5):`conclude` 不碰这几列,已结案的案子仍带着最后的认领人;之后再认领 / 释放 / 暂缓一律 409 `not_pending`。

代价(见「开放问题」):「这件案子被谁办过、改派过几次」要从审计日志读,不能直接 JOIN。

认领与暂缓**正交**:暂缓不释放认领,撤销暂缓后案子回到它按认领人所属的组。

---

## 2. 端点

全部挂在 `JudgmentViewSet` 上,租户范围与其余动作相同(`DataScopeViewSetMixin` → `scope_to_tenant`,别的租户的案子 404,到不了行锁)。

| 方法 & 路径 | 体 | 码名 | 成功 | 拒绝(`{"error", "code", …}`) |
|---|---|---|---|---|
| `POST /judgment/{id}/claim/` | — | `judgment.execute` | 200 `Judgment` | 409 `already_claimed`(带 `claimed_by`)、409 `not_pending`。认领自己已认领的:200,不写。 |
| `POST /judgment/{id}/release/` | — | `judgment.execute` | 200 | 409 `not_claimed`、403 `not_claimant`(别人的认领且无 `judgment.assign`)、409 `not_pending` |
| `POST /judgment/{id}/reassign/` | `{"to": <user id>}` | **`judgment.assign`** | 200 | 400 `invalid_assignee`(不存在 / 别的租户 / 停用 / 无 `judgment.execute` —— 前两种**答同一句话**,不做跨租户用户枚举)、409 `not_pending` |
| `POST /judgment/{id}/defer/` | `{"reason": "…"}`(必填,≤500) | `judgment.execute` | 200 | 400(缺理由 / 空白 / 超长)、409 `already_deferred`、403 `not_claimant`、409 `not_pending` |
| `POST /judgment/{id}/undefer/` | — | `judgment.execute` | 200 | 409 `not_deferred`、403 `not_claimant`、409 `not_pending` |
| `POST /judgment/batch/` | `{"operation": "claim"\|"reassign"\|"defer", "ids": [≤100], "to"?, "reason"?}` | `judgment.execute`;`reassign` 另要 `judgment.assign`(动作体内检查) | 200 `{"operation", "count", "ids"}` | 400(输入)、403、404 `not_found` + `missing: [...]`(有 id 不在调用者范围内)、409(任何一件被拒,带那件的 `id`) |
| `GET /judgment/queue-counts/` | `?court=&search=` | `judgment.read` | 200 `{"mine", "unclaimed", "others", "deferred", "total"}` | |

**批量是全有或全无**:先确认每个 id 都在 `get_queryset()` 里(不在就整批 404,不做「能做的先做」—— 那会让一次越权请求改掉一部分);然后在一个事务里**按主键排序**加行锁(两个批量以不同顺序锁同一组行会互相等成死锁),逐件套用与单件相同的规则,任何一件被拒整批回滚。重复 id 去重后再数。

**列表 `GET /judgment/`** 新增:

- `?group=mine|unclaimed|others|deferred` —— 四组互斥,并在未结案的案子上穷尽:暂缓优先,其余按认领人(相对调用者)分。**`group` 隐含「未结案」**(`verdict IS NULL AND is_final = false AND is_archived = false`)。未知值 400。
- `?court=` —— `court` 是自由文本列,精确匹配。
- `?search=` —— `search_fields = ["soul__name", "=soul__id", "=id"]`:灵魂名包含匹配,或灵魂 / 案子 id 精确匹配。`=` 是 `iexact`,对 UUID 列不经 `get_prep_value`,非 UUID 的词只是匹配不到,不会 500(有测试,SQLite 与 PG 都跑过)。
- 每行新增字段:`claimed_by`、`claimed_by_name`、`claimed_at`、`deferred_at`、`deferred_by`、`deferred_by_name`、`defer_reason`、`karmic_balance`、`evidence_count`。全部只读;PATCH / PUT 带这些键 **400**(同 `verdict` 的做法:只读字段会被 DRF 静默丢掉,显式拒绝才不会让人以为写成功了)。
  - `karmic_balance`:**只对中国的案子**(按案子的 `civilization`),其他宇宙观是 `null` —— `apps/ledger/readings.py`:净值是功過格的读法。**VIEWER 整个拿不到这个键**,与 `SoulSerializer` 同一条写死的底线(VIEWER 默认没有 `judgment.read`;测试里通过数据库授予它 `judgment.read` 再断言键不存在)。
  - `evidence_count`:`evidence_json` 的条目数 —— 详情页「事实」一栏标题旁显示的那个数。

`queue-counts` 让 `court` / `search` 照样生效(标签上的数与当前列表一致),忽略 `group`;一条聚合查询。

**`GET /judgment/next/`**:暂缓的案子默认排除(`total` / `remaining` 也不数它们);`?include_deferred=true` 显式要回。`?at=<暂缓的案子>` 单独给**不**绕过默认 —— `at` 是偏好不是过滤器,那是它原本的语义。

**N+1**:`queryset` 的 `select_related` 加了 `judge`、`claimed_by`、`deferred_by`(`judge` 原本就是每行一查,`judge_name` 读它)。查询数测试:2 行与 8 行的列表查询数相等。

**`packages/core`**:`schema.yml` / `generated/schema.ts` 按仓库流程重新生成(`manage.py spectacular --file …` + `npm run schema:generate`);`api/judgment.ts` 加了 `claim / release / reassign / defer / undefer / batch / queueCounts`、`next({ includeDeferred })` 和对应类型;`hooks/useJudgments.ts` 加了 `useJudgmentQueueCounts`、`useClaimJudgment`、`useReleaseJudgment`、`useReassignJudgment`、`useDeferJudgment`、`useUndeferJudgment`、`useBatchJudgments`。这些 mutation **不弹 toast**(队列界面要按 409 的 `code` 分支,通用错误 toast 会盖在上面),成功或失败都 invalidate `judgmentKeys.all`。

---

## 3. 改派用的权限

**新立一个码名 `judgment.assign`**,默认 ADMIN 与 MODERATOR(殿主)持有,JUDGE 不持有。

现有码名里没有合适的:`judgment.execute` 与 `judgment.create` 都是 {ADMIN, JUDGE, MODERATOR} —— 用它们等于审判官之间能互相派活;judgment 族里唯一「ADMIN + MODERATOR、不含 JUDGE」的是 `sentence_plan.cancel`,语义完全不相干。`judgment.assign` 与 `dispatch.return` / `sentence_plan.cancel` 同一种做法:写进 `DEFAULT_PERMISSIONS` 与 `ROLE_PERMISSIONS`,**不由迁移播种**(judgment.* 其余三条也不播种,在只跑过迁移的库上由字典作答)。

它同时是「替别人释放 / 暂缓 / 撤销暂缓」的门槛(没有它 → 403 `not_claimant`)。

`apps/perm/test_matrix_snapshot.py::test_seeding_actually_moved_those_codenames_onto_the_db_path` 的计数 14 → 15,注释说明了原因。

---

## 4. 并发

每个动作在 `transaction.atomic()` 里先 `Judgment.all_objects.select_for_update(of=("self",))` 锁住案子这一行,**锁到之后**再读 `claimed_by` / `deferred_at`。两个官员同时认领:第二个在行锁上等,拿到锁时读到第一个刚提交的认领,得到 409 `already_claimed`。`of=("self",)` 满足 `apps/core/lock_join_guard.py`(只锁案子,不顺带锁灵魂与租户)。

测试(沿用 `tests/test_concurrency.py` 的写法:串行版每个引擎都跑,线程版只在 PG 上跑):

- `TestJudgmentClaimConcurrency::test_the_claim_check_runs_inside_the_row_locked_transaction` —— 串行,SQLite 也跑:规则执行时 `in_atomic_block` 为真。
- `TestJudgmentClaimConcurrency::test_two_officers_claiming_one_case_at_once_exactly_one_wins` —— **PostgreSQL-only**,已加进 `test_the_postgres_only_set_is_the_set_we_think_it_is` 的名单并写明理由。A 拿锁后在规则里停 1 秒,B 必须等(> 0.5 s)并得到 409。
- SQLite 上可见的那一半(已被认领 → 409 带 `code`,且原认领不变)在 `tests/test_judgment_claim.py`。

---

## 5. 变异验证

每一条都是把守卫改掉、跑测试、看它变红,再还原(脚本改完即还原,`git status` 干净):

| # | 变异 | 结果 |
|---|---|---|
| M1 | 删掉 `_apply_claim` 里的 `already_claimed` 拒绝(SQLite 可见的竞争守卫) | 2 failed(单件 409 测试、批量回滚测试) |
| M2 | `_lock` 去掉 `select_for_update`(**在 PostgreSQL 16 上跑**) | 线程版竞争测试 failed;未变异时 2 passed |
| M3 | 单件动作用 `Judgment.all_objects.get` 代替 `get_object()`(去掉租户范围) | 4 failed(claim / release / reassign / defer 的跨租户测试) |
| M4 | 批量去掉范围检查 | 1 failed(跨租户批量) |
| M5 | `queue-counts` 不走 `get_queryset()` | 3 failed |
| M6 | 批量不在事务里(`nullcontext`) | 2 failed(认领与暂缓的整批回滚测试) |
| M7 | VIEWER 不再去掉 `karmic_balance` | 1 failed |
| M8 | `select_related` 去掉 `claimed_by` | 1 failed(查询数测试) |
| M9 | `reassign` 的码名放宽成 `judgment.execute` | 1 failed |
| F1 | 前端 hook 只在成功时 invalidate | 6 failed(拒绝时也要 invalidate) |

---

## 6. 开放问题

1. **结案要不要限定认领人?** 本分支没有:任何持 `judgment.execute` 的人仍能结任何一件案子(包括别人认领的)。维护者说过不动结案流程,所以只记在这里。若要限定,是 `conclude` 里在同一把行锁下多一条检查。
2. **认领历史的形状。** 现在历史在 `AuditLog`(每次一行,带前后值),`claimed_by` 只存最后一人。若队列 UI 要显示「改派过几次 / 谁办过」,需要按 `resource_id` 读审计日志,或改成单独的认领事件表。
3. **`next/` 是否要按组取?** 现在 `next/` 只排除暂缓,不区分「我的 / 待认领 / 别人的」。「从我认领的里取下一件」若需要,可以给 `next/` 加 `?group=`,复用同一个 `group_q`。
4. **已部署库里的 `judgment.*` Permission 行。** 若某个部署库通过权限管理界面的「初始化」为 judgment.* 建过 Permission 行(数据库路径作答),新码名 `judgment.assign` 也得建行并给 ADMIN 之外的 MODERATOR 授权,否则数据库路径对 MODERATOR 答「无」。测试库与只跑迁移的库走字典路径,不受影响。
5. **`karmic_balance` 按案子的 `civilization` 判**(审理它的宇宙观),不按灵魂此刻的管辖;一个暂居中的中国灵魂在欧洲法庭受审,案子是 EUROPEAN,余额为 null。如需相反的规则,改一行。
6. **`evidence_count` 是 `evidence_json` 的顶层条目数**(与详情页一致),不是某个证据表的行数 —— 这个仓库里没有证据表。
7. **暂缓与认领正交**:暂缓不释放认领;别人认领的案子,JUDGE 不能替他暂缓(403),MODERATOR 可以。若产品上希望暂缓即释放,改 `_apply_defer`。
8. **`court` 是自由文本**,筛选是精确匹配;若需要「殿」的选项列表,要另加一个 distinct 端点或改成外键。

---

## 7. 门禁

环境:云端容器,Python 3.11(`backend/.venv`,`requirements.lock` + `requirements-dev.txt`),Node 20.19.5,`npx -y npm@11 ci` + `npm rebuild …`,装完 `git checkout -- package-lock.json`。一次性 Redis 在 6399(`REDIS_URL` / `CELERY_BROKER_URL` / `CELERY_RESULT_BACKEND` 指向 `/0` `/1` `/2`)。没有 `.env`,没有碰 192.168.2.115。后端命令前缀:`SECRET_KEY=ci-test-key-not-for-production DEBUG=true DATABASE_URL="sqlite:///:memory:"`。

所有数字都在最终的树上重跑过(后端 @ `0cd49ae`,前端 / core @ `241cb47`;本报告的提交不改代码)。退出码是命令自己的,不是管道的。

| 门禁 | 命令 | 退出码 | 结果 |
|---|---|---|---|
| 全量 pytest(SQLite) | `cd backend && <前缀> REDIS_URL=… .venv/bin/python -m pytest --tb=short -q` | **0** | **4523 passed / 25 skipped**,覆盖率 93.64%(门槛 80) |
| ruff | `cd backend && .venv/bin/ruff check .` | **0** | |
| 迁移 | `cd backend && <前缀> .venv/bin/python manage.py makemigrations --check --dry-run` | **0** | `No changes detected`(`judgment/0023` 已在) |
| schema(spectacular) | `cd backend && <前缀> .venv/bin/python manage.py spectacular --fail-on-warn --validate --file <tmp>` | **0** | 0 warnings / 0 errors;输出与提交的 `packages/core/openapi/schema.yml` **逐字节相同**(`cmp`)。`tests/test_schema_has_no_warnings.py`、`test_committed_schema_matches_the_backend.py`、`test_declared_response_shapes_match_the_views.py` 都在上面的全量里 |
| core typecheck | `npm run --workspace packages/core typecheck` | **0** | |
| core lint | `npm run --workspace packages/core lint` | **0** | |
| core test | `npm run --workspace packages/core test` | **0** | 12 files / **118 passed**(含 `generatedSchemaIsCurrent.test.ts`) |
| frontend tsc | `cd frontend && npx tsc --noEmit` | **0** | |
| frontend lint | `cd frontend && npm run lint` | **0** | |
| frontend test:coverage | `cd frontend && npm run test:coverage` | **0** | 169 suites / **3131 passed**;覆盖率门槛通过(All files 76.15 / 66.97 / 66.65 / 77.07) |

### 额外:真 PostgreSQL 16(容器内一次性实例,不是 CI、不是 115)

| | 命令 | 退出码 | 结果 |
|---|---|---|---|
| 全量 | `DATABASE_URL=postgres://…@127.0.0.1:5433/… .venv/bin/python -m pytest -q --no-cov --create-db` | **0** | **4543 passed / 5 skipped** |

与 SQLite 的差是 **+20 / −20**,正好等于 `test_the_postgres_only_set_is_the_set_we_think_it_is` 名单的长度 20(含本分支新增的 1 条)。迁移 `0023` 在 PG 上正向应用无误(`--create-db` 从零迁移)。
**这仍然需要维护者在自己的 PostgreSQL 上复跑**:`cd backend && REDIS_URL=… .venv/bin/python -m pytest -q --no-cov --create-db`,
至少 `tests/test_concurrency.py tests/test_judgment_claim.py`。

### 新增测试

- `backend/tests/test_judgment_claim.py`:53 条 —— 认领 / 释放 / 改派 / 暂缓 / 撤销暂缓、结案后认领保留、批量原子性(认领与暂缓各一)、每个端点的租户隔离(单件与批量 404、计数只数本租户)、VIEWER 无余额、非中国案子余额为 null、四组互斥、分组计数(含 court / search)、搜索(名 / 灵魂 id / 案子 id / 非 UUID)、查询数(2 行 = 8 行)、审计日志里的前后值、PATCH 写不进认领列。
- `backend/tests/test_concurrency.py::TestJudgmentClaimConcurrency`:2 条(串行 1、PG-only 1)。
- `frontend/src/__tests__/useJudgmentClaims.test.ts`:13 条(并登记进 `suiteShape.test.ts`)。
