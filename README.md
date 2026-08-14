# SoulLedger

[English](README.en.md) | **中文**

> SoulLedger is a working full-stack web application (Django + Next.js) that tracks
> souls through the afterlife pipelines of three different mythologies — Chinese,
> European and Egyptian — each with a genuinely different data model. It is an
> application, not a documentation repository. Full English README:
> [README.en.md](README.en.md).

SoulLedger 是一个可运行的全栈 Web 应用（Django + Next.js），在同一套系统里追踪灵魂
在三种神话体系中的流转：中国地府、以基督教/希腊/北欧为一组的「欧洲」死后世界，
以及埃及杜阿特。

本仓库是应用代码，不是资料库。`docs/` 里的神话研究是这套领域模型的来源，而且是真正
起作用的来源。

最有意思的地方在于：三种文明不是同一个数据模型换三套配色。它们计算的是结构上不同的
量，代码拒绝把它们抹平成一个数。

---

## 三种文明为什么不是同一套系统

大多数「多文明」演示会挑一套机制再换皮。这里没有。见
[`backend/apps/ledger/readings.py`](backend/apps/ledger/readings.py)：

| 文明 | 账簿真正说的是什么 | 答案的形状 |
|---|---|---|
| **中国** | 累积账户（功過格）。功与过相互抵消，运行总额本身就是结论。 | 一个带符号的数 |
| **埃及** | 阈值检验。心脏与玛特羽毛称量一次，必须「不重于」它。功德根本不出现——这里没有抵消这一步。 | 相对固定砝码的通过/不通过 |
| **欧洲** | 两个互不相关的事实。*culpa*（罪责）与 *poena*（赦罪后仍需的补赎）互不削减，而本系统没有任何数据能诚实地推出 poena。 | 两个独立量，其中一个明确标注为不可得 |

若某灵魂所属租户没有映射到任何文明，系统不会给出任何读数——是一次带理由的明确拒绝，
而不是回落到别人的算术。

同样的原则贯穿衰减规则（`backend/apps/ledger/services.py`）：中国与埃及灵魂的功过
按每年 1% 衰减，**欧洲则完全不衰减**，因为欧洲那一版对外文案本身就否认衰减。衰减以
灵魂的死亡日期为锚，而非以今天为锚——否则公元前 612 年的一桩善行会仅仅因为年代久远
就被磨到零。

这不是只活在后端里的区分。灵魂详情页的 `SoulReadingPanel`
（[`frontend/src/components/souls/SoulReadingPanel.tsx`](frontend/src/components/souls/SoulReadingPanel.tsx)）
按 `reading.kind` 切换渲染：中国是带趋势的净额，埃及把「不重于」画成倍数而非一个
永远显示「不通过」的徽章，欧洲把 culpa 与 poena 分开摆放、poena 缺失时展示的是
「为什么算不出来」而不是 0。灵魂列表的「余额」列同理——只有中国灵魂显示净额，其余
文明显示「—」，不借用一个不属于自己的读数。

日期本身也分两种严重度：`death_before_birth`、`implausible_lifespan`、
`event_before_birth` 是 ERROR，写入直接被拒绝；`event_after_death`（身后录入的记录）
是 WARNING，放行但会在详情页的 `DateProblemsPanel` 里常驻显示，操作者可以「标记为
已核」——标记绑定的是当时那一对日期的指纹，之后若死亡日期或事发日期又被改动，标记
自动失效、警告重新出现，而不是被悄悄清空的布尔值捂住。列表页用 ⊘/△ 标出有问题的
灵魂并可一键筛选。

---

## 快速启动

**环境要求**：Python 3.11+、Node.js 20+；如需本地 PostgreSQL 与 Redis 则需要 Docker。

### 后端

```bash
cd backend
cp .env.example .env
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver 0.0.0.0:8000
```

未设置 `DATABASE_URL` 时 Django 回落到 SQLite（`backend/db.sqlite3`），因此不依赖任何
外部服务即可跑起来（`DEBUG=False` 时会直接拒绝 SQLite）。Redis 只有 WebSocket 与
Celery 需要，REST API 没有它也能运行。

### 前端

```bash
cd frontend
npm install
npm run dev          # 脚本内已固定 PORT=3333
```

