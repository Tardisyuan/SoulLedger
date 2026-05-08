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
┌──────────────────────────────────────────────────────────────────────────────┐
│                        Shared PostgreSQL Database                             │
│                                                                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │  CN_DIYU    │  │EU_HEAVEN_HELL│  │   EG_DUAT     │  │    ADMIN     │       │
│  │              │  │              │  │              │  │  (跨租户)    │       │
│  │ souls: 1xxx  │  │ souls: xxx   │  │ souls: xxx   │  │              │       │
│  │ realms: 17   │  │ realms: 17   │  │ realms: 5    │  │ 只读统计     │       │
│  │ actors: 31   │  │ actors: 5    │  │ actors: 4    │  │              │       │
│  │              │  │              │  │              │  │              │       │
│  │ 阎罗王(ADMIN)│  │ Satan(ADMIN) │  │ Osiris(ADMIN)│  │              │       │
│  │ 判官(JUDGE) │  │ St.Peter(J.)  │  │ Anubis(J.)   │  │              │       │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────────────┘       │
│         │                 │                 │                                 │
│         │    跨租户审判 (CrossTenantJudgment)    │                          │
│         │◄──────────────────────────────────────►│                          │
│         │                 │                 │                                 │
│         │    外派 (DispatchRecord)           │                                 │
│         └─────────────────►│◄─────────────────┘                                 │
│                           ▼                                                     │
│                    [目标租户 处置执行]                                           │
│                                                                               │
│  ┌──────────────────────────────────────────────────────────────────────┐     │
│  │                     未来支持：独立部署模式                             │     │
│  │  CN_DIYU API: https://diyu.example.com  EU_HEAVEN_HELL: https://...  │     │
│  │  EG_DUAT: https://duat.example.com     各自独立数据库                  │     │
│  └──────────────────────────────────────────────────────────────────────┘     │
└──────────────────────────────────────────────────────────────────────────────┘
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
│   │   ├── dispatch/        # [NEW] 外派（跨租户处置）
│   │   │   ├── models.py    # DispatchRecord, CrossTenantJudgment
│   │   │   ├── views.py
│   │   │   ├── serializers.py
│   │   │   └── services.py  # DispatchService
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
Tenant ────────────────────────────────────────────────────────────────────────┐
  │ 1:N                                                                         │
  ├── User (tenant.users) ─── actor FK ── Actor ── realm FK ── Realm            │
  │                                                                             │
  ├── Soul ────────────────────────────────────────────────────────────────┐    │
  │   │ 1:N                                                                 │    │
  │   ├── SoulRecord ─── merit/demerit                                      │    │
  │   ├── SoulEvent ─── 审计日志                                            │    │
  │   │                                                                      │    │
  │   │ 1:1 Judgment ─── verdict ─── Disposition ─── target_realm          │    │
  │   │                                               │                      │    │
  │   │                                               └── Reincarnation     │    │
  │   │                                                                      │    │
  │   └── dispatched_to_tenant ──► Tenant (FK, nullable)                   │    │
  │       │  灵魂外派目标租户（处置执行地点）                                │    │
  │       │                                                                  │    │
  │       └──► DispatchRecord ─── CrossTenantJudgment (跨租户联合审判)      │    │
  │                                                                           │    │
  └── Actor ─── role ─── ADMIN / JUDGE / GUARDIAN / VIEWER / DISPATCH_JUDGE   │    │
                                                                             │
  Soul.state: ALIVE ──die()──► JUDGING ──conclude()──► DISPOSED ──execute()──► REINCARNATING ──complete()──► ALIVE (或 LOST)
                                                                             │
  Soul.dispatch_status: null ──dispatch()──► PENDING_DISPATCH ──dispatch_confirm()──► DISPATCHED ──punishment_complete()──► COMPLETED
