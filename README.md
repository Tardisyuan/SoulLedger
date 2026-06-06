# SoulLedger

跨文明灵魂管理系统 — 三种文明(中国/欧洲/埃及)的灵魂审判与轮回全栈Web应用

---

## 文明覆盖

| 领域 | 审判 | 记忆重置 | 归宿 |
|------|------|----------|------|
| **中国地府** | 十殿阎王审判 | 孟婆汤 | 六道轮回 |
| **欧洲天堂地狱** | 原罪 + 但丁九层地狱圈 | 忘川河 | 天堂/炼狱/地狱 |
| **埃及冥界** | 心脏称重 vs 玛特羽毛 | 咒语诵读 | 芦苇原/阿图姆 |

---

## 系统架构

```
前端 (Next.js 16)       →  http://localhost:3333
后端 (Django 5 + DRF)   →  http://localhost:8000/api/v1/
WebSocket (channels)    →  ws://localhost:8000/ws/notifications/
PostgreSQL 16            →  localhost:5432 (Docker)
Redis 7                  →  localhost:6379 (Channel Layer + Celery)
```

---

## 快速启动

### 环境要求
- Python 3.11+
- Node.js 20+
- Docker (用于 PostgreSQL + Redis)

### 1. 启动基础设施
```bash
cd infrastructure
docker compose up -d
```

### 2. 启动后端
```bash
cd backend
cp .env.example .env
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver 0.0.0.0:8000
```

### 3. 启动前端
```bash
cd frontend
npm install
PORT=3333 npm run dev
```

### 或使用脚本 (项目根目录)
```bash
bash scripts/start-backend.sh    # Django on :8000
bash scripts/start-frontend.sh  # Next.js on :3333
bash scripts/stop-all.sh        # 停止两者
bash scripts/status.sh          # 查看状态
bash scripts/restart-backend.sh # 重启后端
bash scripts/restart-frontend.sh # 重启前端
```

---

## 项目结构

```
SoulLedger/
├── backend/
│   ├── apps/
│   │   ├── souls/            # 灵魂模型、状态机、因果
│   │   ├── karma/            # 功德计算服务 (含时间衰减、继承)
│   │   ├── judgment/         # 审判系统
│   │   ├── disposition/      # 处置方案
│   │   ├── reincarnation/    # 轮回系统
│   │   ├── actors/           # 角色系统 (判官、守护者等)
│   │   ├── realms/           # 领域系统 (地府、天堂、冥界)
│   │   ├── dispatch/         # 灵魂调度记录
│   │   ├── permissions/      # 跨域审判授权
│   │   ├── audit/            # 审计日志 (含 trace_id)
│   │   ├── tenants/          # 多租户: Tenant模型、TenantManager
│   │   ├── authentication/   # JWT认证
│   │   ├── workflow/         # 审批流程系统
│   │   ├── menus/            # 树形菜单 + MenuButton
│   │   ├── perm/             # RBAC: Permission, Role, DataScope, FieldPermission
│   │   ├── core/             # 公共: middleware, viewsets, mixins, WebSocket auth
│   │   ├── events/           # EventBus: EventEnvelope, DomainEventHandler, HandlerRegistry
│   │   ├── notifications/    # 通知系统 + WebSocket Consumer
│   │   ├── death_sync/       # 死亡同步 API
│   │   ├── social/           # 社交域: Post, Comment, Reaction, Follow, UserProfile
│   │   └── org/              # 组织架构
│   ├── config/               # Django配置、URL、ASGI (WebSocket路由)
│   └── tests/                # pytest测试 (108 tests)
│
├── frontend/
│   ├── app/                  # Next.js 16 App Router 页面
│   │   ├── souls/            # 灵魂列表与详情
│   │   ├── karma/            # 功德管理
│   │   ├── dispatch/         # 调度管理
│   │   ├── workflow/         # 审批流程可视化
│   │   ├── users/            # 用户管理
│   │   ├── menus/            # 菜单管理
│   │   ├── permissions/      # 权限管理
│   │   ├── admin/stats/      # 管理仪表盘
│   │   └── (auth)/login/     # 登录页
│   ├── lib/
│   │   ├── api/              # 类型安全API客户端
│   │   ├── social/           # 社交域 hooks + queryKeys
│   │   └── ws/               # WebSocket 客户端 (WSClient)
│   ├── hooks/                # TanStack Query hooks + SocialEventBus
│   ├── src/components/       # UI组件 (AppLayout, RequireButton, ConnectionStatus)
│   ├── messages/             # i18n翻译 (zh-Hans, en, egy)
│   └── middleware.ts         # 路由守卫
│
├── infrastructure/
│   └── docker-compose.yml    # PostgreSQL + Redis
│
├── scripts/                  # 启动/停止/重启/状态脚本
├── docs/                     # 项目文档 + 神话研究
├── DESIGN.md                 # Linear设计系统规范
└── SPEC.md                   # 完整项目规范
```

