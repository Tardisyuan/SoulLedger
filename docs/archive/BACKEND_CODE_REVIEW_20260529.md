# 后端代码验证报告

> ### 后续 — 2026-08-28
>
> 抽查了「七、待处理问题汇总」里的三条，均已修复：P0 `DispatchProposeSerializer` 现在同时接受
> `source_tenant`/`source_tenant_code`（`apps/dispatch/serializers.py:117`）；P1
> `AuditLogViewSet.permission_codename` 已是 `"audit"`；P1 重复路由只剩
> `config/urls.py:43` 一条。其余各条**未逐条复核**，没有注记不等于已修。
>
> 另：文中的 `apps/karma/*` 路径已不存在，该 app 在 2026-08 更名 `ledger`。

**日期**: 2026-05-29
**验证范围**: 后端代码审查 (Django + DRF)
**验证模块**: Model定义、权限系统、信号、URL路由、Serializer一致性、Service层、API对称性、Schema文档

---

## 一、检查结果汇总

| 检查项 | 状态 | 发现问题数 |
|--------|------|------------|
| Model 定义和字段一致性 | ✅ 通过 | 0 |
| 权限系统和权限标注 | ⚠️ 有问题 | 1个中等问题 |
| 信号和副作用 | ⚠️ 有问题 | 2个问题 |
| URL 路由配置 | ⚠️ 有问题 | 1个重复注册 |
| Serializer 和 ViewSet 一致性 | ✅ 通过 | 2个轻微问题 |
| Service 层业务逻辑 | ⚠️ 有问题 | 6个服务缺少事务 |
| 前后端 API 对称性 | ⚠️ 有问题 | 2个问题 |
| API 文档和 Schema | ✅ 可接受 | 0 (未使用装饰器) |

---

## 二、P0 阻断问题 (需立即修复)

### 1. dispatch/propose tenant_id 类型不匹配 (前后端API对称性)

**问题**: 前端发送 `tenant_code` 字符串，后端期望整数 `tenant_id`

```python
# backend/apps/dispatch/serializers.py
class DispatchProposeSerializer(serializers.Serializer):
    source_tenant = serializers.IntegerField()  # 期望整数
    target_tenant = serializers.IntegerField()   # 期望整数
```

```typescript
// frontend/app/dispatch/propose/page.tsx
await dispatchApi.propose({
  source_tenant: user.tenant.code as unknown as number,  // "EGYPT" 字符串
  target_tenant: form.target_tenant_code as unknown as number, // "CHINA" 字符串
  soul: parseInt(form.soul_id),
  reason: form.reason,
});
```

**影响**: dispatch/propose 功能完全不可用

**解决方案** (二选一):
1. 修改后端 `DispatchProposeSerializer` 接受 `tenant_code` 字符串
2. 修改前端 `karmaApi.statsOverview()` 返回 tenants 时包含 `tenant_id`

---

## 三、P1 高优先级问题

### 2. AuditLogViewSet permission_codename 错误 (权限系统)

**问题**: `AuditLogViewSet` 使用 `permission_codename = "audit_log"`，但实际定义的权限是 `"audit"`

```python
# backend/apps/audit/views.py
class AuditLogViewSet(CodenameViewSetMixin, ModelViewSet):
    permission_codename = "audit_log"  # 错误
```

```python
# backend/apps/perm/models.py - DEFAULT_PERMISSIONS
("audit.read", "查看审计日志", "audit"),  # 实际定义的是 "audit"
```

**影响**: 非 ADMIN 用户即使有 `audit.read` 权限也会被拒绝，因为中间件查找 `audit_log.read` 而非 `audit.read`

**解决方案**: 将 `AuditLogViewSet.permission_codename` 改为 `"audit"`

---

### 3. 重复 URL 路由注册 (URL 配置)

**问题**: `apps.audit.urls` 被注册两次

```python
# backend/config/urls.py
path("api/v1/audit-logs/", include("apps.audit.urls")),  # 第34行
path("api/v1/audit/", include("apps.audit.urls")),        # 第35行 - 重复
```

**影响**: 两个 URL 前缀都指向同一 ViewSet，可能导致 reverse URL 查找混乱

**解决方案**: 删除第35行，保留 `audit-logs/`

---

### 4. 多个 Service 缺少事务处理 (Service 层)

**问题**: 以下服务的多个 DB 写操作未使用 `@transaction.atomic()`

