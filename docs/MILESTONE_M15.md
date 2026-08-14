# M15 — Multi-Tenant Security Hardening

**目标**: 审计并加固跨服务层、后台任务、异步执行路径的租户隔离，确保无跨租户数据访问
**前置条件**: M14 全部完成 + TenantManager contextvar 修复 (已完成)
**总工作量**: 5-7 天
**状态**: ✅ 已修复 (2026-08-07)

> **修复记录**：本文档下方的审计发现与验收标准写于 2026-06-09，两个月后动手修之前先重新
> 核实了一遍——不是所有发现都还成立，也不是所有"未修复"都代表真实缺口。结果：
> **CRITICAL 4/4、HIGH 4/4、MEDIUM 15/15** 中，16 条确认是真实缺口且已修复，
> 3 条确认是有意为之的设计（Menu/`perm` 端点全局共享不分租户、dispatch 的
> `_base_manager` 跨租户查重是防重复调度的既定选择），其余在两个月的其他改动中顺带修好。
> 具体提交：Celery 四个 CRITICAL 任务改为按租户分发子任务并对齐审计归属
> (`dc5dbbe`)、`TenantMiddleware`/`TenantPermission` 加入 JWT 租户与用户真实租户的
> 交叉校验 (`44d12f7`)、服务层四处创建记录补上 `tenant`
> (`e3c7c9f`)、API 层四处补上租户过滤或纠正权限类 (`368f0e6`)。
>
> 过程中额外发现两个不在本审计范围内的问题，未在此修复，已各自开了独立任务：
> social 序列化器的 `post`/`comment` 字段可跨租户提交（写入侧漏洞，权限类之外的一层）；
> `death_sync` 的 API Key 认证端点因默认权限类是 `IsAuthenticated` 而非按 API Key
> 认证放行，导致所有合法外部请求都被拒绝（功能性故障，不是数据泄露，但外部死亡登记
> 集成目前经真实 HTTP 完全不可用）。
>
> 下方审计发现与验收标准表格保留原样（历史记录），不再逐项勾选更新。

---

## 业务目标

SoulLedger 采用多租户架构（中国地府 / 欧洲天堂地狱 / 埃及冥界），每个租户的数据必须严格隔离。当前系统在 ViewSet 层通过 `DataScopeViewSetMixin` 提供了良好的租户隔离，但在**服务层、Celery 后台任务、异步执行路径**中存在多个租户隔离缺口，可能导致：

- 跨租户数据泄露（读取其他租户的灵魂、审判、业力数据）
- 跨租户数据污染（修改其他租户的记录）
- 审计日志丢失租户关联（Celery 任务产生的操作无法追溯到租户）

本里程碑旨在全面审计并修复这些安全缺口。

---

## 当前状态分析

### 架构概述

```
┌─────────────────────────────────────────────────────────┐
│  HTTP Request                                           │
│  TenantMiddleware → set request.tenant from JWT         │
│  ↓                                                      │
│  ViewSet Layer                                          │
│  DataScopeViewSetMixin → filter by tenant               │
│  TenantPermission → reject if no tenant                 │
│  ↓                                                      │
│  Service Layer                                          │
│  ⚠️  NO automatic tenant filtering                      │
│  ⚠️  Must explicitly filter by tenant                    │
│  ↓                                                      │
│  ORM / Database                                         │
│  TenantManager → NO implicit filtering (by design)      │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  Celery Worker                                          │
│  ❌ TenantMiddleware does NOT run                        │
│  ❌ get_current_tenant() returns None                    │
│  ❌ NO task_prerun signal handler                        │
│  ❌ All queries are unfiltered by default                │
└─────────────────────────────────────────────────────────┘
```

### 已有的租户隔离机制

| 机制 | 位置 | 作用 |
|------|------|------|
| `DataScopeViewSetMixin` | `apps/core/viewsets.py` | ViewSet 层自动过滤 queryset |
| `TenantPermission` | `apps/core/permissions.py` | 拒绝无租户的请求 |
| `TenantCreateMixin` | `apps/core/mixins.py` | 创建时自动设置 tenant |
| `TenantMiddleware` | `apps/tenants/middleware.py` | JWT 中提取 tenant_code |
| `TenantManager` | `apps/tenants/managers.py` | 无隐式过滤（设计如此） |

### 已知的隔离缺口（审计发现）

**3 个审计已完成**：
1. ✅ 服务层审计（9 个服务文件）
2. ✅ Celery/后台任务审计（6 个任务 + 配置）
3. ✅ API ViewSet 审计（20 个 ViewSet + 90+ 端点）