### PostgreSQL + Redis（可选，与 CI 一致）

```bash
cd infrastructure
docker compose up -d   # postgres:16-alpine :5432，redis:7-alpine :6379
```

随后让后端指向它，例如
`DATABASE_URL=postgres://soulledger:devpassword@localhost:5432/soulledger`。

### 整栈 Docker

```bash
docker compose up    # 根目录 docker-compose.yml：db、redis、backend、celery、celery-beat、frontend
```

需要在环境中提供 `DB_PASSWORD` 与 `SECRET_KEY`。该路径会在启动时执行迁移并灌入中国域
种子数据。

### 种子数据

根 compose 的启动顺序是 `python manage.py migrate` 再
`python scripts/seed_chinese_data.py`，后者会载入三种文明的领域与角色。其余种子数据
由 Django 管理命令提供：

```bash
python manage.py seed_tenants               # CN_DIYU、EU_HEAVEN_HELL、EG_DUAT
python manage.py seed_mythology             # 三种文明的领域与角色（幂等）
python manage.py consolidate_eu_pantheon
python manage.py seed_workflow_templates
python manage.py seed_field_permissions
python manage.py init_organizations
python manage.py create_api_key             # Death Sync 外部 API 用
```

### 便捷脚本

```bash
bash scripts/start-all.sh      # 前后端后台启动，日志在 scripts/logs/
bash scripts/status.sh
bash scripts/stop-all.sh
bash scripts/install-hooks.sh  # pre-commit：对暂存的前端文件跑 ESLint
```

注意：`start-all.sh` 打印的前端地址是 `:3000`，实际 dev server 监听 `:3333`。

---

## 系统架构

```
前端 (Next.js 16, App Router)  →  http://localhost:3333
后端 (Django 5 + DRF)          →  http://localhost:8000/api/v1/
API 文档 (drf-spectacular)     →  http://localhost:8000/api/docs/
健康检查                        →  http://localhost:8000/health/ 与 /health/detailed/
WebSocket (channels + daphne)  →  ws://localhost:8000/ws/notifications/
PostgreSQL 16                  →  :5432   （本地开发回落 SQLite）
Redis 7                        →  :6379   （Channel Layer + Celery broker）
```

**多租户**：`Tenant` 是一条管理记录，而「文明」是一项关于死者去向的主张。两者的映射
只写在一个地方——`backend/apps/souls/models.py` 中的 `TENANT_CIVILIZATION`。行级隔离
由基于 `contextvars`（而非 `threading.local`）的 `TenantManager` 强制执行，因此在
Celery worker 与异步代码中依然有效。

**权限**：四种角色（ADMIN / JUDGE / GUARDIAN / VIEWER）叠加 codename 权限，再加
`DataScope`（行可见性）与 `FieldPermission`（字段可见性）。API 侧由
`CodenameViewSetMixin` 强制；前端用 `RequirePermission` / `RequireButton` 做 UI 门控。
前端门控只是外观，真正的检查在后端。`/permissions` 页面是一张角色×codename 矩阵而非
逐角色选择器，保存前会做三层校验（越权、悖论式的人数/授权不一致等），每个角色带
`user_count` 与乐观锁 `version`——两次并发保存里，后到的一次会因版本冲突被拒绝，而
不是静默覆盖先到的那次。

**双语外壳**：菜单名、面包屑、角色名是数据库里的自由文本，没有翻译字段，所以在
`en`/`egy` 语言下永远保持中文原文——这是有意为之，不是漏翻。取而代之的是面包屑与
页面 H1 在非中文语言下把翻译后的标签与中文原名并排显示（见
[`frontend/src/lib/menuI18n.ts`](frontend/src/lib/menuI18n.ts)），侧栏图标则要求
在同一父级下互不重复，因为在读不懂中文标签的语言下，图标是唯一的辨认通道。

**事件与实时**：

```
Service → EventBus → HandlerRegistry → ChannelLayer (Redis) → Consumer → 前端缓存失效
```

处理器可按事件类型、按域或全局订阅，注册表内 O(1) 分发。当前发事件的域：soul、
workflow、notification、dispatch、deathsync、social。

**灵魂状态机**（`backend/apps/souls/models.py` 的 `SoulState`）：

