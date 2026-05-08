# SoulLedger 系统设计规格书

> **版本：** 2.0（多租户重构版）
> **更新日期：** 2026-05-09
> **状态：** 设计中
> **OpenSpec 追踪：** `openspec/changes/multi-tenant-architecture/`

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

SoulLedger 是一个**多租户**跨文明灵魂管理系统。三个文明（Chinese Diyu / European Heaven-Hell / Egyptian Duat）各自作为独立租户运行，数据完全隔离，只有系统管理员（ADMIN）可以跨租户查看全局数据。

**核心原则：**
- 每个文明的官员只看到自己租户的灵魂和审判数据
- 灵魂的生命周期（创建→审判→处置→轮回）在自己租户内完成
- 跨租户操作（如灵魂迁移）需要 ADMIN 介入

### 1.2 三大租户

| 租户代码 | 名称 | 体系 | 代表地域 | 审判者 |
|---------|------|------|---------|--------|
| CN_DIYU | 中国地府 | Diyu | 十八层地狱、十殿阎王 | 阎罗王、判官 |
| EU_HEAVEN_HELL | 欧洲天堂地狱 | Heaven/Hell/Purgatory | 九层天堂、七层炼狱、九层地狱 | St. Peter、Hades、Satan |
| EG_DUAT | 埃及冥界 | Duat | Aaru、Duat 深层 | Osiris、Anubis、Thoth |

### 1.3 核心业务流程

每个租户内部，灵魂经历相同的生命周期：

```
ALIVE（存活）
    ↓ 标记死亡（die）
JUDGING（审判中）
    ↓ 判决（conclude）：PASSED / FAILED / PURGATORY
DISPOSED（已判决）
    ↓ 执行处置（execute）
REINCARNATING（轮回中）
    ↓ 完成轮回（complete）
→ ALIVE（下一世） / LOST（失踪）
```

### 1.4 技术栈

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

### 2.1 整体架构图

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              用户浏览器                                         │
│           [CN_DIYU 官员]  [EU_HEAVEN_HELL 官员]  [EG_DUAT 官员]  [ADMIN]     │
└────────────────────────────┬─────────────────────────────────────────────────┘
                             │ HTTP/HTTPS
                             ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                     Nginx / Caddy (反向代理 + SSL)                            │
└────────────────────────────┬─────────────────────────────────────────────────┘
                             │
              ┌──────────────┴──────────────┐
              ▼                              ▼
┌─────────────────────────┐      ┌────────────────────────────────────────────┐
│    Next.js (SSR)        │      │         Django + Gunicorn                   │
│    Port: 3333           │      │         Port: 8000                          │
│                         │      │                                            │
│  租户视图：              │      │  TenantMiddleware ──► thread_local.tenant    │
│  /{tenant}/souls/      │      │         ↓                                    │
│  /{tenant}/realms/     │      │  TenantManager ──► 自动 tenant 过滤          │
│  /admin/dashboard/     │      │         ↓                                    │
│                         │      │  REST API（JWT 认证）                        │
└─────────────────────────┘      └──────────────────┬───────────────────────────┘
                                                  │
                                 ┌────────────────┴────────────────┐
                                 ▼                                 ▼
                       ┌─────────────────┐            ┌─────────────────┐
                       │   PostgreSQL     │            │   Redis          │
                       │   Port: 5432    │            │   Port: 6379     │
                       │                  │            │                  │
                       │  tenants_tenant  │            │  Session / Cache  │
                       │  souls_soul     │            │  Celery Broker   │
                       │  realms_realm   │            └─────────────────┘
                       │  actors_actor   │
                       │  ...            │            ┌─────────────────┐
                       │                  │            │  Celery Worker  │
                       │  (所有表含       │            │  异步任务处理   │
                       │   tenant_id FK)  │            └─────────────────┘
                       └─────────────────┘