---

## 审计发现汇总

### CRITICAL（4 个）

| # | 发现 | 位置 | 描述 |
|---|------|------|------|
| C1 | `karma.recalculate_all` 无租户过滤 | `apps/karma/tasks.py` | 每日定时任务遍历所有灵魂，处理跨租户数据 |
| C2 | `judgment.auto_conclude_stale` 无租户过滤 | `apps/judgment/tasks.py` | 每周任务修改所有租户的过期审判 |
| C3 | `death_sync.retry_failed_webhooks` 无租户过滤 | `apps/death_sync/tasks.py` | 遍历所有租户的重试 webhook |
| C4 | `death_sync.cleanup_old_requests` 无租户过滤 | `apps/death_sync/tasks.py` | DELETE 操作删除所有租户的旧请求 |

### HIGH（4 个）

| # | 发现 | 位置 | 描述 |
|---|------|------|------|
| H1 | `UserProfileViewSet` 无租户过滤 | `apps/social/views.py` | 任何用户可查看/修改所有租户的用户资料 |
| H2 | `PostViewSet.perform_create` 未设置 tenant | `apps/social/views.py` | 创建的帖子无租户关联 |
| H3 | `karma.recalculate_single` 无租户验证 | `apps/karma/tasks.py` | 可传入其他租户的 soul_id |
| H4 | `MenuViewSet` 无租户过滤 | `apps/menus/views.py` | 所有菜单对所有用户可见（需确认是否设计如此） |

### MEDIUM（15 个）

| # | 发现 | 位置 | 描述 |
|---|------|------|------|
| M1 | `DispatchRecordViewSet.get_queryset` 绕过 DataScope | `apps/dispatch/views.py` | 返回 `_base_manager.all()` 不过滤租户 |
| M2 | `UserCreateSerializer` 允许跨租户创建用户 | `apps/authentication/serializers.py` | ADMIN 可在其他租户创建用户 |
| M3 | JWT refresh 不包含 tenant_code | `apps/authentication/views.py` | 刷新 token 后丢失租户信息 |
| M4 | `TenantMiddleware` 不验证用户-租户绑定 | `apps/tenants/middleware.py` | 信任 JWT 中的 tenant_code 无二次验证 |
| M5 | `perm` 端点缺少 TenantPermission | `apps/perm/views.py` | 权限管理端点无租户上下文 |
| M6 | `ExternalApiKeyViewSet` 使用错误权限类 | `apps/death_sync/views.py` | 使用 `IsAdminUser` 而非 `IsAdminPermission` |
| M7 | `DeathSyncHealthView` 无租户过滤 | `apps/death_sync/views.py` | 健康指标查询所有租户数据 |
| M8 | `OrgViewSet.tree` 租户为空时返回全部 | `apps/org/views.py` | 回退到 `Organization.objects.all()` |
| M9 | `Disposition.objects.create` 未设置 tenant | `apps/disposition/services.py` | 创建的处置记录无租户关联 |
| M10 | `WorkflowTemplate` 查询无租户过滤 | `apps/workflow/services.py` | 可跨租户查找工作流模板 |
| M11 | `Reincarnation.objects.create` 未设置 tenant | `apps/reincarnation/services.py` | 创建的轮回记录无租户关联 |
| M12 | `PostService` 计数器更新无租户验证 | `apps/social/services.py` | `filter(pk=post_id).update()` 不检查租户 |
| M13 | Celery 审计日志丢失租户关联 | `apps/audit/signals.py` | Celery 任务中 `get_current_tenant()` 返回 None |
| M14 | `Soul.save()` 在 Celery 中无法设置 tenant | `apps/souls/models.py` | 无 request 上下文时 tenant 自动设置失败 |
| M15 | `DispatchRecord._base_manager` 跨租户查询 | `apps/dispatch/services.py` | 显式绕过 manager 进行跨租户查询 |

---

## 用户故事

### Epic 1: Celery 租户隔离基础设施

**作为**系统架构师，**我需要**一个 Celery 任务租户上下文机制，**以便**所有后台任务都能正确设置租户上下文。

| Story | 描述 | 优先级 |
|-------|------|--------|
| US-1.1 | 实现 `task_prerun` 信号处理器，从任务参数中提取 tenant 并调用 `set_current_tenant()` | P1 |
| US-1.2 | 实现 `task_postrun` 信号处理器，清理租户上下文 | P1 |
| US-1.3 | 为需要跨租户迭代的任务实现 per-tenant 分发模式 | P1 |
| US-1.4 | 验证审计信号在 Celery 上下文中正确记录租户 | P2 |

