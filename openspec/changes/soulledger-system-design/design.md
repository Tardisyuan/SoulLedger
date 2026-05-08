# SoulLedger 系统设计

## 1. 系统概述

### 1.1 项目背景
SoulLedger 是一个跨文明（Civilization）灵魂管理系统，目标是统一管理 Chinese Diyu（中国地府）、European Heaven-Hell（欧洲天堂地狱）与 Egyptian Duat（埃及冥界）三大神话体系的灵魂流转。

核心业务流程：**灵魂创建 → 死亡标记 → 审判 → 处置 → 轮回**

### 1.2 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| 前端 | Next.js 14 + Tailwind CSS | App Router, 三语言 i18n (zh-Hans/en/egy) |
| 后端 | Django 5 + DRF | REST API, Celery (异步任务), PostgreSQL |
| 数据库 | PostgreSQL 16 | 主数据存储 |
| 缓存 | Redis 7 | Celery broker + Karma 缓存 |
| 部署 | Docker Compose | 开发环境全栈容器化 |
| 测试 | pytest + Django TestCase | 单元测试 + 集成测试 |

### 1.3 目录结构

```
SoulLedger/
├── backend/
│   ├── config/                  # Django settings / URL routing
│   ├── apps/
│   │   ├── souls/               # 灵魂核心模型 + 业力记录
│   │   ├── realms/              # 地域数据（三文明）
│   │   ├── actors/              # 角色/神祇数据
│   │   ├── judgment/            # 审判流程
│   │   ├── disposition/          # 处置路由
│   │   ├── reincarnation/       # 轮回执行
│   │   ├── events/              # 审计日志
│   │   ├── workflow/             # 工作流引擎（预留）
│   │   └── karma/               # 业力服务
│   ├── scripts/
│   │   └── seed_chinese_data.py # 数据初始化脚本
│   └── tests/
├── frontend/
│   ├── app/
│   │   ├── souls/               # 灵魂列表/详情页
│   │   ├── realms/               # 地域页
│   │   ├── actors/               # 角色页
│   │   └── page.tsx             # 首页
│   ├── components/               # 可复用组件
│   ├── contexts/I18nContext.tsx  # 三语言上下文
│   ├── lib/api.ts               # API 客户端
│   └── messages/                # 语言包 (zh-Hans/en/egy)
├── infrastructure/
│   └── docker-compose.yml       # PostgreSQL + Redis 独立部署
├── scripts/                      # 服务启动/停止脚本
├── openspec/                     # OpenSpec 变更追踪
└── docker-compose.yml            # 全量 Docker 部署
```

---

## 2. 领域模型

### 2.1 核心实体关系图

```
Soul ─────────────────────────────────────────────────────────────────────┐
  │                                                                        │
  │ 1:N                                                                  1:N
  ▼                                                                     │
SoulRecord (业力记录) ──── accumulation ──→ merit_score / demerit_score    │
                                                                     │
SoulEvent (审计日志) ◄── logged by services ──────────────────────────┘
                                                                          │
SoulState: ALIVE → JUDGING → DISPOSED → REINCARNATING → ALIVE           │
                                      │                                  │
                                      │ 1:1                              │
                                      ▼                                  │
                             Disposition ──N:1──► Realm                 │
                                      │                                  │
                                      │ 1:1                              │
                                      ▼                                  │
                             Reincarnation                              │
                                      │                                  │
                                      │ creates ──► Soul (next life)    │
```

### 2.2 Soul（灵魂）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| name | string | 现世名称 |
| birth_name | string | 出生名（轮回后保留） |
| civilization | enum | CHINESE / EUROPEAN / EGYPTIAN |
| current_state | enum | ALIVE / JUDGING / DISPOSED / REINCARNATING / LOST |
| birth_date | date | 出生日期 |
| death_date | date | 死亡日期（null = 存活） |
| origin_location | string | 死亡地点 |
| merit_score | integer | 功德分 |
| demerit_score | integer | 罪业分 |
| karmic_balance | integer | 净业力（merit - demerit） |
| created_at | datetime | 创建时间 |

### 2.3 SoulRecord（业力记录）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| soul | FK(Soul) | 关联灵魂 |
| record_type | enum | MERIT（功德）/ DEMERIT（罪业） |
| category | string | 类别（如 CHARITY, CRUELTY, HONESTY） |
| description | text | 具体描述 |
| weight | integer | 权重（1-10），影响分数累积 |
| created_at | datetime | 记录时间 |

