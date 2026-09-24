# 处置期满状态与每日检查、列表带判决与分段计数、审判先例

分支 `feat/disposition-expiry-precedents`,基于 `main` @ `4e0b778`。

> **THIS BRANCH CONTAINS MIGRATIONS**:`disposition/0015_disposition_expired_at`、
> `events/0018_soulevent_disposition_expired`。两条都是纯加法(加列 / 加约束 / 扩 choices),
> 存量行不改写。

维护者决定照办:**落判后 5 秒撤回不做**;落判(conclude)提交流程的时序一行没动。

---

## 1. 状态机的选择:`expired_at`,不是一列状态

`Disposition` 没有状态列。它的「状态机」就是 `is_executed` / `executed_at` 这一对布尔 + 时间戳。
期满是接在「已执行」后面的第三步,所以用同一个写法:**加一列 `expired_at`(可空 DateTime)**,
null = 未期满。

- 三段由这两列推出,不另存:`pending = is_executed=False`,
  `executing = is_executed=True AND expired_at IS NULL`,`expired = expired_at IS NOT NULL`
  (`apps/disposition/models.py::SECTION_FILTERS`,列表过滤与计数读的是同一份)。
- 新约束 `disposition_expired_only_if_executed`:`expired_at IS NULL OR is_executed`。
  它让三段互斥且覆盖全部行。
- 只由期满检查写(序列化器里 `expired_at` 只读,和 `is_executed` 一样)。
- **灵魂状态不动。** 执行处置时灵魂已经被推到 REINCARNATING / SETTLED
  (`DispositionService.execute`);期满只是「刑期走完」这个事实被记下来,灵魂在等轮回,推进它是转生那一步的事。
- 不撤销:期满后改长刑期,`expired_at` 不会被清掉(见开放问题)。

为什么不加一个枚举 `status`:它会和 `is_executed` 形成两份真相,而 `is_executed` 被
`execute()`、并发锁、序列化器、受刑计划到处读。多一列时间戳是最小的改动,且保留了「什么时候期满」这个事实。

### 什么算「期满」(`apps/disposition/expiry.py::term_has_ended`,唯一一份定义)

刑期在起算日的第 N 个周年日**当天**走完:`term_end = (起算年 + N, 起算月, 起算日)`。

- 没有公元 0 年:起算在公元前、期满跨到公元时多加一年(5 BCE + 5 年 = 1 CE),与 `apps/souls/dates.year_span` 一致。
- 缺月:等到期满年的 12 月 31 日;缺日:等到期满月的最后一天。**宁可晚一天,不提前放人** —— 与
  `sentence_elapsed_years` 缺精度时给上界的方向相反,因为期满是一次写入。
- 2 月 29 日起算、期满年不闰:3 月 1 日期满。
- 刑期 0 年:起算当天期满。
- **永远不期满**:`is_eternal`;`sentence_years` 为 null(没记刑期,不是 0);
  `term_start_year` 为 null(没记起算日 —— 不从 `executed_at` / `death_year` 推,模型注释说了为什么);未执行。
- 「今天」是 `timezone.localdate()`,而 `TIME_ZONE = "UTC"`。

序列化器新增的 `term_end` 用的是同一个函数,页面的刑期条读它,不再自己用 `term_start + sentence_years` 算。

## 2. 迁移

| 迁移 | 内容 | 存量行 |
|---|---|---|
| `disposition/0015_disposition_expired_at` | 加 `expired_at`(null);加约束 `disposition_expired_only_if_executed` | 全为 null,约束对存量成立 |
| `events/0018_soulevent_disposition_expired` | `SoulEvent.event_type` 的 choices 加 `DISPOSITION_EXPIRED` | 不动(只改 choices;长度 19 < 30) |

`0015` 的依赖手动收窄到只依赖 `disposition/0014`(自动生成的那版带了五个无关依赖)。
部署后第一次每日检查(或 `manage.py expire_dispositions`)会把刑期已走完的存量处置补上 —— 但见开放问题 1。

## 3. 每日任务:注册与手动运行

与既有定时任务同一个形状(`ledger.recalculate_*`、`judgment.auto_conclude_stale*`):

- `apps/disposition/tasks.py`
  - `disposition.expire_due_for_tenant(tenant_id)`:只处理一个租户;**进入时 `set_current_tenant(tenant)`,
    `finally` 里 `clear_current_tenant()`** —— 审计行靠这个 contextvar 归到租户。
  - `disposition.expire_due`:扇出父任务,给每个 `is_active` 租户 `.delay(tenant_id=...)` 一次子任务。
    不被调度(调度的是每租户子任务),留给「一次跑所有租户」用,与 ledger / judgment 的父任务同理。