### Epic 2: 跨租户任务修复

**作为**安全工程师，**我需要**所有 Celery 任务都正确过滤租户数据，**以便**后台处理不会跨租户泄露或污染数据。

| Story | 描述 | 优先级 |
|-------|------|--------|
| US-2.1 | 修复 `karma.recalculate_all` — 改为 per-tenant 分发 | P1 |
| US-2.2 | 修复 `karma.recalculate_single` — 添加 tenant 参数和验证 | P1 |
| US-2.3 | 修复 `judgment.auto_conclude_stale` — 改为 per-tenant 分发 | P1 |
| US-2.4 | 修复 `death_sync.retry_failed_webhooks` — 改为 per-tenant 分发 | P1 |
| US-2.5 | 修复 `death_sync.cleanup_old_requests` — 添加 tenant 过滤 | P1 |
| US-2.6 | 修复 `death_sync.deliver_webhook` — 添加 tenant 验证 | P2 |

### Epic 3: 服务层租户过滤

**作为**安全工程师，**我需要**所有服务层查询都包含租户过滤，**以便**服务层不会绕过 ViewSet 的租户隔离。

| Story | 描述 | 优先级 |
|-------|------|--------|
| US-3.1 | 修复 `DispositionService.create_from_judgment` — 传递 `tenant=soul.tenant` | P1 |
| US-3.2 | 修复 `WorkflowService.find_template` — 添加 `tenant=judgment.tenant` | P1 |
| US-3.3 | 修复 `ReincarnationService.create` — 传递 `tenant=soul.tenant` | P1 |
| US-3.4 | 修复 `PostService` 计数器更新 — 添加租户验证 | P1 |
| US-3.5 | 修复 `DispatchService` `_base_manager` 用法 — 添加租户参数或文档化 | P2 |

### Epic 4: API 层安全加固

**作为**安全工程师，**我需要**所有 API 端点都正确隔离租户数据，**以便**用户无法通过 API 访问其他租户的数据。

| Story | 描述 | 优先级 |
|-------|------|--------|
| US-4.1 | 修复 `UserProfileViewSet` — 添加租户过滤 | P1 |
| US-4.2 | 修复 `PostViewSet.perform_create` — 设置 `tenant=request.tenant` | P1 |
| US-4.3 | 修复 `DispatchRecordViewSet.get_queryset` — 应用租户过滤 | P1 |
| US-4.4 | 修复 `UserCreateSerializer` — 强制 `tenant=request.tenant` | P2 |
| US-4.5 | 实现自定义 `TokenRefreshView` — 刷新 token 时包含 tenant_code | P2 |
| US-4.6 | 修复 `ExternalApiKeyViewSet` — 替换 `IsAdminUser` 为 `IsAdminPermission` | P2 |
| US-4.7 | 修复 `DeathSyncHealthView` — 添加租户过滤 | P2 |
| US-4.8 | 修复 `OrgViewSet.tree` — 租户为空时返回空集 | P2 |
| US-4.9 | 为 `MenuViewSet` 添加文档或租户过滤 | P2 |

### Epic 5: 认证安全加固

**作为**安全工程师，**我需要**认证流程验证用户-租户绑定，**以便**用户无法通过篡改 JWT 访问其他租户。

| Story | 描述 | 优先级 |
|-------|------|--------|
| US-5.1 | `TenantMiddleware` 添加用户-租户绑定验证 | P2 |
| US-5.2 | `perm` 端点添加 TenantPermission 或文档化 | P2 |

### Epic 6: 审计与文档

**作为**安全审计员，**我需要**完整的审计报告和修复验证，**以便**确认所有租户隔离缺口已修复。

| Story | 描述 | 优先级 |
|-------|------|--------|
| US-6.1 | 创建服务层审计报告 | P1 |
| US-6.2 | 创建 Celery 隔离审计报告 | P1 |
| US-6.3 | 创建风险评估报告 | P1 |
| US-6.4 | 编写修复验证测试（跨租户访问测试） | P1 |
| US-6.5 | 更新 MILESTONES.md | P2 |

---

## 详细审计发现

### A. 服务层审计

#### A1. `apps/disposition/services.py`