```

**跨租户关系说明：**
- `Soul.dispatched_to_tenant`：指向目标租户的 FK（nullable），表示灵魂被外派到其他租户执行惩罚
- `CrossTenantJudgment`：记录跨租户联合审判会话，参与者来自不同租户
- `DispatchRecord`：记录外派的具体信息（谁发起、原因、时间等）

### 3.2 Tenant（租户）

|| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| code | string(30) | 唯一代码：CN_DIYU / EU_HEAVEN_HELL / EG_DUAT |
| display_name | string(100) | 展示名称：中国地府 / European Heaven-Hell / Egyptian Duat |
| description | text | 租户描述 |
| settings | JSONB | 租户级配置（审判规则开关等） |
| **dispatch_enabled** | boolean | **是否允许接收外派灵魂（未来独立部署时使用）** |
| **api_endpoint** | string(255) | **API 端点 URL（未来独立部署时使用，如 https://diyu.example.com）** |
| is_active | boolean | 是否激活 |
| created_at | datetime | 创建时间 |

> **未来独立部署支持：** 当 `api_endpoint` 填充后，系统可通过该 URL 访问其他租户的 API，实现真正物理隔离的多租户部署。

### 3.3 User（用户）

|| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| username | string | 用户名 |
| email | string | 邮箱 |
| tenant | FK(Tenant) | **所属租户（必填）** |
| actor | FK(Actor) | 关联的角色（可选） |
| role | enum | **SYS_ADMIN / TENANT_ADMIN / JUDGE / GUARDIAN / VIEWER / DISPATCH_JUDGE** |
| is_active | boolean | 是否激活 |

**权限说明：**

||| 角色 | 说明 |
|------|------|
| SYS_ADMIN | 系统管理员 — 只读统计，无法干预业务（对应 Unix root 概念，不同于 TENANT_ADMIN） |
| TENANT_ADMIN | 阎罗王/撒旦/奥西里斯级别，租户内全权管理 |
| JUDGE | 判官，可审判灵魂、执行处置 |
| **DISPATCH_JUDGE** | **跨租户审判法官，可参与其他租户的联合审判（CrossTenantJudgment）** |
| GUARDIAN | 牛头马面/亡灵守护者，可记录业力、查看灵魂 |
| VIEWER | 访客，只读权限 |

> **角色层级说明：**
> - `SYS_ADMIN`（原 ADMIN）作用于全局，仅有系统配置和只读统计权限，不能操作业务数据
> - `TENANT_ADMIN` 是各租户的最高管理者（如阎罗王、撒旦），拥有租户内完整权限
> - `DISPATCH_JUDGE` 权限允许法官参与其他租户的联合审判

### 3.4 Soul（灵魂）

|| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| tenant | FK(Tenant) | **所属租户（必填，自动填充）—— 灵魂来源地** |
| name | string(100) | 现世名称 |
| birth_name | string(100) | 出生名（轮回后保留） |
| current_state | enum | ALIVE / JUDGING / DISPOSED / REINCARNATING / LOST |
| birth_date | date | 出生日期 |
| death_date | date | 死亡日期（null=存活） |
| origin_location | string(200) | 死亡地点 |
| merit_score | integer | 功德累计 |
| demerit_score | integer | 罪业累计 |
| karmic_balance | integer | 净业力（= merit - demerit） |
| **dispatched_to_tenant** | FK(Tenant) | **外派目标租户（nullable）—— 惩罚执行地** |
| **dispatch_status** | enum | **null / PENDING_DISPATCH / DISPATCHED / COMPLETED** |
| created_at | datetime | 创建时间 |

**dispatch_status 状态说明：**

|| 状态 | 说明 |
|------|------|
| null | 未外派，灵魂在所属租户内完成处置 |
| PENDING_DISPATCH | 已发起外派，等待目标租户确认接收 |
| DISPATCHED | 已外派，灵魂正在目标租户执行惩罚 |
| COMPLETED | 外派惩罚完成，等待轮回 |

> **注意：** 移除了 `civilization` 字段，租户标识通过 `tenant` 外键实现。
> `dispatched_to_tenant` 仅用于跨租户外派场景，本租户内处置时为 null。

### 3.5 SoulRecord（业力记录）

> **重要：业力记录归属策略** — SoulRecord 跟随灵魂（Soul），而非租户。当灵魂被外派到目标租户时，其所有业力记录一并移动，目标租户法官可查看完整历史。

||| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| tenant | FK(Tenant) | 记录创建时所属租户（通过 Soul 级联，灵魂移动时记录一并迁移） |
| soul | FK(Soul) | 关联灵魂 |
| record_type | enum | MERIT / DEMERIT |
| category | string(50) | 类别（CHARITY 等） |
| description | text | 具体描述 |
| weight | integer | 权重 1-10 |
| event_date | date | 事件发生日期 |
| is_milestone | boolean | 重大事件标记 |
| created_at | datetime | 记录时间 |

### 3.6 Realm（地域）

|| 字段 | 类型 | 说明 |
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

|| 字段 | 类型 | 说明 |
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

|| 字段 | 类型 | 说明 |
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

|| 字段 | 类型 | 说明 |
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

|| 字段 | 类型 | 说明 |
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

||| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| tenant | FK(Tenant) | 所属租户（通过 Soul 级联） |
| soul | FK(Soul) | 关联灵魂 |
| event_type | enum | 事件类型（见下方枚举） |
| payload | JSONB | 事件数据 |
| actor | string(100) | 触发者（系统/用户名） |
| created_at | datetime | 事件时间 |

**event_type 枚举值：**

||| 事件类型 | 说明 |
|------|------|
| SOUL_CREATED | 灵魂创建 |
| STATE_CHANGED | 状态变更 |
| JUDGMENT_CREATED | 审判创建 |
| JUDGMENT_CONCLUDED | 审判结束 |
| DISPOSITION_CREATED | 处置创建 |
| DISPOSITION_EXECUTED | 处置执行 |
| DISPATCH_PROPOSED | 外派提议 |
| DISPATCH_APPROVED | 外派批准 |
| DISPATCH_REJECTED | 外派拒绝 |
| DISPATCH_EXECUTED | 外派执行（灵魂迁移至目标租户） |
| CROSS_JUDGMENT_CREATED | 跨租户审判创建 |
| CROSS_JUDGMENT_JOINED | 跨租户审判参与 |
| CROSS_JUDGMENT_CONCLUDED | 跨租户审判结束 |
| PERMISSION_DENIED | 权限拒绝（跨租户访问尝试无权限） |
| KARMA_RECORD_ADDED | 业力记录添加 |

### 3.12 DispatchRecord（外派记录）

> 记录灵魂被外派到其他租户进行惩罚执行的信息。

|| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| **source_tenant** | FK(Tenant) | **来源租户（发起外派的租户）** |
| **target_tenant** | FK(Tenant) | **目标租户（接收并执行惩罚的租户）** |
| **soul** | FK(Soul) | 被外派的灵魂 |
| **cross_tenant_judgment** | FK(CrossTenantJudgment) | 关联的跨租户审判（nullable） |
| reason | text | 外派原因说明 |
| **dispatched_by** | FK(User) | 发起外派的用户 |
| dispatched_at | datetime | 外派时间 |
| returned_at | datetime | 惩罚完成返回时间（nullable） |
| status | enum | PENDING / IN_PROGRESS / COMPLETED / RETURNED |

### 3.13 CrossTenantJudgment（跨租户审判）

> 记录跨租户联合审判会话。多个租户的法官共同参与对某一灵魂的审判。

|| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| **source_tenant** | FK(Tenant) | **灵魂所属租户（发起审判邀请的租户）** |
| **soul** | FK(Soul) | 被审判的灵魂 |
| court_name | string(100) | 审判庭名称（可跨租户） |
| status | enum | **PROPOSED / IN_REVIEW / APPROVED / REJECTED** |
| verdict | enum | PASSED / FAILED / PURGATORY（nullable，判决后才填） |
| notes | text | 审判备注 |
| created_at | datetime | 创建时间 |
| concluded_at | datetime | 审判结束时间 |

**跨租户审判参与者：**

|| 关联表 | 说明 |
|--------|------|
| CrossTenantJudgmentParticipant | 记录参与者信息 |

**CrossTenantJudgmentParticipant（跨租户审判参与者）**

|| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| cross_tenant_judgment | FK(CrossTenantJudgment) | 关联的跨租户审判 |
| **participant_tenant** | FK(Tenant) | **参与者所属租户** |
| **participant_user** | FK(User) | **参与者用户（需有 DISPATCH_JUDGE 权限）** |
| role | enum | ADVISOR / CO_JUDGE / CHAIRMAN |
| added_at | datetime | 加入时间 |
| voted_at | datetime | 投票时间（nullable） |
| vote | enum | APPROVE / REJECT / ABSTAIN（nullable） |

---

## 4. 状态机设计

### 4.1 状态流转图（单租户内）

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

### 4.2 状态流转图（跨租户外派）

当灵魂需要外派到其他租户执行惩罚时：

```
 ┌─────────┐   die()    ┌───────────┐  conclude()  ┌──────────┐  propose_dispatch()  ┌─────────────────┐
 │  ALIVE  │ ─────────► │  JUDGING  │ ───────────► │ DISPOSED │ ────────────────────► │ PENDING_DISPATCH │
 └─────────┘            └───────────┘              └──────────┘                       └────────┬────────┘
                                                                                               │
                                                                        ┌───────────────────────┼───────────────────────┐
                                                                        │                       │                       │
                                                                   approve()              reject()              cancel()
                                                                        │                       │                       │
                                                                        ▼                       ▼                       ▼
                                                            ┌─────────────────┐      ┌──────────┐         ┌──────────────┐
                                                            │   DISPATCHED    │      │ 取消外派  │         │ 返回 DISPOSED │
                                                            │ (前往目标租户)   │      │ 本地执行  │         │ (本地处置)    │
                                                            └────────┬────────┘      └──────────┘         └──────────────┘
                                                                     │
                                                                     │ execute_dispatch()
                                                                     ▼
                                                            ┌─────────────────┐
                                                            │ REINCARNATING   │
                                                            │ (目标租户地域)   │
                                                            └────────┬────────┘
                                                                     │
                                                                     ▼
                                                            ┌─────────────────┐
                                                            │     ALIVE       │
                                                            │ (目标租户轮回)   │
                                                            └─────────────────┘