### 2.4 Realm（地域）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| realm_code | string | 代码（如 DY_01_HEAVEN, EU_HEAVEN, EG_DUAT_1） |
| name_local | string | 各文明本地名称 |
| name_zh | string | 中文名 |
| name_en | string | 英文名 |
| name_egy | string | 埃及语名（象形文字） |
| civilization | enum | CHINESE / EUROPEAN / EGYPTIAN |
| realm_type | enum | HELL / PURGATORY / BLISS / NEUTRAL |
| tier | integer | 层级（1-10，10为最深层地狱） |
| is_eternal | boolean | 是否永恒（天堂/地狱为永恒） |
| cycle_limit | integer | 最大轮回次数（null = 无限制） |

### 2.5 Actor（角色/神祇）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| name_local | string | 本地名称 |
| name_zh | string | 中文名 |
| name_en | string | 英文名 |
| name_egy | string | 埃及语名 |
| civilization | enum | CHINESE / EUROPEAN / EGYPTIAN |
| role | enum | JUDGE（审判者）/ EXECUTOR（执行者）/ GUARDIAN（守护者）/ ADMIN（管理者） |
| title | string | 头衔 |
| realm | FK(Realm) | 所属地域 |

---

## 3. 状态机设计

```
┌─────────┐  die()   ┌───────────┐  conclude()  ┌──────────┐  execute()  ┌─────────────────┐  complete_rebirth()  ┌─────────┐
│  ALIVE  │ ───────► │  JUDGING  │ ───────────► │ DISPOSED │ ─────────► │ REINCARNATING   │ ──────────────────► │  ALIVE  │
└─────────┘           └───────────┘              └──────────┘             └─────────────────┘                      └─────────┘
                                                   │
                                                   │  soul lost
                                                   ▼
                                                ┌────────┐
                                                │  LOST  │
                                                └────────┘
```

**状态说明：**

| 状态 | 说明 | 允许的前置状态 |
|------|------|--------------|
| ALIVE | 存活，尚未死亡 | REINCARNATING（轮回完成） |
| JUDGING | 审判中，等待判决 | ALIVE |
| DISPOSED | 已判决，等待执行 | JUDGING |
| REINCARNATING | 轮回中，灵魂前往新载体 | DISPOSED |
| LOST | 灵魂失踪/湮灭（终态） | DISPOSED |

---

## 4. 业力与处置引擎

### 4.1 业力计算公式

```
karmic_balance = Σ(merit_records.weight) - Σ(demerit_records.weight)
```

**权重等级：**
- 权重 1-3：轻微善/恶行
- 权重 4-6：中等善/恶行
- 权重 7-9：重大善/恶行
- 权重 10：极端善/恶行（如舍身救人、大屠杀）

**时间衰减因子（未来 Milestone 4）：**
```
effective_score = original_score * e^(-λ * years_since_event)
λ = 0.01（衰减常数，每100年衰减约2/3）
```

**轮回业力继承（Milestone 2 已实现）：**
```
next_life.merit_score = current.merit_score * 0.2
next_life.demerit_score = current.demerit_score * 0.2
```

### 4.2 三大文明处置路由规则

| 文明 | PASSED（善行通过） | FAILED（恶行失败） | PURGATORY（待定） |
|------|------------------|------------------|----------------|
| CHINESE | karma ≥ 0 → 第一层天界 DY_01_HEAVEN | karma < 0 → 十殿阎王 DY_10_YAMA | karma ≈ 0 → 九殿都市 |
| EUROPEAN | karma ≥ 0 → Heaven (EU_HEAVEN) | karma < 0 → Hell (EU_HELL) | karma ≈ 0 → Purgatory |
| EGYPTIAN | 心脏称重平衡 → Aaru (EG_AARU) | 心脏比羽毛重 → Ammit (EG_AMMIT→Duat深层) | 不确定 → 冥界暂留 |

**Memory Reset 机制：**

| 重置方式 | 说明 |
|---------|------|
| NONE | 完整记忆保留（接近得道者） |
| PARTIAL | 保留出生名，清除现世经历 |
| FULL | 完全清除，重新投胎 |

---

## 5. API 设计

### 5.1 Souls

