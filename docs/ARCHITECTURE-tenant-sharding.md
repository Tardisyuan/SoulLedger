# 租户分片方案 —— 规划稿

> **状态:规划稿,不实施。** 用户 2026-10-09 决定「只出方案文档,不动代码」。
> 文中「现状」每条事实都在 `989263ed` 上查过:模型数用 Django 元数据实数(`apps.get_models()`,
> 排除 auth / contenttypes / sessions / admin / celery-beat / token_blacklist),引用带 `文件:行`。
> **没有量过的东西写「未量」**:这台机器上没有生产(见项目记忆 `shared-box-115`),仓库里没有任何
> 真实负载数据,所以第 3 节的触发条件是「要量什么、量到多少」,不是「已经量到了」。
> 与 `docs/ARCHITECTURE-soul-app-and-domain-split.md`(下称「域拆分稿」)的关系见第 0 节。

## 0. 先对齐一件事:用户已经选过第 3 档

域拆分稿文首「决策记录(2026-09-14)」写明:**四个地区不受数据法规约束,但仍选第 3 档(按租户分库)**
(`docs/ARCHITECTURE-soul-app-and-domain-split.md:12-13`),与同稿第 7 节「第 3 档唯一触发条件是法规」
(`:281`)不同,「以此为准」。2026-09-17 补充又定:灵魂端先在单库上做,「按租户分库另起一轮;
但新代码按分库约束写(新表 UUID 主键、不加跨租户外键、跨文明动作走事件)」(`:31` 一带)。

所以本稿**不是**重新问「要不要拆」,而是回答三件事:

1. 「按租户分库」到底会弄坏什么,实数是多少(第 1、2 节);
2. 在没有法规、没有量过的负载的前提下,**什么时候**该真正动手(第 3 节);
3. 动手的话怎么走、先要有什么(第 4 节)。

结论先说(细节见第 3 节):**现在不拆。** 已落地的「分库约束」(UUID 主键、受刑计划用 `tenant_code`
字符串)继续守;真拆之前先补第 4 节那几道守卫。这与 2026-09-14 的决定不矛盾 —— 那个决定定的是
**终点**,本稿定的是**何时出发**。若用户的意思是「现在就要出发」,第 6 节第 1 问请直接说。

## 1. 现状(实测)

### 1.1 隔离是怎么做的

- **隔离全在视图层,数据库一层没有。** `TenantManager.get_queryset` 只加 `is_deleted=False`,
  不按租户过滤(`backend/apps/tenants/managers.py:1-30` 文件头自述;`apps/core/tenant.py:12-17`)。
  忘了过滤的 `get_queryset()` 返回的是**所有租户的行**,不是空页。
- **唯一入口 `scope_to_tenant`**(`apps/core/tenant.py:57`):未登录 → `qs.none()`;`role == "ADMIN"`
  整个跳过(`:96`);没有解析出租户 → `qs.none()`(失败即关);否则 `qs.filter(tenant=...)`。
  全后端 `scope_to_tenant(` 调用 46 处,`is_tenant_exempt(` 33 处(grep,排除测试)。
- **租户从 JWT 来**:登录时把 `user.tenant.code` 抄进 `tenant_code` 声明(`apps/authentication/serializers.py:251`),
  `TenantMiddleware` 解出来放 `request.tenant` 并写 contextvar(`apps/tenants/middleware.py:31-35`、`:84`)。
  contextvar 的用途只有一个:让审计信号知道写入属于谁(`apps/audit/signals.py:374-375`)。
- **唯一的守卫是一份契约测试**:`tests/test_tenant_scoping_contract.py`(644 行)遍历所有路由注册的
  viewset,模型带租户列而 queryset 没经过 `scope_to_tenant` 就红;另钉着暂居读 / 写例外的清单
  (`:130` `RESIDENCE_READABLE`、`:602` `RESIDENCE_WRITABLE`)。

### 1.2 租户相关模型的实数

76 个应用模型(排除上述内置)。其中:

| 类别 | 数 | 说明 |
|---|---|---|
| 直接带 `Tenant` 外键 | **39** | 44 条租户外键列:`Soul` 两条(`tenant`、`home_tenant`)、`DispatchRecord` 三条(`source_tenant`、`target_tenant`、`tenant`)、联审与参与方各两条 |
| 不带租户列 | **37** | 其中 **16 个经父表间接属于某租户**(`SentenceNode`→`SentencePlan`、`PostMedia`→`Post`、`SoulAccount`/`PushDevice`/`ChatIdentity`/`InitialCredential`/`RebirthApplication`…→`Soul` 等);其余 21 个不属于任何租户,其中**真全局**的有:`Tenant`、`Menu`、`MenuButton`、`Permission`、`DataScope`、`Role`、`RolePermission`、`RowLevelDataScope`、`FieldPermission`、`UserNotification`、`NotificationEmail`、`JudgmentCaseCounter`、`UserProfile`、`HelpChunk`,另有 `LoginLog`、助手的会话 / 消息 / 配置 / 评测各表 |
| 租户外键列可空 | 27 列 | 含 `Soul.tenant`、`Judgment.tenant`、`User.tenant`:「无租户」是合法状态 |
| 租户外键 `PROTECT` | 3 | `SoulEvent`、`AuditLog`、`chat.Conversation`:租户行删不掉 |

