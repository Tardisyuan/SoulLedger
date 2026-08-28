# Changelog

All notable changes to SoulLedger will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> ### 关于版本号 / On version numbers
>
> `0.1.0` 之后没有再发过版本。判断依据：仓库只有一个 tag（`v0.1.0`，指向
> 2026-05-29 的提交，与本文件记的 `0.1.0 - 2026-05-08` 并不一致），
> `frontend/package.json` 至今仍是 `0.1.0`，后端没有任何版本声明。既然没有可靠的
> 版本信号，也从未发布过，下面就**按日期分段**，段标题写的是工作区间而不是版本号。
> 每段对应一轮主题明确的工作，并在有对应里程碑时标出（M8–M15，见
> [`docs/MILESTONES.md`](docs/MILESTONES.md)）。
>
> 条目按**主题聚合**，不是一条 commit 一行。`git log` 才是逐条的准确记录。
>
> *No release has been cut since `0.1.0`. Sections below are dated work periods,
> not versions — see the reasoning above.*

## [Unreleased]

自 2026-08-15 起、尚未归入某一段的工作。按主题聚合，`git log` 才是逐条记录。

### Added
- **希腊成为第四个文明**（`GREEK` / 租户 `GR_HADES`）：actors、realms、disposition 路由、
  ledger 读数、i18n 标题与配色全线补齐。此前系统只有中国 / 欧洲 / 埃及三个文明
- **可引用的条文语料**，四个文明共 **172 条**：
  - `GONGGUOGE` 74（《太微仙君功過格》，中国）
  - `NEGATIVE_CONFESSION` 42（玛特四十二判官，埃及；DERIVED，不转录正文）
  - `INFERNO` 26 + `DEADLY_SIN` 7（欧洲）
  - `GORGIAS` 12 + `REPUBLIC_ER` 11（希腊）
  - `HELL_LAW` 0，并显式声明 ABSENT
- 希腊与欧洲各有**两套**语料而不是合并成一套：结构不同不可合并——欧洲是七层 vs 九圈，
  希腊是「盖印即终局」（《高尔吉亚》）vs「千年循环后重生」（《理想国》卷十）
- 判决卷宗页、语料浏览页，以及按本租户实际引用频次给条文排序
- 功過格读数：零積不抵整發，以及 fungibility class 与 granularity 规则的 API 通路
- 工作流模板级优先级；申诉流程在各文明都可发起，并带上真实节点
- 处置记录本刑期起算时间，并与灵魂在世时间交叉校验
- 设计系统：真实字体、Tailwind 八级字号阶梯、六个 UI 原语，以及带牙齿的门禁

### Changed
- 44 个页面迁到 `PageShell`
- 处置路由改按各自宇宙论判：中国按未抵消的過、欧洲按 culpa、希腊按柏拉图的岔路
- `Statute.source` 由 `CharField` 改为 `TextField`
- 语料读数改为报出成员与代码，不再拼英文句子
- Git hooks 安装脚本落地——此前那些检查只在有人记得手动跑时才跑

### Fixed
- **四租户考据审计**：12 处确证错误、两处转录缺口；两条自己数错的校勘注也一并改掉。
  被推翻的是那些替四个文明作保证的摘要句，四个租户的框架本身成立
- 功過格四处省略号补全，带回 11 个被吃掉的计分子句；不軌門据原刻版式拆为六条
  （過律 39 条至此完整）
- 迁移：四个 reverse 会删掉自己从未写入的行；两个 forward 长期不可运行；
  `perm/0017` 在已有事务内改用 SAVEPOINT，异常时只回滚自身
- `actors/0010` 退役 2026-05 迁移遗留的那批 Actor
- 7 个长期被当作「环境问题」的测试 ERROR，真凶是 `serialized_rollback`，不是环境
- 两个只有真跑 PostgreSQL 才会暴露的缺陷（SQLite 下不可见）
- 忘川（Lethe）移到炼狱山顶并补入 Eunoè；杜阿特的门属于亡者而非拉
- 设计系统：281 处组件字号归档、28 处写死字号、12 个不产生圆角的圆角类、
  最后七个 `min-h-screen`；门禁报错文案曾把人指去改错的文件
- a11y：35 组不达 AA 的 ink-on-surface 组合、抽屉与工作流列的键盘可达性、
  埃及徽标改掉多数系统画不出的象形字
- 图表：骨架屏没有高度导致每次加载跳版；三处颜色映射与图例对不上

