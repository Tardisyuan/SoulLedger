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

---

## 待开发

### 测试覆盖率提升
**目标**: 后端测试覆盖率从 23% 提升至 40%+
**任务**: Task #291
**详情**: `docs/coverage-roadmap.md`

### i18n 与 UX 完善
**目标**: 国际化翻译 + 社交功能完善

| 任务 | 优先级 |
|------|--------|
| i18n 翻译文件 (中/英) | P1 |
| Profile 编辑 UI | P1 |
| Delete post/comment UI | P1 |
| Social MenuButton permissions | P2 |

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

---

*更新日期: 2026-06-08*
