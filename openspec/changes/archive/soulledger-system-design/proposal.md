# SoulLedger System Design

> ## 📦 ARCHIVED — 已归档，2026-08-14
>
> **写于 2026-05-08**（见 `.openspec.yaml` 的 `created`）。此后只有一次纯文档修订
> （2026-08-14 `b87ab7b`，把目录树指向真实存在的 seeder）。
>
> ### 为什么归档
>
> **这份提案的大部分已经实现，但 `tasks.md` 里 61 个任务框一个都没勾。**
> 与同批的 `multi-tenant-architecture` 一样，这套 OpenSpec 流程从建立起就没被真正
> 使用过（`openspec/changes/archive/` 与 `openspec/specs/` 此前均为空目录）。
> 把一份「全未完成」的清单留在活跃目录里，会让人把已经交付的东西当成待办重做。
>
> **归档而非删除**：其中的数据模型、业力公式与分阶段规划记录了当初的设计意图，
> 有历史价值。但它不再是工作队列。
>
> ### 现状核实（2026-08-14 抽样核对代码）
>
> **14 个主题中 8 个完全实现，5 个部分实现，1 个未实现。**
>
> | 主题 | 状态 | 证据 |
> |---|---|---|
> | 欧洲/埃及 realm 与 actor 数据 | ✅ 一项计数未达标 | `apps/actors/management/commands/seed_mythology.py`（幂等，取代提案里的两个脚本）。欧洲 realm 实际 11 个，验收要求 ≥17 |
> | `Realm.is_judgment_required` / `Judgment.judgment_method` | ✅ | `apps/realms/models.py`；`apps/judgment/models.py`（含 `HEART_WEIGHING`） |
> | 分文明处置路由 | ✅ | `apps/disposition/services.py` — `_route_chinese/_route_european/_route_egyptian`，埃及称心走 `EG_AARU`/`EG_DEVOURER` |
> | 前端 realms/actors/导航页 | ✅ | `frontend/app/realms/`、`app/actors/`；导航由 `AppLayout` + 后端 `apps/menus/` 驱动 |
> | API 文明过滤 + 本地化 | ✅ | `apps/realms/filters.py`、`apps/actors/filters.py`；`?localized=` 切换 serializer |
> | SoulRecord `category`/`is_milestone`/日期 | ✅ 有差异 | `apps/souls/record_models.py`。`event_date` 不是列，而是 `event_year/month/day`（带符号，可表示公元前）之上的兼容属性 |
> | 业力时间衰减 + Redis 缓存 | ✅ 超出规格 | `apps/ledger/services.py` — 分文明衰减率，锚定死亡日期，而非提案的统一 `e^(-0.01·years)` |
> | Recharts 与业力可视化 | ✅ | `frontend/src/components/charts/LazyDashboardCharts.tsx` |
> | 业力时间线 API | 🟡 部分 | 无独立 timeline 端点；summary 返回逐条明细，前端自行渲染时间线 |
> | Celery 定时任务 | 🟡 部分 | 重算任务有（`apps/ledger/tasks.py`）；**逾期轮回检查**与**每日报表**没有 |
> | Dashboard 统计 | 🟡 部分 | 全局/分租户/业力分布/领域占用都有；**轮回周期统计**（`avg_cycles`/`top_souls`/30 天趋势）没有 |
> | 生产环境准备 | 🟡 部分 | Docker/nginx/health/sentry/限流/备份脚本齐备 |
> | E2E 分文明工作流测试 | 🟡 部分 | 提案指名的两个文件不存在；等价覆盖分散在 `apps/disposition/tests.py`、`backend/tests/test_soul_lifecycle.py` |
> | **业力里程碑 2× 加成** | ❌ 未实现 | 见下 |
>
> ### 一个值得单独记下的问题
>
> `is_milestone` 字段的 `help_text` 写着「若为真，权重翻倍（重大人生事件）」
> （`apps/souls/record_models.py`），但 `apps/ledger/services.py` 里的
> `_decay_weight` / `recalculate_soul_ledger` / `get_ledger_summary` **从不对它做任何
> 加权**。这个字段只在 serializer 里被原样透传。**文档承诺了行为，代码没有实现**——
> 要么补上加成，要么改掉 `help_text`。这是本次核实中唯一带正确性影响的发现。
>
> ### 有意为之的设计差异（不是缺口）
>
> - `apps/karma/` 与 `apps/stats/` 都并入了 `apps/ledger/`
> - 两个种子脚本合并为一个幂等 management command
> - 无 `CELERY_BEAT_SCHEDULE`，调度交给 `django_celery_beat` 的 DatabaseScheduler
> - 限流用 DRF throttle 而非 `django-ratelimit`；健康检查在 `/health/` 而非 `/api/v1/health/`
> - `frontend/components/NavBar.tsx` 不存在，由 `AppLayout` 取代
>
> ### 尚未实现（真实剩余项）
>
> - 业力里程碑 2× 加成（见上）
> - 轮回周期统计与「转世次数最多的灵魂」列表、30 天轮回趋势图
> - Celery 的逾期轮回检查与每日统计报表
> - structlog：依赖已装在 `backend/requirements.txt`，但零配置，`LOGGING` 仍是纯文本
> - `docs/MIGRATION_STRATEGY.md`（零停机迁移文档）不存在
> - `infrastructure/pgbouncer.ini` 不存在（compose 里的 pgbouncer 服务是跑着的）
>
> ---
>
> *以下为 2026-05-08 原文，未作改动。*

