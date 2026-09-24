# 行程拓扑所需字段——realm_id 与灵魂行程 path

> ## ⚠️ 这个分支包含迁移(THIS BRANCH CONTAINS MIGRATIONS)
>
> `realms/0019`、`judgment/0023`、`judgment/0024` 三个迁移。维护者会在应用之前
> 备份共享的 PostgreSQL 测试库。**本轮任何步骤都没有连接任何真实数据库**:
> 所有命令都在 `DATABASE_URL="sqlite:///:memory:"` 与本机一次性 Redis
> (`127.0.0.1:6399`)上跑,从未触及 192.168.2.115,没有创建 `.env`。
> **因此这些迁移从未在 PostgreSQL 上跑过** —— 见文末「给维护者的问题」第 1 条。

分支 `feat/realm-path-fields`,起点 `main` @ `4e0b778`。前端不在范围内。

## 1. 契约字段:已有的与新加的

| 契约字段 | 状态 | 落在哪里 |
|---|---|---|
| `realm.id` | 已有 | `Realm.id` |
| `realm.parent_id` | 已有 | `Realm.parent_realm`(API 里叫 `parent_realm`,值是主键) |
| `realm.code` | 已有 | `Realm.realm_code` |
| `realm.is_eternal` | 已有 | `Realm.is_eternal` |
| `realm.order` | **新加** | `Realm.order`,可空 |
| `realm.kind` | **新加** | `Realm.kind`,可空,`RealmKind` = `HALL/GATE/LAYER/PATH`(标签 殿/门/层/道) |
| `realm.capacity` | **新加** | `Realm.capacity`,可空;种子不管(见下) |
| 欧洲 `level` / `sublevel` / `region` | **新加** | 三列,可空;`region` 为 `CommediaRegion` = `INFERNO/PURGATORIO/PARADISO`(标签 地狱/炼狱/天堂) |
| 埃及 `hour` / `gate` / `is_judgment_hall` | **新加** | 三列,可空(`is_judgment_hall` 是可空布尔) |
| 希腊 `fork` | **新加** | `Realm.fork`,可空,`GreekFork` = `LEFT/MIDDLE/RIGHT` |
| 希腊 parent = 审判处 | 已有列,**新数据** | `REALM_PARENTS` 加了两行:Tartarus 与至福岛挂在 `EU_PLATO_MEADOW` 下 |
| `judgment.realm_id` | **新加** | `Judgment.realm`(FK,可空,SET_NULL) |
| `disposition.realm_id` | **已有** | 就是 `Disposition.destination_realm`。**没有加新列**;API 上以只读的 `realm_id` 别名再给一次 |
| `soul.path[]` | **新加** | 新模型 `SoulPathEntry(soul, realm, sequence, entered_at, left_at, tenant)` |

没有重复的列:

- **`order` 不是 `tier`。** `tier` 是「同一 `realm_type` 内的轻重/福报名次」(`Meta.ordering`
  就是 civilization, realm_type, tier),所以 DY_01_HEAVEN、DY_00_PURGATORY 与第一殿都是
  tier 1。`order` 是路线上的先后,只给真有位置的行。对十殿两者相等,对其它行不相等。
- **`level` 与 `tier` 在九层地狱与七层平台上数值相等,别处不等**(EU_HEAVEN、EU_PURGATORY
  是 tier 1、level NULL)。它们回答的是不同的问题;若维护者认为 `level` 应该直接读 `tier`,
  见问题 3。
- **`capacity` 不是 `cycle_limit`。** `cycle_limit`(十殿上 100/80/60…)在代码里没有任何读者,
  也没有文档说明含义;它不叫容量,我没有把它当容量。见问题 4。

`SoulPathEntry` 的约束(数据库层):`(soul, sequence)` 唯一;**每个灵魂至多一条未关闭的行**
(部分唯一索引 `left_at IS NULL`);`left_at >= entered_at`。

## 2. 种子数据(`seed_mythology`)

