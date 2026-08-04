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
- P2: SoulRecord 归位 (`karma/models.py`)
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

### M15 多租户安全加固 (2026-06-09) 📋
**目标**: 审计并加固跨服务层、后台任务、异步执行路径的租户隔离
**工作量**: 5-7 天
**详情**: `docs/MILESTONE_M15.md`

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

### M16 i18n 与 UX 完善
**目标**: 国际化翻译 + 社交功能完善

| 任务 | 优先级 | 状态 |
|------|--------|------|
| i18n 翻译文件 (中/英) | P1 | ⏳ |
| Profile 编辑 UI | P1 | ⏳ |
| Delete post/comment UI | P1 | ⏳ |
| Social MenuButton permissions | P2 | ⏳ |

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
| M15 | 多租户安全加固 | 📋 规划中 |
| M16 | i18n 与 UX 完善 | 📋 规划中 |

---

*更新日期: 2026-06-09*
