# 官员端「问数」(Text-to-SQL)—— 需求说明

> **状态(2026-11-21):需求已定,待实现。** §9 的五个问题已由用户拍板(均取推荐项)。本文是交给实现者的说明:
> 每部分有验收标准(§3–§7 各节末尾),§10 是实现顺序与并行分工,§11 是合并与门禁。
> 实现完成后本文改成讲解稿:每节补「代码在哪、实测结果」,没做的留在 §8。
> 本项目是个人项目,没有真实用户;文档和提交信息里不要写成已上线或有用户。
> 代码出处标文件:行;没有实跑过的推断标「未核实」。

官员用一句话问本殿的案件数据(「今年第一殿结了多少案」「冤魂申诉还有几件没判」),模型写一条 SQL,
过闸门后在**只读角色**的连接上执行,返回结果表和所用的 SQL。

## 1. 与已有东西的关系

最近的先例是审计日志的自然语言查询 `apps/audit/nl_query.py`:模型只出参数、过白名单、评测集在
`apps/soul_assist/evalsets/audit_query.json`、离线用「照字面听话的桩模型」证明校验在起作用(`tests/test_ai_audit_query.py`)。
问数照这个路子走,区别是模型这次真的写 SQL,所以要多三道:SQL 闸门、只读角色、库里的租户墙。

| 部件 | 复用 | 新写 |
|---|---|---|
| 模型调用 | `soul_assist.features.complete`(开关、并发名额、备用与断路器、用量记账),新 feature `ask_data` 加进 `soul_assist/models.py` 的 `FEATURES`(choices 变了,要一条迁移) | — |
| 问题包成数据块 | `soul_assist.redact.data_block` | — |
| 租户墙 | ADR 0006 的策略形状与 `set_config('app.tenant_id', …, true)` 写法(`tests/test_row_level_security_probe.py`) | 落到问数用到的四张表上,只对只读角色生效 |
| 召回 | `soul_assist.vectors` 的 `embed` / `nearest` / 降级规矩 | 召回对象从帮助条目换成表与字段说明 |
| 评测 | `nl_query.evaluate` 的形状(json 用例集 + 离线桩) | 按执行结果比对 + 错误分类 |

**不送数据给模型(沿用 `docs/ARCHITECTURE-officer-assist.md` §2.2)。** 模型只看到问题、召回到的表结构与说明、今天的日期。
查询结果只回给官员,不回给模型 —— v1 没有「模型看了结果再总结一句」。

## 2. 执行路径与范围

```
POST /api/v1/ask-data/ {"question": "…"}            官员令牌(OfficerJWTAuthentication),权限码 judgment.read
  → schema.recall(question)                         召回表说明(§5)
  → features.complete("ask_data", …)                模型出一条 SQL
  → gate.check(sql) → 拒绝:{"code": "...", "sql"}   §3,稳定错误码,HTTP 400
  → executor.run(sql, tenant_id)                    §4,只读角色 + RLS + 超时 + 行数上限
  → 200 {"sql", "columns", "rows", "truncated", "elapsed_ms"}
```

演示用管理命令:`manage.py ask_data "问题" --tenant CN_DIYU [--sql "…"]`(`--sql` 跳过模型,直接把给定 SQL 送进闸门和执行器;
没配模型时也能演示闸门与 RLS)。输出 SQL、结果表或错误码。

代码放 `backend/apps/soul_assist/ask_data/`:`gate.py`、`executor.py`、`setup.py`(建角色与策略的 SQL)、`schema.py`、`schema.yaml`、
`evals.py`、`service.py`(把四步串起来,视图与命令共用)、`views.py`;命令放 `soul_assist/management/commands/`。
不开新 app:它和 audit_query 一样是助手的一个接入点,开关、用量、配置都在 soul_assist 里。

**范围(已定):**
- 只做后端接口 + 演示命令。不做 Web 页面、不做官员 App(§9 Q1)。
- **没绑殿的 ADMIN 不开放**:`request.tenant` 为空 → 403 `no_tenant`,不执行任何 SQL(§9 Q2)。
- 白名单四张表,见 §6(§9 Q3)。

