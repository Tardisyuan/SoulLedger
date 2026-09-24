# 跨文明审判等接口补上租户 / 用户显示名

分支 `fix/api-display-names`,基于 `main` @ `4e0b778`。

## 症状 → 根因 → 修法

- **症状**:官员页 `/cross-judgments/[id]` 显示「发起方: 1」,那个 1 是租户主键。
- **根因**:`CrossTenantJudgmentSerializer` 返回 `initiating_tenant`(主键)和
  `initiating_tenant_code`,但没有显示名。页面印的是主键
  (`frontend/app/cross-judgments/[id]/page.tsx:149`)。参与方席位也是一样:
  `:213` 印的是 `p.participant_tenant`。
- **修法**:在序列化器里新增只读的显示名字段,放在代码旁边。主键和代码都保留(§4.6:原始标识
  必须仍可回溯)。租户对应 `Tenant.display_name`,用户对应 `username`(可回溯)加
  `display_name`(给人读)。**前端页面没有改动**,由正在重做前端的那条分支改用这些字段。

## 新增字段

| 序列化器 | 新字段 | 来源 | 应改用它的前端位置 |
|---|---|---|---|
| `CrossTenantJudgmentSerializer`(详情) | `initiating_tenant_display_name` | `initiating_tenant.display_name` | `frontend/app/cross-judgments/[id]/page.tsx:149`(「发起方」,现在印的是 `initiating_tenant` 主键) |
| `CrossTenantJudgmentListSerializer`(列表) | `initiating_tenant_display_name` | 同上 | `frontend/app/cross-judgments/page.tsx:129`(现在印代码) |
| `CrossTenantJudgmentParticipantSerializer`(详情里嵌套的 `participants`) | `participant_tenant_display_name` | `participant_tenant.display_name` | `frontend/app/cross-judgments/[id]/page.tsx:213`(现在印 `participant_tenant` 主键) |
| `ApprovalNodeSerializer`(单独的 `/nodes/`,以及嵌套在 `ApprovalWorkflowSerializer` 的 `nodes` / `current_node_detail` 里) | `approver_username`、`approver_display_name`(节点未决或账号已删时为 null) | `approver.username`、`approver.display_name` | `frontend/app/workflow/[id]/page.tsx:596-621` 和 `frontend/src/components/workflow/detail/WorkflowNodeHistory.tsx:59-84`。两处都因为没有名字而显示 `MissingValue`,注释里写着「THE REAL FIX IS ON THE BACKEND」 |
| `TaskRunSerializer` | `tenant_code`、`tenant_display_name`(全局任务为 null) | `tenant.code`、`tenant.display_name` | `frontend/src/components/scheduler/RunHistoryPanel.tsx:204-206`(现在靠 job 列表查代码,查不到就印 `String(run.tenant)`,也就是主键) |

`display_name` 可能是空字符串(`User.display_name` 允许为空),所以前端应当回退到
`username` 或代码,而不是回退到主键。

## 排查:哪些字段查过但没改

扫描方法:导入所有 `apps.*` 模块,实例化每一个序列化器,找出所有指向 `Tenant`、`User`、
`Realm` 的关联字段,再看同一个序列化器里有没有 `source` 以 `<field>.` 开头的配套字段。
共 **42** 个这样的字段,其中 **24** 个已经有配套的名字或代码,**18** 个是裸 id。
然后在 `frontend/app/**`、`frontend/src/components/**` 和 `packages/core/src/api/**`
里逐个查这 18 个字段。除上表外,以下字段前端**没有显示**,或只当 id 用,按要求不改:

| 序列化器.字段 | 为什么不改 |
|---|---|
| `AuditLogSerializer` / `AuditLogDetailSerializer`.`create_user` / `update_user` | 前端没有读它们;审计页显示的是 `user_display` / `username` |
| `UserNotificationSerializer.user` | 就是收件人本人,前端不显示 |
| `OrganizationSerializer.tenant` | `app/organizations` 不显示租户 |
| `RealmSerializer.parent_realm` | 只在 `packages/core/src/api/realms.ts:15` 的类型里出现,没有地方渲染它 |
| `ApprovalNodeSerializer.realm`、`ApprovalWorkflowSerializer.coordinating_realm` / `tenant`、`WorkflowTemplateSerializer.tenant` | 工作流页面都不显示 |
| `PostSerializer` / `CommentSerializer` / `ReactionSerializer` / `FollowSerializer`.`tenant` | 社交页不显示;`ReactionBar` 读 `r.user` 是为了和当前用户比对(当 id 用) |
| `FollowCreateSerializer.following` | 只用于写入 |