拓扑值写在 `apps/actors/mythology/realms.py` 末尾新的 `REALM_TOPOLOGY` 表里(与 `REALM_PARENTS`
同一做法,每个取值旁边写着出处)。只有神话数据支持的行才有值,**其余一律 NULL**:

| 文明 | 有值的行 | 故意留 NULL 的 |
|---|---|---|
| 中国 | 十殿:`order` 1–10,`kind=HALL` | 待审所、杨柳宫、天堂(都不是殿,也不在「一线」上);没有 门/层/道 行 —— 小地狱在 realms/0012 已退役,六道没有种成 realm |
| 欧洲 | 九层:`region=INFERNO, level 1–9`;七层平台:`PURGATORIO, level 1–7`;地上乐园 `PURGATORIO, level 8`;EU_PURGATORY `PURGATORIO`;EU_ACHERON `INFERNO`(无 level);EU_HEAVEN `PARADISO` | `sublevel` 全空:没有任何 ring / bolgia 被种成 realm |
| 埃及 | `is_judgment_hall`:两真之殿 True,其余埃及行 False | **`hour` 与 `gate` 全空。** 这是 lore,不是遗漏:十二时是《阿姆杜阿特》的、十二门是《门之书》的,都是拉的夜行,不是死者的路(`realms.py` 在 EGYPTIAN_REALMS 上方有整段说明);死者自己的门(BD 144–147)按「两组」种,因为没有任何一扇门的名字或次序有出处 |
| 希腊 | Tartarus `fork=LEFT`,至福岛 `fork=RIGHT`,两者 `parent_realm = EU_PLATO_MEADOW` | **没有任何行取 `MIDDLE`**:中间那条(Asphodel)是现代教科书的三分,本仓库明确拒绝;草原与渡口不是路 |

左/右的出处是柏拉图《理想国》X 614c-d(正义者向右、向上,不义者向左、向下),不是画图约定。

幂等:第二次运行 `realms created=0 updated=0 unchanged=43`(测试 `test_reseeding_changes_nothing`)。
**对已存在的库**:`_upsert` 新增 `fill_if_null` —— 数据库里是 NULL 而种子有值的拓扑列,
**不带 `--update` 也会填**(与 NULL tenant、NULL parent_realm 已有的规则相同:新加的空列不是
谁的决定);数据库里是另一个非空值的,仍然要 `--update` 才覆盖。所以在已迁移的库上跑一次
普通的 `manage.py seed_mythology` 就会填上拓扑列。`capacity` 进了 `NOT_SEEDED`
(运营数据,与 `Actor.icon_url` 同理),`--update` 不会把手填的容量清掉。

## 3. 迁移

| 迁移 | 内容 | 可逆 |
|---|---|---|
| `realms/0019_realm_topology_and_soul_path` | Realm 加 10 列;建 `SoulPathEntry` 表(含上述三条约束与 `(tenant, soul)` 索引) | 是(纯 schema) |
| `judgment/0023_judgment_realm` | `Judgment.realm` FK | 是(纯 schema) |
| `judgment/0024_backfill_judgment_realm` | 由 `court` 回填 `realm` | 是(见下) |

**回填规则(0024)**:一条审判得到 realm,当且仅当同时满足——

1. `civilization = CHINESE`;
2. `realm` 仍为空(API 写过的值不覆盖);
3. `court.strip()` **逐字等于**某个殿的 `name_local`(第一殿)、`name_zh`(第一殿秦广王)或
   `realm_code`(DY_COURT_01_QINGUANG)之一 —— 这些键从库里的殿行读出,不是写死的;
4. 那个名字只属于**一个**未软删的殿(撞名的名字直接从映射里去掉);
5. 那个殿与审判在**同一个租户**。

其余全部留 NULL:`第1殿`、`秦广王`、`本殿`、`待审所`、空串、欧洲审判上的「第一殿」、别的租户
的审判……反向迁移只清掉「按同一规则会被回填」的那些行。不写 path 行:这些审判的灵魂何时站在
殿上,没有人知道;`created_at` 是立案时间,不是进殿时间。迁移里没有任何 `except`。