```

### 2.2 多租户隔离机制

```
┌────────────────────────────────────────────────────────────────┐
│                     Shared PostgreSQL Database                   │
│                                                                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐        │
│  │  CN_DIYU    │  │EU_HEAVEN_HELL│  │   EG_DUAT     │        │
│  │              │  │              │  │              │        │
│  │ souls: 1xxx  │  │ souls: xxx   │  │ souls: xxx   │        │
│  │ realms: 17   │  │ realms: 17   │  │ realms: 5    │        │
│  │ actors: 31   │  │ actors: 5    │  │ actors: 4    │        │
│  │              │  │              │  │              │        │
│  │ 阎罗王(ADMIN)│  │ Satan(ADMIN) │  │ Osiris(ADMIN)│        │
│  │ 判官(JUDGE) │  │ St.Peter(J.)  │  │ Anubis(J.)   │        │
│  └──────────────┘  └──────────────┘  └──────────────┘        │
│                                                                │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                     ADMIN 视图                           │  │
│  │         可看所有租户数据 + 全局统计大屏                    │  │
│  └──────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────┘
```

### 2.3 项目目录结构

```
SoulLedger/
├── backend/
│   ├── config/
│   │   ├── settings.py       # Django 全局配置（含 JWT + tenant 设置）
│   │   ├── urls.py           # URL 路由
│   │   ├── celery.py         # Celery 配置
│   │   └── wsgi.py / asgi.py
│   ├── apps/
│   │   ├── tenants/          # [NEW] 租户管理
│   │   │   ├── models.py     # Tenant 模型
│   │   │   ├── middleware.py # TenantMiddleware
│   │   │   ├── managers.py   # TenantManager（自动过滤）
│   │   │   ├── views.py
│   │   │   ├── serializers.py
│   │   │   └── urls.py
│   │   ├── authentication/   # JWT 认证 + User 模型
│   │   │   ├── models.py     # User(tenant_id FK, actor_id FK, role)
│   │   │   ├── views.py
│   │   │   ├── serializers.py
│   │   │   └── urls.py
│   │   ├── souls/
│   │   │   ├── models.py     # Soul（含 TenantManager）
│   │   │   ├── managers.py   # TenantManager
│   │   │   ├── views.py
│   │   │   ├── serializers.py
│   │   │   └── services.py   # KarmaService
│   │   ├── realms/
│   │   │   ├── models.py     # Realm（含 tenant FK）
│   │   │   ├── views.py
│   │   │   ├── serializers.py
│   │   │   └── urls.py
│   │   ├── actors/
│   │   │   ├── models.py     # Actor（含 tenant FK）
│   │   │   ├── views.py
│   │   │   ├── serializers.py
│   │   │   └── urls.py
│   │   ├── judgment/         # 审判
│   │   │   └── models.py    # Judgment（含 tenant FK）
│   │   ├── disposition/      # 处置
│   │   │   ├── models.py    # Disposition（含 tenant FK）
│   │   │   └── services.py  # DispositionService（按 tenant 路由）
│   │   ├── reincarnation/   # 轮回
│   │   │   └── models.py    # Reincarnation（含 tenant FK）
│   │   ├── events/           # 审计日志
│   │   │   └── models.py    # SoulEvent（含 tenant FK）
│   │   └── stats/            # [NEW] 全局统计（ADMIN 专用）
│   │       ├── views.py
│   │       └── serializers.py
│   ├── scripts/
│   │   ├── seed_all_tenants.py  # 重写：seed 三个租户
│   │   └── migrate_to_multitenant.py
│   └── tests/
│       ├── test_soul_core.py
│       ├── test_soul_lifecycle.py
│       └── test_tenant_isolation.py  # [NEW] 租户隔离测试
├── frontend/
│   ├── app/
│   │   ├── layout.tsx         # 根布局（NavBar + LanguageSwitcher）
│   │   ├── page.tsx           # 首页（选择租户入口）
│   │   ├── login/page.tsx     # 登录页
│   │   ├── [tenant]/          # [租户视图] 动态路由
│   │   │   ├── layout.tsx    # 租户布局（NavBar 已含 tenant 上下文）
│   │   │   ├── souls/
│   │   │   │   ├── page.tsx  # 灵魂列表
│   │   │   │   └── [id]/page.tsx  # 灵魂详情
│   │   │   ├── realms/page.tsx
│   │   │   └── actors/page.tsx
│   │   └── admin/             # [ADMIN 专用]
│   │       └── dashboard/page.tsx  # 全局统计大屏
│   ├── components/
│   │   ├── NavBar.tsx         # 含 tenant 信息 + 登出
│   │   └── LanguageSwitcher.tsx
│   ├── contexts/
│   │   ├── I18nContext.tsx
│   │   └── TenantContext.tsx  # [NEW] 前端租户上下文
│   ├── lib/
│   │   └── api.ts             # API 客户端（自动带 tenant token）
│   └── messages/              # 语言包
│       ├── zh-Hans.json
│       ├── en.json
│       └── egy.json
├── infrastructure/
│   └── docker-compose.yml
├── scripts/
├── openspec/
│   └── changes/
│       ├── soulledger-system-design/
│       └── multi-tenant-architecture/  # 当前变更
├── SPEC.md
└── README.md
```

---

## 3. 领域模型

### 3.1 实体关系

```
Tenant ─────────────────────────────────────────────────────────────────────┐
  │ 1:N                                                                   │
  ├── User (tenant.users) ─── actor FK ── Actor ── realm FK ── Realm      │
  │                                                                           │
  ├── Soul ──────────────────────────────────────────────────────────────┐   │
  │   │ 1:N                                                              │   │
  │   ├── SoulRecord ─── merit/demerit                                   │   │
  │   ├── SoulEvent ─── 审计日志                                         │   │
  │   │                                                                  │   │
  │   │ 1:1 Judgment ─── verdict ─── Disposition ─── target_realm        │   │
  │   │                                                │                │   │
  │   │                                                └── Reincarnation │   │
  │   │                                                                     │   │
  └── Actor ─── role ─── ADMIN / JUDGE / GUARDIAN / VIEWER                 │   │
                                                                             │
  Soul.state: ALIVE ──die()──► JUDGING ──conclude()──► DISPOSED ──execute()──► REINCARNATING ──complete()──► ALIVE (或 LOST)