| 行号 | 查询 | 租户过滤 | 风险 |
|------|------|----------|------|
| 68 | `Realm.objects.filter(realm_code=...)` | N/A（全局资源） | LOW |
| 71-77 | `Disposition.objects.create(...)` | ❌ 未传递 tenant | **MEDIUM** |

**问题**: `Disposition` 模型有 `tenant` FK（nullable），但 `create_from_judgment` 未传递 `tenant` 参数。创建的记录 `tenant=NULL`，下游租户过滤查询会丢失此记录。

**修复**: `Disposition.objects.create(..., tenant=soul.tenant)`

#### A2. `apps/workflow/services.py`

| 行号 | 查询 | 租户过滤 | 风险 |
|------|------|----------|------|
| 167-171 | `WorkflowTemplate.objects.filter(civilization=..., case_type=...)` | ❌ 仅按文明/案件类型过滤 | **MEDIUM** |
| 195-204 | `ApprovalWorkflow.objects.create(..., tenant=judgment.tenant)` | ✅ | LOW |
| 242-252 | `ApprovalWorkflow.objects.create(..., tenant=judgment.tenant)` | ✅ | LOW |

**问题**: `find_template` 查询 `WorkflowTemplate` 时仅按 `civilization` 和 `case_type` 过滤，不检查 `tenant`。可跨租户查找模板。

**修复**: 添加 `tenant=judgment.tenant` 到过滤条件。

#### A3. `apps/dispatch/services.py`

| 行号 | 查询 | 租户过滤 | 风险 |
|------|------|----------|------|
| 46-49 | `DispatchRecord._base_manager.filter(soul=soul, ...)` | ❌ 显式绕过 manager | **HIGH** |
| 54-62 | `DispatchRecord.objects.create(..., tenant=source_tenant)` | ✅ | LOW |

**问题**: 使用 `_base_manager` 绕过自定义 manager，查询所有租户的 DispatchRecord。可能用于防止重复调度，但无访问控制。

**修复**: 添加租户参数或文档化跨租户查询意图。

#### A4. `apps/reincarnation/services.py`

| 行号 | 查询 | 租户过滤 | 风险 |
|------|------|----------|------|
| 64-73 | `Reincarnation.objects.create(...)` | ❌ 未传递 tenant | **MEDIUM** |

**问题**: `Reincarnation` 模型有 `tenant` FK（nullable），但 `create` 未传递 `tenant`。

**修复**: `Reincarnation.objects.create(..., tenant=soul.tenant)`

#### A5. `apps/social/services.py`

| 行号 | 查询 | 租户过滤 | 风险 |
|------|------|----------|------|
| 17, 22, 29, 34 | `Post.objects.filter(pk=post_id).update(...)` | ❌ 仅按 PK 过滤 | **MEDIUM** |
| 93, 127 | `Reaction.objects.filter(user=user, post=post)` | ❌ 无租户过滤 | LOW |

**问题**: Post 计数器更新仅按 PK 过滤，不验证租户所有权。可跨租户修改帖子计数。

**修复**: 添加租户验证或使用 `tenant=post.tenant` 过滤。

#### A6. `apps/death_sync/services.py` — ✅ 无问题
#### A7. `apps/karma/services.py` — ✅ 无问题（通过 FK 隐式隔离）
#### A8. `apps/events/services.py` — ✅ 无问题（无直接 ORM 查询）
#### A9. `apps/judgment/services.py` — ✅ 无问题（委托给其他服务）

---

### B. Celery 后台任务审计

#### B1. 任务总览

| 任务 | 文件 | 定时 | 租户参数 | set_current_tenant | 跨租户 | 风险 |
|------|------|------|----------|-------------------|--------|------|
| `karma.recalculate_all` | karma/tasks.py | 每日 00:00 | ❌ | ❌ | YES | **CRITICAL** |
| `karma.recalculate_single` | karma/tasks.py | 按需 | soul_id only | ❌ | No | **HIGH** |
| `judgment.auto_conclude_stale` | judgment/tasks.py | 每周 | days_threshold only | ❌ | YES | **CRITICAL** |
| `death_sync.deliver_webhook` | death_sync/tasks.py | 按需 | delivery_log_id only | ❌ | No | MEDIUM |
| `death_sync.retry_failed_webhooks` | death_sync/tasks.py | 按需 | ❌ | ❌ | YES | **CRITICAL** |
| `death_sync.cleanup_old_requests` | death_sync/tasks.py | 每周 | days, batch_size | ❌ | YES | **CRITICAL** |

#### B2. 系统性问题

