# Multi-Tenant Architecture Redesign

> ## 📦 ARCHIVED — 已归档，2026-08-14
>
> **写于 2026-05-08**（见 `.openspec.yaml` 的 `created`），最后修改也是 2026-05-08。
>
> ### 为什么归档
>
> **这份提案的绝大部分已经实现了，但 `tasks.md` 里 82 个任务框一个都没勾。**
> 勾选动作从建立之日起就没发生过——`openspec/changes/archive/` 与 `openspec/specs/`
> 在此之前都是空目录，说明这套 OpenSpec 流程从未真正被使用。一份「全未完成」的
> 清单摆在那里，会让人误以为这些工作还没做，而实际上它们早已上线并被反复加固过
> （M15 多租户安全加固就是在这套架构之上做的）。
>
> 因此：**归档，而不是删除。** 里面的接口设计、数据模型与权衡记录仍有价值，
> 但它不再是一个待办队列。真正剩下的工作见下方「尚未实现」。
>
> ### 现状核实（2026-08-14 抽样核对代码，非照抄清单）
>
> **28 个主题中 24 个已实现。** 关键证据：
>
> | 主题 | 状态 | 证据 |
> |---|---|---|
> | Tenant 模型 + 种子 | ✅ | `backend/apps/tenants/models.py`、`management/commands/seed_tenants.py`（CN_DIYU / EU_HEAVEN_HELL / EG_DUAT） |
> | 业务表 `tenant_id` | ✅ 超出范围 | realms/actors/souls/judgment/disposition/reincarnation/events/User **以及**提案未预见的 org、audit、workflow、social、death_sync、dispatch |
> | 租户中间件 | ✅ | `backend/apps/tenants/middleware.py`（从 JWT 解 `tenant_code`）；WebSocket 侧 `apps/core/ws_tenant.py` |
> | ViewSet 租户过滤 | ✅ | `apps/core/mixins.py`、`apps/core/viewsets.py`、`apps/core/tenant.py` |
> | Tenant API + 登录带租户 | ✅ | `apps/tenants/views.py`；`apps/authentication/serializers.py` 注入 `tenant_code` claim |
> | 数据迁移命令 | ✅ | `apps/tenants/management/commands/migrate_to_multitenant.py`（`--dry-run` 有，`--rollback` 没有） |
> | 租户隔离测试 | ✅ | `backend/tests/test_tenant_isolation.py`、`test_tenant_scoping_contract.py` |
> | DRF 权限类 | ✅ | `apps/core/permissions.py`（`TenantPermission` 交叉校验 JWT 与 DB 用户租户） |
> | Notification 模型 | ✅ | `apps/tenants/models.py`，外加提案未提及的实时 app `apps/notifications/` |
> | Dispatch 模块（M5 全 9 项） | ✅ | `apps/dispatch/{models,services,views}.py`；前端 `dispatch/`、`dispatch/propose/`、`cross-judgments/` |
> | Karma 后端（M6.1） | ✅ 换名 | 无 `apps/karma/`，是 `apps/ledger/` — 衰减、Redis 缓存、Celery 任务齐备 |
> | 统计与仪表盘 | ✅ | `apps/ledger/views.py` 的 `LedgerOverviewStatsView`；`frontend/app/dashboard/` |
> | 三文明数据（M7） | ✅ | `apps/actors/management/commands/seed_mythology.py`（幂等） |
> | 生产就绪（M8） | 🟡 大部分 | compose/nginx/health/sentry/限流/安全头齐备 |
>
> ### 有意为之的设计差异（**不是缺口，不要当待办**）
>
> - **`TenantManager` 不再隐式按 contextvar 过滤**——过滤全部移交 ViewSet mixin。
>   原因写在 `apps/tenants/managers.py` 的 docstring 与
>   [`docs/tenant-contextvar-investigation.md`](../../../docs/tenant-contextvar-investigation.md)：
>   contextvar 在 pytest 与类级 queryset 上会残留状态。
> - **`civilization` 没有被删干净，是故意的**——它从存储列变成了基于 tenant FK 的
>   派生 `@property`（`apps/souls/models.py`）。宇宙论相关逻辑（处置路由、衰减率）
>   仍然按 civilization 分支。提案的验收标准「grep 无匹配」被有意放弃。
> - **四个静态角色被完整的 codename RBAC 取代**——实际角色是
>   `ADMIN/MODERATOR/JUDGE/GUARDIAN/VIEWER`，见 `backend/apps/perm/`。
> - **没有 `/{tenant}/` URL 前缀**——采用「一个用户属于一个租户」，租户由服务端从
>   JWT claim 解析，URL 不携带租户。因此 M4.1c 的动态路由、M4.2a 的三卡片选租户
>   落地页、M4.1e 的 `/{tenant}/souls/` 登录跳转都**不适用**，而不是没做。
> - `X-Tenant-Code` 实际叫 `X-Tenant-ID`；`useAuth`/`RouteGuard` 实际是
>   `usePermissions`/`RequirePermission`；dispatch 的 pending 与 history 合并为一页。
>
> ### 尚未实现（真实剩余项）
>
> - `SoulSerializer` 未继承 `FieldPermissionMixin`——字段级权限的机制、模型与
>   Soul 的种子规则都在，唯独最主要的那个 serializer 没接上（`apps/souls/serializers.py`）
> - `migrate_to_multitenant --rollback`
> - 提案指名的索引与约束（`idx_soul_tenant_karma`、`ck_dispatch_diff_tenants` 等）
>   不存在；功能等价物部分存在，但命名与列都不同
> - 应用外壳里没有任何地方渲染租户 `display_name`
> - 后端 `Dockerfile` 仍是单阶段（前端是三阶段）；无 `frontend/app/api/health/route.ts`；
>   无 `frontend/.env.example`
> - 欧洲 realm 实际 11 个，提案要求 17 个（3 天堂 + 7 炼狱 + 9 地狱，实际塌缩成 1+1+9）
>
> ---
>
> *以下为 2026-05-08 原文，未作改动。*