**种子数据里能回填几条:0。** `seed_mythology` 不建任何审判(测试
`test_the_seed_writes_no_judgments_so_the_backfill_maps_none_there` 钉住),所以在只有种子的库
上回填是空操作。映射覆盖的是 10 个殿 × 3 个名字 = 30 个字符串;在真实库上能映射多少,取决于
那里 `court` 里实际写了什么 —— **我没有、也不能查共享库**,见问题 2 给的查询。

## 4. 哪些流程写 path

`apps/realms/path.py::SoulPathService` 是唯一写者,两个动词:`enter(soul, realm)`(关掉当前那一
站、开新的一站;进同一个 realm 什么都不写)与 `leave(soul[, realm])`(关掉当前那一站)。每个
调用点都在该流程**自己的事务里**。

| 流程 | 调用点 | 写什么 |
|---|---|---|
| 立案(带 realm) | `JudgmentViewSet.perform_create` | 仅 ORIGINAL、未判决、`realm` 非空时 `enter(judgment.realm)` |
| 案子换殿 | `JudgmentViewSet.perform_update`(新增) | `realm_id` 变了、且同上条件时 `enter(新 realm)` |
| 判决 → 处置 | `DispositionService.create_from_judgment` | `enter(destination_realm)`;目的地为空时只 `leave` —— 离开法庭是确定的,去向不知道就不编 |
| 受刑计划:原属下一站 | `SentencePlanService._activate_home_node` | `enter(节点的 realm)` |
| 受刑计划:到达外地一站 | `SentencePlanService.on_dispatch_executed` | `enter(节点的 realm)`,tenant 是执行地 |
| 处置执行(刑满) | `DispositionService.execute` 的三条分支 | 非永久刑期时 `leave(soul, realm=destination_realm)`;永久刑期那一站**永远不关** |
| 转世完成 | `ReincarnationService.complete_rebirth` | `leave(soul)`(兜底:通常执行时已关) |
| 调拨执行 | `DispatchService.execute` | `leave(soul)`;到达那一站由上面 `on_dispatch_executed` 记 |
| 暂居结束 / 回归 | `DispatchService.end_residence` | `leave(soul)`(已关时什么都不写) |

**没有挂钩的流程,以及原因(不猜)**:

- **`Soul.die()` / 死亡同步 / `POST souls/{id}/die/`** —— 建的审判没有 realm,不知道灵魂在哪。
  是否应该默认进「待审所」(DY_00_PURGATORY)或 EG_DUAT_ENTRY,是设计问题(问题 5)。
- **AMENDMENT / REOPEN 审判** —— 灵魂此时在服刑的界域里;重审是否把它「带回」殿上,不知道。
- **已判决的审判改 `realm_id`** —— 那是在更正「案子在哪审的」,灵魂早已离开,不写 path。
- **手动 `POST /disposition/`(API 直接建处置)** —— 这是「补录」还是「送去」语义不明,没挂。
- **`POST souls/{id}/transition/`、`correct_settlement`、归档/软删** —— 只改状态,不涉及界域。
- **手动调拨(无受刑计划)的到达** —— 没有目的界域,只记了离开。
- **联审(CrossTenantJudgment)** —— 联审没有 realm。
- **受刑计划节点 WAITING(刑满但有未结案的审判,暂留)** —— 执行时照常关了那一站;若设计上
  「暂留」算仍在那里,需要改成不关(问题 6)。

## 5. API 形状变化

- `GET/POST/PATCH /api/v1/judgment/…`:新增 `realm_id`(可写,可空)。写入时做租户校验
  (`tenant_scoped("realm")`:别的租户的 realm → 400「No such realm in this tenant.」)。
  `court` 不变,两者互不推导。
- `GET /api/v1/disposition/…`:新增只读 `realm_id`,值即 `destination_realm`。
- `GET /api/v1/realms/{id}/`:新增 `order, kind, capacity, level, sublevel, region, hour, gate,
  is_judgment_hall, fork`。
- `GET /api/v1/realms/`(列表):新增 `parent_realm, is_eternal` 与上面 10 列 —— 官员端画整张图
  读列表,不逐个取 detail。