**验收:**
- 接口:有殿的官员 + 合法问题(桩模型)→ 200 且字段齐;无 `judgment.read` → 403;没绑殿的 ADMIN → 403 `no_tenant`;
  模型未配置 → 503 `assistant_not_configured`(与 audit_query 同一路径);`ASK_DATA_DATABASE_URL` 未配置 → 503 `ask_data_not_configured`;
  闸门拒绝 → 400 带错误码与原 SQL。
- 命令:`--sql` 模式在没有模型 key 的本地环境能跑出结果(本地演示的验收方式)。
- 新视图过 `tests/test_tenant_scoping_contract.py`;如果视图里有不经 `scope_to_tenant` 的查询,登记进 `tests/tenancy_unscoped_sites.py` 并写明原因(租户由 RLS 与 `request.tenant` 保证)。

## 3. SQL 闸门(`gate.py`)

纯函数:`check(sql: str) -> Verdict`(放行时带解析好的表集合;拒绝时带错误码)。用 sqlglot 按 `postgres` 方言解析成 AST,
规则按 AST 判,不按字符串。错误码是对外契约,写成模块常量,测试按常量断言:

| 规则 | 错误码 |
|---|---|
| 解析失败、空串 | `unparseable` |
| 语句不是恰好一条(`SELECT 1; DROP TABLE …`) | `multiple_statements` |
| 根不是查询,或树里有任何 Insert/Update/Delete/Merge/Create/Drop/Alter/Command/Copy/Set 节点(含 `WITH x AS (DELETE … RETURNING *)`) | `not_a_select` |
| `FOR UPDATE` / `FOR SHARE` 等锁子句 | `locking_clause` |
| 黑名单函数:`pg_sleep*`、`dblink*`、`pg_read_file`、`pg_read_binary_file`、`pg_ls_dir`、`pg_stat_file`、`lo_*`、`set_config`、`current_setting`、`pg_terminate_backend`、`pg_cancel_backend`、`query_to_xml*`、`txid_*`、`pg_advisory*` | `forbidden_function` |
| 函数不在放行清单里(sqlglot 解析成 `Anonymous` 的一律拒;放行一组聚合 / 日期 / 字符串 / 条件函数,清单写在模块里) | `unknown_function` |
| 任何 `Table` 不在白名单(读 `schema.yaml`),或带 schema 前缀,或是 `information_schema` / `pg_catalog` 下的;CTE 名不算表 | `table_not_allowed` |
| `SELECT *` 或 `t.*` | `star_not_allowed` |

注释在解析时被丢掉:`SEL/**/ECT` 解析失败,`SELECT 1 -- ; DROP …` 被当成一条普通 SELECT。闸门是第一道,**不是唯一一道**,
§4 的只读角色与 RLS 必须在闸门全失效时也挡得住。

**验收(`tests/test_ask_data_gate.py`,SQLite 也跑,不碰库):**
- 每条拒绝用例断言**错误码**,至少覆盖:注释绕过(`/* */` 拆关键字、`--` 截断后跟第二条语句)、多语句、`SELECT 1; DROP TABLE souls_soul`、
  `; DROP` 带前导空白与大小写变体、CTE 藏 DELETE、`FOR UPDATE`、`pg_sleep(10)`、`dblink(…)`、`pg_read_file('/etc/passwd')`、`set_config(…)`、
  `current_setting(…)`、未知函数、`information_schema.tables`、`pg_catalog.pg_roles`、`public.judgment_judgment`(schema 前缀)、非白名单表(`authentication_user`)、
  子查询里的非白名单表、`SELECT *`、`t.*`、空串。
- 放行用例:单表计数、两表 JOIN、CTE、`UNION`、带日期函数与 `CASE`、子查询 —— 断言放行且表集合正确(断言存在,也断言不多不少)。
- 证明会红:临时去掉一条规则(如表白名单),对应用例变红;记在 PR 说明里,不留在代码里。

## 4. 只读执行与库里的墙(`setup.py`、`executor.py`)