```
ALIVE → JUDGING → DISPOSED → REINCARNATING → ALIVE（下一轮）
                     ├──→ SETTLED   （吸收态——永久处置）
                     └──→ LOST      （中止）
```

`SETTLED` 被刻意设计为吸收态：与 `DISPOSED` 不同，它不再保留通往 `LOST` 的路径。

---

## API 一览

全部挂在 `/api/v1/` 下。租户相关接口需要 `X-Tenant-ID` 头，需认证的接口需要
`Authorization: Bearer <access>`。

| 前缀 | 应用 |
|---|---|
| `auth/`、`users/` | JWT 登录/刷新，用户管理 |
| `souls/` | 灵魂 CRUD 与状态转换 |
| `ledger/` | 功过记录、余额、时间衰减、按文明的读数 |
| `judgment/`、`disposition/`、`reincarnation/` | 审判流水线 |
| `realms/`、`actors/` | 冥界地理及其人员 |
| `dispatch/` | 跨域灵魂调度（含审批） |
| `workflows/`、`nodes/`、`workflow/templates/` | 审批流程引擎 |
| `perm/`、`menus/`、`organizations/`、`tenants/` | RBAC、导航、组织架构、租户 |
| `audit-logs/`、`events/`、`notifications/` | 审计轨迹、事件日志、通知 |
| `death-sync/` | 外部死亡登记 API（API Key + HMAC 签名 webhook） |
| `social/` | 帖子、评论、表态、关注、资料 |

上文提到的按文明读数由 `GET /api/v1/ledger/balance/{soul_id}/` 返回。响应同时携带
`karmic_balance`（原始净额，系统其余部分据此路由）与 `reading`（该灵魂自身文明使用的
量具）。**任何展示给用户的数字都应当用 `reading`。**

`/api/schema/` 的 OpenAPI schema 与 `/api/docs/` 的 Swagger UI 才是权威，上表只是索引，
不是契约。

---

## 测试与 CI

`.github/workflows/ci.yml` 在推送到 `main`/`develop` 及向 `main` 提 PR 时运行三个 job：

| Job | 步骤 |
|---|---|
| **backend** | `makemigrations --check --dry-run`、`migrate`、`pytest`、`ruff check`、`pip-audit` |
| **frontend** | `tsc --noEmit`、`eslint`、`next build`、`jest`、`npm audit` |
| **e2e** | Playwright，`--project=chromium`，上传报告 artifact |

后端 CI 跑在真实的 PostgreSQL 16 与 Redis 7 service container 上。

`pip-audit` 与 `npm audit` 目前都是 `continue-on-error: true`——只报告不阻断。原因写在
workflow 文件里各自步骤旁边；若要收紧，请先读那些注释。

本地：

```bash
cd backend && python -m pytest --tb=short -q     # pytest.ini：--cov=apps，--cov-fail-under=40
cd backend && ruff check .
cd frontend && npx tsc --noEmit && npm run lint && npm test
cd frontend && npx playwright test --project=chromium
```

**后端测试分散在两处**——`backend/tests/`，以及 `backend/apps/` 各应用内的
`test_*.py` / `tests.py`。`pytest.ini` 设了 `testpaths = backend`，从仓库根目录运行会
同时收集两边。只对其中一处跑 pytest，会得到一个「看起来绿、实际上证明不了多少」的结果。

覆盖率以 `--cov=apps`（可导入的包名，不是路径）度量，因此无论从仓库根目录还是从
`backend/` 运行，报出的数字都一致。

---

## 仓库结构