两个会让「拆库」变难的**横切事实**:

- **`User` 是全局身份,所有表都指它。** 57 个模型有指向 `User` 的外键;40 个模型继承 `AuditUserFields`
  (`apps/core/models.py:11`,带 `create_user` / `update_user` / `deleted_by`);39 个带租户的模型里 34 个指向 `User`。
  `User.tenant` 可空(`authentication/models.py:132`)。
- **灵魂是第二个枢纽。** 19 个模型指向 `Soul`,其中账号、推送、聊天身份、转生申请、冷却申请
  不存租户列,「租户经 `soul__home_tenant`」一跳取得(`apps/soul_accounts/models.py:7`、`:100`)。
  `Soul.tenant` 是**暂居地**,`Soul.home_tenant` 是原属(`apps/core/tenant.py:124-131`)。

**全局唯一约束**(拆库后都得换成别的办法保证):`Tenant.code`(`tenants/models.py:14`)、
`Realm.realm_code`(`realms/models.py:91`)、`Soul.soul_code`(`souls/models.py:295`,即**灵魂登录名**)、
`Judgment.case_number`(`judgment/models.py:117`)、`User` 邮箱在存活行间唯一(`authentication/models.py:187`)。

### 1.3 跨租户的查询与功能(逐条)

| # | 功能 | 位置 | 跨在哪 |
|---|---|---|---|
| 1 | **调拨(暂居)执行** | `dispatch/services.py:375-382` | 单个 `transaction.atomic` 内 `select_for_update` 锁灵魂,改 `soul.tenant`;提案 / 批准 / 执行各自的锁在 `:146`、`:180`、`:307`、`:435`。双方租户在**同一事务**里 |
| 2 | **暂居结束(回原属)** | `dispatch/services.py:457-527` | 锁灵魂与调拨记录,`tenant_id = home_tenant_id` |
| 3 | **调拨记录的可见性** | `dispatch/views.py:172-179` | `Q(source_tenant=t) \| Q(target_tenant=t)`:一张表,两边都能读 |
| 4 | **跨文明联审** | `dispatch/services.py:637-943` | 参与方的 `participant_tenant` / `participant_actor` 指向别的租户;提交刑罚、`activate`、`conclude` 都在同一库里锁联审行(`:758`、`:804`、`:915`) |
| 5 | **暂居只读例外** | `core/tenant.py:105-215` | `Q(tenant=t) \| Q(soul__home_tenant=t, tenant=F(soul__tenant))`:查询谓词里**同时引用两个租户**;`residence_read_actions` 清单钉在契约测试 |
| 6 | **暂居写例外(唯一一条)** | `core/tenant.py:218-238`、`sentence_plan/requests.py::_open_reopen_judgment` | 原属租户对外地灵魂开「重开审判」 |
| 7 | **受刑计划** | `sentence_plan/models.py:5`、`:76`、`:119`、`:184` | 计划归原属,节点用 `tenant_code` 字符串、请求用 `from_tenant_code`;**这是已按分库约束写的那一块**,但读它仍靠同库 JOIN(`sentence_plan/views.py:43`、`:117-122`) |
| 8 | **ADMIN 全局** | `is_tenant_exempt` 33 处,典型:`ledger/views.py:378-401`(全租户概览)、`audit/views.py:145`、`core/recycle_bin_views.py:166-227`(回收站)、`dispatch/views.py:64`、`:172`、`:219`、`:533`、`:660` | `scope_to_tenant` 整个跳过。**反例**:`ledger/views.py:429`、`:764` 与 `death_sync/views.py:290-299` 刻意 `admin_bypass=False`(ADMIN 也只看自己那一殿) |
| 9 | **死亡同步** | `death_sync/views.py:109-173`(按 API key 划界,`scope_to_api_key`,`core/tenant.py:241`) | 调用方是机器,不带 JWT;租户来自 `ExternalApiKey.tenant`。登记后自动开灵魂账号(跨 `soul_accounts`) |
| 10 | **朋友圈** | `social/views.py:103`、`:250`、`:302`(`scope_to_tenant`);写侧 `social/serializers.py:171-193` 显式拒跨租户引用 | 帖子 / 评论 / 点赞 / 关注都带租户列,**灵魂朋友圈本文明内**;但见 11 |
| 11 | **私聊不看文明** | 域拆分稿 2026-09-19 节;`chat/views.py:377`(`User.objects.filter(pk=...)` 不按租户)、`POST /me/chat/lookup/` | 任意两个灵魂可聊,按完整灵魂编号**跨文明**精确查找。聊天本体在 Synapse,库里只有 `Conversation` / `ChatIdentity` |
| 12 | **官员助手** | `soul_assist/officer_tools.py:44-48`、`corpus.py:142-145` | ADMIN 跨「开了助手的殿」读 |
| 13 | **定时任务扇出** | `Tenant.objects.filter(is_active=True)` 在 `disposition/tasks.py:21`、`death_sync/tasks.py:19`、`judgment/tasks.py:34`、`ledger/tasks.py:31`;`for_tenant` 里 `set_current_tenant` | 总任务读租户表,子任务按 id 取租户。共 13 个 `tasks.py` / 39 个 `shared_task`;名称不带 `for_tenant` 的(如 `events.deliver_webhook`、`soul_push.sweep`、`chat.reconcile_inbox`)是否读全库,本稿未逐个核对 |
| 14 | **WebSocket** | `notifications/consumers.py:98-107`、`:197-200`;`events/handlers/websocket_handler.py:56-57` | 用户组 + 租户组(`rt:tenant:{code}`),靠 channel layer(Redis)广播;认证用 `user.tenant` |
| 15 | **权限缓存** | `perm/cache.py:79-86` | key 是 `{prefix}perm:{role}:{codename}`,**不含租户**。角色全局,所以这是对的 —— 但意味着它是**共享状态**,拆库后须决定放哪 |
| 16 | **审计** | `audit/signals.py:361-383`、`:426-438`;`AuditLog.tenant` 是 `PROTECT` | 写入时取 contextvar 租户;ADMIN 读全部(`audit/views.py:145`) |
| 17 | **事件 / webhook** | `events/tasks.py:26`、`:116`;`SoulEvent.tenant`(`PROTECT`) | 事件按租户写,投递任务读全库 |

