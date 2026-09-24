# 朋友圈审核三区的后端 —— 报告

分支 `feat/moderation-backend`,起点 `main` @ `4e0b778`。

> **⚠️ THIS BRANCH CONTAINS MIGRATIONS.** `backend/apps/social/migrations/0007_moderation_word_action_and_handled.py`。
> 应用到共享 PostgreSQL 之前先备份。本分支没有碰过任何真库:所有命令用 SQLite 内存库,
> 或本容器里临时起的 PostgreSQL 16(`127.0.0.1:5439`,跑完即弃)。

## 1. 已有的与新增的

先查后加。设计要的东西有一半已经在了:

| 设计要的 | 现状(`main`) | 本分支 |
|---|---|---|
| 敏感词 `created_by` | **已有**(`SensitiveWord.created_by`,序列化器已输出) | 不动 |
| 敏感词 `category` | 无 | **新增**,`SensitiveWordCategory` TextChoices:`PRIVACY` / `ABUSE` / `INDUCEMENT` / `CONFIDENTIAL` / `OFFICIAL_DEFAMATION`;空串 = 未分类 |
| 敏感词 `action` | 无(命中一律 PENDING) | **新增**,`SensitiveWordAction`:`REVIEW` / `HIDE` / `MASK`,默认 `REVIEW` |
| 近 30 天命中 | 无 | **新增**表 `SensitiveWordDailyHit`,列表注 `hits_30d` |
| 批量删词 | 无 | **新增** `POST sensitive-words/batch-delete/` |
| 禁言开始 / 结束 / 理由 | **已有**(`created_at` / `until` / `reason`) | 不动 |
| 禁言执行人 | 模型**已有** `created_by`,但 API 没输出 | 序列化器加输出 `created_by`、`lifted_by`(无迁移) |
| 永久禁言(`until` 可空) | 不存在:天数 1–365,`until` 非空 | **不加**。代码里没有任何地方需要它,见「待定问题」 |
| 解除禁言 + 通知 | **已有**:`POST mutes/{id}/lift/`,提交后发 `SOCIAL_UNMUTED`(事件总线 → WebSocketHandler,定向给被禁言账号) | 不另造通知;补了测试 |
| 已处理列表 | 无 | **新增** `GET handled/` |
| 恢复可见 | **已有**:`POST posts|comments/{id}/restore/`(HIDDEN → PUBLISHED) | 复用,补了测试;写入处理人 |
| 隐藏的处理人 / 时间 / 理由 | 只在 AuditLog 里 | **新增** `Post` / `Comment` 的 `moderated_by` / `moderated_at` / `moderation_reason` |
| 删除的处理人 / 时间 / 理由 | **已有**(软删除的 `deleted_by` / `deleted_at` / `delete_reason`) | 直接读 |
| 删除的恢复 | 帖子与评论**不在回收站登记表里**(`register_bin_type` 只登了 menu / soul / role) | 按要求不加第二条恢复路径 |

为什么给隐藏加三列,而不从 AuditLog 反查:「已处理」是一张要分页、按时间排序的列表,
从 `AuditLog.resource_id`(字符串)反连回帖子既慢又脆;而删除那一侧早就有同样的三列。

## 2. 迁移

`social/0007_moderation_word_action_and_handled` —— 只有 `AddField` × 8 与 `CreateModel` × 1,
Django 自动可逆,不读不写既有行,没有 `RunPython`,没有 `except Exception: pass`。

| 字段 | 既有行得到 |
|---|---|
| `SensitiveWord.action` | `REVIEW` —— 与迁移前「命中进待审」一致,行为不变 |
| `SensitiveWord.category` | `""`(未分类) |
| `Post/Comment.moderated_by`、`moderated_at` | `NULL` |
| `Post/Comment.moderation_reason` | `""` |
| `SensitiveWordDailyHit` | 新表,空;命中从迁移那一刻开始计 |

