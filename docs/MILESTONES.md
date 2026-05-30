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

### M7 DDD Refactoring (2026-05-29)
- P1: 统一权限检查 (`apps/perm/checker.py`)
- P2: SoulRecord 归位 (`karma/models.py`)
- P3: DispatchRecord + CrossTenantJudgment 状态机
- P4: Domain Events 补发 (JUDGMENT_CONCLUDED, KARMA_RECALCULATED, etc.)
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

---

## 待开发

### M10 搜索与过滤系统
**目标**: 所有列表页面统一搜索和过滤能力

| 页面 | 当前状态 | 需要添加 |
|------|----------|----------|
| souls | ✅ 已有 | - |
| judgment | ✅ 已有 | - |
| users | ✅ 已有 | - |
| **actors** | ❌ 无 | 搜索框 + 文明/角色类型过滤 |
| **realms** | ❌ 无 | 搜索框 + 文明/realm类型/层级过滤 |
| **karma** | ❌ 无 | 灵魂搜索 + 类别/时间范围过滤 |
| **workflow** | ❌ 无 | 搜索框 + 状态/类型过滤 |
| **dispatch** | ❌ 无 | 搜索框 + 状态过滤 |

### M11 死亡同步 API
**目标**: 外部系统接入灵魂同步

| 任务 | 优先级 |
|------|--------|
| X-API-Key header 认证 | P0 |
| 批次大小限制 ≤100 | P1 |
| id_number 加密传输 | P1 |
| source_id 幂等去重 | P1 |

### M12 WebSocket 重构
**目标**: 实时通知系统

| 任务 | 优先级 |
|------|--------|
| JWT 改用 header 认证 | P0 |
| 消息 ID 去重/ACK | P1 |
| 指数退避重连 | P1 |
| 离线消息队列 | P2 |

### M13 社交功能
**目标**: 朋友圈 + 聊天 + 举报

| 任务 |
|------|
| 朋友圈发布/评论/点赞 |
| 灵魂间实时聊天 |
| 举报/拉黑机制 |

---

## 里程碑总览

| 里程碑 | 内容 | 状态 |
|--------|------|------|
| M1-M5 | 核心系统 | ✅ 完成 |
| M6 | Bug 修复 | ✅ 完成 |
| M7 | DDD 重构 | ✅ 完成 |
| M8 | RC Closure | ✅ 完成 |
| M9 | 工程质量 | ✅ 完成 |
| M10 | 搜索与过滤 | 待开发 |
| M11 | 死亡同步 API | 待开发 |
| M12 | WebSocket 重构 | 待开发 |
| M13 | 社交功能 | 待开发 |

---

*更新日期: 2026-05-30*