```

### 3.2 Tenant（租户）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| code | string(30) | 唯一代码：CN_DIYU / EU_HEAVEN_HELL / EG_DUAT |
| display_name | string(100) | 展示名称：中国地府 / European Heaven-Hell / Egyptian Duat |
| description | text | 租户描述 |
| settings | JSONB | 租户级配置（审判规则开关等） |
| is_active | boolean | 是否激活 |
| created_at | datetime | 创建时间 |

### 3.3 User（用户）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| username | string | 用户名 |
| email | string | 邮箱 |
| tenant | FK(Tenant) | **所属租户（必填）** |
| actor | FK(Actor) | 关联的角色（可选） |
| role | enum | **ADMIN / JUDGE / GUARDIAN / VIEWER** |
| is_active | boolean | 是否激活 |

**权限说明：**

| 角色 | 说明 |
|------|------|
| ADMIN | 阎罗王/撒旦/奥西里斯级别，可跨租户操作，查看全局统计 |
| JUDGE | 判官，可审判灵魂、执行处置 |
| GUARDIAN | 牛头马面/亡灵守护者，可记录业力、查看灵魂 |
| VIEWER | 访客，只读权限 |

### 3.4 Soul（灵魂）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| tenant | FK(Tenant) | **所属租户（必填，自动填充）** |
| name | string(100) | 现世名称 |
| birth_name | string(100) | 出生名（轮回后保留） |
| current_state | enum | ALIVE / JUDGING / DISPOSED / REINCARNATING / LOST |
| birth_date | date | 出生日期 |
| death_date | date | 死亡日期（null=存活） |
| origin_location | string(200) | 死亡地点 |
| merit_score | integer | 功德累计 |
| demerit_score | integer | 罪业累计 |
| karmic_balance | integer | 净业力（= merit - demerit） |
| created_at | datetime | 创建时间 |

> **注意：** 移除了 `civilization` 字段，租户标识通过 `tenant` 外键实现。

### 3.5 SoulRecord（业力记录）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| tenant | FK(Tenant) | 所属租户（通过 Soul 级联） |
| soul | FK(Soul) | 关联灵魂 |
| record_type | enum | MERIT / DEMERIT |
| category | string(50) | 类别（CHARITY 等） |
| description | text | 具体描述 |
| weight | integer | 权重 1-10 |
| event_date | date | 事件发生日期 |
| is_milestone | boolean | 重大事件标记 |
| created_at | datetime | 记录时间 |

### 3.6 Realm（地域）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| tenant | FK(Tenant) | **所属租户（必填）** |
| realm_code | string(20) | 唯一代码 |
| name_local | string(100) | 本地名称 |
| name_zh | string(100) | 中文名 |
| name_en | string(100) | 英文名 |
| name_egy | string(100) | 埃及语名 |
| realm_type | enum | HELL / PURGATORY / BLISS / NEUTRAL |
| tier | integer | 层级（地狱层级 1-10） |
| is_eternal | boolean | 是否永恒地域 |
| is_judgment_required | boolean | 是否需要标准审判流程 |
| cycle_limit | integer | 最大轮回次数 |

> **注意：** 移除了 `civilization` 字段。

### 3.7 Actor（角色/神祇）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| tenant | FK(Tenant) | **所属租户（必填）** |
| name_local | string(100) | 本地名称 |
| name_zh | string(100) | 中文名 |
| name_en | string(100) | 英文名 |
| name_egy | string(100) | 埃及语名 |
| role | enum | JUDGE / EXECUTOR / GUARDIAN / ADMIN |
| title | string(100) | 头衔 |
| realm | FK(Realm) | 所属地域 |

### 3.8 Judgment（审判）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| tenant | FK(Tenant) | 所属租户（通过 Soul 级联） |
| soul | FK(Soul) | 被审判灵魂 |
| court | string(100) | 审判庭名称 |
| verdict | enum | PASSED / FAILED / PURGATORY / RETRY（null=未判决） |
| judgment_method | enum | STANDARD / HEART_WEIGHING / DIABOLICAL_TRIAL |
| notes | text | 判决备注 |
| is_final | boolean | 是否终审判决 |
| created_at | datetime | 创建时间 |
| concluded_at | datetime | 判决时间 |

### 3.9 Disposition（处置）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| tenant | FK(Tenant) | 所属租户（通过 Soul 级联） |
| soul | FK(Soul) | 被处置灵魂 |
| destination_realm | FK(Realm) | 目标地域 |
| memory_reset | enum | MENGPO / LETIES / SPELL / NONE |
| is_eternal | boolean | 是否永恒处置 |
| is_executed | boolean | 是否已执行 |
| created_at | datetime | 创建时间 |
| executed_at | datetime | 执行时间 |

### 3.10 Reincarnation（轮回）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| tenant | FK(Tenant) | 所属租户（通过 Soul 级联） |
| soul | FK(Soul) | 轮回灵魂 |
| disposition | FK(Disposition) | 关联处置 |
| target_realm | string(20) | 目标地域代码 |
| rebirth_form | enum | HUMAN / ANIMAL / DIVINE / OTHER |
| cycle_count | integer | 轮回次数 |
| previous_realm | string(20) | 前一地域 |
| new_identity | string(100) | 新身份名称 |
| notes | text | 备注 |
| reincarnated_at | datetime | 轮回完成时间 |

### 3.11 SoulEvent（审计日志）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| tenant | FK(Tenant) | 所属租户（通过 Soul 级联） |
| soul | FK(Soul) | 关联灵魂 |
| event_type | enum | SOUL_CREATED / STATE_CHANGED / DISPOSITION_CREATED 等 |
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

### 5.2 轮回业力继承

```
next_life.merit_score   = current.merit_score × 0.2
next_life.demerit_score = current.demerit_score × 0.2
```

### 5.3 三大租户处置路由规则

| 租户 | verdict=PASSED 或 karma ≥ 0 | verdict=FAILED 且 karma < 0 | verdict=PURGATORY |
|------|-----|-----|---------|
| **CN_DIYU** | karma ≥ 0 → 第一层天界 | tier = min(10, abs(karma)/10+1) → 对应地狱层 | 待定 |
| **EU_HEAVEN_HELL** | karma ≥ 0 → Heaven | circle = min(9, abs(karma)/15+1) → Dante 九层地狱 | Purgatory 层 |
| **EG_DUAT** | 心脏平衡 → Aaru | 心脏比羽毛重 → Ammit 吞噬或 Duat 深层 | 炼狱沼泽 |

### 5.4 Memory Reset 机制

| 值 | 租户 | 说明 |
|----|------|------|
| MENGPO | CN_DIYU | 孟婆汤（清除现世记忆） |
| LETIES | EU_HEAVEN_HELL | 忘川（Lethe 河水） |
| SPELL | EG_DUAT | 咒语（魔法记忆消除） |
| NONE | 通用 | 完整记忆保留 |

---

## 6. API 设计

> **认证：** Bearer JWT Token（30分钟有效，Refresh 7天）
> **租户隔离：** 所有业务 API 非 ADMIN 自动按 `user.tenant` 过滤

### 6.1 Auth

| 方法 | 端点 | 描述 | 认证 |
|------|------|------|------|
| POST | /api/v1/auth/login/ | 登录 | 否 |
| POST | /api/v1/auth/register/ | 注册 | 否 |
| POST | /api/v1/auth/refresh/ | 刷新 token | 否 |
| POST | /api/v1/auth/logout/ | 注销 | 是 |
| GET | /api/v1/auth/profile/ | 当前用户（含 tenant 信息） | 是 |

**登录响应：**
```json
{
  "access": "eyJ...",
  "refresh": "eyJ...",
  "user": {
    "id": "uuid",
    "username": "admin",
    "role": "ADMIN",
    "tenant": {
      "code": "CN_DIYU",
      "display_name": "中国地府"
    }
  }
}
```

### 6.2 Tenants（仅 ADMIN）

| 方法 | 端点 | 描述 |
|------|------|------|
| GET | /api/v1/tenants/ | 租户列表 |
| GET | /api/v1/tenants/{code}/ | 租户详情 |
| PATCH | /api/v1/tenants/{code}/ | 更新租户配置 |

### 6.3 Souls

| 方法 | 端点 | 描述 |
|------|------|------|
| GET | /api/v1/souls/ | 列表（**按 tenant 自动过滤**） |
| POST | /api/v1/souls/ | 创建灵魂（自动绑定 tenant） |
| GET | /api/v1/souls/{id}/ | 详情 |
| PATCH | /api/v1/souls/{id}/ | 更新 |
| POST | /api/v1/souls/{id}/die/ | 标记死亡 |
| POST | /api/v1/souls/{id}/transition/ | 手动转态 |
| POST | /api/v1/souls/{id}/add_record/ | 添加业力记录 |
| GET | /api/v1/souls/{id}/karma/ | 业力汇总 |
| GET | /api/v1/souls/{id}/records/ | 业力记录列表 |
| GET | /api/v1/souls/{id}/events/ | 事件日志 |

### 6.4 Realms

| 方法 | 端点 | 描述 |
|------|------|------|
| GET | /api/v1/realms/ | 列表（按 tenant 自动过滤） |
| GET | /api/v1/realms/{code}/ | 详情 |

### 6.5 Actors

| 方法 | 端点 | 描述 |
|------|------|------|
| GET | /api/v1/actors/ | 列表（按 tenant 自动过滤） |
| GET | /api/v1/actors/{id}/ | 详情 |

### 6.6 Judgment

| 方法 | 端点 | 描述 |
|------|------|------|
| GET | /api/v1/judgment/ | 列表（按 tenant 自动过滤） |
| POST | /api/v1/judgment/ | 创建审判 |
| POST | /api/v1/judgment/{id}/conclude/ | 判决 |

### 6.7 Disposition

| 方法 | 端点 | 描述 |
|------|------|------|
| GET | /api/v1/disposition/ | 列表 |
| POST | /api/v1/disposition/{id}/execute/ | 执行处置 |

### 6.8 Reincarnation

| 方法 | 端点 | 描述 |
|------|------|------|
| GET | /api/v1/reincarnation/ | 列表 |
| POST | /api/v1/reincarnation/reborn/ | 快速轮回 |

### 6.9 Events

| 方法 | 端点 | 描述 |
|------|------|------|
| GET | /api/v1/events/ | 日志（按 tenant 自动过滤） |

### 6.10 Stats（仅 ADMIN）

| 方法 | 端点 | 描述 |
|------|------|------|
| GET | /api/v1/stats/global/ | 全局统计（所有租户汇总） |
| GET | /api/v1/stats/by-tenant/ | 按租户统计 |
| GET | /api/v1/stats/realm-occupancy/ | 地域占用 |

---

## 7. 前端架构

### 7.1 路由结构

```
/                       # 首页（三大租户入口卡片）
/login                  # 登录页

