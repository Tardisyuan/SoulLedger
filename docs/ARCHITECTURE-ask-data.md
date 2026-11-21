# 官员端「问数」(Text-to-SQL)—— 讲解稿

> **状态(2026-11-21):第 0–2 步已在功能分支 `feat/ask-data` 上实现,未推送、未合进 main。** 本文原是需求说明,
> 现改成讲解稿:每节先说做了什么,再给「代码在哪」与「实测结果」。没做的在 §8。§9 是用户拍板的决定,原样保留。
> 本项目是个人项目,没有真实用户;下文的「官员」「殿」都是系统里的角色,不是真实使用者。
> 代码出处标 文件:行(行号是本文写成时的,随代码移动);没有实跑过的推断标「未核实」。

官员用一句话问本殿的案件数据(「今年第一殿结了多少案」「冤魂申诉还有几件没判」),模型写一条 SQL,
过闸门后在**只读角色**的连接上执行,返回结果表和所用的 SQL。

## 1. 与已有东西的关系

最近的先例是审计日志的自然语言查询 `apps/audit/nl_query.py`:模型只出参数、过白名单、评测集在
`apps/soul_assist/evalsets/audit_query.json`、离线用「照字面听话的桩模型」证明校验在起作用(`tests/test_ai_audit_query.py`)。
问数照这个路子走,区别是模型这次真的写 SQL,所以多了三道:SQL 闸门、执行器自己的单语句检查、库里的只读角色与租户墙。

| 部件 | 复用 | 新写 |
|---|---|---|
| 模型调用 | `soul_assist.features.complete`(开关、并发名额、备用与断路器、用量记账);feature `ask_data` 在 `soul_assist/models.py` 的 `FEATURES`,迁移 `0022_ask_data_feature` | — |
| 问题包成数据块 | `soul_assist.redact.data_block` | — |
| 租户墙 | ADR 0006 的策略形状与 `set_config('app.tenant_id', …, true)` 写法 | 落到四张白名单表上,只对问数角色生效(ADR 0007) |
| 召回 | `soul_assist.vectors` 的 `embed` / `cosine` / `warm_up` 与降级规矩 | 召回对象是表说明;向量放 Django cache(§5) |
| 评测 | `nl_query.evaluate` 的形状(json 用例集 + 离线桩) | 按执行结果比对 + 错误分类(§7) |

**不送数据给模型(沿用 `docs/ARCHITECTURE-officer-assist.md` §2.2)。** 模型只看到问题、召回到的表说明(只含授权列)与今天的日期。
查询结果只回给官员,不回给模型 —— 没有「模型看了结果再总结一句」。

## 2. 执行路径与范围

```
POST /api/v1/ask-data/ {"question": "…"}            官员令牌,TenantPermission + CodenamePermission(judgment.read)
  → 没有 request.tenant → 403 no_tenant              不调模型
  → 没有这个殿要读的 ask_data 别名(分库时是殿所在分库的 `ask_data_civ_*`)→ 503 ask_data_not_configured
                                                    不调模型(先于模型:没有库就不花模型的钱)
  → schema.recall(question)                         召回表说明(§5)
  → features.complete("ask_data", …)                模型出一条 SQL(取 ```sql 围栏里的,没有围栏取整段)
  → gate.check(sql) → 拒绝:400 {"code", "sql"}      §3
  → executor.run(sql, request.tenant.pk)            §4;拒绝:400 {"code", "sql"};分库时读殿所在的分库
  → 200 {"sql", "columns", "rows", "truncated", "elapsed_ms"}
  ↳ 以上每一步的结果(200 或任何一个错误码)都写一行审计;写不进去整次调用 500、不回结果(§2「留痕」)