**问题 1: 无 Celery 任务租户上下文机制**
- `config/celery.py` 中无 `task_prerun` 信号处理器
- 无自定义 Celery `Task` 基类
- `TenantMiddleware` 仅在 HTTP 请求中运行
- Celery worker 中 `get_current_tenant()` 始终返回 `None`

**问题 2: TenantManager 不自动过滤**
- `TenantManager.get_queryset()` 返回 `super().get_queryset()` 无过滤
- Celery 任务中所有查询默认无租户过滤

**问题 3: 审计日志丢失租户关联**
- `apps/audit/signals.py` 调用 `get_current_tenant()` 记录租户
- Celery 任务中返回 `None`，审计日志无法追溯到租户

#### B3. 详细任务分析

**`karma.recalculate_all` (CRITICAL)**
```python
@shared_task(name="karma.recalculate_all")
def recalculate_all_karma():
    for soul in Soul.objects.iterator(chunk_size=500):  # ❌ 无租户过滤
        KarmaService.recalculate_soul_karma(soul)
```
- 每日执行，遍历所有租户的所有灵魂
- 单次失败可能影响其他租户数据
- 审计日志无租户关联

**修复**: 改为 coordinator 模式，按租户分发子任务。

**`judgment.auto_conclude_stale` (CRITICAL)**
```python
@shared_task(name="judgment.auto_conclude_stale")
def auto_conclude_stale_judgments(days_threshold=30):
    stale = Judgment.objects.filter(  # ❌ 无租户过滤
        is_final=False, verdict__isnull=True,
        created_at__lt=threshold
    )
    for judgment in stale:
        judgment.notes = f"Auto-closed after {days_threshold}..."
        judgment.save(update_fields=["notes"])
```
- 每周执行，修改所有租户的过期审判
- `.select_related("soul", "tenant")` 表明代码知道 tenant 存在但不过滤

**修复**: 改为 coordinator 模式，按租户分发子任务。

**`death_sync.cleanup_old_requests` (CRITICAL)**
```python
@shared_task(name="death_sync.cleanup_old_requests")
def cleanup_old_requests(days=90, batch_size=1000):
    cutoff = now() - timedelta(days=days)
    old = DeathRegistrationRequest.objects.filter(  # ❌ 无租户过滤
        request_timestamp__lt=cutoff
    )
    # ... DELETE 操作
```
- 破坏性操作（DELETE），无租户边界

**修复**: 添加 `tenant` 参数或按租户分发。

---

### C. API ViewSet 审计

#### C1. 高风险发现

**`UserProfileViewSet` (HIGH)**
- `get_queryset()` 无租户过滤
- 任何用户可查看/修改所有租户的用户资料
- **修复**: 添加 `qs.filter(user__tenant=tenant)`

**`PostViewSet.perform_create` (HIGH)**
- `serializer.save(author=self.request.user)` 未设置 `tenant`
- 创建的帖子 `tenant=NULL`
- **修复**: `serializer.save(author=self.request.user, tenant=getattr(self.request, 'tenant', None))`

**`MenuViewSet` (HIGH — 需确认)**
- 所有菜单对所有用户可见
- 可能是设计如此（菜单为全局资源）
- **修复**: 确认设计意图，添加文档或租户过滤

#### C2. 中风险发现

**`DispatchRecordViewSet.get_queryset` (MEDIUM)**
- 返回 `_base_manager.all()` 不调用 `DataScopeViewSetMixin.get_queryset()`
- 绕过租户 + DataScope 过滤
- **修复**: 应用 `Q(source_tenant=tenant) | Q(target_tenant=tenant)` 过滤

**`UserCreateSerializer` (MEDIUM)**
- `tenant` 为可写字段
- ADMIN 可在其他租户创建用户
- **修复**: `perform_create` 中强制 `tenant=request.tenant`

**JWT Refresh (MEDIUM)**
- 刷新 token 后新 access token 不含 `tenant_code`
- 导致租户隔离失效
- **修复**: 实现自定义 `TokenRefreshView`

**`TenantMiddleware` (MEDIUM)**
- 不验证 `request.user.tenant == resolved_tenant`
- 信任 JWT 中的 tenant_code
- **修复**: 添加二次验证

---

## 范围

### 包含

- [x] 服务层租户隔离审计
- [x] Celery 后台任务租户隔离审计
- [x] API ViewSet 租户隔离审计
- [ ] Celery 任务租户上下文基础设施
- [ ] 所有 CRITICAL/HIGH 风险修复
- [ ] 所有 MEDIUM 风险修复
- [ ] 跨租户访问测试
- [ ] 审计报告和文档