| 方法 | 端点 | 描述 |
|------|------|------|
| GET | /api/v1/souls/ | 灵魂列表（支持 current_state / civilization / search 筛选） |
| POST | /api/v1/souls/ | 创建灵魂 |
| GET | /api/v1/souls/{id}/ | 灵魂详情 |
| PATCH | /api/v1/souls/{id}/ | 更新灵魂 |
| POST | /api/v1/souls/{id}/die/ | 标记死亡，开始审判 |
| POST | /api/v1/souls/{id}/transition/ | 手动状态转换 |
| POST | /api/v1/souls/{id}/add_record/ | 添加业力记录 |
| GET | /api/v1/souls/{id}/karma/ | 业力汇总 |
| GET | /api/v1/souls/{id}/records/ | 业力记录列表 |
| GET | /api/v1/souls/{id}/events/ | 事件日志 |

### 5.2 Realms

| 方法 | 端点 | 描述 |
|------|------|------|
| GET | /api/v1/realms/ | 地域列表（支持 civilization / realm_type 筛选） |
| GET | /api/v1/realms/{code}/ | 地域详情 |
| GET | /api/v1/realms/?localized=true | 多语言地域列表（Accept-Language header） |

### 5.3 Actors

| 方法 | 端点 | 描述 |
|------|------|------|
| GET | /api/v1/actors/ | 角色列表（支持 civilization / role 筛选） |
| GET | /api/v1/actors/{id}/ | 角色详情 |
| GET | /api/v1/actors/?localized=true | 多语言角色列表 |

### 5.4 Judgment

| 方法 | 端点 | 描述 |
|------|------|------|
| GET | /api/v1/judgment/ | 审判列表 |
| POST | /api/v1/judgment/ | 创建审判 |
| POST | /api/v1/judgment/{id}/conclude/ | 判决（verdict: PASSED/FAILED/PURGATORY） |

### 5.5 Disposition

| 方法 | 端点 | 描述 |
|------|------|------|
| GET | /api/v1/disposition/ | 处置列表 |
| POST | /api/v1/disposition/{id}/execute/ | 执行处置，触发轮回 |

### 5.6 Reincarnation

| 方法 | 端点 | 描述 |
|------|------|------|
| GET | /api/v1/reincarnation/ | 轮回记录列表 |
| POST | /api/v1/reincarnation/reborn/ | 快速轮回（创建+完成） |

### 5.7 Events

| 方法 | 端点 | 描述 |
|------|------|------|
| GET | /api/v1/events/ | 事件日志（支持 soul / event_type 筛选） |

---

## 6. 前端架构

### 6.1 页面清单

| 页面 | 路由 | 功能 |
|------|------|------|
| 首页 | / | Landing page + 文明选择卡片 + 导航栏 |
| 灵魂列表 | /souls/ | 搜索/筛选/创建灵魂 |
| 灵魂详情 | /souls/{id}/ | 完整旅程：状态+Karma+审判+处置+轮回+日志 |
| 地域列表 | /realms/ | 地域浏览（支持文明筛选） |
| 角色列表 | /actors/ | 角色浏览（支持文明筛选） |

### 6.2 i18n 策略

- 使用 React Context（I18nContext）管理当前语言
- 语言偏好存储在 cookie（`soulledger-locale`）
- 服务端渲染时从 cookie 读取语言，避免 hydration 不匹配
- 象形文字使用 Noto Sans Egyptian Hieroglyphs 字体渲染

---

## 7. 数据库索引策略

```sql
-- 灵魂查询优化
CREATE INDEX idx_soul_state ON souls_soul(current_state);
CREATE INDEX idx_soul_civilization ON souls_soul(civilization);
CREATE INDEX idx_soul_state_civilization ON souls_soul(current_state, civilization);

-- 业力记录查询
CREATE INDEX idx_record_soul ON souls_soulrecord(soul_id);
CREATE INDEX idx_record_type ON souls_soulrecord(record_type);

-- 事件日志查询
CREATE INDEX idx_event_soul ON events_soulevents(soul_id);
CREATE INDEX idx_event_type ON events_soulevents(event_type);

-- 地域查询
CREATE INDEX idx_realm_civilization ON realms_realm(civilization);
CREATE INDEX idx_realm_code ON realms_realm(realm_code);
```

---

## 8. 里程碑规划（详细）

### Milestone 1 ✅ 已完成：基础框架与核心模型