**角色与策略(`manage.py ask_data_setup`,幂等,按环境跑一次,需要 CREATEROLE):**

- 建 LOGIN 角色(默认名 `soulledger_ask_data`,可用参数改):`NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT`,
  密码从环境变量 `ASK_DATA_DB_PASSWORD` 读,不从命令行读。
- `GRANT USAGE ON SCHEMA public`;只对白名单表的白名单列 `GRANT SELECT (列…)`(**列级授权**,清单读 `schema.yaml`)。
  重跑时先 `REVOKE ALL` 这几张表再授,保证清单删了列权限也跟着收回。
- 白名单表 `ENABLE ROW LEVEL SECURITY`(**不 FORCE**),`DROP POLICY IF EXISTS` 后
  `CREATE POLICY ask_data_tenant ON <表> FOR SELECT TO <角色> USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::bigint [AND NOT is_deleted])`
  (有软删列的表加后半句)。
- SQL 写在 `setup.py` 的一个函数里,命令和测试调用同一个函数。不放迁移:建角色是集群级操作、要密码、要 CREATEROLE,
  不该随每次 `migrate` 跑;策略引用角色,角色不在时建不了。代价是这几条 DDL 不在迁移历史里 —— 写进 ADR 0007。

为什么不 FORCE、为什么策略只 `TO` 这个角色:生产的 `soulledger` 是表的 owner(`docker-compose.production.yml` 同一个用户跑 migrate),
owner 在不 FORCE 时绕过 RLS —— **现有业务一行不受影响**,墙只对问数角色存在。代价:哪天业务改成非 owner 角色连库,
它会在这四张表上读到零行(没有适用策略 = 默认拒绝)。写进 ADR 0007。

**连接与执行。** 新数据库别名 `ask_data`,读 `ASK_DATA_DATABASE_URL`(未配置时不加这个别名,功能答 503)。别名要排除在迁移、
`migrate_shards`、分库路由与测试库创建之外(实现时查 `config/` 下的路由与 `testdb.py`)。每次执行一个事务:

```sql
BEGIN READ ONLY;
SET LOCAL statement_timeout = '3s';                       -- 比全局 60 s 短(config/settings.py:253),设置项 ASK_DATA_TIMEOUT_MS
SELECT set_config('app.tenant_id', '<request.tenant.pk>', true);   -- SET LOCAL,COMMIT 即失效,适配 pgbouncer 事务池
<闸门放行的 SQL>                                          -- fetchmany(MAX_ROWS + 1);多出的一行只用来标 truncated
COMMIT;
```

- 殿只来自 `request.tenant`,不来自问题,不来自模型。`tenant_id` 为空 → 不执行(fail closed)。
- `MAX_ROWS` 默认 200(设置项 `ASK_DATA_MAX_ROWS`)。执行器不改写 SQL 加 LIMIT,只按 fetchmany 截断。
- 错误码:超时 `timeout`;权限错(未授权列 / 表)`permission_denied`;只读事务里的写 `read_only`;其余库错 `execution_error`
  (原文进日志,不回给前端)。
- **分库**:官员所在殿的文明在 `SHARD_READ_CIVS` 里 → `not_on_this_database`,不执行。

**验收(`tests/test_ask_data_rls.py`,PG-only,登记进 `tests/test_concurrency.py::test_the_postgres_only_set_is_the_set_we_think_it_is` 的名单;
fixture 建的角色名带随机后缀、测试后删除,与 `test_row_level_security_probe.py` 同一套清理写法):**
- 跨租户:两个殿各有案件与灵魂;以殿 A 执行一条**没写租户过滤**的 `SELECT count(*) FROM judgment_judgment` 只数到 A 的;
  `WHERE id = <B 的案件>` 返回空;JOIN `souls_soul` 也只有 A 的行。四张表各至少一条。
