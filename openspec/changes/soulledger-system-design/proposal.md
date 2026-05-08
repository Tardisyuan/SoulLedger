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