- `apps/scheduler/registry.py`:`JobSpec("disposition.expire_due_for_tenant", TENANT, "30 2 * * *", max_runtime=1800)`。
  每天 02:30 UTC,排在 00:00–02:00 三条租户任务之后。`setup_scheduled_tasks` 会为每个活跃租户建一行
  `PeriodicTask`(`disposition.expire_due_for_tenant@<租户码>`),受 `SchedulerTask` 的单飞锁、TaskRun 记录与逾期检测管。
  既有的 `test_every_registry_task_is_one_a_worker_can_run_with_the_kwargs_we_send` 覆盖了它。
- 幂等:候选只选 `expired_at IS NULL`;每一行在自己的事务里、在行锁下(`select_for_update(of=("self",))`)复查
  `expired_at` 再写,所以定时一次、手动一次并发也只发一次事件。漏跑一天由第二天补上。
- 写入走 `save(update_fields=["expired_at"])`,所以审计信号照常记一条 UPDATE(与 `execute` 写 `is_executed` 同一条路);
  另在灵魂时间线上记 **`DISPOSITION_EXPIRED`**(新事件类型,与 `DISPOSITION_CREATED` 并列;payload:
  `disposition_id`、`realm`、`sentence_years`、`expired_at`)。前端 `event_registry.ts` / `eventHandlers.ts` 与三份语言包已同步
  (`souls.events.DISPOSITION_EXPIRED`、`scheduler.jobs.disposition_expire_due_for_tenant`)。

**celery beat 仍然没有部署**(仓库里的现状与任务说明一致)。在它部署之前,手动运行:

```bash
cd backend
.venv/bin/python manage.py expire_dispositions                 # 所有活跃租户
.venv/bin/python manage.py expire_dispositions --tenant CN_DIYU
```

命令在进程内调用同一个每租户任务体(不需要 worker 与 broker),每个租户各自设置 contextvar。
另有 admin 动作 **「Run the expiry check for the selected rows' tenants」**(Disposition 列表页):
对所选行涉及的租户跑整租户的检查 —— 故意不只查所选行,「到期」只有一份定义。

## 4. 接口形状

### `GET /api/v1/disposition/`(列表)与 `GET /api/v1/disposition/{id}/`(详情)

每行新增(全部只读):

| 字段 | 类型 | 含义 |
|---|---|---|
| `expired_at` | datetime \| null | 期满检查写下的时间 |
| `term_end` | `{year, month, day}` \| null | 刑期走完的那一天(同 §1 的算法);永久刑、缺刑期或起算日时为 null |
| `section` | `"pending" \| "executing" \| "expired"` | 这一行在哪一段 |
| `verdict` | `VerdictEnum` \| null | 产生它的判决(`judgment.verdict`);没有本地审判时为 null |
| `soul_state` | `CurrentStateEnum` | 灵魂**现在**的状态 |
| `soul_reborn` | boolean | 这份处置所属的那一世(`cycle`)之后灵魂是否已转世(有 `cycle_count > cycle` 的转生记录) |

新过滤项:

- `?section=pending|executing|expired`(非法值 400)
- `?soul_reborn=true|false` —— 「期满」段用 `soul_reborn=false` 藏起已经转世的灵魂

列表信封多一个 `section_counts`:

```json
{
  "count": 23, "next": "...", "previous": null, "results": [...],
  "section_counts": {"pending": 2, "executing": 1, "expired": 23}
}
```

`section_counts` 是**当前所有过滤条件(租户范围、归档、`soul`、`soul_reborn`……)下三段各自的总行数,只忽略
`section` 本身** —— 一条聚合 SQL。所以打开「期满」页签时,另外两个页签也有真实数字;`soul_reborn=false`
藏了哪些行,计数就不数哪些行。

N+1:`judgment` 进了 `select_related`,`soul_reborn` 是一个 `Exists` 子查询注解;测试比较 3 行与 15 行的 SQL 条数,相等。
单条响应(`execute` / `archive` 的返回)没有注解,退回一次 `exists()` 查询。

### `GET /api/v1/judgment/{id}/precedents/?limit=5`

权限 `judgment.read`(ADMIN / MODERATOR / JUDGE;VIEWER 与 GUARDIAN 403)。裸数组,不分页,不带列表的过滤项。
`limit` 默认 5,夹在 1..20;非整数 400。

```json
[
  {
    "id": "<judgment uuid>", "soul": "<soul uuid>", "name": "张三",
    "verdict": "FAILED", "court": "第五殿", "concluded_at": "2026-09-20T…Z",
    "balance": -7, "realm_code": "DY_05_…", "realm_name": "…",
    "same_court": true, "shared_statutes": 2
  }
]
```

`realm_code` / `realm_name` 是那份审判产生的处置的去处(`realm_name` 按请求的语言本地化);没有处置时为 null。

## 5. 先例的排序(`apps/judgment/precedents.py`)