### Removed
- 120 行无人引用的组件；孤立的 `CASE_TYPE_KEYS` 映射

### Tests
- 后端 **2,694 passed, 9 skipped, 0 failed**，覆盖率 **91.43%**（闸门 80）——2026-08-28 实跑，
  **无任何排除**。此前引用的 2,672 是排除了 `tests/test_websocket*.py` 的数字，而那个排除
  的理由（沙箱到 Redis 不可达）已于 2026-08-27 被实测证伪 —— 理由删了、排除没删
- 前端补上「整套跑了多少」的下限门禁；三个永远不会失败的守卫被改成会失败
- 钉住「正文列了价而 clauses 没有」——省略号能吃掉分值的原因

---

## [2026-08-13 – 2026-08-14] — 神话建模收口与质量门

### Added
- 十殿：每一殿获得独立的 realm，不再共用一个（`realms`）
- 玛特的四十二判官入座，埃及审判的判官阵容补全（`actors`）
- 分诊队列（triage queue，设计简报 §4.2）——待审判灵魂的排队与分派入口
- 六道轮回补全，并对 `rebirth_form` 做校验
- 枚举、标识符与缺失值的**统一显示约定**（设计简报 §4.6），配 `IDENTIFIER_POLICY`
  与审计行的登记豁免
- 神话种子改为幂等的 management command；三个文明的席位可重复执行而不重复写入

### Changed
- 种子入口收敛：退役 `populate_chinese_actors`，删除第二份重复的种子数据，
  埃及 bootstrap 不再硬编码
- 十殿归位，希腊阵容补入，北欧线退出（此前 `05_北欧死后世界.md` 只是研究稿）
- 租户 scoping 收敛到**单一 helper**，各处不再各写各的
- CI 两条 workflow 改为手动 dispatch，E2E 并行化

### Fixed
- **`GET /menus/buttons/` 对每个非 ADMIN 角色都 500**——过滤条件引用了 Menu 上
  并不存在的 tenant 字段，必然抛 `FieldError`（五个角色中四个受影响）
- `LETHE` 的存储值写错，realm 与枚举重新绑定（`disposition`）
- nanoid DoS 依赖告警修补，并让审计门禁真正生效
- 共享 data-grid 的徽章底色 tint 上限压到 10%，附契约测试（a11y 对比度）
- 页头与工作流列在 393px 视口下不再溢出
- `LedgerStatsOverview` 数组的可选链补完
- 强调色背景上的按钮链接 hover 时不再变透明

### Removed
- 已死的 disposition execute schema
- 一条过期的 E2E 竞态注释

### Tests
- 前端覆盖率 33% → 51%，门槛同步上调（棘轮）
- E2E 套件重建，使其**能够真正失败**（此前部分断言恒真）
- 四个形同虚设的质量门被改成会实际触发
- 六道与分诊队列的 i18n key 补齐三个语言包

---

## [2026-08-01 – 2026-08-08] — 设计交付期：设计系统、权限强制执行、M15 租户加固

### Added
- **共享 data-grid 组件库**抽取，页面表格统一收敛（此前为手写 table）
- **软删除与回收站**：级联 id 软删除、以归档替代删除、全局回收站页面
  （Stage 4 §4.7），菜单上先落地 delete/restore 模式
- 灵魂详情的**生命周期脊线**——原先分离的审判/处置/轮回三个盒子合并为一条主线
- SETTLED 状态的 ADMIN 专属**受审计更正**通道
- 文明专属"读数"渲染与文明表面色调（每套宇宙论用自己的读法，而非一个带 variant 的组件）
- 死亡后事件告警的 acknowledge / unacknowledge 端点，并记录操作人与时间
- 权限**矩阵**取代按角色逐个挑选的编辑器，替换操作加保护；菜单编辑器的五道可见性门
  变得可读
- 角色带上用户数与乐观锁版本号
- 侧边栏归入六个目录并加面包屑
- 语义调色板重新调校，新增 `accent-ink` 分叉

### Changed
- 权限体系分阶段**开始强制执行 codename**：先 ledger 与 souls，再 judgment /
  disposition / workflow，再 dispatch / reincarnation，最后退役 menus 里硬编码的
  ADMIN 判断；跨租户审判移交 JUDGE
- `karma` 更名为 `ledger`，相关 codename 一并迁移
- MODERATOR 成为领域主管角色，配受审计的应急通道
- API client 全量加类型——过程中查出 12 个运行时 bug
- 最后五张手写表迁移到 DataTable；souls / users / audit 表同步迁移
- `admin/stats` 折叠为 dashboard 的一个 karma tab