**目标：** 建立 Django + Next.js 全栈框架，核心数据模型，基础 API，Landing page

**已完成项：**
- [x] Django 项目结构（apps/ 目录组织）
- [x] Soul / Realm / Actor / Judgment / Disposition / Reincarnation / SoulEvent 模型
- [x] REST API（DRF ViewSet）
- [x] 前端 Landing page + i18n 三语言
- [x] Docker Compose 开发环境
- [x] 启动脚本（scripts/）
- [x] pytest 单元测试（9个）
- [x] 种子数据（中国地府 17 realms + 16 actors）

**未完成/遗留项：**
- [ ] 地域页（/realms/）
- [ ] 角色页（/actors/）

---

### Milestone 2 ✅ 已完成：审判与处置流程

**目标：** 实现灵魂从"活着"到"轮回"的全自动流程

**已完成项：**
- [x] Soul.die() — 标记死亡，状态 → JUDGING
- [x] Judgment — 创建审判，判决（PASSED/FAILED/PURGATORY）
- [x] Judgment.conclude() — 自动创建 Disposition + 状态 → DISPOSED
- [x] DispositionService — 分文明处置路由
- [x] DispositionViewSet.execute() — 执行处置 → REINCARNATING
- [x] ReincarnationService — 完成轮回，状态 → ALIVE，Karma 保留 20%
- [x] 状态机补全（DISPOSED → REINCARNATING / LOST）
- [x] 前端灵魂详情页（完整旅程视图 + 操作按钮）
- [x] 前端灵魂列表页（搜索/筛选/创建）
- [x] pytest 集成测试（3个，全流程 12/12 通过）

---

### Milestone 3 🔲 进行中：多文明工作流

**目标：** European Heaven/Hell 和 Egyptian Duat 的完整地域、神祇、处置路由

**Sub-tasks：**

**数据补充：**
1. [ ] 补充 European realms：
   - Heaven: EU_HEAVEN（天堂）
   - Purgatory: EU_PURGATORY_1~7（七层炼狱）
   - Hell: EU_HELL_1~9（Nine Circles of Hell，Dante体系）
2. [ ] 补充 Egyptian realms：
   - Duat（冥界）: EG_DUAT_CENTER（审判厅）、EG_AARU（芦苇之地/天堂）、EG_WERETS（冥界深层）
   - Ammit 深渊: EG_AMMIT（吞食不合标准灵魂）
3. [ ] 补充 European actors：
   - St. Peter（天堂守门人）
   - Hades（冥界统治者）
   - Satan/Lucifer（地狱统治者）
   - Dante's guides（但丁体系）
4. [ ] 补充 Egyptian actors：
   - Osiris（冥界之主，裁决者）
   - Anubis（心脏称重者）
   - Thoth（记录者）
   - Ammit（吞噬者）
5. [ ] 脚本：`backend/scripts/seed_european_data.py`
6. [ ] 脚本：`backend/scripts/seed_egyptian_data.py`

**代码修改：**
7. [ ] DispositionService — 分文明路由逻辑完善：
   - CHINESE: karma ≥ 0 → DY_01_HEAVEN, karma < 0 → 按tier分配地狱层
   - EUROPEAN: karma ≥ 0 → EU_HEAVEN, karma < 0 → 按严重程度分配Hell层
   - EGYPTIAN: 心脏称重仪式 → Anubis审判 → Aaru / Duat深层 / Ammit
8. [ ] Realm 模型：补充 `is_judgment_required` 字段（Egyptian Duat 需要特殊审判流程）
9. [ ] Judgment 模型：补充 `judgment_method` 字段（STANDARD / HEART_WEIGHING / DIABOLICAL_TRIAL）

**前端页面：**
10. [ ] `/realms/page.tsx` — 地域列表页，支持文明筛选
11. [ ] `/actors/page.tsx` — 角色列表页，支持文明筛选
12. [ ] 地域/角色详情页 — 多语言展示（Accept-Language）
13. [ ] 前端：灵魂详情页 — 显示对应文明的审判流程（Chinese: 十殿阎王 / European: 圣彼得 / Egyptian: Anubis）

**API：**
14. [ ] GET `/api/v1/realms/?civilization=EUROPEAN|EGYPTIAN` — 按文明筛选
15. [ ] GET `/api/v1/actors/?civilization=EUROPEAN|EGYPTIAN` — 按文明筛选
16. [ ] GET `/api/v1/realms/?localized=true` — Accept-Language → 返回对应语言名称
17. [ ] GET `/api/v1/actors/?localized=true` — 同上