候选:**这份审判自己的租户**(不是请求者的 —— ADMIN 也不跨租户)、同一文明、已结案(`verdict` 非空)、未归档,
且**不是同一个灵魂**(同一灵魂的前案是它的履历,不是先例)。

依次比较,前一项相同才看后一项:

1. 同一殿:`court` 字符串相同且**非空**的在前(空 `court` 不算匹配);
2. 业力余额(灵魂的 merit − demerit)与本案灵魂余额之差的绝对值,小的在前;
3. 与本案共同援引的法条数,多的在前;
4. 结案时间新的在前,最后按 id —— 结果稳定。

整个排序是一条 SQL(annotate + order_by + limit)。注意第 3 项只在余额**完全相等**时才起作用 ——
这是「然后」的字面意思;若希望法条重合度与余额混合打分,见开放问题 3。

VIEWER 余额扣留:序列化器对 VIEWER 返回 `balance: null`(与 `SoulSerializer` 扣留 `karmic_balance` 同一个 `_is_viewer`
判定)。VIEWER 今天根本没有 `judgment.*`,端点直接 403;序列化器这一层是第二道地板,防的是将来给 VIEWER 开读时顺带开了分数。

## 6. core 包

- `schema.yml` 与 `src/api/generated/schema.ts` 由 `manage.py spectacular` + `npm run schema:generate` 重新生成。
  新增 `ENUM_NAME_OVERRIDES`:`CurrentStateEnum`(`soul_state` 与 `current_state` 同一选项集,钉在既有名字上)、
  `DispositionSectionEnum`(`section` 太通用)。
- `api/disposition.ts`:`Disposition` 加上述字段(可选,见文件内注释)、`DispositionSection`、`DispositionSectionCounts`、
  `DispositionPage`(信封 + `section_counts`)、`DispositionListParams`(`section`、`soul_reborn`)。
- `api/judgment.ts`:`JudgmentPrecedent` 类型、`judgmentApi.precedents(id, limit?)`。
- `hooks/useJudgments.ts`:`useJudgmentPrecedents(id, limit?)`,key `judgmentKeys.precedents(id, limit)`,挂在
  `judgmentKeys.all` 下 —— 落判已经会 invalidate 这个根。
- `hooks/useDispositions.ts`:`useDispositions(params)` 接受 `DispositionListParams`。

`/disposition` 页面本身**没有**在这个分支里改版 —— 这里交付的是它要读的接口与 hooks。

## 7. 开放问题

1. **存量处置都没有起算日,所以存量不会期满。** `term_start_*` 由 `disposition/0011` 加入,所有更早的行都是 null,
   而模型注释明确拒绝从 `executed_at` 推起算日。结果:部署后每日检查对存量行是 no-op,直到有人记录真正的起算日。
   要不要允许「起算日缺失时以 `executed_at` 的日期起算」?这是一个领域决定,不是这个分支该替你做的;
   若要,改的是 `expiry.candidates` 的一个条件与 `term_has_ended` 的输入,测试里「没有起算日永不期满」那条会跟着翻。
   另外,自动生成的处置(`create_from_judgment`)也不写 `term_start` —— 新处置同样不会期满,除非在执行时记起算日。
2. **余额没有快照。** 先例用的是灵魂**现在**的余额。一个先例灵魂转世之后,它的余额描述的是新的一世(含继承部分)。
   精确的做法是在 `conclude` 时把余额快照进 `Judgment`(一列 + 一条迁移);没做,因为维护者说了落判流程不动。
3. **第 3 项排序几乎只在平局时生效。** 余额是整数,完全相等并不常见。如果审判台想要「法条重合度」更有分量,
   可以把余额分桶(例如按 10 取整)再比法条。当前按字面实现并写进了文档。
4. **期满后改刑期。** `expired_at` 不会因刑期被改长而清掉(期满是一次写入的事实)。要不要在序列化器写刑期 /
   起算日时,若新的期满日在未来就清空 `expired_at`?
5. **归档的处置也会被标期满。** 期满是关于时间的事实,与是否在列表上无关;列表默认仍然藏起归档行。
6. **受刑计划节点。** 挂在计划节点上的处置执行时节点就被标完成(`_execute_plan_node`);期满检查与计划互不相干,
   没有去推进计划。若计划节点应当「刑满才完成」,那是计划状态机的改动,不在这里。
7. **没有 PostgreSQL 上的实跑。** 行锁用 `select_for_update(of=("self",))` 以避开可空外连接(`destination_realm`)
   在 PostgreSQL 上的 `FOR UPDATE cannot be applied to the nullable side of an outer join`;新的 CheckConstraint 在
   PostgreSQL 上会被强制。这两点在 SQLite 上都验不到 —— 这台云主机没有 PostgreSQL,也不能连 115。

## 8. 门禁

GATES_PLACEHOLDER