```

演示命令:`manage.py ask_data "问题" --tenant CN_DIYU [--sql "…"]`。`--sql` 跳过召回与模型,直接把给定 SQL 送进闸门和执行器,
没配模型也能演示闸门与 RLS。输出 SQL、结果表(制表符分隔)与行数,出错时命令以错误码失败。

**代码在哪:**
- 四步串联:`backend/apps/soul_assist/ask_data/service.py:66`(`ask`),后半段 `run_sql`(`:44`)由接口与 `--sql` 共用,
  `generate`(`:57`)由接口、演示命令与 `ask_data_eval --live` 共用;给模型的规则 `SYSTEM`(`:21`);执行器码到 HTTP 状态 `_STATUS`(`:31`)。
- 视图:`backend/apps/soul_assist/ask_data/views.py:34`(`AskDataView`,`get_required_permissions` 返回 `judgment.read`);
  路由 `backend/apps/soul_assist/urls.py:24`,挂在 `backend/config/urls.py:117`。
- 演示命令:`backend/apps/soul_assist/management/commands/ask_data.py`。
- 新错误码登记在 `backend/apps/core/problem_codes.py`(末尾「问数」一段);OpenAPI 已重新生成
  (`packages/core/openapi/schema.yml`、`packages/core/src/api/generated/schema.ts`)。
- 视图不碰 ORM,所以 `tests/test_tenant_scoping_contract.py` 没有它要查的 queryset;两个命令按殿码取 `Tenant` 的那一行
  登记在 `tests/tenancy_unscoped_sites.py`(理由:殿码全局唯一,该殿的行之后只经只读角色与 RLS 读)。

**实测结果:**`backend/tests/test_ask_data_api.py`,§2 验收逐条一格:200 的完整形状与「殿来自令牌」、无 `judgment.read`
(GUARDIAN)403、SYSTEM_ADMIN 与没绑殿的 ADMIN 都是 403 `no_tenant`、殿没开助手 503 `assistant_not_configured`、
没有别名 503 `ask_data_not_configured`、五种被闸门拒的回复(多语句、非白名单表、`SELECT *`、非 SQL 文本、空回复)400 带码与 SQL、
执行器的三种码、空问题与超长问题 400。这些在 SQLite 上把执行器换成记录调用的替身。
PG-only 的 `test_through_the_wall_the_model_forgets_the_hall_and_still_counts_only_its_own` 走真闸门、真执行器、只读角色:
模型的 SQL 不写租户过滤,CN 殿只数到自己的 1 件(库里同名殿名下共 3 件);演示命令对同一条
`SELECT count(*) FROM judgment_judgment` 在 CN 殿得 1、EU 殿得 2,`; DROP TABLE souls_soul` 以 `multiple_statements` 失败。
这条就是 §11 第 3 条的本地演示,跑在 unRAID 的一次性测试库上,不是本机 PG(本机没有 `psql`,也没有起本地 PG)。
运行与计数见 §11。

**留痕(2026-11-21 决定 3)。** `service.ask` 每次调用恰好写一行审计(`write_audit_row`,仓库唯一的审计入口,
`tests/test_audit_rows_have_one_entry.py` 的 AST 守卫禁止直接写 `AuditLog`):`user` 是官员、`tenant` 是殿(没绑殿时为空)、
`action=READ`、`resource="ask_data"`,`changes` = `question`、模型的 `sql`(没出 SQL 时为空)、`outcome`(`ok`,或闸门 /
执行器 / 模型不可用的错误码)、`rows`(返回给官员的行数)、`truncated`、`elapsed_ms`(整次调用,含召回与模型;响应里的
`elapsed_ms` 只是执行那一段);再加 IP 与 UA。**不存结果数据**:列名与行只回给官员。分库时行写在殿的主库上(`_write_row` 按殿选库)。
审计写失败按仓库的规矩(`_write_row`:写在业务事务里,失败抛给调用方):读没有可回滚的业务,所以整次调用失败(500)、结果不回 ——
和 CSV 导出(`apps/core/exports.py::record_export`)一样,没有留痕就没有数据。序列化器或权限在 `service.ask` 之前拒的请求
(空问题、超长、没有 `judgment.read`、限流)没有调用发生,不写。演示命令与评测命令不经接口,不写审计。
代码:`backend/apps/soul_assist/ask_data/service.py`(`ask`、`_audit`)。测试:`backend/tests/test_ask_data_api.py` 里「每次调用一行审计」一段:
成功、三种闸门码、四种执行器码、没绑殿 / 没配模型 / 没配库各恰好一行且字段逐项相等、结果里才有的值一个都不在行里、序列化器拒的不写;
注入审计 INSERT 失败 → 请求抛出注入的错误、不回结果、没有行。分库时行在殿的分库上:`tests/test_ask_data_sharded.py`。

**范围(已定,§9):** 只做后端接口 + 演示命令;没绑殿的 ADMIN 不开放;白名单四张表(§6)。

## 3. SQL 闸门(`gate.py`)

纯函数 `check(sql) -> Verdict`:sqlglot 按 `postgres` 方言解析成 AST,规则按 AST 判,按下表顺序给第一条命中的错误码。

| 规则 | 错误码 |
|---|---|
| 解析失败、空串 | `unparseable` |
| 语句不是恰好一条 | `multiple_statements` |
| 根不是查询,或树里有 Insert/Update/Delete/Merge/Create/Drop/Alter/Command/Copy/Set/Into/TruncateTable | `not_a_select` |
| `FOR UPDATE` / `FOR SHARE` 等锁子句 | `locking_clause` |
| 黑名单函数(`pg_sleep*`、`dblink*`、`pg_read_file`、`set_config`、`current_setting`、`lo_*`、`txid_*`、`pg_advisory*` …) | `forbidden_function` |
| 函数不在放行清单(按类;sqlglot 解析成 `Anonymous` 的只放 `age`、`make_date` 两个名字,且不带 schema 前缀) | `unknown_function` |
| 表不在白名单、带 schema 前缀;CTE 名只在它的作用域里算 CTE | `table_not_allowed` |
| `SELECT *` 或 `t.*`(`count(*)` 放行) | `star_not_allowed` |

**代码在哪:** `backend/apps/soul_assist/ask_data/gate.py:136`(`check`);写节点 `:31`,黑名单 `:46`–`:58`,放行清单 `:62`,
白名单 `allowed_tables`(`:100`,读 `schema.yaml`),CTE 按作用域收 `_visible_ctes`(`:123`)。`function_name`(`:110`)执行器也用。

**实测结果:** `backend/tests/test_ask_data_gate.py`(SQLite 也跑,不碰库),§3 列的全部拒绝用例按错误码常量断言,放行用例断言表集合
不多不少。子代理 A 做过变异(去掉表白名单 → 对应用例红),记在它的提交说明里。闸门之后还有两道,见 §4。

**sqlglot 不建模的无害函数(2026-11-21 用户决定:放)。** sqlglot 30.29 实测:`date_part` / `date_trunc` / `extract` / `to_char`
原本就解析成放行清单里的类;`make_interval`、`generate_series`、`justify_interval`(连同 `justify_days` / `justify_hours`)有类而原先不在清单里,
按类加进去;只有 `age`、`make_date` 是 `Anonymous`,按名字放(`_ALLOWED_BY_NAME`),两者所有重载都是纯计算。按名字放的只认不带前缀的写法
(`public.age(…)`、`j.age(…)` 是别的模式里的函数,仍拒),黑名单先于放行判,所以 `pg_sleep_for(make_interval(…))` 照旧 `forbidden_function`。
`generate_series` 在 FROM 里是表函数(`Table.this`),表循环只对它跳过白名单;别的表函数照旧拒。执行器的单语句与 `set_config` 检查不读放行清单,不受影响。
代价:`generate_series(1, 1e9)` 让「结果很大」更容易写出来(以前要靠多表笛卡尔积),仍由 3 s 超时兜着(§8「截断只截返回的部分」)。

## 4. 只读执行与库里的墙(`setup.py`、`executor.py`)

**角色与策略。** `manage.py ask_data_setup`(幂等,按环境跑一次,要 CREATEROLE)调 `setup.apply`:建 LOGIN 角色
(默认 `soulledger_ask_data`,`NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT`,密码只从 `ASK_DATA_DB_PASSWORD` 读);
`GRANT USAGE ON SCHEMA public`;四张表先 `REVOKE ALL` 再按 `schema.yaml` 的 `granted: true` 做**列级** `GRANT SELECT`;
`ENABLE`(不 FORCE)RLS,`CREATE POLICY ask_data_tenant … FOR SELECT TO <角色> USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::bigint AND NOT is_deleted)`。
不放迁移、不 FORCE 的理由与代价在 ADR 0007。

**执行。** 别名 `ask_data` 读 `ASK_DATA_DATABASE_URL`(未设 = 没有这个别名,答 503),不迁移、测试里镜像 `default`。每次一个事务:
`SET TRANSACTION READ ONLY` → `set_config('statement_timeout', ASK_DATA_TIMEOUT_MS, true)` 与 `set_config('app.tenant_id', 殿, true)` →
SQL → `fetchmany(ASK_DATA_MAX_ROWS + 1)` → COMMIT。殿只来自调用方;没有殿不执行。

**分库时(2026-11-21 决定 2,取代原来的 409 `not_on_this_database`)。** `settings.SHARDED` 时四张表的行都在殿所在文明的分库上,
控制库一行没有,所以执行器连 `ask_data_civ_<文明>`(`executor.alias_for`:殿的文明 → `shard_reads.alias_for_reads` → 分库别名;
文明未知的殿行留在控制库,D2,读 `ask_data`)。`ask_data_setup` 在控制库和每个 `civ_*` 上各跑一次 `setup.apply`:同一个角色、
同一个密码、同样的列授权与策略(角色是集群级的,同一集群上第二次是 ALTER)。**连接设置只有一个变量**:分库别名由
`config/shard_db.ask_data_shard_databases` 在 settings 里推出 —— `ASK_DATA_DATABASE_URL` 的用户、密码、OPTIONS,换上
`SHARD_DATABASE_URL_<CIV>` 的主机 / 端口 / 库名。所以角色的密码只写在 `ASK_DATA_DATABASE_URL` 里,不进分库表主的 URL;
没有 `ASK_DATA_DATABASE_URL_<CIV>`。选它是因为不加变量、也不会和分库清单不一致;限制是角色得能用分库表主的主机和端口连上
(中间有 pgbouncer 的话,它也得认这个角色)。某个分库推不出别名(配置错)→ 503 `ask_data_not_configured`,不调模型。
单库形态不变。
库错按 SQLSTATE 归成 `timeout`(57014)、`permission_denied`(42501)、`read_only`(25006),其余 `execution_error`(原文进日志)。

**执行器自己的单语句检查(第 2 步加的,纵深防御)。** 库墙信任 `app.tenant_id`,而这是任何角色都能写的设置;psycopg2 用简单查询协议,
一段文本里的每条语句都会执行。子代理 B 记下的缺口:绕过闸门时,`SELECT set_config('app.tenant_id','<B>',true); SELECT …` 读到 B 殿,
`COMMIT; SELECT …` 跑到只读事务之外。现在 `executor._one_statement` 在**发送任何东西之前**用 sqlglot 解析并拒绝:
不是恰好一条(`multiple_statements`)、根不是查询或 DML(`not_a_select`,白名单:sqlglot 把 `START TRANSACTION`、`ABORT`、
`SAVEPOINT x`、`DISCARD ALL` 读成列或别名,黑名单会漏)、树里任何 `set_config` 调用(`forbidden_function`,也挡住单条语句里
「物化 CTE 先改殿再扫表」的写法)。DML 照样发出去,让角色与 READ ONLY 在库里拒 —— 墙的测试要的就是这个。

**代码在哪:** `backend/apps/soul_assist/ask_data/setup.py:50`(`apply`),策略表达式 `:25`、`:46`;
`backend/apps/soul_assist/ask_data/executor.py:96`(`run`),单语句检查 `:79`、白名单 `:76`,殿检查 `:59`;
命令 `backend/apps/soul_assist/management/commands/ask_data_setup.py`;设置 `backend/config/settings.py:236`–`:250`;
不迁移 `backend/config/sharding.py:91`;测试用的角色与别名 `backend/tests/ask_data_wall.py`(RLS、评测、接口三处共用)。

**实测结果:** `backend/tests/test_ask_data_rls.py`。PG-only 的九条(已登记进 `tests/test_concurrency.py` 的名单)在 unRAID 的真 PG 上
全过:跨殿(四张表、按 id 查 B、JOIN)、软删不可见、没设殿零行且 COMMIT 后同一连接上殿与超时都已失效、绕过闸门的
UPDATE / DELETE / 未授权列 / 未授权表全被库拒且什么都没写、`pg_sleep(10)` 在 5 秒内以 `timeout` 结束、500 行截成 200 行且标 truncated、
`ask_data_setup` 跑两次结果一样且表主照常读写、`relforcerowsecurity` 为假。原 xfail 的伪造殿测试改成普通测试(三种写法,都被执行器拒,
同一连接上下一问仍只见 A);另加 `test_the_executor_sends_one_statement_and_never_a_setting`,十四种写法,每个引擎都跑。
**变异:** 去掉 `run` 里对 `_one_statement` 的调用,这十七格全红(三格 PG 测试 `DID NOT RAISE`,即请求真的发了出去;十四格在拒绝之前就碰了库),
还原后全绿(命令与计数见 §11)。B 的三处变异(策略 `USING (true)`、不开 RLS、整表 `GRANT SELECT`)记在 ADR 0007。

## 5. Schema 召回(`schema.py`、`schema.yaml`)

`schema.yaml` 是唯一来源:每张表一段说明、每列一行(类型、是否授权、中文叫法、同义词、枚举值含义)。读它的有四处:闸门的表白名单、
`ask_data_setup` 的列授权、召回语料、给模型的表结构(`table_text` 只写授权列)。

召回:每张表一个文本块,查询加 qwen3-embedding 的指令前缀,余弦取最近 k=3 张。**向量放在 Django cache 里**(键是模型 / 维度 / 四段说明全文
的哈希,说明或模型一变就换键,没有重建命令),没命中时与问题同一次 `embed` 请求取。没复用 `HelpChunk`:`vectors.sync` 会删掉帮助语料里
没有的行。降级:向量服务不通、超时、维度对不上 → `fallback`,最近一张低于 `ASSISTANT_RETRIEVAL_MIN_SIMILARITY` → `fallback_low_similarity`,
两种都返回全部四张表。

**代码在哪:** `backend/apps/soul_assist/ask_data/schema.py:79`(`recall`),`table_text` `:52`;`backend/apps/soul_assist/ask_data/schema.yaml`。

**实测结果:** `backend/tests/test_ask_data_schema.py`:yaml 的表与列逐列等于模型的具体列(按字段顺序)、§6 的私密列与全部 `text` 列都不授、
策略要的 `tenant_id` / `is_deleted` 都授;**三方相等**(第 2 步加):`gate.allowed_tables() == schema.tables() == setup.tables()`;
**同义词覆盖评测集**(第 2 步加):每道非反例题的 gold_sql 用到的每一列,问题里都要出现 yaml 给它的某个叫法 —— 第一次跑查出六列缺词
(`is_final` 的「没结」、`concluded_at` 的「结了多少案」「结案的」、`created_at` 的「立了几件案」、`grievance_filed_at`、`death_year` 的「以后死的」、
`executed_at`),已补进 yaml;变异:删掉「没结」,`open-cases` 那格红。召回用二元组替身,四个问题排第一的表正确;没有灵魂表的一格,
理由写在测试里(替身是字面重合,灵魂类问题的字面四段说明里都有)。真嵌入模型上的排序未核实。

## 6. 白名单表(已定)

| 表 | 用途 | 不授的列(至少) |
|---|---|---|
| `judgment_judgment` | 案件:判决、结案、申诉、时间 | `confession`、`notes`、`summary`、`grievance_plea`、`grievance_note`、`evidence_json`、`fail_reason_note` |
| `souls_soul` | 灵魂:状态、文明、功过分 | `name`、`birth_name`、`description`、`soul_code`、`contact_email`、`contact_phone`、`origin_location` 等 |
| `disposition_disposition` | 去向 / 处置 | `notes` 等自由文本 |
| `sentence_plan_sentenceplan` | 受刑计划 | `cancel_reason` 等自由文本 |

逐列的授与不授在 `schema.yaml`,由 `tests/test_ask_data_schema.py` 与 `tests/test_ask_data_rls.py::test_setup_runs_twice_…`(真 PG 上逐列问
`has_column_privilege`)核对。策略一律「本殿且未删」,比 ADR 0006 探针里 `souls_soul` 的「本籍殿也能读」更窄。

## 7. 评测(`evals.py`、`evalsets/ask_data.json`、`manage.py ask_data_eval`)

**用例集:** 42 题(单表 10+、JOIN 8+、聚合 8+、时间 6+、同义词 5+、反例 5),四张表都用到;每题 `gold_sql`、`naive_sql`(离线桩的回答)、
`expect`、`offline`(在种子上应落的分类)。种子 `backend/tests/ask_data_eval_seed.py`:两个殿,时间钉死,`today` = 2026-11-15。

**比对与分类:** 执行结果按行的多重集合比(不比列名列序;`ordered` 时比行序;小数 6 位;日期 ISO;截断不判对);分类按
`no_sql → gate_rejected → timeout → permission_denied → execution_error → truncated → ok → wrong_table → wrong_join → wrong_filter → wrong_aggregate → other`
取第一个命中的。

**两种跑法(`manage.py ask_data_eval`):** `--offline` 用每题的 `naive_sql`,`--live` 走 `service.generate`(召回 + 生效配置的模型)。
都经真闸门与真执行器(`service.eval_hooks`),在 `--tenant`(默认用例集的殿)上跑。用例集记下的离线分数只在评测种子上成立。

**代码在哪:** `backend/apps/soul_assist/ask_data/evals.py`(`classify` `:113`,`evaluate` `:131`,`summarize` `:151`);
`backend/apps/soul_assist/management/commands/ask_data_eval.py`;`backend/apps/soul_assist/ask_data/service.py:79`(`eval_hooks`)。

**实测结果:** `backend/tests/test_ask_data_evals.py`。比对、分类(每个分类至少一格)、用例集自检每个引擎都跑;第 2 步把自检里的结构闸门替身换成
真 `gate.check`:每条 gold_sql 过闸门、每条反例题的 naive_sql 被拒。离线整套(PG-only,已登记)换成真闸门 + 以只读角色过 RLS 的真执行器后,
**分数与分类计数和替身时一样**:准确率 27/37、反例拒绝 5/5,`ok` 27、`gate_rejected` 5、`wrong_filter` 2,`execution_error` /
`no_sql` / `other` / `permission_denied` / `truncated` / `wrong_aggregate` / `wrong_join` / `wrong_table` 各 1。读未授权列的那题从替身的
42703(列不存在)变成 42501(无权限),两者都记 `permission_denied`。「忘了租户过滤」的题判 `ok`,且同一条 SQL 不经 RLS 会数进别殿(测试核对)
—— 这是 RLS 兜住的证明。**这是离线桩模型的分数,不是任何模型的准确率。** `--live` 没有跑过。

## 8. 没做 / 这一版不做 / 已知缺口

- **真模型的准确率**只有 `ask_data_eval --live` 才有,一次都没跑过;文档与简历都不写准确率数字。
- **不是全库 RLS**,ADR 0006 的 rollout 条件一条没动;业务连接仍只有视图层一道墙。
- **殿的设置仍可被写**:执行器挡住了它能看见的写法(§4),但它信任 sqlglot 与 PG 的词法器对「几条语句」的判断一致;试过的几类(反斜杠、`E''`、
  美元引号、嵌套注释)一致,没试过的分歧会让一段同时骗过闸门的文本重新打开这个缺口。根治要让策略依赖角色写不了的东西(ADR 0007)。
- **就绪探针**:`apps/core/health.py:23` 会 ping 每个别名,所以先设了 `ASK_DATA_DATABASE_URL`、还没跑 `ask_data_setup` 时,就绪检查失败。先跑命令再设变量。
- **向量在 Django cache 里**:缓存清空或换后端就在下一问时重嵌四段说明(多一次 embed 请求),没有持久化;相似度下限沿用帮助台的设置项,
  在这里的取值是否合适未核实。
- **截断只截返回的部分**:psycopg2 的普通游标在 `execute` 时把整份结果取到客户端,`fetchmany` 只决定回给官员多少行。大结果由 3 s 超时兜着,
  内存上限未量过。
- **留痕只在接口上**:接口每次调用写一行审计(§2「留痕」),不写 `AIDraft`;演示命令与评测命令不写。
- **离线分数只在种子上成立**:`ask_data_eval --offline` 在别的库上会得到别的数字;种子只由测试加载,没有加载命令。
- ADMIN 跨殿问数;多轮追问;模型看结果再总结;图表;Web 页面与官员 App。
- pgbouncer 本身没在测试里:和 ADR 0006 一样,用同一连接 COMMIT 后复查来代替。

## 9. 已拍板(2026-11-21,均取推荐项)

- **Q1 前端**:只做后端接口 + 演示用管理命令 `manage.py ask_data`。不做 Web 页面与官员 App。
- **Q2 没绑殿的 ADMIN**:不开放,403 `no_tenant`。
- **Q3 白名单表**:§6 的四张。
- **Q4 新依赖**:加 sqlglot,进 `backend/requirements.txt` 与 `backend/requirements.lock`(按锁文件头部注释写的 `uv pip compile` 方式重算,
  只多它这一行;会让门禁强制跑一次全量)。
- **Q5 提交**:在功能分支 `feat/ask-data` 上分几次提交,跑 `scripts/run-gates.sh` 与 `scripts/run-gates.sh --real-pg`(远端 unRAID),
  **不推送**,等用户看过再推。

## 10. 实现顺序(已完成)

- **第 0 步**(主会话):分支、sqlglot 依赖、`schema.yaml` 初版、`FEATURES` 的 `ask_data` 与迁移 `0022`。
- **第 1 步**(四个子代理,各自分支):A 闸门(`feat/ask-data-gate`)、B 执行器与墙 + ADR 0007(`feat/ask-data-exec`)、
  C 召回(`feat/ask-data-schema`)、D 评测(`feat/ask-data-evals`)。
- **第 2 步**:先合 main(带 `config/worksteal.py` 的修复),再按 A → B → C → D 合入(无冲突);补 `service.py`、`views.py` 与路由、
  两个命令、接口测试、三方相等与同义词覆盖、D 的离线整套换成真闸门与真执行器、两条新 PG-only 登记;在执行器里堵上伪造殿与 `COMMIT` 逃逸。

## 11. 门禁与运行记录

2026-11-21,合入后的分支(`feat/ask-data-step2`,即将快进成 `feat/ask-data`)。后端改到 `apps/core/problem_codes.py`,
选择器因此判后端全量。按约定的分法:JS 一侧跑门禁,后端一侧走真 PostgreSQL,ruff 与 makemigrations 在本机。

| 命令 | 在哪 | 退出码 | 计数 |
|---|---|---|---|
| `backend/.venv/bin/ruff check .` | 本机 | 0 | — |
| `manage.py makemigrations --check --dry-run`(SQLite) | 本机 | 0 | — |
| `GATES_SIDES=js scripts/run-gates.sh --base main` | unRAID | 0 | core vitest 37 文件 / 372;web jest 425 套 / 7164;灵魂端 78 套 / 1424;官员端 60 套 / 1338;四处 tsc 与 eslint 绿 |
| `scripts/run-gates.sh --real-pg --base main` | win-wsl | 0 | 11636 passed / 1212 skipped / 47 subtests,1730 s(后端全量 + 迁移往返) |
| `scripts/run-gates.sh --real-pg --tests`(五个 ask_data 测试文件 + 未登记查询守卫) | unRAID | 0 | 291 passed / 0 skipped |
| `scripts/run-gates.sh --tests`(SQLite:ask_data 五个文件、PG-only 名单、租户契约、未登记查询、OpenAPI、problem 信封、`apps/perm`) | unRAID | 1 → 修后见上 | 第一次 1 failed / 756 passed:两个命令按殿码取 `Tenant` 没登记,已补进 `tests/tenancy_unscoped_sites.py` |
| 变异:去掉 `_one_statement` 调用、删掉「没结」同义词(`--real-pg --tests test_ask_data_rls.py test_ask_data_schema.py`) | unRAID | 1(预期) | 18 failed / 91 passed:17 格单语句检查 + 1 格同义词;还原后上面那行全绿 |

JS 第一次跑红过一次:`creditsOssDrift.test.ts`,第 0 步加了 sqlglot 却没进「致谢」的开源清单;已补(`packages/core/src/config/creditsOss.json`)。
两次门禁都因工作区里有未提交的本文而没记账(门禁只在干净工作区记账);本文提交之后没有再跑。

**2026-11-21,三条决定(`feat/ask-data-decisions`,先合了 main 的 `settings.SHARDED`)。** 提交 `a1b585269`(决定 1)、`b24e9ede1`(决定 2、3)。
门禁数字都在 `b24e9ede1`(树 `c00f0edb37`)上;改了 `problem_codes.py`,后端按规则全量。

| 命令 | 在哪 | 退出码 | 计数 |
|---|---|---|---|
| `scripts/run-gates.sh --real-pg --base feat/ask-data` | unRAID | 0 | 后端全量含迁移往返 11662 passed / 785 skipped / 47 subtests,1862 s;记账(backend) |
| `GATES_SIDES=js scripts/run-gates.sh --base feat/ask-data` | unRAID | 0 | core vitest 37 / 372;web jest 371 套 / 6601;灵魂端 74 / 1366;官员端 57 / 1291;记账(js) |
| `--real-pg --workers 4 --tests --ds=config.settings_sharded -m sharded`(ask_data_sharded、ask_data_rls、审计两份) | unRAID | 0 | 16 passed |
| `--real-pg --tests`(ask_data 六个文件、未登记查询、problem 信封、审计两份、PG-only 名单) | unRAID | 0 | 355 passed / 15 skipped(提交前一版;其后只多了一条分库审计测试,上一行已含) |
| 变异(各自单独,跑完还原):闸门五处 | 本机(纯函数) | 1(预期) | 2 / 4 / 2 / 5 / 4 failed,还原 108 passed |
| 变异:`alias_for` 不看分库、`ask_data_setup` 只建 default(分库组) | unRAID | 1(预期) | 各 2 failed / 1 passed |
| 变异:拒绝时不写审计、审计里写整份行、吞掉审计失败(`test_ask_data_api.py`) | unRAID | 1(预期) | 8 / 1 / 1 failed |