### Fixed
- **M15 多租户加固**：四个 CRITICAL Celery 任务做租户隔离；JWT 中与用户不再匹配的
  `tenant_code` 直接拒绝；服务层四处（A1/A2/A4/A5）与 API 层四处（C1/C4/C9/C10）
  租户 scoping 缺口关闭，随后又补上两处遗漏
- 权限层：授权真的授权、撤销真的撤销；按 codename（而非按角色）解析权限清单；
  窄 codename 被宽 action 绕过的三个洞；org 应用的跨租户洞；ADMIT 的 escalate
  授权补回（迁移 0015 本意如此）
- death-sync：有效 API key 终于能到达视图（C11）；`create_time`/`created_at`
  错配导致的 `WebhookViewSet` 故障；用 `DjangoJSONEncoder` 让校验过的日期能存下来
- 前端崩溃与错配一批：跨租户审判列表、组织树不嵌套、死亡同步注册路由与分页、
  用户编辑表单的姓名与租户字段不生效、轮换后的 refresh token 丢失（登出时加入黑名单）
- 工作流：节点审批 404、模板渲染、列表节点数、空模板遮蔽十殿、软删除行泄漏进列表
- dispatch：绕开 approve/reject/execute 的 PATCH 路由关闭；软删除记录泄漏
- 权限缓存不再对已死的 Redis 连接每次 cache miss 都重试
- 浅色模式下五个低于 AA 的状态色调暗；Toast 内联 CSS 的图标徽章 tint 同样压到 10%
- 灵魂：早于公元 1 年的日期可记录；记录级日期 ERROR 在列表页也标出；
  总分不再由四舍五入后的分项相加得出
- karma：衰减锚定到灵魂的死亡时间而非"今天"；结转只在端点计算处算一次
- i18n：`egy` 语言包改回埃及语；日期与状态枚举走当前 locale 渲染

### Removed
- 已死的社交原型代码与重复实现
- 无人渲染的图表组件
- 临时种子账号

---

## [2026-07-30 – 2026-07-31] — 前端稳定化与 i18n / a11y 补齐

### Added
- 95 个缺失的 i18n key，并加上回落到默认 locale 的机制

### Fixed
- `/dispatch`、`/cross-judgments`、`/welcome` 三个页面崩溃
- 分页响应未解包就当数组使用（含菜单按钮与侧边栏）
- 加载态表格行未包在 `tbody` 内
- 状态色与判决色改走语义 token
- 键盘焦点环恢复，纯图标控件补上可访问名称
- 默认 queryset 排除软删除记录（`core`）
- `org` 中无效的 tenant 字段引用

---

## [2026-06-06 – 2026-06-09] — M13 社交与 M14 覆盖率、租户修复

### Added
- **M13 社交功能**：`Post`、`Comment`、`Reaction`、`Follow`、`UserProfile`
  与可见性枚举，含权限、服务层与 API
- WebSocket 基建：鉴权、权限、路由与 ASGI 装配
- EventBus + HandlerRegistry + 通知 consumer + 实时推送
- 前端 WebSocket provider、SocialEventBus、响应式布局与 WS 客户端
- death-sync、dispatch 详情、disposition、tenants 页面与图表
- 英文 README 与语言切换

### Changed
- pytest 配置上移到项目根，支持根级执行
- 前端清理：移除未使用的组件、hooks、contexts，页面组件简化

### Fixed
- 租户隔离：`TenantCreateMixin` 修复与视图层隔离；移除基于 contextvar 的
  queryset 过滤（该路径被调查证伪，见 `docs/tenant-contextvar-investigation.md`）
- postcss XSS 依赖漏洞（npm overrides）
- 缺失的迁移补生成（events、menus、reincarnation、workflow）
- CI：pytest-asyncio 与 `asyncio_mode=auto`；测试发现；E2E 选择器
- 组织级联测试中的软删除断言

### Tests
- dispatch、karma、souls、workflow 的覆盖率测试
- WebSocket、实时总线与工作流事件测试

---

## [2026-05-30 – 2026-06-04] — M8–M12：RC 收口、搜索、死亡同步、WebSocket 架构

### Added
- **M10 搜索与过滤**：基础层，并接入 Actors/Realms、Karma、Workflow/Dispatch
- **M11 死亡同步 API**：基础层、死亡登记 API 与服务、带 HMAC 签名与重试的
  Webhook 系统（Celery）、可靠性层（限流、健康指标）