小结:**真正「一个事务里同时碰两个租户的行」的只有 1、2、4、6 四处**(调拨、回原属、联审、重开审判);
其余是「读时跨租户」(3、5、7、8、12)和「全局身份 / 全局唯一」(9、11 与 1.2 的约束)。
这个分布决定了后面每个方案的难度。

### 1.4 测试与门禁的现状(与分片直接相关)

- 后端测试跑在 **SQLite 内存库**,真 PostgreSQL 是另一条手动命令(`CLAUDE.md` Build & Test)。
  SQLite 没有 schema、没有 RLS、没有多库的事务语义;`tests/test_concurrency.py` 里 4 条 `skipif(SQLITE)` 的
  测试是**唯一**真正检验 `select_for_update` 的东西。
- 提到 tenant 的测试文件 297 个(`tests/`、`apps/*/tests*`,grep);`tests/*.py` 336 个;迁移文件 338 个。
- 池化方面:`config/settings.py:175-184` 单一 `default` 库,无 `DATABASE_ROUTERS`,无副本配置(grep 全空)。
  域拆分稿推荐的「第 2 档:读走副本」**还没有落地**。

## 2. 备选方案:各自弄坏什么

下表先给总览,后面逐个展开。「弄坏」按 4 类标:
**无** = 不受影响;**改** = 要改代码但语义不变;**重做** = 语义变了;**不可行** = 做不到。

| 维度 | (a) 共库 + RLS | (b) 每租户一个 schema | (c) 每租户一个库 / 分片组 | (d) 业务域拆分(租户作次键) |
|---|---|---|---|---|
| 调拨 / 回原属(1、2) | 无 | 无(跨 schema 同库,事务照常) | **重做**:Saga + 补偿 | 无 |
| 跨文明联审(4) | 无 | 无 | **重做** | 无 |
| 重开审判写例外(6) | 改(策略要放行) | 无 | **重做** | 无 |
| 暂居只读例外(5) | **改**:策略要写成两租户 | 改:要跨 schema 查询 | **重做**:跨库 JOIN 不存在 | 无 |
| ADMIN 全局(8) | 改:ADMIN 走绕过角色 | 改:search_path 要含全部 schema | **重做**:扇出到每个库再合并 | 无 |
| 报表 / 概览(`ledger/views.py:378-461`) | 无 | 改:UNION 各 schema | **重做**:聚合层 | 无 |
| 迁移 | 无 | **改**:每个 schema 各跑一遍 | **改**:每个库各跑一遍 | 无(核心库一份) |
| 测试套件 | **改**:SQLite 测不了 | **改**:SQLite 不支持 schema | **改**:多库 + 事务测试全重写 | 无 |
| Celery 扇出 | 无(已是扇出形状) | 无 | 改:任务带库路由 | 无 |
| 全局唯一(`soul_code` 等) | 无 | 无(同库可用全局表约束) | **重做**:要号段或中心登记 | 无 |
| 用户 / 审计字段外键(57 个模型指 `User`) | 无 | 无(`User` 放公共 schema,跨 schema 外键合法) | **不可行**:跨库无外键 | 无 |
| 解决什么 | 防**漏过滤**的缺陷 | 防漏过滤 + 单租户备份 / 恢复 | 防漏过滤 + 容量 + 驻留 + 故障域 | 解决**灵魂读与聊天**的容量 |
| 不解决什么 | 容量、驻留 | 容量、驻留、故障域 | — | 漏过滤、驻留 |

### 2.1 (a) 共库、行级如现状,外加 PostgreSQL RLS