- **新端点 `GET /api/v1/souls/{id}/path/`**,返回 `[{id, sequence, realm_id, realm_code,
  entered_at, left_at}]`,按 `sequence` 升序,不分页;权限 `soul.read`;列入
  `residence_read_actions`。
  - **为什么是独立端点而不是 soul detail 上的字段**:path 的隔离是**按行**的,不是按灵魂的 ——
    暂居期间的那几站属于暂居地租户,要单独过一遍 `scope_to_tenant`(含暂居只读例外);放进
    soul 序列化器会让 soul 列表/详情多出查询,也会把「整个灵魂可见」误当成「每一站可见」。
  - 可见性:本租户的站;原属租户在灵魂暂居期间还能读到暂居地的站;别的租户连灵魂都是 404。
- 新 enum 名钉在 `ENUM_NAME_OVERRIDES`:`RealmKindEnum`、`CommediaRegionEnum`、`GreekForkEnum`
  (不钉的话 `kind` 会被 drf-spectacular 命名成带哈希的 `KindD0cEnum`)。
- `packages/core/openapi/schema.yml` 与 `packages/core/src/api/generated/schema.ts` 按仓库流程
  (`manage.py spectacular --file …` + `npm run schema:generate --workspace @soulledger/core`)
  重新生成并提交。

## 6. 门禁结果

环境:Python 3.11.15(`backend/.venv`,`requirements.lock` + `requirements-dev.txt`);
Node v22.22.2;`redis-server` 已安装,一次性实例在 6399(`--save '' --appendonly no`)。
每条后端命令前缀
`SECRET_KEY=ci-test-key-not-for-production DEBUG=true DATABASE_URL="sqlite:///:memory:"
REDIS_URL=redis://127.0.0.1:6399/0 CELERY_BROKER_URL=redis://127.0.0.1:6399/1
CELERY_RESULT_BACKEND=redis://127.0.0.1:6399/2`。

所有数字都在提交 `2c7fca5` 之后的树上重跑(不是改动前的绿)。

| 门禁 | 命令 | 退出码 | 结果 |
|---|---|---|---|
| 后端全量 | `cd backend && <前缀> .venv/bin/python -m pytest --tb=short -q` | **0** | **4501 passed, 24 skipped**,覆盖率 93.64%(门槛 80) |
| 其中新文件 | `tests/test_realm_path_fields.py` | 0 | 32 passed |
| ruff | `cd backend && <前缀> .venv/bin/ruff check .` | **0** | All checks passed! |
| makemigrations | `cd backend && <前缀> .venv/bin/python manage.py makemigrations --check --dry-run` | **0** | No changes detected |
| drf-spectacular | `manage.py spectacular --file …` | 0 | **0 warnings / 0 errors**;重新生成的 YAML 与提交的逐字节相同(`cmp`) |
| schema 门禁(后端) | `tests/test_committed_schema_matches_the_backend.py`、`test_schema_has_no_warnings.py`(在全量里) | 0 | 通过 |
| `npx -y npm@11 ci` | 仓库根 | 0 | 装完 `npm rebuild …`,`git checkout -- package-lock.json` 还原锁文件 |
| core typecheck | `npm run --workspace packages/core typecheck` | **0** | — |
| core lint | `npm run --workspace packages/core lint` | **0** | — |
| core test(含 `generatedSchemaIsCurrent`) | `npm run --workspace packages/core test` | **0** | 12 files / **118 passed** |
| 额外:frontend tsc | `cd frontend && npx tsc --noEmit` | 0 | — |
| 额外:enum 与 schema 一致 | `cd frontend && npx jest src/__tests__/enumsMatchTheSchema.test.ts` | 0 | 15 passed |

Node 用的是 v22.22.2(机器上没有 20.19.5;CLAUDE.md 记录 v22 下这两道门禁同样是绿的)。

**第一次全量跑(提交前)是 3 failed / 4466 passed**:两条 schema 测试失败,因为那个进程启动时
`ENUM_NAME_OVERRIDES` 还没加(`kind` 撞名 → `KindD0cEnum`);第三条是
`test_tenant_scoping_contract.py::test_declared_residence_actions_match_the_contract_exactly`
—— 新的 `path` 动作进了 `residence_read_actions`,契约表要同步写上它与理由,已补。上表是补完之后的重跑。