/{tenant}/              # 租户视图（自动取 user.tenant.code）
  souls/                # 灵魂列表
  souls/[id]/           # 灵魂详情
  realms/               # 地域列表
  actors/               # 角色列表

/admin/                  # ADMIN 专属
  dashboard/            # 全局统计大屏
  tenants/              # 租户管理
```

### 7.2 导航流程

```
用户打开首页
    ↓
未登录 → /login
    ↓ 登录成功
解析 user.tenant.code
    ↓
role = ADMIN → /admin/dashboard/
role ≠ ADMIN → /{tenant_code}/souls/
```

### 7.3 i18n 策略

- 语言：zh-Hans / en / egy
- 方案：React Context + Cookie
- 字体：Noto Sans Egyptian Hieroglyphs（象形文字）
- 租户内容（地域名/角色名）使用对应语言 locale

---

## 8. 数据库设计

### 8.1 多租户索引策略

```sql
-- 租户隔离主索引（所有租户相关表）
CREATE INDEX idx_<table>_tenant ON <table>(tenant_id);

-- Soul 查询优化
CREATE INDEX idx_soul_tenant_state ON souls_soul(tenant_id, current_state);
CREATE INDEX idx_soul_tenant_name ON souls_soul(tenant_id, name);

-- Realm/Actor 查询
CREATE INDEX idx_realm_tenant ON realms_realm(tenant_id);
CREATE INDEX idx_actor_tenant ON actors_actor(tenant_id);

