# SoulLedger 里程碑计划

## 已完成

### M1-M5 核心系统
- 用户认证与权限系统
- 灵魂管理（CRUD + 状态流转）
- 审判系统（创建/判决/完结）
- 业力系统（积分/衰减/统计）
- 审批流程（可视化 + 模板）
- 前端 i18n 全面覆盖
- CSS 变量主题系统

### M6 修复 (2026-05-27)
- JWT middleware `ExpiredToken` 导入错误 → 全局 500 修复
- 审判页面灵魂名称显示 UUID → 改用后端返回的 `soul_name`
- 测试租户清理（17 个删除）
- permissions migration 修复
- TypeScript 编译清理

### M7 DDD 重构 (2026-05-29)
- P1: 统一权限检查 (`apps/perm/checker.py`)
- P2: SoulRecord 归位 (`karma/models.py`) —— **路径不成立**（2026-08-28 核实）：
  `SoulRecord` 至今定义在 `apps/souls/record_models.py`；`apps/ledger/models.py`
  （`karma` 已更名 `ledger`）只是再导出同一个类。物理搬迁于 2026-08-23 评估后
  决定不做，理由与代价记在该模块的 docstring 里
- P3: DispatchRecord + CrossTenantJudgment 状态机
- P4: Domain Events 补发 (JUDGMENT_CONCLUDED, KARMA_RECALCULATED, 等)
- P5: JudgmentConclusionService 拆分 God method
- P6: WorkflowTemplate DB-first 查询

### M8 Release Candidate Closure (2026-05-30)
- RC-1: EventService tenant 修复
- RC-2: Redis KEYS → SCAN
- RC-3: TenantPermission 补齐 (4 ViewSets)
- RC-4: KarmaExportStatsView O(n) 修复
- RC-5: HealthCheckDetailed 认证加固
- 前端: 16 个 error.tsx 边界, 4 hooks onError
- 报告: SECURITY_CLOSURE_REPORT.md, RC_READINESS_REPORT_FINAL.md

### M9 Engineering Excellence (2026-05-30)
- 清理未使用依赖 (zustand, next-intl)
- 前端 Hooks 测试 (useUsers, useWorkflows)
- 架构一致性审查
- 报告: ENGINEERING_EXCELLENCE_REPORT.md

### M10 搜索与过滤系统 (2026-06-06)
- 搜索 & 过滤 foundation
- Actors & Realms search/filter integration
- Karma module search/filter integration
- Workflow & Dispatch search/filter integration
- Search audit — fix 6 failures + performance report

### M11 死亡同步 API (2026-06-06)
- Death Sync Foundation Layer
- Death Registration API + service + tests
- Webhook System with HMAC signing, retry, Celery tasks
- Reliability layer: throttle, health metrics, tests
- M11 audit — deterministic idempotency, transaction, admin permission, SSRF

### M12 WebSocket 重构 (2026-06-06)
- WebSocket infrastructure — auth, permissions, routing, ASGI
- EventBus + HandlerRegistry + notification consumer + realtime
- WebSocket provider, SocialEventBus, responsive layout, WS client
- Architecture Readiness Review Report

### M13 社交功能 (2026-06-08)
- Backend: Post, Comment, Reaction, Follow, UserProfile models + API
- Backend: 133 tests (models, views, services, permissions)
- Frontend: Social API module, TanStack Query hooks
- Frontend: 5 components (PostCard, CommentThread, ReactionBar, FollowButton, ProfileCard)
- Frontend: 4 pages (Feed, Post Detail, Profile, Follows)
- Sidebar navigation entry (Social menu)
- Data migration: 0007_add_social_menu