## Why

SoulLedger 是一个跨文明（Chinese Diyu / European Heaven-Hell / Egyptian Duat）灵魂管理系统。当前已完成核心模型与审判流程，但缺乏完整的系统设计文档、多文明工作流、业力引擎细节、以及清晰的分阶段里程碑规划。

**解决的问题：**
1. 三大文明的地府体系（结构、地域、神祇）缺乏系统化数据模型
2. 业力计算规则分散在代码中，无统一文档
3. 里程碑步骤粗糙，验收标准不明确
4. 前端页面不完整（首页缺少导航入口、地域/角色页缺失）

## What Changes

本次变更不改变现有代码行为，而是补充完整的系统架构文档与精细化的里程碑规划：

1. 补充 European 与 Egyptian 的 Realm 与 Actor 数据
2. 完善 DispositionService 分文明处置路由
3. 补充 Karma 系统细节（时间衰减、权重放大）
4. 补充前端页面（地域页、角色页、导航完善）
5. 制定 Milestone 3-6 的详细实施计划

## Capabilities

### New Capabilities
- `multi-civilization-workflow`: 三大文明独立工作流（Chinese Diyu / European Heaven-Hell / Egyptian Duat）
- `karma-engine`: 完善的业力系统（衰减因子、权重放大、Celery 定时任务）
- `analytics-dashboard`: 数据分析与可视化（灵魂状态分布、轮回统计、业力分布）
- `european-data`: 欧洲天堂/地狱地域与神祇数据
- `egyptian-data`: 埃及冥界地域与神祇数据

### Modified Capabilities
- `soul-lifecycle`: 当前已实现，需补充 European/Egyptian 文明特定路由规则
- `i18n`: 当前已实现三语言切换，需补充地域/角色页的多语言展示

## Impact

**受影响的代码：**
- `backend/apps/disposition/services.py` — 分文明路由逻辑
- `backend/apps/realms/models.py` — 补充 European/Egyptian realms
- `backend/apps/actors/models.py` — 补充 European/Egyptian actors
- `backend/apps/karma/services.py` — 补充业力衰减/权重逻辑
- `frontend/app/` — 补充 realms 页、actors 页、dashboard 页

**受影响的 API：**
- `GET /api/v1/realms/?civilization=EUROPEAN|EGYPTIAN`
- `GET /api/v1/actors/?civilization=EUROPEAN|EGYPTIAN`
- `GET /api/v1/stats/` — 新增统计端点