```

**关键说明：**
- **DISPOSED → PENDING_DISPATCH**：来源租户法官提出外派申请（verdict=FAILED 且犯罪涉及跨租户）
- **PENDING_DISPATCH → DISPATCHED**：目标租户法官批准，外派执行
- **DISPATCHED → REINCARNATING**：灵魂迁移到目标租户，进入目标租户的轮回状态
- **跨租户轮回**：灵魂在外派目标租户的地域完成轮回，不是来源租户
- **LOST**：无论是本地处置还是外派，灵魂都可能进入 LOST 终态

### 4.3 各状态详细说明

| 状态 | 说明 | 进入条件 | 允许转出 |
|------|------|---------|---------|
| ALIVE | 存活 | REINCARNATING 完成 | JUDGING（die） |
| JUDGING | 审判中 | ALIVE（die） | DISPOSED（conclude） |
| DISPOSED | 已判决 | JUDGING（conclude） | REINCARNATING（execute）/ PENDING_DISPATCH（propose_dispatch）/ LOST |
| PENDING_DISPATCH | 等待外派审批 | DISPOSED（propose_dispatch） | DISPATCHED（approve）/ DISPOSED（reject/cancel） |
| DISPATCHED | 已外派 | PENDING_DISPATCH（approve） | REINCARNATING（execute_dispatch） |
| REINCARNATING | 轮回中 | DISPOSED（execute） 或 DISPATCHED（execute_dispatch） | ALIVE（complete） |
| LOST | 失踪/湮灭 | DISPOSED（手动标记）或任何状态（系统判定） | 无（终态） |

### 4.4 dispatch_status 子状态

Soul.dispatched_to_tenant 非空时，灵魂处于外派流程：

| dispatch_status | 说明 | 关联状态 |
|----------------|------|---------|
| null | 未外派，本租户内完成处置 | ALIVE/JUDGING/DISPOSED/REINCARNATING/LOST |
| PENDING_DISPATCH | 已发起外派，等待目标租户确认 | PENDING_DISPATCH |
| DISPATCHED | 已外派，灵魂正在目标租户执行惩罚 | DISPATCHED → REINCARNATING |
| COMPLETED | 外派惩罚完成，等待目标租户轮回 | REINCARNATING（在目标租户） |

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

#### 5.3.1 本地处置路由（默认）

| 租户 | verdict=PASSED 或 karma ≥ 0 | verdict=FAILED 且 karma < 0 | verdict=PURGATORY |
|------|-----|-----|---------|
| **CN_DIYU** | karma ≥ 0 → 第一层天界 | tier = min(10, abs(karma)/10+1) → 对应地狱层 | 待定 |
| **EU_HEAVEN_HELL** | karma ≥ 0 → Heaven | circle = min(9, abs(karma)/15+1) → Dante 九层地狱 | Purgatory 层 |
| **EG_DUAT** | 心脏平衡 → Aaru | 心脏比羽毛重 → Ammit 吞噬或 Duat 深层 | 炼狱沼泽 |

#### 5.3.2 跨租户外派路由（Dispatch）

当 verdict=FAILED 且犯罪行为涉及其他租户地域时，来源租户法官可提议外派：

```
来源租户法官提出外派申请
         │
         ▼
   ┌─────────────────┐
   │ PENDING_DISPATCH │ ◄── Soul.state
   └────────┬────────┘
            │
            ▼
   ┌─────────────────────────────────────┐
   │       目标租户法官审批                │
   │  (检查 target_tenant.dispatch_enabled) │
   └───────────────┬─────────────────────┘
                    │
         ┌──────────┴──────────┐
         ▼                     ▼
    批准 (approve)       拒绝 (reject)
         │                     │
         ▼                     ▼
   ┌───────────┐        ┌───────────┐
   │ DISPATCHED │        │ 返回 DISPOSED │
   │ (跨租户)   │        │ 本地执行     │
   └─────┬─────┘        └───────────┘
         │
         │ execute_dispatch()
         ▼
   ┌─────────────────┐
   │ REINCARNATING   │
   │ (目标租户地域)   │
   └─────────────────┘