-- 审计日志查询
CREATE INDEX idx_event_tenant_soul ON events_solevents(tenant_id, soul_id);
```

### 8.2 约束设计

```sql
-- 所有租户相关表必须有 tenant_id（NOT NULL）
ALTER TABLE souls_soul ADD CONSTRAINT chk_soul_tenant CHECK (tenant_id IS NOT NULL);

-- 外键约束（级联删除）
ALTER TABLE souls_soul ADD CONSTRAINT fk_soul_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants_tenant(id) ON DELETE CASCADE;
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
| 种子数据 | ✅ | realms + actors 已加载 |
| pytest 测试 | ✅ | 12个测试全部通过 |

### Milestone 2 ✅ 已完成

JWT 认证 + 前端登录

| 任务 | 状态 | 验收标准 |
|------|------|---------|
| SimpleJWT 安装配置 | ✅ | djangorestframework-simplejwt |
| User 模型 + 角色 | ✅ | ADMIN/JUDGE/GUARDIAN/VIEWER |
| Auth endpoints | ✅ | login/register/logout/refresh/profile |
| 前端登录页 | ✅ | /login 页面，Token 存 cookie |
| API 认证保护 | ✅ | 所有业务端点需 JWT |

### Milestone 3 🔲 进行中

**多租户架构重构**

