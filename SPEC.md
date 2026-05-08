# SoulLedger 系统设计规格书

> **版本：** 1.0
> **更新日期：** 2026-05-08
> **状态：** 制定中（OpenSpec 变更追踪：`openspec/changes/soulledger-system-design/`）

---

## 目录

1. [系统概述](#1-系统概述)
2. [系统架构](#2-系统架构)
3. [领域模型](#3-领域模型)
4. [状态机设计](#4-状态机设计)
5. [业力与处置引擎](#5-业力与处置引擎)
6. [API 设计](#6-api-设计)
7. [前端架构](#7-前端架构)
8. [数据库设计](#8-数据库设计)
9. [里程碑规划](#9-里程碑规划)
10. [部署架构](#10-部署架构)
11. [技术决策记录](#11-技术决策记录)

---

## 1. 系统概述

### 1.1 项目背景

SoulLedger 是一个跨文明（Cross-Civilization）灵魂管理系统，统一管理三大神话体系的灵魂流转：

| 文明 | 体系 | 代表地域 | 审判者 |
|------|------|---------|--------|
| Chinese（中国） | Diyu（地府） | 十八层地狱、十殿阎王 | 阎罗王、判官 |
| European（欧洲） | Heaven/Hell | 九层天堂、七层炼狱、九层地狱 | St. Peter、Hades、Satan |
| Egyptian（埃及） | Duat（冥界） | Aaru（芦苇之地）、Duat 深层 | Osiris、Anubis、Thoth |

### 1.2 核心业务流程

```
灵魂创建 (ALIVE)
    ↓ 标记死亡
审判中 (JUDGING)
    ↓ 判决（PASSED / FAILED / PURGATORY）
已处置 (DISPOSED)
    ↓ 执行处置
轮回中 (REINCARNATING)
    ↓ 完成轮回
→ 下一世 (ALIVE) / 失踪 (LOST)
```

### 1.3 技术栈

| 层级 | 技术 | 版本 |
|------|------|------|
| 前端框架 | Next.js | 14.x |
| UI 框架 | Tailwind CSS | 3.x |
| 后端框架 | Django | 5.x |
| API | Django REST Framework | 3.14+ |
| 数据库 | PostgreSQL | 16.x |
| 缓存/Broker | Redis | 7.x |
| 异步任务 | Celery | 5.x |
| 容器化 | Docker Compose | 2.x |
| 测试 | pytest + Django TestCase | - |

---

## 2. 系统架构

### 2.1 整体架构

```
┌──────────────────────────────────────────────────────────────┐
│                         用户浏览器                            │
└────────────────────────────┬───────────────────────────────┘
                             │ HTTP/HTTPS
                             ▼
┌──────────────────────────────────────────────────────────────┐
│                    Nginx / Caddy (反向代理)                    │
│                  SSL 终止 │ 静态文件服务 │ 路由                │
└────────────────────────────┬───────────────────────────────┘
                             │
              ┌──────────────┴──────────────┐
              ▼                              ▼
┌─────────────────────┐           ┌─────────────────────┐
│   Next.js (SSR)     │           │  Django + Gunicorn  │
│   Port: 3333        │           │  Port: 8000          │
│                     │           │                     │
│  - Landing Page     │           │  - REST API          │
│  - Soul 详情页       │           │  - Admin             │
│  - Dashboard        │           │  - Celery Worker     │
│  - i18n 三语言       │           │                     │
└─────────────────────┘           └─────────┬─────────────┘
                                            │
                              ┌─────────────┴─────────────┐
                              ▼                           ▼
                    ┌─────────────────┐       ┌─────────────────┐
                    │   PostgreSQL     │       │   Redis          │
                    │   Port: 5432    │       │   Port: 6379     │
                    │   (主数据存储)    │       │   (缓存 + Broker) │
                    └─────────────────┘       └─────────────────┘
```

### 2.2 项目目录结构

```
SoulLedger/
├── backend/
│   ├── config/
│   │   ├── settings.py       # Django 全局配置
│   │   ├── urls.py           # URL 路由
│   │   ├── celery.py         # Celery 配置
│   │   └── wsgi.py / asgi.py
│   ├── apps/
│   │   ├── souls/            # 灵魂 + 业力记录
│   │   │   ├── models.py     # Soul, SoulRecord, SoulState, Civilization
│   │   │   ├── views.py       # ViewSet
│   │   │   ├── serializers.py
│   │   │   ├── urls.py
│   │   │   └── services.py   # KarmaService
│   │   ├── realms/           # 地域
│   │   │   └── models.py     # Realm, RealmType
│   │   ├── actors/           # 神祇/角色
│   │   │   └── models.py     # Actor, ActorRole
│   │   ├── judgment/         # 审判
│   │   │   └── models.py     # Judgment, Verdict
│   │   ├── disposition/      # 处置
│   │   │   ├── models.py     # Disposition, MemoryResetMethod
│   │   │   └── services.py   # DispositionService
│   │   ├── reincarnation/   # 轮回
│   │   │   ├── models.py     # Reincarnation, RebirthForm
│   │   │   └── services.py   # ReincarnationService
│   │   ├── events/           # 审计日志
│   │   │   └── models.py     # SoulEvent, EventType
│   │   └── workflow/          # 工作流引擎（预留）
│   ├── scripts/
│   │   └── seed_chinese_data.py
│   └── tests/
│       ├── test_soul_core.py
│       └── test_soul_lifecycle.py
├── frontend/
│   ├── app/
│   │   ├── layout.tsx         # 根布局（含 NavBar + LanguageSwitcher）
│   │   ├── page.tsx           # 首页 Landing Page
│   │   ├── souls/
│   │   │   ├── page.tsx       # 灵魂列表页
│   │   │   └── [id]/page.tsx  # 灵魂详情页
│   │   ├── realms/page.tsx    # 地域页
│   │   └── actors/page.tsx    # 角色页
│   ├── components/
│   │   ├── NavBar.tsx         # 导航栏
│   │   └── LanguageSwitcher.tsx
│   ├── contexts/
│   │   └── I18nContext.tsx    # 三语言上下文
│   ├── lib/
│   │   └── api.ts             # API 客户端
│   └── messages/               # 语言包
│       ├── zh-Hans.json        # 简体中文
│       ├── en.json             # English
│       └── egy.json            # 𓋴 العربية
├── infrastructure/
│   └── docker-compose.yml       # PostgreSQL + Redis 独立部署
├── scripts/
│   ├── start-backend.sh
│   ├── stop-backend.sh
│   ├── start-frontend.sh
│   ├── stop-frontend.sh
│   └── status.sh
├── openspec/                    # OpenSpec 变更追踪
│   └── changes/
│       └── soulledger-system-design/
│           ├── proposal.md
│           ├── design.md
│           └── tasks.md
├── docker-compose.yml           # 全量部署
├── SPEC.md                     # 本文档
└── README.md
```

---

## 3. 领域模型

### 3.1 实体关系

```
Soul ─────────────────────────────────────────────────────────┐
  │                                                           │
  │ 1:N                                                       │
  ├──────────────────────────────────────────────────────────┤
  │                                                           │
  ├─SoulRecord (业力记录)───merit/demerit──→ merit_score /   │
  │                             accumulation      demerit_score │
  │                                                           │
  ├─SoulEvent (审计日志)◄──log()──────────── 全部状态变更     │
  │                                                           │
  │ 状态机: ALIVE → JUDGING → DISPOSED → REINCARNATING → ALIVE│
  │                                      ↓ LOST               │
  │                                                           │
  │ 1:1 Disposition ──────────────N:1 Realm (目标地域)        │
  │      │                                                      │
  │      └─────────────1:1 Reincarnation                       │
```

### 3.2 Soul（灵魂）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| name | string(100) | 现世名称 |
| birth_name | string(100) | 出生名（轮回后保留） |
| civilization | enum | CHINESE / EUROPEAN / EGYPTIAN |
| current_state | enum | ALIVE / JUDGING / DISPOSED / REINCARNATING / LOST |
| birth_date | date | 出生日期 |
| death_date | date | 死亡日期（null=存活） |
| origin_location | string(200) | 死亡地点 |
| merit_score | integer | 功德累计 |
| demerit_score | integer | 罪业累计 |
| karmic_balance | integer | 净业力 (= merit - demerit) |
| created_at | datetime | 创建时间 |

### 3.3 SoulRecord（业力记录）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| soul | FK(Soul) | 关联灵魂 |
| record_type | enum | MERIT / DEMERIT |
| category | string(50) | 类别（CHARITY 等） |
| description | text | 具体描述 |
| weight | integer | 权重 1-10 |
| event_date | date | 事件发生日期（用于时间衰减） |
| is_milestone | boolean | 重大事件标记（权重×2） |
| created_at | datetime | 记录时间 |

### 3.4 Realm（地域）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| realm_code | string(20) | 唯一代码 |
| name_local | string(100) | 本地名称 |
| name_zh | string(100) | 中文名 |
| name_en | string(100) | 英文名 |
| name_egy | string(100) | 埃及语名 |
| civilization | enum | CHINESE / EUROPEAN / EGYPTIAN |
| realm_type | enum | HELL / PURGATORY / BLISS / NEUTRAL |
| tier | integer | 层级（1-10） |
| is_eternal | boolean | 是否永恒地域 |
| is_judgment_required | boolean | 是否需要标准审判流程 |
| cycle_limit | integer | 最大轮回次数（null=无限制） |

### 3.5 Actor（角色/神祇）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| name_local | string(100) | 本地名称 |
| name_zh | string(100) | 中文名 |
| name_en | string(100) | 英文名 |
| name_egy | string(100) | 埃及语名 |
| civilization | enum | CHINESE / EUROPEAN / EGYPTIAN |
| role | enum | JUDGE / EXECUTOR / GUARDIAN / ADMIN |
| title | string(100) | 头衔 |
| realm | FK(Realm) | 所属地域 |

### 3.6 Judgment（审判）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| soul | FK(Soul) | 被审判灵魂 |
| civilization | enum | 审判适用的文明 |
| court | string(100) | 审判庭名称 |
| verdict | enum | PASSED / FAILED / PURGATORY / RETRY（null=未判决） |
| judgment_method | enum | STANDARD / HEART_WEIGHING / DIABOLICAL_TRIAL |
| notes | text | 判决备注 |
| is_final | boolean | 是否终审判决 |
| created_at | datetime | 创建时间 |
| concluded_at | datetime | 判决时间 |

### 3.7 Disposition（处置）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| soul | FK(Soul) | 被处置灵魂 |
| destination_realm | FK(Realm) | 目标地域 |
| memory_reset | enum | NONE / PARTIAL / FULL |
| is_eternal | boolean | 是否永恒处置 |
| is_executed | boolean | 是否已执行 |
| created_at | datetime | 创建时间 |
| executed_at | datetime | 执行时间 |

### 3.8 Reincarnation（轮回）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| soul | FK(Soul) | 轮回灵魂 |
| disposition | FK(Disposition) | 关联处置 |
| target_realm | string(20) | 目标地域代码 |
| rebirth_form | enum | HUMAN / ANIMAL / DIVINE / OTHER |
| cycle_count | integer | 轮回次数 |
| previous_realm | string(20) | 前一地域 |
| new_identity | string(100) | 新身份名称 |
| notes | text | 备注 |
| reincarnated_at | datetime | 轮回完成时间 |

### 3.9 SoulEvent（审计日志）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| soul | FK(Soul) | 关联灵魂 |
| event_type | enum | SOUL_CREATED / STATE_CHANGED / DISPOSITION_CREATED / REINCARNATION_COMPLETED / JUDGMENT_CREATED |
| payload | JSONB | 事件数据 |
| actor | string(100) | 触发者（系统/用户名） |
| created_at | datetime | 事件时间 |

---

## 4. 状态机设计

### 4.1 状态流转图

```
 ┌─────────┐   die()    ┌───────────┐  conclude()  ┌──────────┐  execute()  ┌─────────────────┐  complete()  ┌─────────┐
 │  ALIVE  │ ─────────► │  JUDGING  │ ───────────► │ DISPOSED │ ──────────► │ REINCARNATING   │ ────────────► │  ALIVE  │
 └─────────┘            └───────────┘              └──────────┘             └─────────────────┘               └─────────┘
                                                    │
                                                    │  soul lost
                                                    ▼
                                                 ┌────────┐
                                                 │  LOST  │
                                                 └────────┘
```

### 4.2 各状态详细说明

| 状态 | 说明 | 进入条件 | 允许转出 |
|------|------|---------|---------|
| ALIVE | 存活 | REINCARNATING 完成 | JUDGING（die） |
| JUDGING | 审判中 | ALIVE（die） | DISPOSED（conclude） |
| DISPOSED | 已判决 | JUDGING（conclude） | REINCARNATING（execute）/ LOST |
| REINCARNATING | 轮回中 | DISPOSED（execute） | ALIVE（complete） |
| LOST | 失踪/湮灭 | DISPOSED（手动标记） | 无（终态） |

---

## 5. 业力与处置引擎

### 5.1 业力计算公式

```
karmic_balance = Σ(merit_records.weight) - Σ(demerit_records.weight)
```

### 5.2 时间衰减（Milestone 4）

```
effective_score = original_score × e^(-0.01 × years_since_event)
```
每 100 年约衰减 2/3。

### 5.3 轮回业力继承（Milestone 2，已实现）

```
next_life.merit_score   = current.merit_score × 0.2
next_life.demerit_score = current.demerit_score × 0.2
```

### 5.4 三大文明处置路由规则

| 文明 | verdict=PASSED | verdict=FAILED |
|------|---------------|----------------|
| **Chinese** | karma ≥ 0 → 第一层天界（DY_01_HEAVEN） | karma < 0 → tier = min(10, abs(karma)/10+1) → 对应地狱层 |
| **European** | karma ≥ 0 → Heaven（EU_HEAVEN） | karma < 0 → circle = min(9, abs(karma)/15+1) → Dante 九层地狱 |
| **Egyptian** | 心脏平衡 → Aaru（EG_AARU） | 心脏比羽毛重 → Ammit 吞噬 或 Duat 深层 |

### 5.5 Memory Reset 规则

| 方法 | 使用场景 | 实现 |
|------|---------|------|
| NONE | 接近得道者，保留完整记忆 | soul.description 不变 |
| PARTIAL | 普通轮回，保留出生名 | soul.description = "" |
| FULL | 重罪轮回，完全清除 | soul.name = "", birth_name = "" |

---

## 6. API 设计

### 6.1 Souls

| 方法 | 端点 | 描述 |
|------|------|------|
| GET | /api/v1/souls/ | 列表（?current_state=&civilization=&search=） |
| POST | /api/v1/souls/ | 创建灵魂 |
| GET | /api/v1/souls/{id}/ | 详情 |
| PATCH | /api/v1/souls/{id}/ | 更新 |
| POST | /api/v1/souls/{id}/die/ | 标记死亡 |
| POST | /api/v1/souls/{id}/transition/ | 手动转态 |
| POST | /api/v1/souls/{id}/add_record/ | 添加业力记录 |
| GET | /api/v1/souls/{id}/karma/ | 业力汇总 |
| GET | /api/v1/souls/{id}/records/ | 业力记录列表 |
| GET | /api/v1/souls/{id}/events/ | 事件日志 |

### 6.2 Realms

| 方法 | 端点 | 描述 |
|------|------|------|
| GET | /api/v1/realms/ | 列表（?civilization=&realm_type=） |
| GET | /api/v1/realms/{code}/ | 详情 |
| GET | /api/v1/realms/?localized=true | 多语言列表（Accept-Language header） |

### 6.3 Actors

| 方法 | 端点 | 描述 |
|------|------|------|
| GET | /api/v1/actors/ | 列表（?civilization=&role=） |
| GET | /api/v1/actors/{id}/ | 详情 |
| GET | /api/v1/actors/?localized=true | 多语言列表 |

### 6.4 Judgment

| 方法 | 端点 | 描述 |
|------|------|------|
| GET | /api/v1/judgment/ | 列表 |
| POST | /api/v1/judgment/ | 创建审判 |
| POST | /api/v1/judgment/{id}/conclude/ | 判决（body: {verdict, notes}） |

### 6.5 Disposition

| 方法 | 端点 | 描述 |
|------|------|------|
| GET | /api/v1/disposition/ | 列表 |
| POST | /api/v1/disposition/{id}/execute/ | 执行处置，触发轮回 |

### 6.6 Reincarnation

| 方法 | 端点 | 描述 |
|------|------|------|
| GET | /api/v1/reincarnation/ | 列表 |
| POST | /api/v1/reincarnation/reborn/ | 快速轮回（body: {soul_id, disposition_id, new_identity}） |

### 6.7 Events

| 方法 | 端点 | 描述 |
|------|------|------|
| GET | /api/v1/events/ | 日志（?soul=&event_type=） |

### 6.8 Stats（Milestone 5）

| 方法 | 端点 | 描述 |
|------|------|------|
| GET | /api/v1/stats/ | 全局统计 |
| GET | /api/v1/stats/by-civilization/ | 文明分布 |
| GET | /api/v1/stats/karma-distribution/ | 业力分布 |
| GET | /api/v1/stats/reincarnation-cycles/ | 轮回统计 |
| GET | /api/v1/stats/realm-occupancy/ | 地域占用 |

---

## 7. 前端架构

### 7.1 页面清单

| 页面 | 路由 | 描述 |
|------|------|------|
| 首页 | / | Landing + 文明卡片 + 导航 |
| 灵魂列表 | /souls/ | 搜索/筛选/创建 |
| 灵魂详情 | /souls/{id}/ | 完整旅程 + 操作按钮 |
| 地域列表 | /realms/ | 地域浏览 + 文明筛选 |
| 角色列表 | /actors/ | 角色浏览 + 文明筛选 |
| 仪表板 | /dashboard/ | 统计图表（Milestone 5） |

### 7.2 i18n 策略

- 语言：`zh-Hans`（简体中文）、`en`（English）、`egy`（𓋴 العربية）
- 方案：React Context + Cookie
- 字体：Noto Sans Egyptian Hieroglyphs（象形文字）
- 路由：Cookie-based（无需 URL 重写）

---

## 8. 数据库设计

### 8.1 数据库索引

```sql
-- Soul 高频查询优化
CREATE INDEX idx_soul_state ON souls_soul(current_state);
CREATE INDEX idx_soul_civ ON souls_soul(civilization);
CREATE INDEX idx_soul_state_civ ON souls_soul(current_state, civilization);

-- SoulRecord 查询
CREATE INDEX idx_record_soul ON souls_soulrecord(soul_id);
CREATE INDEX idx_record_type ON souls_soulrecord(record_type);

-- Realm 查询
CREATE INDEX idx_realm_civ ON realms_realm(civilization);
CREATE INDEX idx_realm_code ON realms_realm(realm_code);

-- Actor 查询
CREATE INDEX idx_actor_civ ON actors_actor(civilization);
CREATE INDEX idx_actor_role ON actors_actor(role);

-- Event 查询
CREATE INDEX idx_event_soul ON events_soulevents(soul_id);
CREATE INDEX idx_event_type ON events_soulevents(event_type);
```

---

## 9. 里程碑规划

### Milestone 1 ✅ 已完成

基础框架与核心模型

| 任务 | 状态 | 验收标准 |
|------|------|---------|
| Django 项目结构 | ✅ | apps/ 目录组织，manage.py 可运行 |
| 核心数据模型 | ✅ | Soul/Realm/Actor/Judgment/Disposition/Reincarnation/SoulEvent |
| REST API | ✅ | 所有 ViewSet 可访问 |
| 前端 Landing + i18n | ✅ | 三语言切换正常 |
| Docker Compose | ✅ | postgres + redis 可启动 |
| 启动脚本 | ✅ | scripts/ 下脚本可执行 |
| 种子数据 | ✅ | 17 realms + 16 actors 已加载 |
| pytest 测试 | ✅ | 9个测试全部通过 |

### Milestone 2 ✅ 已完成

审判与处置流程

| 任务 | 状态 | 验收标准 |
|------|------|---------|
| Soul.die() | ✅ | 状态 → JUDGING |
| Judgment.conclude() | ✅ | 自动创建 Disposition + 状态 → DISPOSED |
| DispositionService | ✅ | 分文明路由 |
| ReincarnationService | ✅ | 轮回完成 + Karma 20% 继承 |
| 前端灵魂列表/详情 | ✅ | 完整旅程视图 + 操作按钮 |
| 状态机完善 | ✅ | DISPOSED → REINCARNATING/LOST |
| 集成测试 | ✅ | 12/12 测试通过 |

### Milestone 3 🔲 进行中

多文明工作流

**数据补充：** European realms（17个）+ Egyptian realms（5个）+ 双方 actors
**路由逻辑：** 分文明 DispositionService
**前端页面：** /realms/、/actors/
**测试：** European + Egyptian E2E 工作流测试
**验收标准：** 三大文明均有完整数据，且端到端测试通过

### Milestone 4 🔲 待开始

业力系统与事件驱动

- SoulRecord 时间衰减因子
- KarmaService 增强（重大事件权重放大）
- Redis 业力缓存（TTL=5min）
- Celery 定时任务（每日重算、逾期检查、统计报告）
- 前端业力可视化（Recharts）
- Karma Timeline API

### Milestone 5 🔲 待开始

数据分析与可视化

- Dashboard API（stats/ 全局统计）
- 状态分布饼图
- 文明分布柱状图
- 业力分布直方图
- 轮回周期趋势

### Milestone 6 🔲 待开始

生产环境准备

- docker-compose.prod.yml
- 多阶段 Dockerfile 优化（< 500MB）
- Nginx HTTPS 配置
- .env.example 完整文档
- /health/ 健康检查端点
- PgBouncer 连接池
- 结构化日志（structlog）
- Sentry 集成
- API 认证（Token/JWT）
- API 限流

---

## 10. 部署架构

### 开发环境

```
localhost
├── PostgreSQL (Docker): localhost:5432
├── Redis (Docker): localhost:6379
├── Django: localhost:8000
└── Next.js: localhost:3333
```

### 生产环境（目标）

```
用户 → CDN/Nginx (HTTPS) → Next.js (3333) / Django (8000)
                              ↓                    ↓
                         PostgreSQL            Redis
                        (Primary+RO)         (Celery Broker)
```

---

## 11. 技术决策记录

### ADR-001：Django + Next.js 而非其他组合

**决策：** Django（后端）+ Next.js 14（前端）

**理由：**
- Django ORM + DRF 非常适合有复杂关系模型的系统
- Django admin 内置对管理后台的开发效率极高
- Next.js 14 App Router 提供现代前端开发体验
- 两者都是成熟稳定、社区活跃的技术栈

**替代方案：**
- Rails/Nuxt：在中国开发者社区不如 Django/Next.js 普及
- FastAPI + React：FastAPI 适合微服务，但 Django admin 的管理后台效率无可替代
- 纯 Serverless：PostgreSQL + Redis 已有状态，不适合纯无状态架构

---

### ADR-002：PostgreSQL 而非 MySQL

**决策：** PostgreSQL 16

**理由：**
- JSONBField 原生支持（SoulEvent.payload 字段）
- UUID 主键有原生支持
- Railway/Render/Supabase 等平台对 PostgreSQL 支持更好
- 更好的全文搜索（未来可能需要全文搜索灵魂记录）

---

### ADR-003：状态机在 Model 层而非 Service 层

**决策：** `Soul.can_transition_to()` 和 `transition_to()` 在 Model 层

**理由：**
- 状态机的约束是领域规则，应该属于模型本身
- Service 层调用 transition_to() 时自然遵守约束
- 不易出现跨越 Service 调用时状态不一致的情况
- 单元测试直接对模型测试即可，无需 mock

---

### ADR-004：i18n 用 cookie-based 而非 URL-based

**决策：** Cookie + React Context

**理由：**
- URL-based i18n（如 /en/souls/）需要 Next.js 中间件配置，复杂
- Cookie 方案：语言选择后立即生效，无需刷新/重定向
- 对用户操作无感知干扰
- SEO 不是本系统的核心需求（内部管理系统）

---

*本文档由 OpenSpec 变更追踪：`openspec/changes/soulledger-system-design/design.md`*
*详细任务清单：`openspec/changes/soulledger-system-design/tasks.md`*