- 软删的行不可见。
- 不设殿 → 零行;同一连接 COMMIT 后再查 → `current_setting` 为空且零行(pgbouncer 泄漏那条)。
- **绕过闸门**直接交给执行器:`UPDATE …` → `read_only`(或权限错);`SELECT pg_sleep(10)` → `timeout`,且用时 < 5 s;
  读未授权的列(`confession`)→ `permission_denied`;读未授权的表(`authentication_user`)→ `permission_denied`;
  `SELECT set_config('app.tenant_id', '<B>', true)` 之后再查 —— 断言仍只见 A(若做不到,记为已知缺口写进 §8,并确认闸门挡住它)。
- 超大结果:`generate_series` 或多行数据 → 返回 `MAX_ROWS` 行且 `truncated = true`。
- `ask_data_setup` 跑两次结果一样(幂等);跑完后 owner 角色在这四张表上照常读写(不 FORCE 的证明),`relforcerowsecurity` 为假。
- 证明会红:去掉策略(或改成 FORCE 以外的错误形状),跨租户用例变红。

## 5. Schema 召回(`schema.py`、`schema.yaml`)

`schema.yaml` 是唯一来源:每张表一段说明、每列一行(列名、类型、中文业务叫法、同义词、枚举值的含义,
如 `verdict` 的取值、「结案」= `is_final`、「申诉」= `grievance_status`),以及该列是否授权给只读角色。它同时喂给:
闸门的表白名单、`ask_data_setup` 的列授权、召回语料、给模型的表结构。四处读同一份,不抄。

召回:每张表一个文本块,用 `vectors.embed` 取向量、`vectors.nearest` 取最近 k 张(k 默认 3)。降级照 `vectors.retrieve` 的规矩:
向量服务不通、超时、库里没有向量、相似度低于下限 → 返回全部白名单表(只有四张,整份不长),`mode` 标 `fallback*`。
向量存哪:复用 `HelpChunk`(用一个专门的 `audience` 值)还是另起一张小表,实现时取改动小的一种,写进讲解稿。

**验收(`tests/test_ask_data_schema.py`):**
- `schema.yaml` 里每张表、每个授权列在模型里真实存在(读 `_meta`,改了模型这条会红);未授权列至少包括 §6 列出的那些。
- 闸门白名单 == `schema.yaml` 的表集合 == `ask_data_setup` 授权的表集合(断言三者相等)。
- 召回:装假的 embed(根 conftest 默认让出网失败),「申诉」类问题把 `judgment_judgment` 排第一;embed 失败 → `fallback` 且返回全部表。
- 每列的同义词至少覆盖评测集里出现的业务叫法(用评测集反查,缺了就红)。

## 6. 白名单表(已定)

| 表 | 用途 | 不授的列(至少) |
|---|---|---|
| `judgment_judgment` | 案件:判决、结案、申诉、时间 | `confession`、`notes`、`summary`、`grievance_plea`、`grievance_note`、`evidence_json`、`fail_reason_note` |
| `souls_soul` | 灵魂:状态、文明、功过分 | 姓名与其他身份信息、自由文本(实现时逐列定,写进 `schema.yaml`) |
| `disposition_disposition` | 去向 / 处置 | 自由文本 |
| `sentence_plan_sentenceplan` | 受刑计划 | 自由文本 |

表名以实现时 `Model._meta.db_table` 为准。策略一律 `tenant_id = 当前殿`(有软删列的加 `AND NOT is_deleted`),比 ADR 0006 探针里
`souls_soul` 的「本籍殿也能读」更窄:问数只回答本殿的数据。

## 7. 评测(`evals.py`、`evalsets/ask_data.json`、`manage.py ask_data_eval`)

**用例集:** 40 题(下限 30,上限 50)。每题:`id`、`question`、`gold_sql`(标准 SQL)、`naive_sql`(离线桩模型的输出)、
`ordered`(题目要求排序时为真)、`expect`(`ok` 或期望的错误类型,用于反例题)。题目分布至少:单表计数 / 过滤 10 题、两表以上 JOIN 8 题、
聚合与分组 8 题、时间范围 6 题、同义词与业务叫法 5 题、反例(注入、越权表、跨殿意图)5 题。四张表都要被用到。