### 变异证明(新检查必须能红)

每次改一处、跑相关测试、看它红、再还原(`diff` 确认还原):

| 变异 | 结果 |
|---|---|
| path 端点去掉 `scope_to_tenant`(裸 queryset) | 红 2:`test_the_path_endpoint_shows_this_tenants_stops_only`、`test_while_residing_the_home_tenant_reads_the_stop_abroad` |
| 回填去掉租户检查 | 红 1:`test_backfill_maps_exact_court_names_and_nothing_else` |
| 回填改成子串匹配 | 红 2:上一条 + `test_backfill_drops_a_name_two_courts_share` |
| 回填去掉 `civilization` 检查(`resolve` 与 queryset 两处都去) | 红 2:`…maps_exact…`、`…reverse_clears_only_what_forward_set` |
| 回填只去掉 `resolve` 里那一处 civilization 检查 | **不红** —— queryset 已经按 `civilization=CHINESE` 过滤,`resolve` 里那句是冗余的第二道;如实记录 |
| 执行处置时不管永久刑期 | 红 1:`test_an_eternal_sentence_is_never_left` |
| 判决时不写 path | 红 2:`test_a_verdict_moves_…`、`test_an_unrouted_verdict_…` |

**没有被变异证明的**:`test_a_refused_conclusion_leaves_no_path_behind`(结案被拒时 path 一起
回滚)。在这份代码里我构造不出「path 写在事务外」的变异 —— 外层 `conclude_judgment` 本身就是
`atomic()`。这条测试守的是现状,不是被证明能红的检查。

## 7. 给维护者的问题

1. **PostgreSQL。** 三个迁移只在 SQLite 上跑过(含 `judgment/0024` 的真 `migrate` 往返测试)。
   部分唯一索引(`left_at IS NULL`)与 CHECK 约束在两边语义相同,但按 CLAUDE.md,事务与约束
   相关的改动应在备份后的 115 测试库上再跑一次 `pytest --create-db`。
2. **真实库能回填多少?** 应用前可以这样数(只读):
   `Judgment.all_objects.filter(civilization="CHINESE", realm__isnull=True).exclude(court="")
   .values("court").annotate(n=Count("id"))`,对照十殿的 `name_local` / `name_zh` / `realm_code`。
3. `level` 在九层与七层平台上与 `tier` 数值相同。要不要干脆让 API 的 `level` 读 `tier`,去掉这一列?
   我保留为独立列,因为 `tier` 在同一文明的别的行上意思不同。
4. `cycle_limit`(十殿 100/80/…/10)是什么?没有读者、没有文档。若它其实就是「容量」,`capacity`
   就是重复列,应删一个。
5. 死亡(`die()`)时灵魂在哪?要不要默认进 DY_00_PURGATORY / EG_DUAT_ENTRY / GR_ACHERON /
   EU_ACHERON?这决定 path 的第一站。
6. 受刑计划节点 WAITING(刑满暂留)时,path 现在关了那一站。设计上「暂留」算不算仍在那里?
7. AMENDMENT / REOPEN 审判,以及手动 `POST /disposition/`,要不要写 path?
8. 希腊 `parent_realm` 的含义被放宽了:此前它只表示「是…的一部分」(平台之于山),现在
   Tartarus/至福岛挂在草原下表示「从…分岔出去」。这是契约要求的,但若有代码把 `sub_realms`
   读作「组成部分」,会受影响(目前仓库里没有这样的读者)。
9. `kind` / `region` / `fork` 的存储值用的是英文大写(`HALL`、`INFERNO`、`LEFT`),中文在标签里 ——
   与本仓库其余 TextChoices 一致;若设计稿要的是字面「殿/门/层/道」,告诉我。
10. `MIDDLE` 留在了 enum 里但没有任何行用它(Asphodel 被本仓库拒绝)。要不要从 enum 里去掉?