- **M9 工程质量**：依赖清理与 hook 测试
- 页面级 `error.tsx` 错误边界

### Changed
- DDD 重构分四层推进（Tier 1–4），含 `SoulViewSet` 逻辑抽取与领域 hooks
- `middleware.ts` 移到项目根以适配 Next.js 16
- `@sentry/nextjs` 升到 v10 以适配 Next.js 16

### Fixed
- RC 收口：5 项关键阻塞项，以及反向验证查出的 Critical / High / Medium 问题
- 数据库审计：索引、`CASCADE`→`PROTECT`、`select_related`、N+1
- `source_payload` 加密、原子限流、批量清理、重试内存
- M11 审计：确定性幂等、事务、admin 权限、SSRF
- 软删除一致性（`SoulRecord`、`LoginLog`、`UserNotification`）
- 未认证用户重定向到 `/login` 而非 `/welcome`
- 所有 mutation 补上 `onError`

### Tests
- pytest-cov 配置，覆盖率门槛与分支覆盖
- 审计测试成组补齐（User、Menu、Workflow、Tenant、Notification）
- 并发测试、性能回归测试、E2E 导航与工作流测试
- 组件测试（Modal、Skeleton、RequireButton、PageError、ErrorBoundary）

---

## [2026-05-09 – 2026-05-29] — 安全收口与工程基建

*本段即本文件此前的 `Unreleased` 内容，原样保留，只补上了工作区间。
它对应 `v0.1.0` tag（2026-05-29）之前的一轮工作。*

### Added
- GitHub Actions CI/CD pipeline (backend + frontend + migration check)
- Pre-commit hooks (ruff, prettier, eslint, trailing-whitespace)
- API documentation via DRF Spectacular (Swagger UI at `/api/docs/`)
- Frontend test framework: Jest + React Testing Library (126 tests)
- Semantic color tokens for theme-aware status/karma/verdict colors
- i18n: ~100 new translation keys across en.json and zh-Hans.json
- Data scope architecture design (Snowy analysis) documented for M7

### Fixed
- **CRITICAL**: Toast.tsx XSS vulnerability (innerHTML → textContent)
- **CRITICAL**: admin/stats page missing role guard
- **CRITICAL**: welcome page missing auth check
- **CRITICAL**: UserModal type assertion bypass (as any → proper typing)
- **CRITICAL**: SettingsDrawer CSS injection (hex color validation)
- **HIGH**: NotificationViewSet tenant isolation bypass
- **HIGH**: Password reset code length validation (6-digit enforced)
- **HIGH**: ALLOWED_HOSTS=['*'] → environment-based configuration
- **HIGH**: Registration rate limiting (5/hour via DRF throttle)
- **HIGH**: Empty tenant soul creation prevention
- **HIGH**: Cross-civilization workflow validation
- **HIGH**: SoulEvent `created_at` migration issue (stale column removed)
- Auth token reading: now checks both cookie and sessionStorage
- Events API 500 error (field name mismatch `created_at` → `create_time`)
- 15+ hardcoded Tailwind colors replaced with CSS variables
- 5 files with missing `hsl()` wrapper on CSS variables
- Toast SSR crash protection (document guard)
- localStorage try/catch in SettingsDrawer and AppLayout
- Variable shadowing in dashboard and workflow pages
- Dead component `progress-bar.tsx` removed
- 27+ hardcoded Chinese/English strings replaced with i18n keys

### Changed
- WorkflowEditor: 40+ hardcoded strings → i18n keys
- SoulEditModal: 15+ hardcoded strings → i18n keys
- All CIVILIZATION_LABELS/ROLE_LABELS/NODE_TYPE_LABELS → i18n
- KarmaChart colors: hardcoded hex → CSS variables
- Jest config: testEnvironment `node` → `jsdom`

## [0.1.0] - 2026-05-08

### Added
- Initial release
- Soul lifecycle management (ALIVE → JUDGING → DISPOSED → REINCARNATING)
- Multi-civilization support (Chinese Diyu, European Heaven-Hell, Egyptian Duat)
- Karma system with time-decay formula
- Judgment system with verdicts (PASSED/FAILED/PURGATORY/RETRY)
- Disposition and reincarnation workflows
- Cross-civilization soul dispatch
- Multi-stage approval workflow with ReactFlow visualization
- Role-based access control (RBAC) with menu permissions
- Tenant isolation (3 civilizations)
- Audit logging
- i18n support (zh-Hans, en, egy)
- Dark/light theme with CSS variables
