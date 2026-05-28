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
前端 (Next.js 16)  →  http://localhost:3333
后端 (Django 5)    →  http://localhost:8000/api/v1/
PostgreSQL 16       →  localhost:5432 (Docker)
Redis 7             →  localhost:6379
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
│   │   ├── karma/           # 功德计算服务 (含时间衰减、继承)
│   │   ├── judgment/        # 审判系统
│   │   ├── disposition/     # 处置方案
│   │   ├── reincarnation/   # 轮回系统
│   │   ├── actors/          # 角色系统 (判官、守护者等)
│   │   ├── realms/          # 领域系统 (地府、天堂、冥界)
│   │   ├── dispatch/        # 灵魂调度记录
│   │   ├── permissions/     # 跨域审判授权
│   │   ├── audit/           # 审计日志 (含 trace_id)
│   │   ├── tenants/        # 多租户: Tenant模型、TenantManager
│   │   ├── authentication/  # JWT认证
│   │   ├── workflow/        # 审批流程系统
│   │   ├── menus/           # 树形菜单 + MenuButton
│   │   ├── perm/           # RBAC: Permission, Role, DataScope, FieldPermission
│   │   ├── core/           # 公共: middleware, viewsets, mixins
│   │   ├── events/         # 灵魂事件
│   │   ├── notifications/  # 通知系统
│   │   └── org/            # 组织架构
│   ├── config/              # Django配置、URL
│   ├── tests/               # pytest测试 (383 tests)
│
├── frontend/
│   ├── app/                 # Next.js 16 App Router 页面
│   │   ├── souls/          # 灵魂列表与详情
│   │   ├── actors/         # 角色管理
│   │   ├── realms/         # 领域管理
│   │   ├── karma/          # 功德管理
│   │   ├── dispatch/       # 调度管理
│   │   ├── cross-judgments/ # 跨域审判
│   │   ├── workflow/       # 审批流程可视化
│   │   ├── audit/          # 审计日志
│   │   ├── users/          # 用户管理
│   │   ├── profile/        # 个人资料
│   │   ├── notifications/  # 通知中心
│   │   ├── menus/          # 菜单管理
│   │   ├── permissions/    # 权限管理
│   │   └── (auth)/login/  # 登录页
│   ├── src/
│   │   ├── components/     # UI组件
│   │   │   ├── layout/    # AppLayout侧边栏
│   │   │   └── settings/  # SettingsDrawer设置抽屉
│   │   ├── contexts/       # TenantContext, ThemeContext, I18nContext
│   │   ├── hooks/          # TanStack Query hooks
│   │   └── middleware.ts   # 路由守卫
│   ├── lib/api.ts          # 类型安全API客户端
│   ├── messages/            # i18n翻译 (zh-Hans, en, egy)
│   └── tailwind.config.js  # Linear设计系统
│
├── infrastructure/
│   └── docker-compose.yml  # PostgreSQL + Redis
│
├── scripts/
│   ├── start-*.sh          # 启动服务
│   ├── stop-*.sh           # 停止服务 (PID_FILE + 双重检查)
│   ├── restart-*.sh        # 重启服务
│   ├── status.sh           # 查看状态
│   ├── backup-db.sh        # PostgreSQL 数据库备份
│   ├── pids/               # PID 文件
│   └── logs/               # 日志文件
│
├── docs/                   # 项目文档 + 神话研究
│   ├── AUDIT_REPORT_*.md   # 项目审核报告
│   ├── ROADMAP_V2.md       # 产品路线图
│   ├── snowy-analysis.md   # Snowy 基线分析
│   └── (世界观文档: 地府/欧洲/埃及神话体系)
│
├── DESIGN.md               # Linear设计系统规范
├── AGENTS.md               # Agent工作规范
└── SPEC.md                 # 完整项目规范
```

---

## 主要功能

### M1-M6 已完成里程碑
- **M1**: 核心灵魂CRUD + 状态机
- **M2**: 多租户系统 (CN_DIYU / EU_HEAVEN_HELL / EG_DUAT)
- **M3**: JWT认证 + 权限中间件
- **M4**: 角色与领域系统 (Actors + Realms)
- **M5**: 审批流程系统 (Workflow + 7种审判类型)
- **M6**: 功德系统 (时间衰减 + 因果继承)
- **M7**: 用户与组织重构 + 权限系统完整实现 (RBAC codename, DataScope, Button Permission, Field Permission, Audit Trail, Tree Menu, Permission Export)

### 页面模块
| 页面 | 功能 | 角色 |
|------|------|------|
| `/souls` | 灵魂列表与详情 | ALL |
| `/karma` | 功德时间衰减计算 | JUDGE+ |
| `/dispatch` | 灵魂调度记录 | ADMIN |
| `/cross-judgments` | 跨域审判 | JUDGE+ |
| `/actors` | 角色管理 | ADMIN |
| `/realms` | 领域管理 | ADMIN |
| `/workflow` | 审批流程可视化 | JUDGE+ |
| `/audit` | 审计日志 | ADMIN |
| `/users` | 用户管理 | ADMIN |
| `/profile` | 个人资料 | ALL |
| `/notifications` | 通知中心 | ALL |
| `/menus` | 菜单管理 | ADMIN |
| `/permissions` | 权限管理 | ADMIN |

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
| 前端 | Next.js 16, React 18, Tailwind CSS, TanStack Query v5, @xyflow/react, TypeScript |
| 后端 | Django 5, Django REST Framework, 自定义 TenantManager (contextvars), Celery |
| 数据库 | PostgreSQL 16 (生产/CI), SQLite (本地开发) |
| 任务队列 | Celery 5, Redis 7 |
| 容器 | Docker Compose |

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

## 设计参考

菜单和权限系统设计灵感来自 [Snowy](https://github.com/xiaonuobase/Snowy) (Apache-2.0)。

---

*维护者: Tardisyuan*
*GitHub: https://github.com/Tardisyuan/SoulLedger*