**做法:** 每张带租户的表 `ENABLE ROW LEVEL SECURITY`,策略 `tenant_id = current_setting('app.tenant')`;
连接上用事务级 `SET LOCAL app.tenant`(中间件与 Celery 的 `set_current_tenant` 已有挂钩点,`tenants/middleware.py:31`、
各 `*_for_tenant` 任务)。这是对 1.1 里「数据库一层没有」的**补一层兜底**,不是分片。

**弄坏什么 / 要做什么:**

- **暂居只读例外要写进策略。** 5 号功能的谓词引用两个租户(`core/tenant.py:208-215`),RLS 策略得把同一个
  `Q` 用 SQL 重写一遍 —— 于是「应用层一份、数据库一份」两份真相,必须有测试让它们对拍。
- **调拨 / 联审:** 单事务里要同时可见两个租户的行,`app.tenant` 要变成**集合**(`app.tenants = 'a,b'`)或
  对这类表放行。策略复杂度主要在这里。
- **ADMIN 全局:** 用一个绕过 RLS 的数据库角色,或 `app.is_admin`。33 处 `is_tenant_exempt` 要对应。
  `admin_bypass=False` 的 3 处(1.3 第 8 条)是反例,策略必须能表达「ADMIN 也只看自己那一殿」。
- **连接池:** 只能用事务级 `SET LOCAL`;会话级 `SET` 在 pgbouncer 事务池模式下会串租户。
  当前 `DISABLE_SERVER_SIDE_CURSORS` 已有开关(`settings.py:184`),说明已经考虑过 pgbouncer。
- **测试:** SQLite 完全无法检验。`CLAUDE.md` 已经写了「SQLITE HIDES A WHOLE CLASS OF DEFECT」,RLS 是又一类。
  所以 RLS 的守卫**只能**在真 PG 那条路径上跑,并且要有一个「故意不设 `app.tenant` 应当查不到任何行」的测试。
- **迁移:** 加策略的迁移要 `RunSQL`,且不能是 `except: pass`(`CLAUDE.md` 记录的 `perm/0017` 事故)。
- **Celery 扇出 / WS / 权限缓存 / 审计:** 不变。

**得到什么:** 把「漏过滤」从「数据泄漏」降成「查不到」。契约测试仍要留(它抓的是**开发期**漏写,RLS 抓的是**运行期**)。
**没得到:** 任何容量、驻留、故障域。

### 2.2 (b) 每租户一个 PostgreSQL schema(`django-tenants` 一类)

**做法:** 公共 schema 放全局表(权限 / 菜单 / 租户本表等真全局表 + `User` + 灵魂?见下),每个租户一个 schema 放其余,
请求进来 `SET search_path`。

**为什么看起来合适:** 同库内跨 schema **可以有外键、可以做事务**。所以调拨、联审、`select_for_update`
的语义全部保持 —— 这是它相对 (c) 的唯一大优势。

**弄坏什么:**

- **灵魂放哪?** 灵魂会在租户间移动(`soul.tenant` 被改,`dispatch/services.py:382`)。放租户 schema =
  移动要 `INSERT … SELECT` 再删;放公共 schema = 灵魂不再属于租户 schema,19 个指向它的模型各自要决定。
  现在的设计是**改一列**,schema 方案把它变成**搬行**。这是 (b) 最大的结构性代价。
- **迁移:** 338 个迁移文件 × 租户数。四个租户时是 4 倍时间,线性可接受;但租户数涨起来就不是了。
  `makemigrations --check` 门禁不变,迁移执行门禁要新增「每个 schema 都到最新」。
- **`User` 与 57 个指向它的外键:** `User` 放公共 schema,跨 schema 外键合法,无问题。但 `User.tenant` 还在 ——
  schema 方案里它是**路由键**而不是过滤键,语义变了,`TenantMiddleware`(`middleware.py:48-61`)要改成选 schema。
- **ADMIN 全局:** `search_path` 要包含所有租户 schema,同名表按顺序遮蔽 —— **危险**:漏写 schema 前缀会静默读到第一个租户。
  ADMIN 跨租户读要显式 `UNION ALL`,或循环切换。
- **测试:** SQLite 不支持 schema。要么整套测试迁到 PG(慢:CLAUDE.md 记录真 PG 全量要经过到 115 的网络),
  要么放弃测 schema 路径。这是 (b) 的第二大代价。
- **没有驻留、没有容量收益**:仍是一个库实例。
- **Celery:** 已是扇出形状,子任务进入时切 schema 即可,改动小。

### 2.3 (c) 每租户一个库,或几个租户一个分片组,用 Django DB router 路由

**这就是 2026-09-14 选的第 3 档。** 代价域拆分稿第 4 节已列(`:154-170`),这里给**实数**和**逐项后果**:

- **跨库没有外键。** 57 个模型指向 `User`;40 个继承 `AuditUserFields`。若 `User` 放控制库,所有租户库里的
  `create_user_id` / `update_user_id` 只能是**裸 UUID/整数**,失去引用完整性与 `select_related`。
  若 `User` 复制到每个租户库,则登录名唯一(`Soul.soul_code`、邮箱)失去全局保证。**这条没有第三种办法。**