**测试：**
18. [ ] 单元测试：European PASSED 路由（karma≥0 → EU_HEAVEN）
19. [ ] 单元测试：Egyptian 心脏称重路由
20. [ ] E2E 测试：完整 European 工作流（ALIVE → JUDGING → DISPOSED → HEAVEN）
21. [ ] E2E 测试：完整 Egyptian 工作流（ALIVE → JUDGING → AARU 或 Duat深层）

**验收标准：**
- [ ] 三大文明均有完整地域数据（≥10 realms/文明）
- [ ] 三大文明均有完整角色数据（≥5 actors/文明）
- [ ] 地域页可按文明筛选，显示对应语言名称
- [ ] 角色页可按文明筛选，显示对应语言名称
- [ ] European 和 Egyptian 工作流端到端测试通过

---

### Milestone 4 🔲：业力系统与事件驱动

**目标：** 完善的业力积累、因果记录、事件驱动架构

**Sub-tasks：**

**业力模型增强：**
1. [ ] SoulRecord 增加 `event_date` 字段（事件发生时间，用于时间衰减）
2. [ ] SoulRecord 增加 `is_milestone` 布尔（重大事件，权重放大 2x）
3. [ ] SoulRecord category 标准化：
   - MERIT: CHARITY, COMPASSION, HONESTY, COURAGE, WISDOM, PIETY
   - DEMERIT: CRUELTY, DECEPTION, COWARDICE, GREED, BLASPHEMY, MURDER

**KarmaService 增强：**
4. [ ] `recalculate_karma()` — 时间衰减因子（每年 -1%）
5. [ ] `get_milestone_boost()` — 重大事件权重 × 2
6. [ ] `get_karma_timeline()` — 返回时间轴形式的业力变化
7. [ ] 业力缓存（Redis，TTL=5min）

**Celery 异步任务：**
8. [ ] `celery task: recalculate_stale_karma` — 每天重新计算30天内有变动的灵魂业力
9. [ ] `celery task: check_reincarnation_overdue` — 检查 DISPOSED 超过30天未执行轮回的灵魂

**前端业力可视化：**
10. [ ] 灵魂详情页：业力时间轴图表（使用 Recharts）
11. [ ] 灵魂详情页：Merit/Demerit 分类柱状图
12. [ ] 新页面：`/souls/{id}/karma-timeline/` — 详细业力分析

**API 扩展：**
13. [ ] GET `/api/v1/souls/{id}/karma/timeline/` — 业力时间轴数据
14. [ ] POST `/api/v1/souls/{id}/karma/recalculate/` — 手动触发业力重算
15. [ ] GET `/api/v1/souls/{id}/karma/breakdown/` — 按 category 分组的业力详情

**测试：**
16. [ ] 单元测试：时间衰减计算
17. [ ] 单元测试：重大事件权重放大
18. [ ] 集成测试：Celery 定时任务

---

### Milestone 5 🔲：数据分析与可视化

**目标：** 灵魂管理统计仪表板，跨文明数据对比

**Sub-tasks：**

**Dashboard 后端：**
1. [ ] GET `/api/v1/stats/` — 全局统计（各状态灵魂数量、总数）
2. [ ] GET `/api/v1/stats/by-civilization/` — 各文明灵魂分布
3. [ ] GET `/api/v1/stats/karma-distribution/` — 业力分布直方图（buckets: <-50, -50~-20, -20~0, 0~20, 20~50, >50）
4. [ ] GET `/api/v1/stats/reincarnation-cycles/` — 平均轮回次数、最高轮回次数
5. [ ] GET `/api/v1/stats/realm-occupancy/` — 各地域当前灵魂数量

**Dashboard 前端：**
6. [ ] `/dashboard/page.tsx` — 主仪表板页面
7. [ ] 状态分布饼图（ALIVE/JUDGING/DISPOSED/REINCARNATING）
8. [ ] 文明分布柱状图
9. [ ] 业力分布直方图
10. [ ] 轮回周期趋势线图
11. [ ] Top 10 最古老灵魂（最多轮回次数）

**Celery 报告任务：**
12. [ ] `celery task: daily_stats_report` — 每日生成统计报告（写入 SoulEvent）
13. [ ] Email/Webhook 通知（可选）