在本地临时 PostgreSQL 16 上实测:`migrate` → `migrate social 0006`(两列与新表都消失)→
`migrate social`,三步退出码均 0;一条在 0006 时插入的旧敏感词,前进后读出 `REVIEW` / `""`。

## 3. 端点形状

都在 `/api/v1/social-moderation/` 下,都只要一个码名 `social.moderate`,都经 `scope_to_tenant`。

**`GET sensitive-words/`**(改)每行:
```
{id, word, category: ""|PRIVACY|ABUSE|INDUCEMENT|CONFIDENTIAL|OFFICIAL_DEFAMATION,
 action: REVIEW|HIDE|MASK, hits_30d: int, created_by: {user_id, display_name}|null, created_at}
```
**`POST sensitive-words/`**(改)`{word, category?, action?}`;不给 = 未分类 + `REVIEW`(与旧客户端兼容)。
分类不接受中文名(400):中文在 i18n 包的 `social_moderation.word_category.*` 里。

**`POST sensitive-words/batch-delete/`**(新)`{ids: uuid[1..200]}` → `200 {deleted: n}`。
全有或全无:任何一个 id 不在本文明词表里 → `404 {code: "not_found", missing: [...]}`,一条都不删;
超过 200 或空 → 400。行锁 + 事务,每个词一条 DELETE 审计。

**`GET mutes/`**(改)每行加 `created_by`、`lifted_by`:
```
{id, user, until, reason, created_at, created_by, lifted_at, lifted_by, is_active}
```
**`POST mutes/{id}/lift/`**(不变)返回同上;409 `already_lifted`;别的文明 404。

**`GET handled/`**(新)`?type=POST|COMMENT&handling=HIDDEN|DELETED&page=`,按 `handled_at` 倒序
(空的排最后),每行:
```
{type: POST|COMMENT, id, post, author: {user_id, display_name}, excerpt (≤200 字),
 handling: HIDDEN|DELETED, reason, handled_by: {user_id, display_name}|null, handled_at|null}
```
* HIDDEN = `moderation_status=HIDDEN` 且未删除;读 `moderated_*`。
* DELETED = 软删除且删除人**不是作者本人**(作者自删不是审核处理);读 `deleted_*`。
* `handled_by` 为空:系统处理(HIDE 词命中,`reason` = `sensitive_word:<词>`),或 0007 之前隐藏的行。
* `post`:评论所在的帖子;帖子行是它自己。
* 两个模型各过一次 `scope_to_tenant`,再 `UNION ALL`,分页与计数都在数据库里。

**恢复可见** = 既有的 `POST posts/{id}/restore/`、`POST comments/{id}/restore/`,现在同时写 `moderated_*`。
删除的行对它是 404(查询集只含未删除的行)。

`packages/core`:`socialModerationApi.addWord(word | {word, category, action})`、`removeWords(ids)`、
`handled(filters)`;hooks `useHandledContent`、`useRemoveSensitiveWords`、`useRestoreVisible`
(按行的 `type` 选 posts / comments 调 restore);`useAddSensitiveWord` 仍接受字符串。
查询键 `socialModerationKeys.handled`。类型 `HandledContent` / `SensitiveWordCategory` / `SensitiveWordAction`
直接取自生成的 schema。

## 4. 动作在哪里执行

唯一入口:`apps/social/moderation.py::screen_content(tenant, content)`,由
`apps/social/soul_circle.py` 的 `create_post` 与 `create_comment` 在写入前调用(这是灵魂侧帖子与
评论仅有的两条写路径;没有编辑帖子的路径)。结果在**同一次 INSERT** 里落库:

* `REVIEW` → `PENDING`,进待审队列(`posts/` / `comments/` 的默认视图),内容不改 —— 即迁移前的行为。
  注意:「送审」进的是**待审内容队列**,不是 `Report` 表;迁移前就是这样,本分支没改。
* `HIDE` → `HIDDEN`,`moderated_at` = 现在,`moderation_reason` = `sensitive_word:<词>`,
  `moderated_by` 空;别人看不见,作者本人看得见(沿用既有可见性规则);直接出现在「已处理」。