```

**关键说明：**
- 外派前必须验证 `target_tenant.dispatch_enabled = true`，否则拒绝
- 灵魂执行外派后，在**目标租户的地域**完成轮回（不是返回来源租户）
- 来源租户保留灵魂记录用于历史和审计

#### 5.3.3 跨租户外派决策矩阵

| 条件 | verdict | 犯罪涉及地域 | 目标租户配合意愿 | 路由决策 |
|------|---------|-------------|----------------|---------|
| 本地犯罪 | FAILED | 来源租户 | - | 本地处置 |
| 跨租户犯罪 | FAILED | 目标租户 | 同意 | 外派到目标租户 |
| 跨租户犯罪 | FAILED | 目标租户 | 拒绝 | 本地处置 |
| 跨租户犯罪 | FAILED | 多租户 | - | 联合审判（CrossTenantJudgment）→ 主判租户执行 |
| PASSED/PURGATORY | - | - | - | 本地处置（按 5.3.1） |

**跨租户犯罪认定标准：**
- 灵魂在现世的伤害行为发生在其他租户地域（如中国灵魂在欧洲犯下罪行）
- 受害方为其他租户的灵魂
- 犯罪结果影响其他租户的秩序

#### 5.3.4 外派 vs 本地处置判定流程

```
judgment.conclude(verdict=PASSED/PURGATORY)?
    │
    ├─ YES → 本地处置（按租户规则路由）
    │
    └─ NO (verdict=FAILED)
           │
           ▼
       犯罪涉及跨租户?
           │
           ├─ NO → 本地处置
           │
           └─ YES
                  │
                  ▼
            目标租户同意接收?
                  │
                  ├─ YES → propose_dispatch() → PENDING_DISPATCH
                  │        (检查 target_tenant.dispatch_enabled)
                  │
                  └─ NO → 本地处置
```

**dispatch_enabled 检查：**

在 propose_dispatch() 阶段：
1. 查询 `target_tenant.dispatch_enabled`
2. 如果为 `false`，返回错误："Tenant not accepting dispatches"
3. 如果为 `true`，创建 PENDING_DISPATCH 记录

### 5.4 Memory Reset 机制

| 值 | 租户 | 说明 |
|----|------|------|
| MENGPO | CN_DIYU | 孟婆汤（清除现世记忆） |
| LETIES | EU_HEAVEN_HELL | 忘川（Lethe 河水） |
| SPELL | EG_DUAT | 咒语（魔法记忆消除） |
| NONE | 通用 | 完整记忆保留 |

### 5.5 联合审判（CrossTenantJudgment）

当犯罪涉及多个租户时，可发起联合审判：

- **发起方**：来源租户法官（source_tenant）
- **参与方**：目标租户法官（需有 DISPATCH_JUDGE 角色）
- **审判结果**：统一 verdict，处置地点由主判租户决定或协商决定
- **执行方**：verdict=FAILED 时，可外派到涉案租户执行

---

## 6. API 设计

> **认证：** Bearer JWT Token（30分钟有效，Refresh 7天）
> **租户隔离：** 所有业务 API 非 SYS_ADMIN 自动按 `user.tenant` 过滤

### 6.0 分页与过滤（通用）

所有列表接口（list endpoints）统一支持以下分页和过滤参数：

**请求参数：**

|| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|-------|------|
| page | integer | 1 | 页码 |
| page_size | integer | 20 | 每页数量（最大 100） |
| ordering | string | -created_at | 排序字段（加 `-` 前缀表示降序） |
| search | string | null | 模糊搜索（可选） |
| state | string | null | 按状态过滤（如 JUDGING、DISPOSED） |

**响应格式：**
```json
{
  "count": 42,
  "next": "/api/v1/souls/?page=2",
  "previous": null,
  "results": [
    { ... }
  ]
}
```

> **注意：** SYS_ADMIN（系统管理员）调用列表接口时不过滤租户，可通过 `tenant` 参数指定查看特定租户数据。

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
    "role": "SYS_ADMIN",
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

### 6.11 Dispatch（跨租户外派）

> 跨租户外派允许将灵魂从一个租户派遣到另一个租户执行惩罚。

#### 6.11.1 DispatchRecord（外派记录）

| 方法 | 端点 | 描述 | 认证 |
|------|------|------|------|
| GET | /api/v1/dispatch/ | 列表（按 tenant 自动过滤） | 是 |
| POST | /api/v1/dispatch/propose/ | 提议外派到另一个租户 | JUDGE+ |
| GET | /api/v1/dispatch/{id}/ | 外派记录详情 | 是 |
| POST | /api/v1/dispatch/{id}/approve/ | 目标租户法官批准 | DISPATCH_JUDGE |
| POST | /api/v1/dispatch/{id}/reject/ | 目标租户法官拒绝 | DISPATCH_JUDGE |
| POST | /api/v1/dispatch/{id}/cancel/ | 发起方取消外派 | JUDGE+ |
| POST | /api/v1/dispatch/{id}/execute/ | 执行外派（移动灵魂到目标租户） | SYSTEM/ADMIN |
| GET | /api/v1/dispatch/{id}/status/ | 外派状态详情 | 是 |

**POST /api/v1/dispatch/propose/ 请求体：**
```json
{
  "soul_id": "uuid",
  "target_tenant_code": "EU_HEAVEN_HELL",
  "reason": "该灵魂在欧洲犯下罪行，需移交欧洲冥界处理",
  "cross_tenant_judgment_id": "uuid（可选，关联联合审判）"
}
```

**POST /api/v1/dispatch/{id}/approve/ 请求体：**
```json
{
  "notes": "批准外派，将在欧洲地狱执行惩罚"
}
```

**POST /api/v1/dispatch/{id}/reject/ 请求体：**
```json
{
  "reason": "拒绝原因，如：该灵魂不属于欧洲管辖",
  "alternative_target": "EG_DUAT（可选，建议其他目标）"
}
```

**响应示例（GET /api/v1/dispatch/）：**
```json
{
  "count": 2,
  "results": [
    {
      "id": "uuid",
      "soul": {
        "id": "uuid",
        "name": "张三",
        "current_state": "PENDING_DISPATCH"
      },
      "source_tenant": {
        "code": "CN_DIYU",
        "display_name": "中国地府"
      },
      "target_tenant": {
        "code": "EU_HEAVEN_HELL",
        "display_name": "European Heaven-Hell"
      },
      "status": "PENDING",
      "dispatched_by": {
        "username": "判官"
      },
      "dispatched_at": "2026-05-09T10:00:00Z",
      "reason": "该灵魂在欧洲犯下罪行"
    }
  ]
}
```

#### 6.11.2 CrossTenantJudgment（跨租户联合审判）

| 方法 | 端点 | 描述 | 认证 |
|------|------|------|------|
| GET | /api/v1/cross-tenant-judgments/ | 列表（按 tenant 自动过滤） | 是 |
| POST | /api/v1/cross-tenant-judgments/ | 创建联合审判会话 | JUDGE+ |
| GET | /api/v1/cross-tenant-judgments/{id}/ | 联合审判详情 | 是 |
| POST | /api/v1/cross-tenant-judgments/{id}/participate/ | 加入联合审判 | DISPATCH_JUDGE |
| POST | /api/v1/cross-tenant-judgments/{id}/conclude/ | 结束审判并判决 | JUDGE（发起方） |
| GET | /api/v1/cross-tenant-judgments/{id}/participants/ | 参与者列表 | 是 |

**POST /api/v1/cross-tenant-judgments/ 请求体：**
```json
{
  "soul_id": "uuid",
  "court_name": "跨租户联合审判庭",
  "target_tenants": ["EU_HEAVEN_HELL", "EG_DUAT"],
  "notes": "该灵魂同时在欧洲和埃及犯下罪行"
}
```

**POST /api/v1/cross-tenant-judgments/{id}/participate/ 请求体：**
```json
{
  "role": "CO_JUDGE"
}
```

**CrossTenantJudgment 状态流转：**
```
PROPOSED → IN_REVIEW → APPROVED/REJECTED
                    ↓
               verdict 判决
                    ↓
            → 执行处置或外派