---

### Milestone 6 🔲：生产环境准备

**目标：** 生产级部署配置、监控、备份

**Sub-tasks：**

**Docker & 部署：**
1. [ ] 生产级 `docker-compose.prod.yml`（gunicorn + 多阶段构建）
2. [ ] `Dockerfile` 多阶段构建（builder → runner）
3. [ ] Nginx/Caddy 反向代理配置（HTTPS）
4. [ ] 环境变量管理（`.env.example` 完整文档化）
5. [ ] 健康检查端点：`GET /api/v1/health/`（返回 DB/Redis 连接状态）

**数据库：**
6. [ ] 数据库备份脚本（每日全量 + 每小时增量）
7. [ ] 数据库迁移策略（Zero-downtime migration plan）
8. [ ] PostgreSQL 连接池配置（PgBouncer）

**监控：**
9. [ ] 结构化日志（`structlog`，JSON格式）
10. [ ] Sentry 集成（Django + Next.js）
11. [ ] API rate limiting（django-ratelimit）
12. [ ] CORS 配置（仅允许前端域名）

**安全：**
13. [ ] API 认证（Token / JWT）
14. [ ] 敏感字段加密（karma 计算逻辑）
15. [ ] 安全 headers（CSP, HSTS, X-Frame-Options）

---

## 9. 技术决策记录（ADR）

### ADR-001：为什么用 Django + Next.js

**决策：** Django（后端）+ Next.js 14（前端）

**理由：**
- Django 的 ORM + DRF 非常适合有复杂关系模型的系统
- Django admin 内置对管理后台的开发效率极高
- Next.js 14 App Router 提供现代前端开发体验
- 两者都是成熟稳定、社区活跃的技术栈

**替代方案：**
- Rails/Nuxt：不如 Django/Next.js 组合在中国开发者社区普及
- FastAPI + React：FastAPI 很适合微服务，但 Django admin 的管理后台效率无可替代
- 纯 Serverless：PostgreSQL + Redis 已有状态，不适合纯无状态架构

---

### ADR-002：为什么用 PostgreSQL 而非 MySQL

**决策：** PostgreSQL 16

**理由：**
- JSONField 原生支持（SoulEvent.payload 字段）
- UUID 主键有原生支持
- 更好的全文搜索（未来可能需要）
- Railway/Render/Supabase 等平台对 PostgreSQL 支持更好

---

### ADR-003：状态机为什么在 Model 层而非 Service 层

**决策：** Soul.can_transition_to() 和 transition_to() 在 Model 层

**理由：**
- 状态机的约束是领域规则，应该属于模型本身
- Service 层调用 transition_to() 时自然遵守约束
- 不易出现跨越 Service 调用时状态不一致的情况
- 单元测试直接对模型测试即可，无需 mock

---

### ADR-004：i18n 为什么用 cookie-based 而非 URL-based

**决策：** Cookie + React Context

**理由：**
- URL-based i18n（如 /en/souls/）需要 Next.js 中间件配置，复杂
- Cookie 方案：语言选择后立即生效，无需刷新/重定向
- 对用户操作无感知干扰
- SEO 不是本系统的核心需求（内部管理系统）

---

## 10. 部署架构

### 开发环境
```
本机: localhost
├── PostgreSQL (Docker): localhost:5432
├── Redis (Docker): localhost:6379
├── Django: localhost:8000
└── Next.js: localhost:3333
```

### 生产环境（目标）
```
                    ┌─────────────┐
User ──────────────►│  Nginx/CDN  │ HTTPS
                    └──────┬──────┘
                           │ proxy_pass
              ┌────────────┴───────────┐
              ▼                        ▼
    ┌─────────────────┐      ┌─────────────────┐
    │  Next.js (SSR)  │      │  Django + Gunicorn │
    │  3333           │      │  8000              │
    └─────────────────┘      └─────────┬─────────┘
                                      │
                           ┌──────────┴──────────┐
                           ▼                      ▼
                 ┌─────────────────┐    ┌─────────────────┐
                 │   PostgreSQL     │    │   Redis (Cache) │
                 │   (Primary+RO)  │    │   (Celery Borker)│
                 └─────────────────┘    └─────────────────┘
```

---

*本文档由 OpenSpec 变更追踪：`openspec/changes/soulledger-system-design/`*
*最后更新：2026-05-08*