```
backend/
  apps/
    souls/          灵魂模型、状态机、租户→文明映射
    ledger/         功过记录、时间衰减、按文明的读数
    judgment/       审判记录与判决
    disposition/    判决 → 目标领域
    reincarnation/  轮回记录
    actors/         判官、守卫、引渡者
    realms/         冥界地理
    dispatch/       跨域调度
    permissions/    跨租户审判授权
    perm/           RBAC：Permission、Role、DataScope、FieldPermission
    tenants/        Tenant 模型、contextvar 版 TenantManager
    authentication/ JWT 认证、User 模型、角色
    workflow/       审批流程引擎
    menus/          树形导航 + MenuButton
    events/         EventBus、EventEnvelope、HandlerRegistry
    notifications/  通知 + WebSocket Consumer
    death_sync/     外部死亡登记 API 与 webhook
    social/         帖子、评论、表态、关注、资料
    org/            组织架构
    audit/          带 trace_id 的审计日志
    core/           中间件、公共 viewset/mixin、WebSocket 认证、健康检查
  config/           settings、URL、ASGI、Celery
  tests/            跨应用 pytest 套件
frontend/
  app/              Next.js App Router 页面
  lib/api/          每个后端应用一个类型安全客户端
  src/hooks/        TanStack Query hooks
  src/components/   UI，含 RBAC 门控组件
  messages/         i18n：zh-Hans、en、egy
  e2e/              Playwright 用例
infrastructure/     PostgreSQL + Redis 的 docker-compose
scripts/            启停/重启/状态、数据库备份恢复、git hooks
docs/               神话研究、工程文档、设计交付包——见 docs/README.md
```

---

## 文档

从 [`docs/README.md`](docs/README.md) 开始，那里索引了整个目录。简版：

- **神话研究（中文）**：约 20 篇关于三套死后世界体系的文档——地府十殿、但丁九圈与
  希腊/北欧冥界、杜阿特十二门与心脏称量。这是领域模型的来源材料，也是
  `readings.py` 长成那样的原因。仓库根目录下的 `地府结构研究/`、`欧洲天堂地狱/`、
  `埃及冥界/` 是同一批文件的镜像。
- **工程文档**：架构、规约、API 说明、里程碑，以及一批带日期的评审/审计报告。
- **[`docs/design-handoff/`](docs/design-handoff/)**：发给外部设计师的设计简报包，含
  29 张实际界面全页截图、设计 token 清单与多语言表格样本。`ADDENDUM.md` 记录了打包
  之后发生的变化，应与 `BRIEF.md` 一起读。该包已被外部引用，请视为冻结内容。

根目录：[`SPEC.md`](SPEC.md) 是完整项目规范，[`DESIGN.md`](DESIGN.md) 是设计系统，
[`CONTRIBUTING.md`](CONTRIBUTING.md) 是协作流程，[`SECURITY.md`](SECURITY.md) 是漏洞
披露政策。

---

## 技术栈

| 层级 | 技术 |
|---|---|
| 前端 | Next.js 16、React 18、TypeScript 5、Tailwind CSS 3、TanStack Query v5、@xyflow/react（流程画布）、Recharts |
| 后端 | Django 5、Django REST Framework、drf-spectacular、channels + daphne |
| 数据库 | PostgreSQL 16（Docker/生产）、SQLite（本地默认） |
| 实时 | channels + channels-redis 的 WebSocket |
| 异步 | Celery 5 + django-celery-beat，Redis broker |
| 认证 | djangorestframework-simplejwt，Death Sync 另用 API Key |
| 测试 | pytest + pytest-django + pytest-cov + factory-boy；Jest + React Testing Library；Playwright |
| 工具链 | ruff、ESLint、TypeScript、Sentry、structlog |

---

## 安全现状

已实现：JWT 与 API Key 认证、带数据与字段范围的 RBAC、webhook secret 与 PII 载荷的
Fernet 加密、基于 Redis 的原子限流、webhook URL 的 SSRF 校验、CSP/HSTS/X-Frame-Options，
以及写操作的审计轨迹。

这份清单描述的是代码做了什么，不是一份安全保证。报告问题的方式见
[`SECURITY.md`](SECURITY.md)。

---

## 定位与状态

这是一个为其自身而做的个人项目——用来搞清楚：要把三套互不兼容的道德记账体系放进
同一套 schema 而不悄悄抹平它们，究竟需要付出什么。它从未部署到任何真实环境，没有用户，
不提供可用性、支持或向后兼容承诺。生产用的 Docker Compose、健康检查和 CI 之所以存在，
是因为「把它们做对」本身就是这个练习的一部分，而不是因为有什么东西真的在跑生产。

里程碑历史在 [`docs/MILESTONES.md`](docs/MILESTONES.md)，它落后于代码。`git log` 才是
准确的记录。

---

## 致谢

菜单与权限系统的设计参考了 [Snowy](https://github.com/xiaonuobase/Snowy)（Apache-2.0）。

维护者：Tardisyuan · <https://github.com/Tardisyuan/SoulLedger>