| 任务 | 状态 | 验收标准 |
|------|------|---------|
| Tenant 模型 | 🔲 | |
| 租户中间件 | 🔲 | |
| 所有表加 tenant_id | 🔲 | |
| TenantManager QuerySet 过滤 | 🔲 | |
| User → Tenant 关联 | 🔲 | |
| 前端租户路由 | 🔲 | |
| 租户隔离测试 | 🔲 | |
| 全局统计 API（ADMIN） | 🔲 | |
| 种子数据重写 | 🔲 | |

### Milestone 4 🔲 待开始

多文明工作流

| 任务 | 状态 | 验收标准 |
|------|------|---------|
| European realms 数据（17个） | 🔲 | Heaven + Purgatory 7层 + Hell 9层 |
| Egyptian realms 数据（5个） | 🔲 | Aaru + Duat regions |
| European actors 数据 | 🔲 | St. Peter, Hades, Satan 等 |
| Egyptian actors 数据 | 🔲 | Osiris, Anubis, Thoth 等 |
| 分租户审判逻辑 | 🔲 | 各租户独立路由规则生效 |
| 前端地域/角色页面 | 🔲 | 三文明数据完整展示 |

### Milestone 5 🔲 待开始

业力系统与事件驱动

| 任务 | 状态 | 验收标准 |
|------|------|---------|
| SoulRecord 时间衰减 | 🔲 | effective_score = original × e^(-0.01×years) |
| KarmaService Redis 缓存 | 🔲 | TTL=5min |
| Celery 定时任务 | 🔲 | 每日重算、逾期检查 |
| 前端业力可视化 | 🔲 | Recharts 时间线图 |