**固定种子数据:** 评测与其单元测试用同一份种子(两个殿,各几十条案件 / 灵魂 / 处置 / 计划,时间钉死,`today` 写在用例集头里)。

**比对口径(执行结果比对):**
- `gold_sql` 与模型 SQL 都在**同一殿、同一种子**上经执行器跑;期望结果不手写,由 `gold_sql` 跑出。
- 两边结果都转成行的多重集合比较:不比列名,不比列序(每行按值排序后比);`ordered` 为真时才比行序。
- 数值:整数精确比,小数四舍五入到 6 位;`NULL` 与 `NULL` 相等;日期时间统一成 ISO 字符串。
- 任一边被截断(`truncated`)→ 该题不判对,分类 `truncated`。
- 执行准确率 = `ok` 题数 / 非反例题数;反例题单独算「拒绝率」(期望被拒且被拒的比例)。

**错误分类**(每题落且只落一个,按顺序判第一个命中的):
`no_sql`(模型没给出可提取的 SQL)→ `gate_rejected`(带闸门错误码)→ `timeout` → `permission_denied` → `execution_error` →
`truncated` → `ok` → `wrong_table`(用到的表集合与 gold 不同)→ `wrong_join`(表集合相同、JOIN 条件不同)→
`wrong_filter`(JOIN 相同、WHERE 不同)→ `wrong_aggregate`(GROUP BY / 聚合函数不同)→ `other`。
AST 差异判不出的落 `other`;分类是帮人看,不是精确诊断。

**两种跑法:**
- `--offline`:桩供应商直接返回 `naive_sql`。naive 里有的题是对的、有的故意忘了租户过滤(结果应与 gold 相同 —— RLS 兜住了)、
  有的故意错表 / 错 JOIN / 错过滤、有的写 `; DROP`。离线跑证明的是闸门、执行器、RLS、比对与分类本身,**不证明任何模型的准确率**。
  需要真 PostgreSQL(RLS 只在 PG 上有)。
- `--live`:走 `features.complete`,要配模型。跑出的才是执行准确率。没跑过 `--live` 之前,文档与简历都不写准确率数字。
- 输出:总分、按分类计数、每题一行(id、分类、错误码)。

**验收(`tests/test_ask_data_evals.py`):**
- 比对:列序不同算对、行序在 `ordered=False` 时不算错而 `ordered=True` 时算错、NULL、小数、截断各一条。
- 分类器:每个分类至少一条构造用例命中。
- 用例集自检:条数在 30–50;每条 `gold_sql` 过闸门;四张表都被用到;反例题 `expect` 不是 `ok`。
- 离线整套(PG-only,登记进 PG-only 名单):在种子上跑 `--offline`,断言得到用例集里记下的固定分数与分类计数;
  「忘了租户过滤」的那几题判 `ok`(证明 RLS 兜住)。

## 8. 没做 / 这一版不做

- 不是全库 RLS,ADR 0006 的 rollout 条件一条没动;业务连接仍只有视图层一道墙。
- 分库上的问数(`SHARD_READ_CIVS`);ADMIN 跨殿问数;多轮追问;模型看结果再总结;图表;Web 页面与官员 App。
- pgbouncer 本身没在测试里:和 ADR 0006 一样,用同一连接 COMMIT 后复查来代替。
- 真模型的准确率只有跑了 `--live` 才有数字。

实现时补一份 ADR 0007(问数的只读角色与表级 RLS、为什么不放迁移、不 FORCE 的代价,与 ADR 0006 的关系)。

## 9. 已拍板(2026-11-21,均取推荐项)

- **Q1 前端**:只做后端接口 + 演示用管理命令 `manage.py ask_data`。不做 Web 页面与官员 App。
- **Q2 没绑殿的 ADMIN**:不开放,403 `no_tenant`。
- **Q3 白名单表**:§6 的四张。
- **Q4 新依赖**:加 sqlglot,进 `backend/requirements.txt` 与 `backend/requirements.lock`(按锁文件头部注释写的 `uv pip compile` 方式重算,
  只多它这一行;会让门禁强制跑一次全量)。