### M14 测试覆盖率 + 租户修复 (2026-06-09) ✅
- 后端测试覆盖率 23% → 83% (Task #291)
- TenantManager contextvar 隔离修复 (Task #292)
- TenantCreateMixin.perform_create 修复
- DataScopeViewSetMixin + ViewSet 层租户隔离
- 1023 tests passed, 16 skipped, 8 xpassed
- 详见: `docs/coverage-roadmap.md`, `docs/post-coverage-audit-report.md`

---

## 待开发

*标题保留原样。实际状态：M15 已于 2026-08-07 全部落地，M16 四项里三项已交付——
逐项状态见下表。（2026-08-28 核实）*

### M15 多租户安全加固 (2026-06-09 审计, 2026-08-07 修复) ✅
**目标**: 审计并加固跨服务层、后台任务、异步执行路径的租户隔离
**工作量**: 5-7 天（估）
**详情**: `docs/MILESTONE_M15.md`

审计完成两个月后才动手修——修之前先重新核实过23条发现，确认哪些依然成立而不是照单全收：
16条依然存在（含全部4条CRITICAL，其中一条是无租户边界的物理DELETE），4条已在中途的其他改动里
顺带修好，3条确认是有意为之的设计（Menu/perm端点全局共享、dispatch的`_base_manager`跨租户查询
是为了防重复调度）。16条真实缺口全部修复：Celery四个CRITICAL任务改成按租户分发子任务、
TenantMiddleware/TenantPermission加了JWT租户与用户真实租户的交叉校验、服务层4处创建记录补上
tenant、API层4处补上租户过滤或换掉用错的权限类。过程中额外发现两个不在审计范围内的问题，
已分别开了独立任务跟进：social序列化器的post/comment字段可跨租户提交、death_sync的API Key
认证端点因权限类配置错误导致所有合法请求都被拒绝（功能性故障，不是数据泄露）。

> **下面三张表是 2026-06-09 的计划表，从未回勾**（2026-08-28 核实：全是 ⏳）。活干完了，
> 表没动。实际收口结果见上一段与 [`docs/MILESTONE_M15.md`](MILESTONE_M15.md) 顶部的修复记录：
> 16 条真实缺口已修，3 条判定为有意为之的设计（Menu/`perm` 端点全局共享、dispatch 的
> `_base_manager` 跨租户查重），其余在两个月里的其他改动中顺带修好。**不要按这三张表的
> ⏳ 判断当前状态**——其中 #294（`task_prerun`/`task_postrun` 信号处理器）确实没有实现，
> 但那是因为最终改用了「按租户扇出子任务 + 任务内 `set_current_tenant()`」的做法
> （见 `apps/ledger/tasks.py`、`apps/judgment/tasks.py`、`apps/death_sync/tasks.py`）。

#### Phase 1: Celery 基础设施 + CRITICAL 修复 (Day 1-3)
| 任务 | Task | 优先级 | 状态 |
|------|------|--------|------|
| Celery task_prerun/postrun 信号处理器 | #294 | P1 | ⏳ |
| karma.recalculate_all per-tenant 分发 | #295 | P1 | ⏳ |
| karma.recalculate_single tenant 验证 | #295 | P1 | ⏳ |
| judgment.auto_conclude_stale per-tenant | #295 | P1 | ⏳ |
| death_sync.cleanup_old_requests 租户过滤 | #295 | P1 | ⏳ |
| death_sync.retry_failed_webhooks per-tenant | #295 | P1 | ⏳ |
| death_sync.deliver_webhook tenant 验证 | #295 | P2 | ⏳ |

#### Phase 2: 服务层 + HIGH 修复 (Day 4-5)
| 任务 | Task | 优先级 | 状态 |
|------|------|--------|------|
| DispositionService tenant 传递 | #296 | P1 | ⏳ |
| WorkflowService.find_template tenant 过滤 | #296 | P1 | ⏳ |
| ReincarnationService tenant 传递 | #296 | P1 | ⏳ |
| PostService 计数器租户验证 | #296 | P1 | ⏳ |
| DispatchService _base_manager 修复 | #296 | P2 | ⏳ |
| UserProfileViewSet 租户过滤 | #297 | P1 | ⏳ |
| PostViewSet.perform_create tenant 设置 | #297 | P1 | ⏳ |
| DispatchRecordViewSet.get_queryset 修复 | #297 | P1 | ⏳ |

#### Phase 3: API 加固 + 文档 (Day 6-7)
| 任务 | Task | 优先级 | 状态 |
|------|------|--------|------|
| UserCreateSerializer 租户强制 | #297 | P2 | ⏳ |
| TokenRefreshView tenant_code | #298 | P2 | ⏳ |
| ExternalApiKeyViewSet 权限类修复 | #297 | P2 | ⏳ |
| DeathSyncHealthView 租户过滤 | #297 | P2 | ⏳ |
| OrgViewSet.tree 空值处理 | #297 | P2 | ⏳ |
| TenantMiddleware 用户-租户验证 | #298 | P2 | ⏳ |
| perm 端点 TenantPermission | #298 | P2 | ⏳ |
| MenuViewSet 文档或租户过滤 | #297 | P2 | ⏳ |
| 审计报告 | #299 | P1 | ⏳ |
| 跨租户访问测试 | #299 | P1 | ⏳ |

### M16 i18n 与 UX 完善 (3/4 已交付)
**目标**: 国际化翻译 + 社交功能完善

逐项核实于 2026-08-28：

| 任务 | 优先级 | 状态 | 依据 |
|------|--------|------|------|
| i18n 翻译文件 (中/英) | P1 | ✅ | `frontend/messages/{zh-Hans,en,egy}.json` 三份键集对齐 |
| Profile 编辑 UI | P1 | ✅ | `src/components/social/ProfileEditModal.tsx`，由 `ProfileCard.tsx:83` 挂载 |
| Delete post/comment UI | P1 | ✅ | `useDeletePost`/`useDeleteComment`（`src/hooks/useSocial.ts:85,130`），带确认弹窗 |
| Social MenuButton permissions | P2 | ⏳ | `apps/menus/migrations/` 里 `/social` 只有 Menu 行，没有 MenuButton 行 |

---

## 里程碑总览

| 里程碑 | 内容 | 状态 |
|--------|------|------|
| M1-M5 | 核心系统 | ✅ 完成 |
| M6 | Bug 修复 | ✅ 完成 |
| M7 | DDD 重构 | ✅ 完成 |
| M8 | RC Closure | ✅ 完成 |
| M9 | 工程质量 | ✅ 完成 |
| M10 | 搜索与过滤 | ✅ 完成 |
| M11 | 死亡同步 API | ✅ 完成 |
| M12 | WebSocket 重构 | ✅ 完成 |
| M13 | 社交功能 | ✅ 完成 |
| M14 | 测试覆盖率 + 租户修复 | ✅ 完成 |
| M15 | 多租户安全加固 | ✅ 完成 |
| M16 | i18n 与 UX 完善 | 🔸 3/4 已交付 |

---

*更新日期: 2026-08-28（M15/M16 状态核实、M16 逐项取证）。M1–M14 各段仍是各自完成当时的
记录，未回填后续变更。*

*本文件不是事实来源——落后于代码，且 M7/M8 的编号与 `docs/MILESTONE_M7.md`、
`docs/MILESTONE_M8.md` 指的不是同一件事。以 `git log` 为准。*