```

**REJECTED 判决处理：**

当 CrossTenantJudgment 状态变为 REJECTED 时：
- 灵魂返回 `JUDGING` 状态
- 源租户法官需要重新发起本地审判（standard judgment）
- 跨租户审判记录保留用于审计

**APPROVED 判决处理：**

当 CrossTenantJudgment 状态变为 APPROVED 且 verdict=FAILED 时：
- 触发外派流程（dispatch）
- 灵魂进入 PENDING_DISPATCH 状态
- 详见 §6.11.1 外派记录接口

---

## 6.X 权限模型

> 本节定义 SoulLedger 系统的细粒度权限控制体系，包括角色定义、三层权限粒度、外派特殊权限以及前后端实施方式。

### 6.X.1 角色定义（Role Definition）

|| 角色 | 范围 | 说明 |
|------|-------|-------------|
| TENANT_ADMIN | Per-tenant | 阎罗王/撒旦/奥西里斯 — 租户内全权管理 |
| JUDGE | Per-tenant | 判官 — 可执行审判、查看灵魂 |
| GUARDIAN | Per-tenant | 牛头马面 — 可添加业力记录、查看灵魂 |
| VIEWER | Per-tenant | 只读 — 仅仪表盘访问 |
| SYS_ADMIN | Global | 系统管理员 — 只读统计，无法干预业务 |
| DISPATCH_JUDGE | Per-tenant | 跨租户审判参与者 — 可参与其他租户的联合审判 |

### 6.X.2 权限粒度（Permission Granularity）

系统采用三层权限控制：

**1. 页面可见性（Page Visibility）— 控制菜单项显示**

|| 页面 | TENANT_ADMIN | JUDGE | GUARDIAN | VIEWER | SYS_ADMIN | DISPATCH_JUDGE |
|------|-------------|-------|----------|--------|-------|----------|---------------|
| /{tenant}/souls/ | ✓ | ✓ | ✓ | ✓ | ✓ (via /admin/) | ✓ |
| /{tenant}/souls/[id]/ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| /{tenant}/dispatch/propose/ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| /{tenant}/dispatch/pending/ | ✓ | ✓ | ✗ | ✗ | ✗ | ✓ |
| /{tenant}/cross-judgments/ | ✓ | ✓ | ✗ | ✗ | ✗ | ✓ |
| /{tenant}/realms/ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| /{tenant}/actors/ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| /admin/dashboard/ | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ |
| /admin/dispatch/audit/ | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ |

**2. 操作权限（Operation Permission）— 控制 API 可执行操作**

|| 操作 | TENANT_ADMIN | JUDGE | GUARDIAN | VIEWER | DISPATCH_JUDGE |
|-----------|-------------|-------|----------|--------|--------------|
| soul.create | ✓ | ✓ | ✗ | ✗ | ✗ |
| soul.die | ✓ | ✓ | ✗ | ✗ | ✗ |
| soul.transition | ✓ | ✓ | ✗ | ✗ | ✗ |
| soul.view | ✓ | ✓ | ✓ | ✓ | ✓ |
| soul.add_record | ✓ | ✓ | ✓ | ✗ | ✗ |
| judgment.conclude | ✓ | ✓ | ✗ | ✗ | ✗ |
| disposition.execute | ✓ | ✓ | ✗ | ✗ | ✗ |
| dispatch.propose | ✓ | ✓ | ✗ | ✗ | ✗ |
| dispatch.approve | ✓ | ✓ | ✗ | ✗ | ✗ |
| dispatch.execute | ✓ | ✓ | ✗ | ✗ | ✗ |
| cross_judgment.create | ✓ | ✓ | ✗ | ✗ | ✗ |
| cross_judgment.join | ✓ | ✓ | ✗ | ✗ | ✓ |
| cross_judgment.conclude | ✓ | ✓ | ✗ | ✗ | ✗ |
| realm.view | ✓ | ✓ | ✓ | ✓ | ✓ |
| actor.view | ✓ | ✓ | ✓ | ✓ | ✓ |

**3. 字段级可见性（Field-Level Visibility）— 控制数据字段暴露**

以 Soul 模型为例：

| 字段 | TENANT_ADMIN | JUDGE | GUARDIAN | VIEWER |
|-------|-------------|-------|----------|--------|
| karmic_balance | ✓ | ✓ | ✗ | ✓ |
| merit_score | ✓ | ✓ | ✓ | ✗ |
| demerit_score | ✓ | ✓ | ✓ | ✗ |
| death_date | ✓ | ✓ | ✓ | ✓ |
| dispatch_status | ✓ | ✓ | ✗ | ✗ |

### 6.X.3 外派权限（Dispatch Permission）

外派模块有特殊权限要求：

| 权限 | 可执行角色 | 说明 |
|------|----------|------|
| dispatch:propose | TENANT_ADMIN, JUDGE | 发起外派申请 |
| dispatch:approve | TENANT_ADMIN, JUDGE (目标租户) | 批准外派 |
| dispatch:reject | TENANT_ADMIN, JUDGE (目标租户) | 拒绝外派 |
| cross_judgment:create | TENANT_ADMIN, JUDGE | 创建联合审判 |
| cross_judgment:participate | DISPATCH_JUDGE | 参与联合审判 |

### 6.X.4 权限实施（Permission Enforcement）

**后端实施：**

- **DRF Permission Classes**：每个 ViewSet 配置自定义 Permission Class
  ```python
  class SoulViewSet(ModelViewSet):
      permission_classes = [IsAuthenticated, TenantPermission]
      # TenantPermission 检查 user.tenant == obj.tenant
  ```
- **Service Layer 验证**：敏感操作在 Service 层二次校验
- **ADMIN 只读保证**：ADMIN 角色 bypass tenant 过滤，但业务层强制 read-only

**前端实施：**

- **useAuth() Hook**：在组件渲染前检查角色和权限
  ```typescript
  const { hasPermission, role } = useAuth();
  // hasPermission('soul.create') → boolean
  ```
- **路由守卫**：Router 层校验菜单可见性
- **API 拦截**：请求自动携带 JWT，401/403 处理

**中间件验证：**

- TenantMiddleware 从 JWT 提取 tenant_id 和 user_id
- 请求进入 ViewSet 前，验证用户 tenant 与资源 tenant 一致
- 跨租户访问时，验证用户是否具有 `cross_tenant` 权限或 `DISPATCH_JUDGE` 角色

---

### 6.X.5 跨租户 API 访问（Cross-Tenant API Access）

当租户 A 的法官需要访问租户 B 的 API 进行跨租户审判时，采用以下机制：

**JWT 携带的信息：**

```json
{
  "user_id": "uuid",
  "tenant_id": "CN_DIYU (source)",
  "role": "JUDGE",
  "permissions": ["cross_tenant"]
}
```

**目标租户 API 的验证流程：**

1. **JWT 验证**：目标租户的 Django 使用共享密钥验证 JWT 签名
2. **租户识别**：从 JWT payload 读取 `tenant_id`（source tenant），而非从请求路径
3. **权限检查**：
   - 验证用户是否具有 `cross_tenant` 权限或 `DISPATCH_JUDGE` 角色
   - 验证请求的操作是否在允许范围内（只读操作）
4. **操作限制**：
   - 读操作：查看灵魂、添加意见 — 允许
   - 写操作：最终判决、执行外派 — 仅限源租户

**TenantMiddleware 跨租户检查逻辑：**

```python
# TenantMiddleware 伪代码
def process_request(self, request):
    jwt_tenant_id = request.jwt_payload.get('tenant_id')
    requested_tenant = request.path_tenant  # 从 URL 解析的目标租户
    
    if requested_tenant != jwt_tenant_id:
        # 跨租户访问
        if not user.has_cross_tenant_permission():
            raise PermissionDenied("Cross-tenant access denied")
        # 设置为只读模式
        request.cross_tenant_readonly = True