- **44 条租户外键列中**,指向「别的租户库里的行」的是:`DispatchRecord.source_tenant/target_tenant`、
  `CrossTenantJudgment.initiating_tenant`、`CrossTenantJudgmentParticipant.participant_tenant`、`Soul.home_tenant`
  —— 5 列。`Tenant` 本表放控制库,这 5 列退化成「租户代码」字符串即可(受刑计划已经这么做了,`sentence_plan/models.py:119`)。
  真正难的不是外键列,是**事务**:
- **调拨(1、2):** 现在是一个事务里改 `soul.tenant` 并写调拨记录。分库后 = 源库删 / 标记灵魂及其 19 类关联行、
  目标库建,中间任何一步失败都要补偿。灵魂的账号链(`SoulAccount`、`InitialCredential`、`PushDevice`、`ChatIdentity`)
  随灵魂搬。**「一个灵魂同一时刻只属于一个租户」(域拆分稿 `:293`)的不变式从数据库约束变成协议约束。**
  但注意:**调拨是「暂居」,不是迁籍**(域拆分稿 2026-09-17 节)—— 原属不变,所以搬的是「暂居副本」。
  这把难度降了一档:灵魂记录的主人始终是原属库,暂居地只持有受刑计划与处置的**执行记录**。
  这也是受刑计划把节点做成 `tenant_code` 字符串的原因(`sentence_plan/models.py:5`)。
- **联审(4):** 多个库的参与方共同决定一件案子。需要一个**协调者库**(发起租户)持有联审行,参与方通过事件提交各自那一站。
  `submit_sentence` / `activate` / `conclude` 三处的行锁(`dispatch/services.py:804`、`:881`、`:915`)变成单库内锁 +
  跨库幂等消息。
- **暂居只读例外(5):** 谓词 `Q(soul__home_tenant=t, tenant=F(soul__tenant))` **没有等价物** —— 原属库看不到暂居地库里的行。
  只能改成「暂居地把关键行异步复制回原属库的只读视图」或「原属请求时由应用层去暂居库取」。
  它对应域拆分稿的「灵魂读走副本」,不是免费的。
- **ADMIN 全局(8):** 每个全局视图(概览 `ledger/views.py:378-461`、审计列表、回收站、助手)要扇出到所有库再合并。
  分页与排序跨库合并要重写。
- **全局唯一:** `soul_code`(灵魂登录名)、`case_number`、`realm_code`、邮箱。要么号段分配(每库一段),要么控制库登记。
  `JudgmentCaseCounter`(真全局表之一)已经是一个计数器,可以复用思路。
- **迁移:** 每库一份,顺序与失败回滚要有编排。338 个迁移 × 库数。
- **测试套件:** 最重的一块。SQLite 内存库做不了多库 + 跨库事务;`pytest-django` 的 `databases=` 支持多库,但
  297 个提到租户的测试文件里,涉及跨租户的都要重写。契约测试 `test_tenant_scoping_contract.py` 的前提(一个库里一个 `tenant` 列)变了。
- **Celery 扇出(13):** 已经是「总任务→子任务按租户」形状,这是**已有的好处**:子任务入口加 `using=` 路由即可。
  但读全库的几个(`events.deliver_webhook`、`soul_push.sweep`、`chat.reconcile_inbox`)要改成逐库循环。
- **WS(14):** channel layer 是 Redis,按 `rt:tenant:{code}` 分组 —— 与库无关,**不变**。
  但 `_authenticate_token` 取 `User` 的库要对。
- **权限缓存(15):** 角色全局,缓存 key 无租户,**不变**;缓存本身放控制面。
- **审计(16):** 每库一张 `AuditLog` 还是汇总到控制库?`AuditLog.tenant` 是 `PROTECT`。ADMIN 读全部 = 扇出。

**得到什么:** 容量(每库独立)、故障域(一个库挂不影响另一个)、驻留(若将来需要)、单租户备份 / 恢复。
**代价:** 上面每一条。粗估(**不是实测**):1.3 表里 17 项中 10 项要重做或大改,测试套件要大改。

### 2.4 (d) 域拆分稿的方案,租户作为次键

即域拆分稿第 4、7 节「第 2 档」:核心账本维持单主库(+ 副本),**灵魂读走副本 + 缓存,聊天独立,通知事件驱动**,
租户只是每个域内的分区键。

- 它**不改**1.3 的任何一项跨租户功能(核心库仍是一个事务),所以第 2 节表格这一列几乎全是「无」。
- 它解决的是域拆分稿第 3 节判断出的增长点:**灵魂读与聊天写**。聊天已经独立(Matrix / Synapse),
  是本方案中**已经落地**的一块(`docker-compose.yml` 的 `synapse` 服务,域拆分稿 `:245`)。
- **还没落地的:** 副本与缓存(`settings.py` 无副本、无 `DATABASE_ROUTERS`)、`/me/` 的读副本路由、事务性 outbox
  (事件总线是 `on_commit` 发布 + `EventWebhookDelivery` 投递记录,域拆分稿 `:174`)。