### 不包含

- 前端变更（M14 范围）
- 新功能开发
- 性能优化
- 数据库 schema 变更（除非修复 nullable tenant FK）

---

## 依赖

| 依赖 | 状态 | 说明 |
|------|------|------|
| M14 完成 | ⏳ 待开始 | 前端租户切换功能 |
| TenantManager contextvar 修复 | ✅ 已完成 | `fb32356` |
| DataScopeViewSetMixin | ✅ 已存在 | ViewSet 层隔离 |
| TenantPermission | ✅ 已存在 | 权限检查 |
| Celery + django-celery-beat | ✅ 已配置 | 后台任务基础设施 |

---

## 风险评估

| 风险 | 可能性 | 影响 | 缓解措施 |
|------|--------|------|----------|
| Celery 修复引入回归 | 中 | 高 | 充分测试 + 逐步发布 |
| 服务层修复影响现有 API | 低 | 中 | 向后兼容 + 版本控制 |
| 审计修复遗漏发现 | 低 | 高 | 多轮审计 + 自动化测试 |
| 修复引入性能问题 | 低 | 中 | 基准测试 + 监控 |

---

## 验收标准

### 功能验收

- [ ] 所有 Celery 任务接受 `tenant_code` 参数或按租户分发
- [ ] 所有服务层查询包含租户过滤
- [ ] 所有 API 端点通过 `DataScopeViewSetMixin` 或手动过滤隔离租户
- [ ] JWT 刷新后 `tenant_code` 保留
- [ ] 审计日志在 Celery 任务中正确记录租户
- [ ] 跨租户访问测试全部通过

### 安全验收

- [ ] 无 CRITICAL 级别发现
- [ ] 无 HIGH 级别发现
- [ ] MEDIUM 级别发现已修复或有文档化缓解措施
- [ ] 跨租户 API 访问测试覆盖所有端点

### 质量验收

- [ ] ruff check 通过
- [ ] 现有测试全部通过
- [ ] 新增测试覆盖修复场景
- [ ] 审计报告完成

---

## 工作量估算

| Epic | 工作量 | 优先级 |
|------|--------|--------|
| Epic 1: Celery 租户隔离基础设施 | 1.5-2 天 | P1 |
| Epic 2: 跨租户任务修复 | 1-1.5 天 | P1 |
| Epic 3: 服务层租户过滤 | 0.5-1 天 | P1 |
| Epic 4: API 层安全加固 | 1-1.5 天 | P1-P2 |
| Epic 5: 认证安全加固 | 0.5 天 | P2 |
| Epic 6: 审计与文档 | 0.5-1 天 | P1-P2 |
| **总计** | **5-7 天** | |

---

## 优先级顺序

```
Phase 1 (Day 1-3): Celery 基础设施 + CRITICAL 修复
├── task_prerun/postrun 信号处理器
├── karma.recalculate_all per-tenant 分发
├── judgment.auto_conclude_stale per-tenant 分发
├── death_sync.cleanup_old_requests 租户过滤
└── death_sync.retry_failed_webhooks per-tenant 分发

Phase 2 (Day 4-5): 服务层 + HIGH 修复
├── DispositionService tenant 传递
├── WorkflowService tenant 过滤
├── ReincarnationService tenant 传递
├── PostService 计数器租户验证
├── UserProfileViewSet 租户过滤
├── PostViewSet.perform_create tenant 设置
└── DispatchRecordViewSet.get_queryset 修复

Phase 3 (Day 6-7): API 加固 + 文档
├── UserCreateSerializer 租户强制
├── TokenRefreshView tenant_code
├── ExternalApiKeyViewSet 权限类修复
├── DeathSyncHealthView 租户过滤
├── OrgViewSet.tree 空值处理
├── TenantMiddleware 用户-租户验证
├── 审计报告
└── 跨租户访问测试
```

---

## 文件索引

- [docs/MILESTONES.md](./MILESTONES.md) — 里程碑总览
- [docs/tenant-contextvar-investigation.md](./tenant-contextvar-investigation.md) — contextvar 调查报告
- [docs/tenant-manager-safety-validation.md](./tenant-manager-safety-validation.md) — TenantManager 安全验证
- [docs/task-292-security-validation.md](./task-292-security-validation.md) — 安全验证报告

---

*创建日期: 2026-06-09*
*审计完成: 2026-06-09*