* `MASK` → 命中的片段在写入时换成 `***`,内容照常发布。检测与替换是同一种「小写子串」匹配,
  重叠或相邻的命中合并成一个 `***`。
* 一条内容命中多个词:状态取最重的,`HIDE > REVIEW > MASK`;MASK 的词**无论如何**都被替换。
  检测在原文上做,先遮掉的 MASK 词不会让重叠的 REVIEW / HIDE 词漏检。

改显示名(`soul_circle.rename`)仍用 `hits_sensitive_word`:名字命中任何词一律拒,不看动作、不计命中。

### 命中计数的做法

`SensitiveWordDailyHit(word, day, count)`,`(word, day)` 唯一。命中时对当天那一行
`count = count + 1`(没有就建;并发建撞唯一约束时在保存点里回滚那一条 INSERT 再 UPDATE ——
PostgreSQL 上失败语句会中止整个事务,所以必须是保存点)。计数与帖子 / 评论在同一事务里,写入失败不计。
一条内容里同一个词出现多次只算一次。

读:`Sum(count) where day >= today-29`,每个词最多 30 行,走唯一约束的索引 —— 读的代价与命中量无关。
为什么不是「一次命中一行」:读要 COUNT 全部命中行,词表页每次打开都做;为什么不是 SensitiveWord 上
一个计数列:滚动窗口要能过期,一个数做不到。代价是每个词每天一行,删词时级联删掉。
日期按 UTC(`timezone.now().date()`)。

## 5. 待定问题

1. **「从别的文明复制词表」没有做。** 权限模型不允许它干净地成立:`social.moderate` 是按租户授的,
   官员只看得见本文明(`scope_to_tenant`),唯一跨租户的角色是 ADMIN。要做就得回答:谁有权读
   另一个文明的词表 —— 只给 ADMIN?还是新增一个「可读的来源文明」关系?复制时 `action` / `category`
   跟着复制吗?命中计数显然不复制。
2. **永久禁言。** 现在天数 1–365、`until` 非空,代码里没有永久的需求,所以没加可空的 `until`。
   设计稿若确要「永久」,要定:是可空 `until`,还是一个很远的日期;解除与到期显示怎么分。
3. **删除内容的恢复。** 帖子与评论不在回收站登记表里,所以今天「已删除」没有任何恢复入口。
   要恢复就该在回收站登记(`register_bin_type("social_post", …)`),而不是在审核后台开第二条路 —— 请定。
4. **未分类。** 0007 之前的词 `category=""`;新建时分类也是可选的(为了不打断现有前端)。设计若要求
   必填,改序列化器一行即可,但要先让前端表单跟上。
5. **egy 文案是占位。** 三个语言包的键集合有一致性测试(`soulLifecycleEventCopy.test.tsx`),所以 egy 必须有
   这 11 个新键。我只用了词表里**已有**的词(登记表只变了计数,没有新词形):分类 `Wa-Ek` / `Medu Kher` /
   `Medu Isfet` / `Khet Khetem` / `Medu Kher Er Sab` / 未分类 `Nen Sesh`;动作 `Em Maat` / `Imen Khet` / `Imen Medu`。
   请词表的主人过目。
6. **显示名命中是否计数。** 现在不计(改名命中一律拒,不属于三种动作)。若希望计入,是一行的事。
7. **待审的理由。** REVIEW 命中没有写 `moderation_reason`(它不是「已处理」)。若待审队列想显示「因哪个词待审」,
   可以同样写 `sensitive_word:<词>`。

## 6. 门禁

环境:Python 3.11 venv(`requirements.lock` + `requirements-dev.txt`),node v22.22.2,npm 11 装依赖后
`git checkout -- package-lock.json` 还原。后端命令都带
`SECRET_KEY=ci-test-key-not-for-production DEBUG=true DATABASE_URL="sqlite:///:memory:"`,
并起了一次性 `redis-server --port 6399 --save '' --appendonly no`,
`REDIS_URL` / `CELERY_BROKER_URL` / `CELERY_RESULT_BACKEND` 分别指向 `/0` `/1` `/2`。