### Milestone 6 🔲 待开始

数据分析与可视化

| 任务 | 状态 | 验收标准 |
|------|------|---------|
| Dashboard API | 🔲 | 全局统计端点 |
| 状态分布图 | 🔲 | 饼图 |
| 文明分布图 | 🔲 | 柱状图 |
| 业力分布图 | 🔲 | 直方图 |

### Milestone 7 🔲 待开始

生产环境

| 任务 | 状态 | 验收标准 |
|------|------|---------|
| docker-compose.prod.yml | 🔲 | 生产级配置 |
| 多阶段 Dockerfile | 🔲 | < 500MB |
| Nginx HTTPS | 🔲 | SSL 终止 |
| /health/ 端点 | 🔲 | 健康检查 |
| 结构化日志 | 🔲 | structlog |
| Sentry 集成 | 🔲 | 错误追踪 |

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

### 生产环境

```
用户 → CDN/Nginx (HTTPS) → Next.js (:443) / Django (:443)
                              ↓                    ↓
                         PostgreSQL            Redis
                        (Primary+RO)         (Celery Broker)
```

---

## 11. 技术决策记录

### ADR-001：Django + Next.js 而非其他组合

**决策：** Django（后端）+ Next.js 14（前端）

**理由：** Django ORM + DRF 非常适合有复杂关系模型的系统；Django admin 内置对管理后台的开发效率极高；Next.js 14 App Router 提供现代前端开发体验。

### ADR-002：Shared Database + tenant_id（多租户策略）

**决策：** 同一 PostgreSQL 数据库，所有租户相关表加 `tenant_id` 外键

**理由：** 三个租户规模可控，不需要物理隔离；灵魂历史可能跨租户，Shared DB 方便跨租户查询；运维成本最低。

**替代方案：**
- Separate Database：运维成本高，跨租户查询几乎不可能 → 不采用
- Separate Schema：迁移复杂 → 不采用

### ADR-003：User → Tenant 直接关联

**决策：** User.tenant_id 直接 FK Tenant，不通过中间表

**理由：** 每个用户只属于一个租户（业务本质），直接 FK 最简单；ACTOR 字段可选关联到具体神祇角色。

### ADR-004：TenantMiddleware + TenantManager 双重隔离

**决策：** Middleware 注入 tenant context，Manager 自动过滤 QuerySet

**理由：** Middleware 保证 request 层面有 tenant；Manager 保证 ORM 查询层面自动过滤，双重保证不漏数据。

### ADR-005：i18n 用 cookie-based

**决策：** Cookie + React Context

**理由：** SEO 不是本系统核心需求（内部管理系统）；Cookie 方案语言选择后立即生效，无需刷新/重定向。

---

*本文档由 OpenSpec 变更追踪：`openspec/changes/multi-tenant-architecture/`*