```

**跨租户 API 端点示例：**

```
# 租户 A 的法官参与租户 B 的联合审判
POST /api/v1/cross-tenant-judgments/{id}/participate/
Authorization: Bearer <JWT from tenant A>

# 租户 B 的 API 验证 JWT，发现 tenant_id=A（来源），允许参与
```

---

## 7. 前端架构

### 7.1 路由结构

```
/                           # 首页（三大租户入口卡片）
/login                      # 登录页

/{tenant}/                  # 租户视图（tenant 代码：CN_DIYU / EU_HEAVEN_HELL / EG_DUAT）
  souls/                    # 灵魂列表
  souls/[id]/               # 灵魂详情
  realms/                   # 地域列表
  actors/                   # 角色列表
  dispatch/
    propose/                # 发起外派申请
    pending/                # 待处理外派申请
    history/                # 外派历史
  cross-judgments/          # 联合审判页面

/admin/                     # ADMIN 专属（只读）
  dashboard/                # 全局统计大屏
  dispatch/audit/           # 外派审计（只读）
```

### 7.2 导航流程

```
用户打开首页
    ↓
未登录 → /login
    ↓ 登录成功（JWT 含 tenant_code）
JWT 解码 → 获取 user.tenant.code
    ↓
role = ADMIN → /admin/dashboard/
role ≠ ADMIN → /{tenant_code}/souls/
```

### 7.3 TenantContext.tsx

前端通过 `TenantContext` 追踪当前租户上下文：

```typescript
interface TenantContextType {
  tenant: Tenant | null;        // 当前租户对象
  tenantCode: string | null;    // CN_DIYU / EU_HEAVEN_HELL / EG_DUAT
  isAdmin: boolean;             // 是否 ADMIN 角色
  language: string;             // 当前语言（dispatch 内容使用此语言）
}

// 使用示例
const { tenant, tenantCode, isAdmin, language } = useTenant();
```

**数据流：**
1. 用户登录后，API 返回 JWT，payload 含 `tenant_code`
2. 前端从 JWT 解码出 `tenant_code`，设置 `TenantContext`
3. 所有 API 请求自动携带 `tenant_code` 路径前缀
4. 路由 `/[tenant]/...` 中的 `tenant` 参数与 `TenantContext.tenantCode` 保持同步

### 7.4 i18n 策略

- 语言：zh-Hans / en / egy
- 方案：React Context + Cookie
- 字体：Noto Sans Egyptian Hieroglyphs（象形文字）
- 租户内容（地域名/角色名）使用对应语言 locale
- **dispatch 内容：** 外派申请、联合审判等跨租户内容使用当前用户的语言设置；多语言混合场景（如联合审判）以发起方语言为主

### 7.5 API 路由前缀

所有前端 API 调用自动添加租户路径前缀：

```typescript
// 租户业务 API
GET /api/v1/{tenant_code}/souls/
GET /api/v1/{tenant_code}/dispatch/