## Why

当前系统是单系统 + `civilization` 字段区分三大文明。存在两个问题：
1. **权限隔离不足**：欧洲的判官理论上能看到中国地府的记录（只是查询层过滤）
2. **业务边界不清晰**：三个文明的审判逻辑、处置路由、地域数据混在同一套表中

多租户（Multi-Tenant）架构更适合地府的业务本质：三个地府是完全独立的运营单位，只在极少数场景下需要协同（如跨文明灵魂迁移）。

## What

**新增 `Tenant` 模型，每个文明（Chinese Diyu / European Heaven-Hell / Egyptian Duat）为独立租户。**

- 所有业务表（Soul/Realm/Actor/Judgment 等）加 `tenant_id` 字段
- 每个租户用户（User）绑定租户，只能操作自己租户的数据
- ADMIN 角色可跨租户操作和查看全局统计
- 租户之间完全数据隔离

## Scope

**包含：**
- Tenant 模型与数据迁移
- 所有现有表加 `tenant_id` 外键
- Django 中间件自动注入 tenant context
- API queryset 自动按 tenant 过滤
- User 与 Tenant 的关联
- 前端租户上下文感知导航
- Admin site 按租户过滤

**不包含：**
- 跨文明灵魂迁移功能（未来 Milestone 单独处理）
- 租户级别的配额/计费（不适用）

## Outcome

- 三个文明的官员登录后只看自己租户的数据
- 数据物理隔离，一个租户的 bug 不会泄漏到另一个
- ADMIN 可访问全局统计大屏
- 迁移过程零数据丢失

## Risks

1. **迁移复杂度**：所有表加 `tenant_id`，Django migration 需要 careful planning
2. **API 兼容性**：所有现有 API 需要加 tenant 过滤逻辑，可能影响现有前端调用
3. **测试覆盖**：需要新增租户隔离的集成测试