| 门禁 | 命令 | 退出码 | 结果 |
|---|---|---|---|
| 全量 pytest(SQLite) | `cd backend && <prefix> .venv/bin/python -m pytest --tb=short -q` | 0 | **4496 passed / 24 skipped**,覆盖率 93.65% |
| ruff | `cd backend && .venv/bin/ruff check .` | 0 | — |
| 迁移检查 | `cd backend && <prefix> .venv/bin/python manage.py makemigrations --check --dry-run` | 0 | No changes detected |
| schema | `manage.py spectacular --file ../packages/core/openapi/schema.yml --validate --fail-on-warn` | 0 | 0 warnings / 0 errors;再生成一次与提交的逐字节相同;`schema:generate` 退出 0 |
| core typecheck | `npm run --workspace packages/core typecheck` | 0 | — |
| core lint | `npm run --workspace packages/core lint` | 0 | — |
| core test | `npm run --workspace packages/core test` | 0 | 12 files / 118 passed |
| frontend tsc | `cd frontend && npx tsc --noEmit` | 0 | — |
| frontend coverage | `cd frontend && npm run test:coverage` | 0 | 168 suites / 3118 passed,阈值全过 |
| 真 PG(本地临时 16) | 社交 7 个文件 + 租户契约 + `test_concurrency.py`,`DATABASE_URL=postgres://…@127.0.0.1:5439/… pytest --no-cov --create-db` | 0 | **169 passed / 2 skipped** |

frontend 第一次跑是红的(3117 passed / 1 failed):`soulLifecycleEventCopy` 要求三个语言包键集合一致,
而我起初只给 zh-Hans 与 en 加了键。补上 egy(见上面第 5 条)、按 `egyLexiconRules.test.ts` 里写的办法
重生成 `support/egyVocabulary.json` 之后,上表是重跑的数字。

### 新测试与变异证明

`backend/tests/test_social_moderation_backend.py`,27 条:三种动作(帖子与评论)、最重动作优先、
重叠遮盖、干净内容不动;命中计数(同条只算一次、29 天前算、30 天前不算、评论也算、竞态分支、
别的文明看不到);新建带分类与动作、分类不收中文;批量删(成功 + 审计、跨文明整批 404 一条不删、
上限 200 / 空 / JUDGE 403、级联删桶);禁言(执行人、解除人、`SOCIAL_UNMUTED` 定向发给本人、
重复解除 409、别的文明看不到也解除不了);已处理(隐藏 + 官员删除入列,作者自删 / 正常 / 待审不入列,
字段逐项、过滤、倒序、跨文明隔离、码名);恢复可见(回到 PUBLISHED、离开已处理、记处理人;
删除的 404;别的文明 404)。

每条都改源码看它变红,再还原(还原后与备份逐字节相同,重跑 33 passed):

| 变异 | 结果 |
|---|---|
| `handled/` 去掉 `scope_to_tenant` | `test_handled_does_not_leak_across_civilizations` 红 |
| 批量删用未收窄的 `SensitiveWord.objects.all()` | `test_batch_delete_is_all_or_nothing_across_civilizations` 红 |
| 公共外壳 `ModerationViewSet.get_queryset` 去掉 `scope_to_tenant` | 词表命中、解除禁言、恢复可见三条跨文明测试红 |
| MASK 不替换 | 4 条红 |
| MASK 只替换第一次出现 | `test_mask_replaces_every_hit_with_stars_and_publishes` 红 |

### 需要在真 PostgreSQL 上确认的

`handled/` 的 `UNION ALL` + `ORDER BY … NULLS LAST` + 分页计数,以及 `record_hits` 的保存点分支,
都是 SQLite 可能放过的写法。上表最后一行就是为此在本地临时 PostgreSQL 16 上跑的;没有连过 115。