| Service | 问题 |
|---------|------|
| `disposition/services.py` | `create_from_judgment()` 多次 DB 写入无事务 |
| `events/services.py` | `EventService` 未显式设置 tenant context |
| `karma/services.py` | `recalculate_soul_karma()` 缓存和 DB 写操作非原子 |
| `judgment/services.py` | `conclude_judgment()` 跨上下文操作无事务 |
| `reincarnation/services.py` | `complete_rebirth()` 多次写入非原子 |
| `dispatch/services.py` | `DispatchService.propose()` 缺少事务包装 |

**影响**: 部分失败会导致数据不一致

**解决方案**: 为涉及多次 DB 写入的方法添加 `@transaction.atomic()` 装饰器

---

## 四、P2 中等问题

### 5. AuditLog 创建缺少 transaction.on_commit (信号)

**问题**: `apps/audit/signals.py` 中 `_create_audit_log()` 在信号处理器内同步创建 AuditLog

```python
# 如果信号在事务内触发，事务回滚时 AuditLog 会残留
AuditLog.objects.create(...)  # 应包装在 transaction.on_commit()
```

**影响**: 审计日志可能与实际业务操作不一致

**解决方案**: 使用 `transaction.on_commit(lambda: AuditLog.objects.create(...))`

---

### 6. 全局 _in_migration 标志非线程安全 (信号)

**问题**: `apps/audit/signals.py` 使用全局布尔标志 `_in_migration`，在并行测试场景下可能不一致

**影响**: 低 - 迁移通常顺序运行

**解决方案**: 使用 `threading.local()` 或其他线程安全机制

---

### 7. auditApi.create() 死代码 (前后端API对称性)

**问题**: 前端定义了 `auditApi.create()` 但后端 `AuditLogViewSet` 是 `ReadOnlyModelViewSet`

```typescript
// frontend/lib/api.ts
create: (data: object) => api.post("/audit/create/", data),
```

```python
# backend/apps/audit/views.py
class AuditLogViewSet(ReadOnlyModelViewSet):  # 无 create() 方法
```

**影响**: 调用会返回 405 Method Not Allowed

**解决方案**: 删除前端死代码或确认是否需要实现后端 `create()` (审计日志通常由信号创建)

---

## 五、P3 轻微问题

### 8. WorkflowTemplateSerializer nodes 处理冗余

**问题**: `workflow/serializers.py` 中 `WorkflowTemplateSerializer` 有冗余的 `to_internal_value`/`create`/`update` 方法

**影响**: 无运行时错误，代码可简化

---

### 9. MenuCreateUpdateSerializer children/buttons 字段

**问题**: `menus/serializers.py` 中声明了 `children` 和 `buttons` 但无 `get_children`/`get_buttons` 方法

**影响**: 创建/更新菜单时这些字段被忽略 (可能是预期行为)

---

## 六、检查通过项

| 模块 | 状态 |
|------|------|
| Model 定义和字段一致性 | ✅ 所有16个app的Model与Serializer字段一致 |
| DataScopeFilter 实现 | ✅ 正确实现，ADMIN bypass，无认证返回空 |
| TenantPermission 中间件顺序 | ✅ 正确：`PermissionMiddleware` 在 `TenantMiddleware` 之后执行 |
| URL basename 注册 | ✅ 所有 ViewSet 的 basename 正确 |
| Serializer/ViewSet 一致性 | ✅ 字段与操作匹配 |
| API 文档基础设施 | ✅ drf-spectacular + Swagger UI 已配置 |

---

## 七、待处理问题汇总

| 优先级 | 问题 | 状态 |
|--------|------|------|
| P0 | dispatch/propose tenant_id 类型不匹配 | **待修复** |
| P1 | AuditLogViewSet permission_codename 错误 | **待修复** |
| P1 | 重复 URL 路由 (audit-logs/ + audit/) | **待修复** |
| P1 | 6个 Service 缺少事务处理 | **待修复** |
| P2 | AuditLog 创建缺少 transaction.on_commit | 建议修复 |
| P2 | 全局 _in_migration 非线程安全 | 低优先级 |
| P2 | auditApi.create() 死代码 | 建议清理 |
| P3 | WorkflowTemplateSerializer 冗余代码 | 可简化 |
| P3 | MenuCreateUpdateSerializer 字段声明 | 无影响 |

---

## 八、相关文档

- 前端验证报告: `docs/FRONTEND_CODE_REVIEW_20260528.md`
- 权限系统审核: `docs/AUDIT_REPORT_20260528.md`
- 安全审计报告: `docs/project_security_audit_20260527.md`