已经有配套字段、所以没动的:`DispatchRecord*`(`*_tenant_code`、`dispatched_by_name`)、
`ScheduledJobSerializer.tenant_code`、`Follow*_name`、`DispositionSerializer.realm_code`,
以及上面提到的其余 24 个中的其他字段。

**没有覆盖到的范围**:不经过序列化器的实时推送(`apps/scheduler/realtime.py` 里 WebSocket 帧中的
`tenant_id`),以及 `mobile/`。这次只看了官员端的 web。

## N+1

- 跨文明审判:列表和详情原本就有 `select_related("initiating_tenant")`,参与方也已经有
  `Prefetch(... select_related("participant_tenant", "participant_actor"))`(见 PQ-01),
  新字段只是读已经 join 进来的行。新增的测试 `test_the_cross_judgment_list_does_not_query_once_per_row`
  验证 10 行(来自 5 个不同发起方)的查询数与 1 行相同(都是 6 次)。
- 工作流:嵌套的 `nodes` 原来是 `prefetch_related("nodes")`,读 `approver.*` 会每个节点多一次查询。
  改成 `Prefetch("nodes", ApprovalNode.objects.select_related("approver"))`,`current_node` 也加了
  `current_node__approver`(`apps/workflow/views.py`)。测试 `test_the_workflow_detail_does_not_query_once_per_approver`
  验证 4 个已决节点和 1 个已决节点的查询数相同。
- `TaskRunViewSet` 原本就 `select_related("tenant")`。
- **两条计数测试都做了变异验证**:去掉 `select_related("initiating_tenant")` 后,列表查询数从 6 变成 15;
  把 `Prefetch` 换回裸的 `"nodes"` 后,查询数从 6 变成 9。两条都失败了。改回之后重新变绿。

## 测试

`backend/tests/test_officer_api_display_names.py`,共 9 条:

- 检查每个新字段存在且值正确,主键仍然保留。
- 检查缺席,也就是租户隔离仍然成立:A 既不是发起方也没有席位的联审,C 和 B 的显示名与代码都不会出现在
  A 的列表响应里,详情返回 404。别的租户的工作流返回 404,列表和详情里都没有对方审批人的用户名或显示名。
  JUDGE 的 `/scheduler/runs/` 只返回本租户的运行记录,响应里没有其他租户的名字。
- 未决节点和全局任务的名字字段是 `null`,而不是空字符串。
- 上面两条查询计数测试。

另外,`frontend/src/__tests__/SentencePlanPanels.test.tsx` 的两个测试数据里补上了新的必填字段。
这是 `tsc` 要求的,不是页面改动。

## 门禁(都在改动后的树上跑)

| 门禁 | 命令 | 退出码 | 结果 |
|---|---|---|---|
| 全量 pytest | `SECRET_KEY=… DEBUG=true DATABASE_URL=sqlite:///:memory: REDIS_URL=redis://127.0.0.1:6399/0 CELERY_*=… .venv/bin/python -m pytest --tb=short -q` | (运行中) | 待补:本提交时全量套件尚未跑完 |
| ruff | `.venv/bin/ruff check .` | 0 | All checks passed! |
| 迁移 | `makemigrations --check --dry-run` | 0 | No changes detected |
| schema:warning / error | `manage.py spectacular --fail-on-warn --validate` | 0 | 0 个 warning,0 个 error;输出与提交的 `schema.yml` 逐字节相同 |
| schema 测试 | `pytest tests/test_schema_has_no_warnings.py tests/test_committed_schema_matches_the_backend.py tests/test_e2e_fixtures_match_the_serializers.py tests/test_declared_response_shapes_match_the_views.py tests/test_the_schema_does_not_record_its_own_database.py` | 0 | 19 passed |
| 新测试 | `pytest tests/test_officer_api_display_names.py` | 0 | 9 passed |
| core typecheck | `npm run --workspace packages/core typecheck` | 0 | — |
| core lint | `npm run --workspace packages/core lint` | 0 | — |
| core test | `npm run --workspace packages/core test` | 0 | 12 个文件,118 passed(含 `generatedSchemaIsCurrent`) |
| frontend tsc | `cd frontend && npx tsc --noEmit` | 0 | — |
| 改过的 jest 文件 | `npx jest SentencePlanPanels SentencePlanForms` | 0 | 2 个套件,46 passed |

环境:Python 3.11 venv(`requirements.lock` + `requirements-dev.txt`),Node v22.22.2
(vitest 5 要求 node ≥ 22.12,所以没用 20.19.5),依赖用 `npm@11 ci` 安装,装完已还原 `package-lock.json`。
Redis 用的是一次性的 `redis-server --port 6399`。**没有**在 PostgreSQL 上跑:这次只加了只读字段和
查询形状,不涉及事务、约束或列宽。