- **Q5 提交**:在功能分支 `feat/ask-data` 上分几次提交,跑 `scripts/run-gates.sh` 与 `scripts/run-gates.sh --real-pg`(远端 unRAID),
  **不推送**,等用户看过再推。

## 10. 实现顺序与并行分工

**第 0 步(串行,主会话,先于一切):** 建分支 `feat/ask-data`;加 sqlglot 依赖(requirements 两个文件);写 `ask_data/schema.yaml`
的初版(四张表、列、授权与否、说明);加 `FEATURES` 里的 `ask_data` 与迁移;建空的 `ask_data/__init__.py`。提交。
这一步是后面所有子代理的共同基础:表白名单、列授权、依赖都从这里来。

**第 1 步(四个子代理并行,各自一个 worktree,都从第 0 步的提交开分支):**

| 子代理 | 文件 | 依赖 | 交付 |
|---|---|---|---|
| A 闸门 | `ask_data/gate.py`、`tests/test_ask_data_gate.py` | 只读 `schema.yaml` 的表集合 | §3 全部验收 |
| B 执行器与墙 | `ask_data/setup.py`、`ask_data/executor.py`、`ask_data_setup` 命令、`ask_data` 数据库别名与设置项、`tests/test_ask_data_rls.py`、PG-only 名单登记、ADR 0007 | `schema.yaml` 的列授权 | §4 全部验收(真 PG) |
| C 召回 | `ask_data/schema.py`、`tests/test_ask_data_schema.py` | `schema.yaml`、`vectors` | §5 验收里召回与 yaml 对模型的部分 |
| D 评测 | `ask_data/evals.py`、`evalsets/ask_data.json`、种子 fixture、`ask_data_eval` 命令、`tests/test_ask_data_evals.py` | 写比对与分类时不依赖 A/B;离线整套要 A + B | §7 的比对、分类、用例集自检;离线整套留到第 2 步 |

- 互不重叠的文件,四路可以同时写。共同改动的文件(`config/settings.py`、`test_concurrency.py` 的 PG-only 名单)只归 B;
  D 需要登记的 PG-only 测试在第 2 步由主会话加。
- 每个子代理的 prompt 照 `CLAUDE.md`「Agent Comms」:动手前 `git log --oneline -1` 确认在分支尖端;报告写在最终回复里;
  报的「N passed」只算它跑的那部分。worktree 里没有 `.venv`,用主 checkout 的 `backend/.venv` 绝对路径。
- 子代理只在 worktree 里提交到自己的分支,不合并、不推送。

**第 2 步(串行,主会话):** 按 A → B → C → D 合进 `feat/ask-data`;写 `ask_data/service.py`(召回 → 模型 → 闸门 → 执行)、
`views.py` 与路由、`ask_data` 演示命令、接口测试(§2 验收)、D 的离线整套测试并登记 PG-only 名单;
补 §5 验收里「闸门白名单 == yaml == 授权表集合」的三方相等测试(需要 A、B、C 都在)。

## 11. 合并后的门禁与收尾

1. 工作区干净(先提交)后跑 `scripts/run-gates.sh`(依赖改了,会被强制全量,输出会写明规则);要求后端与 JS 两侧都绿,读退出码。
2. 跑 `scripts/run-gates.sh --real-pg`(远端 unRAID,含全部 PG-only 测试:§4 的 RLS 用例与 §7 的离线整套)。
3. 本地演示:对本地 PG 跑 `ask_data_setup`,再 `manage.py ask_data "…" --tenant CN_DIYU --sql "SELECT count(*) FROM judgment_judgment"`,
   换另一个殿再跑一遍,数字不同;再跑一条 `; DROP` 看到错误码。命令与输出贴进讲解稿。
4. `ask_data_eval --offline` 的分数与分类计数贴进讲解稿,标明「离线,桩模型,不是模型准确率」。
5. 本文改成讲解稿(每节补代码位置与实测结果,§8 照实更新),ADR 0007 定稿。提交。**不推送**,等用户看过。