- **它不解决:** 漏过滤(仍是视图层)、驻留。所以它和 (a) 是**叠加**关系:(d) + (a) 是最便宜的组合。

## 3. 建议

### 3.1 一句话

**现在不分片。** 选 **(d) 作为容量方案,按需叠加 (a) 作为兜底,把 (c) 留作有明确触发时才走的终点**;
(b) 不推荐 —— 它既不给容量也不给驻留,却要付灵魂搬行与测试迁 PG 两项重代价。

### 3.2 为什么不是「现在」

1. **没有量过任何负载。** 仓库里没有生产,没有 QPS、行数、慢查询的真实读数;现有数字都是测试套件的(2026-10-03 记录:SQLite 5963 条后端、
   227 个前端 suite),那是代码量不是流量。拆分的收益(容量)没有被证明需要。
2. **2026-09-14 决定里「第 3 档」的理由是产品形态**(Matrix 联邦与分库同形),不是容量或法规。
   那个理由在**聊天**上已经兑现一半(单 homeserver 跑通,联邦留后),核心账本不需要为它先拆。
3. **拆分代价集中在最近新增的功能上。** 暂居只读 / 写例外(1.3 第 5、6 条)、受刑计划、私聊跨文明查找都是
   2026-09-18 到 2026-09-19 之后加的 —— 它们让「跨租户」变深了,不是变浅了。现在拆,这几块要连同重做;
   再等一段,待它们稳定、测试完整,拆的是一个更确定的目标。
4. **已有的最便宜的保险已经买了:** UUID 主键、受刑计划不加跨租户外键、`tenant_code` 字符串。继续守比提前拆便宜。

### 3.3 触发条件(任一满足,则进入下一档;每条都要**量**,下面写怎么量)

| 触发 | 阈值(**建议值,待用户确认**) | 怎么量 | 进入哪一档 |
|---|---|---|---|
| **只读压力** | 灵魂 `/me/` 读让主库 CPU 持续 > 60%,或 `/me/` p95 > 500 ms,持续一周 | APM / `pg_stat_statements`;当前**未量** | 先 (d):副本 + 缓存,**不分库** |
| **聊天写压力** | Synapse 自带库写入 / 磁盘成为瓶颈 | Synapse 指标 | (d) 的聊天独立库(已独立),扩 Synapse,不动核心库 |
| **单表体量** | 任一租户相关表 > 约 1 亿行,或主库 > 约 1 TB,以致备份 / 迁移窗口超过可接受 | `pg_total_relation_size`;当前**未量** | 先分区(按租户的 PG 声明式分区),再考虑 (c) |
| **一个租户拖垮其他租户** | 某殿的批量导入 / 报表让其他殿 p95 翻倍,且限流 / 队列隔离无效 | 按租户的查询耗时分位 | (c) 把该租户单独拆出去(分片组),**只拆这一个** |
| **数据驻留法规 / 合同** | 任何一个客户或地区要求个人数据只存当地 | 法务确认,不是工程量 | 直接 (c);域拆分稿第 7 节的原条件 |
| **故障域要求** | 合同要求一个殿故障不影响其他殿(SLA 级别) | 合同文本 | (c) |
| **漏过滤事故** | 再出现一次线上跨租户读到别殿数据(`CLAUDE.md` 记录的 M15 审计曾发现 4 个 CRITICAL) | 事故复盘 | 先 (a) RLS,**不是**分库 |

读法:**驻留、故障域是 (c) 的充分理由;容量不是** —— 容量先吃 (d)。漏过滤的正确回应是 (a),因为分库是用最贵的办法解决一个
RLS 能解决的问题。若用户坚持「终点就是 (c)」,上表只是定出发时机。

### 3.4 现在就值得做的、不算分片的小事(**仅建议,本稿不做**)

- **把「跨库外键清单」做成测试。** 域拆分稿第 7 节说「维护一份跨租户外键 + 全局表清单」,但仓库里没有这份清单的执行机制
  (`CLAUDE.md` 与契约测试里没有)。一个测试:枚举所有指向 `Tenant` / `Soul` / `User` 的外键,与一份已批准的名单对拍,
  新增不在名单上就红。1.2 的数字(44 / 57 / 19)就是它的初值。
- **新代码继续守分库约束**(UUID、不加跨租户外键、跨文明动作走事件)。
- **(a) RLS 的原型**只在真 PG 路径上、对 2~3 张表(如 `Post`、`Comment`)试,量一量对查询的影响。**不进主线。**

## 4. 如果要分片:路径、回滚、先决守卫

以下以 (c) 为目标(用户 2026-09-14 的选择),(a) 作为第 0 步。

### 4.1 先决守卫(没有它们不要开工)