---

## 主要功能

### 里程碑
- **M1-M5**: 核心系统 (灵魂CRUD + 多租户 + JWT + 角色领域 + 审批流程)
- **M6**: 功德系统 (时间衰减 + 因果继承)
- **M7**: DDD重构 + 权限系统 (RBAC, DataScope, FieldPermission, Audit Trail)
- **M8-M9**: 工程质量 + Bug修复
- **M10**: 搜索系统
- **M11**: Death Sync API + WebSocket基础设施
- **M12**: Realtime系统 (EventBus + HandlerRegistry + Social域 + 前端 closure) ✅ **FINAL_CLOSE**

### 页面模块
| 页面 | 功能 | 角色 |
|------|------|------|
| `/souls` | 灵魂列表与详情 | ALL |
| `/karma` | 功德时间衰减计算 | JUDGE+ |
| `/dispatch` | 灵魂调度记录 | ADMIN |
| `/workflow` | 审批流程可视化 | JUDGE+ |
| `/users` | 用户管理 | ADMIN |
| `/menus` | 菜单管理 | ADMIN |
| `/permissions` | 权限管理 | ADMIN |
| `/admin/stats` | 管理仪表盘 | ADMIN |

---

## 关键API

```
认证
POST /api/v1/auth/login/         # 登录 (返回JWT)
POST /api/v1/auth/refresh/      # 刷新Token

灵魂 (需 X-Tenant-ID header)
GET    /api/v1/souls/                     # 列表
POST   /api/v1/souls/                     # 创建
GET    /api/v1/souls/{id}/               # 详情
PATCH  /api/v1/souls/{id}/               # 更新
DELETE /api/v1/souls/{id}/               # 删除
POST   /api/v1/souls/{id}/transition/    # 状态转换

功德
GET    /api/v1/karma/balance/{soul_id}/     # 因果余额
POST   /api/v1/karma/calculate/{soul_id}/  # 重算因果

角色与领域
GET /api/v1/actors/   # 角色列表
GET /api/v1/realms/   # 领域列表

调度
GET  /api/v1/dispatch/records/      # 调度记录
POST /api/v1/dispatch/records/      # 创建调度
GET  /api/v1/dispatch/proposed/     # 待审批

审批流程
GET    /api/v1/workflows/                    # 流程列表
GET    /api/v1/nodes/                        # 节点列表
POST   /api/v1/workflow/templates/           # 创建模板
```

---

## 状态机

```
ALIVE → JUDGING → DISPOSED → REINCARNATING → ALIVE (新生命)
```

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | Next.js 16, React 18, Tailwind CSS, TanStack Query v5, TypeScript |
| 后端 | Django 5, Django REST Framework, channels, contextvars TenantManager |
| 数据库 | PostgreSQL 16 (生产/Docker), SQLite (本地开发) |
| 实时通信 | WebSocket (channels + RedisChannelLayer) |
| 事件总线 | EventBus (EventEnvelope + DomainEventHandler + HandlerRegistry) |
| 任务队列 | Celery 5, Redis 7 |
| 容器 | Docker Compose |
| 测试 | 108 后端 tests, 277 前端 tests |

---

## 预置数据

三个文明的领域和角色已预填充:

### 中国地府 (CN_DIYU)
- **11领域**: 天界、枉死城、十殿阎王等
- **33角色**: 十殿阎王、魏征、崔府君、地藏王菩萨、牛头马面、黑白无常等

### 欧洲天堂地狱 (EU_HEAVEN_HELL)
- **15角色**: Michael, Gabriel, Lucifer, Hades, 希腊三判官, Odin, Freya, Hel等

### 埃及冥界 (EG_DUAT)
- **43角色**: Osiris, Anubis, Thoth, Horus + 42审判者 + Ammit等

---

## 安全特性

- JWT + API Key 认证
- RBAC 4级角色 (ADMIN/JUDGE/GUARDIAN/VIEWER) + DataScope + FieldPermission
- Fernet 加密 (webhook secrets, PII payloads)
- Redis INCR 原子速率限制
- SSRF 防护 (webhook URL 验证)
- CSP / HSTS / X-Frame-Options

## 实时架构

```
EventService → EventBus → Handlers → ChannelLayer → Consumer → Frontend
                                     (Redis)         (WebSocket)
```

- EventBus: 统一事件总线, EventEnvelope + DomainEventHandler
- HandlerRegistry: O(1) 分发, 支持 event_type/domain/global 处理器
- 5 个域: soul, workflow, notification, dispatch, deathsync, social
- ChannelNaming: `rt_tenant_{code}`, `rt_user_{user_id}`

---

## 设计参考

菜单和权限系统设计灵感来自 [Snowy](https://github.com/xiaonuobase/Snowy) (Apache-2.0)。

---

*维护者: Tardisyuan*
*GitHub: https://github.com/Tardisyuan/SoulLedger*