// ADMIN 全局 API（无租户前缀）
GET /api/v1/stats/global/
GET /api/v1/stats/by-tenant/
```

### 7.X UI Framework（可选功能）

> 以下为可选的 UI 增强功能，不影响核心业务，可根据项目进度选择性实现。

#### 7.X.1 Theme System（主题系统）

当前实现：Light/Dark 通过 Tailwind `dark:` classes + Cookie 切换。

增强功能：
- **ThemeProvider Context**：包装整个应用的 Theme 上下文
- **系统偏好检测**：自动检测 `prefers-color-scheme`
- **localStorage 持久化**：主题选择保存到 localStorage
- **设置抽屉快捷切换**：在设置抽屉中提供主题切换

```typescript
interface ThemeContextType {
  theme: 'light' | 'dark' | 'system';
  resolvedTheme: 'light' | 'dark';
  setTheme: (theme: 'light' | 'dark' | 'system') => void;
}
```

#### 7.X.2 Theme Color（主题色）

提供自定义强调色选择器（6 预设 + 自定义）：

| 预设 | 名称 | 用途 |
|------|------|------|
| Amber（默认） | 地府金 | 中国地府主题色 |
| Crimson | 血红色 | 欧洲地狱主题色 |
| Jade | 玉绿 | 埃及主题色 |
| Lapis | 石青蓝 | 备用蓝 |
| Obsidian | 黑曜石黑 | 深色主题强调色 |
| Custom | 自定义 | 用户输入 hex 值 |

存储方式：CSS 变量 `--color-accent`、`--color-accent-hover`

#### 7.X.3 Settings Drawer（设置抽屉）

右侧滑入抽屉式设置面板（不跳转页面），设置持久化到 localStorage：

| 设置项 | 类型 | 默认值 |
|--------|------|--------|
| Language | Select: zh-Hans / en / egy | zh-Hans |
| Theme | Select: Light / Dark / System | System |
| Accent Color | Color picker (6 presets + custom) | Amber |
| Compact Mode | Toggle | Off |
| Show Quick Actions | Toggle | On |

#### 7.X.4 Personal Center（个人中心）

路由：`/{tenant}/profile/` 或 `/profile/`

功能模块：
- **Profile Info**：用户名、显示名、角色、租户信息
- **Change Password**：修改密码表单
- **Notification Preferences**：通知偏好设置
- **Appearance Settings**：外观设置（跳转设置抽屉快捷方式）
- **Activity History**：近期操作历史

#### 7.X.5 Navigation Modes（导航模式）

两种导航模式（存储在用户偏好）：

| 模式 | 描述 |
|------|------|
| **Classic Menu** | 传统侧边栏，图标 + 文字标签，始终展开 |
| **Compact Menu** | 仅图标侧边栏，hover 展开 |

两种模式均保持 NavBar 显示租户上下文。

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

**核心基础设施**

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

**JWT 认证**

| 任务 | 状态 | 验收标准 |
|------|------|---------|
| SimpleJWT 安装配置 | ✅ | djangorestframework-simplejwt |
| User 模型 + 角色 | ✅ | ADMIN/JUDGE/GUARDIAN/VIEWER |
| Auth endpoints | ✅ | login/register/logout/refresh/profile |
| 前端登录页 | ✅ | /login 页面，Token 存 cookie |
| API 认证保护 | ✅ | 所有业务端点需 JWT |

### Milestone 3 🔲 进行中

**多租户后端基础设施**

|| 任务 | 状态 | 验收标准 |
|------|------|---------|
| Tenant 模型 | 🔲 | code/display_name/settings/dispatch_enabled/api_endpoint |
| 三租户种子数据 | 🔲 | CN_DIYU / EU_HEAVEN_HELL / EG_DUAT 各一条 |
| 所有表加 tenant_id | 🔲 | Soul/Realm/Actor/Judgment/Disposition/Reincarnation/Event |
| User → Tenant 关联 | 🔲 | user.tenant_id FK，用户只能访问同租户数据 |
| TenantMiddleware | 🔲 | TenantMiddleware + thread_local.tenant |
| TenantManager | 🔲 | 自动过滤 QuerySet，所有业务模型使用 |
| ViewSet 租户过滤 | 🔲 | 非 ADMIN 强制 tenant 过滤，ADMIN 可跨租户 |
| 租户隔离测试 | 🔲 | pytest 测试跨租户数据不可见 |
| 登录响应加 tenant | 🔲 | /auth/login/ 返回 user.tenant.code 和 display_name |
| **DRF Permission Classes** | 🔲 | 每个 ViewSet 配置 TenantPermission + RolePermission |
| **useAuth() Hook** | 🔲 | 前端权限检查 hook，hasPermission(operation) → boolean |
| **路由守卫** | 🔲 | 菜单项根据角色动态显示/隐藏 |
| **字段级序列化** | 🔲 | 根据角色过滤响应字段（如 VIEWER 看不到 karmic_balance） |

**Session 估算:** 4–5 sessions

### Milestone 4 🔲 待开始

**租户感知前端 + 落地页**

|| 任务 | 状态 | 验收标准 |
|------|------|---------|
| TenantContext | 🔲 | React context，存储 tenant_code/display_name |
| API client 租户注入 | 🔲 | 请求自动带 tenant 上下文 |
| 前端租户路由 | 🔲 | /{tenant}/souls/、/{tenant}/realms/、/{tenant}/actors/ |
| 登录跳转逻辑 | 🔲 | JWT 解码 → redirect 到 /{tenant_code}/souls/ |
| NavBar 租户信息 | 🔲 | 显示当前租户名称 + 用户角色 + 登出 |
| 落地页租户选择 | 🔲 | 三个租户卡片，点击进入该租户登录 |
| 语言切换 | 🔲 | dispatch 内容按用户语言显示 |
| **ThemeProvider** | 🔲 | 主题系统 Context（Light/Dark/System） |
| **Theme Color Picker** | 🔲 | 6 预设 + 自定义强调色选择器 |
| **Settings Drawer** | 🔲 | 右侧滑入抽屉，持久化到 localStorage |
| **Personal Center** | 🔲 | /{tenant}/profile/ 用户信息、修改密码、历史 |
| **Navigation Modes** | 🔲 | Classic/Compact 侧边栏切换 |

**Session 估算:** 3–4 sessions | **依赖:** M3

### Milestone 5 🔲 待开始

**外派模块**（独立复杂模块）

| 任务 | 状态 | 验收标准 |
|------|------|---------|
| DispatchRecord 模型 | 🔲 | source_tenant/target_tenant/soul/dispatched_by/status |
| CrossTenantJudgment 模型 | 🔲 | 跨租户联合审判会话 |
| CrossTenantJudgmentParticipant | 🔲 | 参与者角色（ADVISOR/CO_JUDGE/CHAIRMAN） |
| DispatchService | 🔲 | propose/approve/reject/execute 完整 workflow |
| CrossTenantJudgmentService | 🔲 | 创建会话/参与/结束 workflow |
| dispatch API | 🔲 | /dispatch/propose/、/dispatch/{id}/approve/ 等 |
| 联合审判 API | 🔲 | /cross-tenant-judgments/、/cross-tenant-judgments/{id}/participate/ |
| dispatch 前端页面 | 🔲 | /{tenant}/dispatch/propose/、pending/、history/ |
| 联合审判前端 | 🔲 | /{tenant}/cross-judgments/ |
| dispatch 集成测试 | 🔲 | 跨租户 workflow + 隔离测试 |

**Session 估算:** 2–3 sessions | **依赖:** M3, M4

### Milestone 6 🔲 待开始

**业力系统 + 统计大屏**

| 任务 | 状态 | 验收标准 |
|------|------|---------|
| 业力时间衰减 | 🔲 | effective_score = original × e^(-0.01×years) |
| KarmaService Redis 缓存 | 🔲 | TTL=5min，自动失效 |
| Celery 定时任务 | 🔲 | 每日重算、逾期检查（>30天 JUDGING 提醒） |
| 业力计算 API | 🔲 | /api/v1/souls/{id}/karma/ |
| 前端业力可视化 | 🔲 | Recharts 时间线图 |
| 全局统计 API | 🔲 | /stats/global/、/stats/by-tenant/（ADMIN 专用） |
| ADMIN 统计大屏 | 🔲 | 状态分布饼图、租户对比柱图、业力分布直方图 |
| ADMIN 外派审计页 | 🔲 | /admin/dispatch/audit/（只读） |

**Session 估算:** 2–3 sessions | **依赖:** M3, M4

### Milestone 7 🔲 待开始

**扩展文明数据**

| 任务 | 状态 | 验收标准 |
|------|------|---------|
| European realms 数据 | 🔲 | Heaven(3) + Purgatory(7) + Hell(9) = 17个 |
| European actors 数据 | 🔲 | St. Peter, Hades, Satan, Michael, Lucifer (5) |
| Egyptian realms 数据 | 🔲 | Aaru + Duat regions = 5个 |
| Egyptian actors 数据 | 🔲 | Osiris, Anubis, Thoth, Ma'at (4) |
| 路由验证 | 🔲 | 三文明 dispatch 路由正确 |
| i18n 验证 | 🔲 | 三语言 locale 切换正常 |

**Session 估算:** 1–2 sessions | **依赖:** M3

### Milestone 8 🔲 待开始

**生产就绪**

| 任务 | 状态 | 验收标准 |
|------|------|---------|
| docker-compose.prod.yml | 🔲 | 生产级配置（网络、卷、restart） |
| 多阶段 Dockerfile | 🔲 | < 500MB |
| Nginx HTTPS | 🔲 | SSL 终止，HTTP → HTTPS 重定向 |
| /health/ 端点 | 🔲 | Django + Next.js 健康检查 |
| 结构化日志 | 🔲 | structlog + JSON 格式 |
| Sentry 集成 | 🔲 | 错误追踪 + source maps |
| 环境变量管理 | 🔲 | .env.example，最小 secrets |

**Session 估算:** 2 sessions | **依赖:** 所有里程碑

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

### ADR-006：跨租户外派机制

**决策：** 通过 DispatchRecord + CrossTenantJudgment 实现灵魂跨租户派遣

**理由：**
- 灵魂被外派到目标租户执行惩罚（而非来源租户），符合"犯罪地管辖"原则
- 外派是主动操作，需要目标租户法官审批（DISPATCH_JUDGE 角色），不能静默执行
- 联合审判（CrossTenantJudgment）处理多租户涉及的高复杂度案件，统一定罪后决定执行地
- Soul.dispatched_to_tenant 记录目标租户，状态机 dispatch_status 跟踪外派进度

**跨租户数据流：**
```
来源租户法官 propose_dispatch()
    → 创建 DispatchRecord（status=PENDING）
    → 目标租户法官 approve()
    → Soul.dispatched_to_tenant = 目标租户
    → Soul.dispatch_status = DISPATCHED
    → 目标租户执行惩罚
    → 目标租户轮回完成
    → 灵魂返回来源租户（或留在目标租户轮回）