| # | 守卫 | 现状 | 缺什么 |
|---|---|---|---|
| G1 | **跨库外键清单测试**(3.4 第一条) | 无 | 新写;初值见 1.2 |
| G2 | **读 / 写路由全覆盖测试**:任何查询必须带租户或显式标 `global` | 契约测试只管 viewset 的 queryset(`test_tenant_scoping_contract.py`),不管 service 层、Celery、signal | service 层 `Soul.all_objects.select_for_update(...)`(`dispatch/services.py:376`、`:448`、`:475`、`:547`)全是绕过 manager 的直取 |
| G3 | **真 PG 多库测试通路** | SQLite 单库为主;真 PG 单库那条是手动 | 要一条自动的多库 CI 通路,否则跨库事务无人检验 |
| G4 | **跨库调拨 Saga 的模型检查**:每一步失败注入,断言「一个灵魂同一时刻只属于一个租户」 | 现有的是单事务并发测试(`test_concurrency.py` 4 条) | 新写 |
| G5 | **全局唯一性的跨库证明**:`soul_code`、`case_number`、邮箱 | 数据库约束 | 号段或登记表 + 测试 |
| G6 | **ADMIN 汇总等价测试**:分库后全局概览 = 分库前同一份数据的概览 | 无 | 夹具:同一份数据装进单库与多库,对拍 |
| G7 | **影子读 / 双写对账工具** | 无 | 见 4.2 |

**2026-10-09 已落地(单库上就能做的三道;G3、G4、G6、G7 仍待,因为要多库才有意义):**

- **G1 完成** —— `backend/tests/test_fk_inventory_across_tenants.py`,清单 `tests/tenancy_fk_inventory.py`。
  从 `apps.get_models()` 推导,80 个应用模型(排除内置),其中 39 个带租户列。钉住 **198 条边**
  (44 条租户外键列、47 条指向 `User` 的非审计外键、49 条「租户内模型 → 租户内模型」即**可能跨租户**的外键、
  7 条租户内 → 无租户列、21 条无租户列 → 租户内父表、28 条无租户列之间、2 条 M2M),外加 `AuditUserFields`
  的 40 个模型(每个 3 列,共 120 列,按模型清单钉住)。每条有一行理由;新增、消失、类别变化(给模型加 / 去租户列)都红并点名。
- **G2 完成** —— `backend/tests/test_unscoped_query_sites_are_declared.py`,清单 `tests/tenancy_unscoped_sites.py`。
  AST 扫 `apps/` 与 `config/` 非测试代码里的 `X.all_objects` / `._base_manager` / `._default_manager` / `Tenant.objects`。
  **实测 212 处使用,落在 192 个(文件, 函数, 表达式)键上**(「未量」到此为止;上面 `dispatch/services.py` 那类锁行只是其中一种)。
  每键一个标签加理由:PK 38、FANOUT 34、LOCK 33、FILTERED 28、CROSS 25、CLI 21、CODE 7、GLOBAL 6。
  清单里没有的新用法红、清单里有而代码里没了的也红,次数变了也红。**不扫 `Model.objects`**:`TenantManager` 只滤软删,
  它同样不按租户过滤,但那是整个代码库的每一条查询,归 `scope_to_tenant` 与视图契约测试管。
- **G5 部分完成(单库内的部分)** —— `backend/tests/test_global_uniqueness_inventory.py`,清单 `tests/tenancy_global_uniqueness.py`。
  推导出全部 72 个唯一键:**20 个 GLOBAL_VALUE**(`soul_code`、`case_number`、`username`、邮箱、`Tenant.code`、`Realm.realm_code`、
  `Organization.code`、API key 哈希、各类 token、Matrix 标识、死亡同步的 `(source_system, idempotency_key)` 等)、
  46 个 PER_PARENT(每灵魂一条之类,靠父键全局唯一与同库放置成立)、6 个 PER_TENANT。键消失或类别变化都红。
  六个点名的值另有专项断言(`unique=True`、邮箱是 `Lower(email)` 且不含租户、`case_number` 发号器按「前缀-年」而不是租户计数、
  `soul_code` 生成器遇碰撞重试且只写空值),并有两个真写库的测试(两个租户不能同名 / 同邮箱;共用前缀的两个租户发不出同一个案号)。
  **「跨库证明」(号段或登记表)仍是分库时才有的工作,这里只保证不会静默丢掉一个单库内的保证。**

**G2 是最大的缺口:** 契约测试守的是「viewset 过 `scope_to_tenant`」,而 service、任务、信号里的 `all_objects` 查询没有守卫。
分库后这些全都要带路由,而现在没人知道有多少 —— 先用 grep 量一遍(本稿 `Tenant.objects` / `all_objects` 在 `apps/` 里的直取点数
当时未量;2026-10-09 已量为 212 处,见上)。

### 4.2 迁移路径(分阶段,每阶段可停)

1. **阶段 0 —— 路由层不动数据。** 加 `DATABASE_ROUTERS`,所有路由仍指向 `default`。目标:证明 router 本身不改变任何行为。
   门禁:全套测试不变。
2. **阶段 1 —— 控制库分离。** 把真全局表 + `User` + `Tenant` 放 `control` 库。`User` 的 57 个外键改裸 ID(这是一次
   **大迁移**,见 2.3 第一条)。可回滚:反向迁移把表搬回。
3. **阶段 2 —— 影子分库。** 建每租户库,**双写**(写 `default`,异步写租户库),对账工具(G7)比对。读仍走 `default`。
4. **阶段 3 —— 按租户切读。** 一个租户一个租户地把读切到租户库,从**最小、最不跨租户**的殿开始。每切一个,保留 `default` 里的数据。
5. **阶段 4 —— 切写 + 跨租户协议上线。** 调拨 / 联审改 Saga(G4)。这是**不可无损回退**的一步 —— 切写后租户库有 `default` 没有的数据。
   在此之前每步都能回;之后回退 = 反向同步,须提前演练。
6. **阶段 5 —— 清理。** 删 `default` 里的租户数据,移除双写。

### 4.3 回滚

| 阶段 | 回滚方式 | 代价 |
|---|---|---|
| 0 | 删 router | 无 |
| 1 | 反向迁移搬回 | 停机窗口,57 个外键重建 |
| 2~3 | 关闭路由到租户库,读写回 `default` | 无数据丢失(双写) |
| 4 | **反向同步** 租户库→`default`;期间冻结调拨 | 需演练;若冻结期内有联审进行,须先结案 |
| 5 | 无(此时已回不去) | 因此阶段 5 要在阶段 4 稳定多久之后,是第 6 节的问题 |

### 4.4 与域拆分稿其他部分的关系

- **聊天:** 联邦 = 每文明一个 homeserver(域拆分稿 `:18`)。分库之前聊天不必动;分库时聊天库已经独立,**不是阻塞项**。
- **推送、朋友圈:** `social` 7 个模型带租户列,朋友圈本文明内,**天然适合先分**;灵魂账号、推送设备经 `soul` 外键挂靠,跟灵魂走。
- **读副本:** 阶段 3 的「按租户切读」与域拆分稿的「灵魂读走副本」可以共用同一套读路由。

## 5. 可以直接拿走的事实表

| 项 | 数 | 来源 |
|---|---|---|
| 应用模型 | 76 | 元数据实数 |
| 带 `Tenant` 外键的模型 / 列 | 39 / 44 | 同上 |
| 不属于任何租户的模型 | 21(其中约 14 个是权限 / 菜单 / 租户本表类真全局) | 同上 |
| 指向 `User` 的模型 | 57(其中 40 继承 `AuditUserFields`) | 同上 |
| 指向 `Soul` 的模型 | 19 | 同上 |
| 一事务内同时碰两个租户的功能 | 4(调拨、回原属、联审、重开审判) | 1.3 |
| `scope_to_tenant(` / `is_tenant_exempt(` 调用 | 46 / 33 | grep |
| `shared_task` / `tasks.py` 文件 | 39 / 13(其中 4 处总任务读 `Tenant` 表) | grep |
| 迁移文件 / 提租户的测试文件 | 338 / 297 | `find` / `grep -l` |
| 租户数 | 4(种子;`seed_tenants`) | 未在本稿中再数一次库,按种子 |

## 6. 待用户回答

1. **何时出发?** 2026-09-14 选了第 3 档。本稿建议「现在不拆、守约束、等触发」。你要的是「现在就开工」还是「条件满足再开」?
   若是前者,第 4 节的 G1~G7 就是第一批任务,而且阶段 1(控制库分离、`User` 外键改裸 ID)是整件事里最大的一刀。
2. **触发阈值**(3.3 表)里的数字是我定的建议值,**没有依据**。你有没有真实的预期用户量 / 租户数增长曲线?
   租户会不会从 4 个增长到几十个?这决定 (b) 与分片组(几个租户一个库)是否值得。
3. **「租户」的单位。** 现在一个文明 = 一个租户 = 一个殿集合(有 `Tenant.code` 与 `hall_names`,`tenants/models.py`)。
   分库按**文明**(4 个库)还是按**殿**(更多)?两者的跨租户功能数量差很多。
4. **`User` 放哪?** 全局身份(控制库,外键变裸 ID)还是复制到每个租户库(登录名全局唯一性放弃)?没有第三种。
5. **ADMIN(阎罗王)的形态。** 是继续「一个全局角色看全部」,还是变成「每个文明各有一个、再有一个全局只读的聚合账号」?
   后者在 (c) 下便宜得多,但改了产品含义。
6. **RLS(方案 a)要不要先做原型?** 它与分库无关,能单独买到「漏过滤降级」,代价是 2.1 里那些。
7. **驻留、故障域:** 有没有合同或客户要求?目前域拆分稿写的是「四个地区不受法规约束」,若这一点变了,3.3 表的优先级整体前移。
8. **阶段 4 之后能不能接受「不可无损回退」?** 若不能,要在阶段 3 停很久,或不做阶段 4。

---

*这份稿落在 `docs/ARCHITECTURE-tenant-sharding.md`;改它不改任何代码。数字复核:模型数用 Django `apps.get_models()` 重算,其余用 grep 重数。
`# 暂居`、`受刑计划` 的行号会随提交漂移,以 `grep` 为准。*