```

### ADR-007：URL 路径含租户代码

**决策：** 前端路由使用 `/{tenant}/souls/` 而非 session/cookie 存储 tenant

**理由：**
- **可分享性**：URL 含 tenant_code，可直接分享给同租户同事，无需额外上下文
- **可调试性**：浏览器地址栏直接看出当前租户，排查问题快
- **安全性**：JWT 已含 tenant_code，URL 与 JWT 双重验证防止串租户
- **RESTful**：资源按租户组织，语义清晰

**替代方案：**
- Session 存储 tenant：用户开多个标签页登录不同租户时冲突 → 不采用
- Header 传递 tenant：URL 不自包含，无法分享 → 不采用

### ADR-008：ADMIN 只读

**决策：** ADMIN 角色只能查看全局统计，不能干预具体业务操作

**理由：**
- ADMIN（阎罗王/撒旦/奥西里斯）是文明最高管理者，应尊重各租户法官的审判权
- 跨租户干预会破坏业务完整性（如擅自修改灵魂状态）
- 审计需求：ADMIN 的所有操作应可追溯，不能有"业务干预"灰色地带
- 跨租户业务操作（如外派）通过正式的 dispatch workflow 解决，而非 ADMIN 手动介入

**ADMIN 权限范围：**
- 只读：所有租户的 soul/realm/actor/judgment/disposition 数据
- 只读：DispatchRecord + CrossTenantJudgment
- 统计：/api/v1/stats/global/、/api/v1/stats/by-tenant/
- 审计：/admin/dispatch/audit/（只读外派历史）

### ADR-009：Dispatch API 独立设计

**决策：** dispatch 相关功能独立 API（/dispatch/）而非扩展 disposition 端点

**理由：**
- **职责分离**：Disposition 是单租户内执行处置；Dispatch 是跨租户灵魂迁移，逻辑完全不同
- **权限隔离**：Dispatch 需要 DISPATCH_JUDGE 角色审批，Disposition 需要 JUDGE 角色执行，混在一起易权限混淆
- **状态机独立**：DispatchRecord 有独立的 PENDING → IN_PROGRESS → COMPLETED 状态机，与 Soul.state 正交
- **扩展性**：未来可能支持"外派审判庭"等新实体，独立 API 更易扩展
- **前端路由**：/{tenant}/dispatch/ 页面结构清晰，与 /{tenant}/souls/../disposition/ 并列

**替代方案：**
- 扩展 POST /api/v1/disposition/{id}/execute/ 加 target_tenant 参数：职责混乱，权限模型复杂 → 不采用

---

*本文档由 OpenSpec 变更追踪：`openspec/changes/multi-tenant-architecture/`*
