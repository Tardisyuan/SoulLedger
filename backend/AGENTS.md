# SoulLedger 多租户与权限管理系统优化记录

> 基于子 agent 链式学习（Snowy + Django 最佳实践）完成的所有优化

## 优化日期
2026-05-12

---

## P0 - 关键风险修复

### 1. Celery 租户上下文修复 (ContextVar)
**状态**: ✅ 完成

**问题**: 原使用 `threading.local` 存储租户上下文，Celery worker 使用不同线程导致租户丢失

**修改文件**:
- `apps/core/request_local.py` - 用 `contextvars.ContextVar` 替代 `threading.local`
- `apps/tenants/managers.py` - 同上
- `apps/core/middleware.py` - 更新注释

**实现**:
```python
import contextvars

_tenant_var: contextvars.ContextVar[Optional[Any]] = contextvars.ContextVar('tenant', default=None)
_user_var: contextvars.ContextVar[Optional[Any]] = contextvars.ContextVar('user', default=None)

def get_current_tenant():
    return _tenant_var.get()

def set_current_tenant(tenant):
    _tenant_var.set(tenant)
```

---

### 2. 跨租户权限模型 (CrossTenantPermission)
**状态**: ✅ 完成

**目的**: 支持三文明（中国/欧洲/埃及）之间的灵魂转移和审判授权

**创建文件**:
- `apps/permissions/models.py` - 新增 `CrossTenantPermission` 模型
- `apps/permissions/migrations/0001_initial.py` - 迁移文件
- `apps/permissions/apps.py` - App 配置

**模型设计**:
```python
class CrossTenantPermission(models.Model):
    source_tenant = models.ForeignKey('tenants.Tenant', related_name='cross_grants')
    target_tenant = models.ForeignKey('tenants.Tenant', related_name='cross_received')
    permission_type = models.CharField(max_length=30, choices=[
        ('JUDGMENT_TRANSFER', '审判移交'),
        ('SOUL_VIEW', '灵魂查阅'),
        ('SOUL_TRANSFER', '灵魂转移'),
        ('ACT_ACTOR', '代理审判'),
    ])
    soul_category = models.CharField(max_length=50, blank=True, default='')
    is_active = models.BooleanField(default=True)
```

---

## P1 - 权限精细化

### 3. 数据范围权限模型 (DataScope / RowLevelDataScope)
**状态**: ✅ 完成

**目的**: 支持行级访问控制，如 ACTOR 只能处理 PENDING 状态的灵魂

**修改文件**:
- `apps/perm/models.py` - 新增 `DataScope` 和 `RowLevelDataScope` 模型
- `apps/perm/migrations/0005_add_conditions_and_data_scope.py` - 迁移
- `apps/perm/migrations/0006_add_row_level_data_scope.py` - 迁移

**模型设计**:
```python
class RowLevelDataScope(models.Model):
    role = models.ForeignKey('perm.Role', on_delete=models.CASCADE)
    civilization = models.CharField(max_length=20)  # CHINA/EUROPE/EGYPT
    model_name = models.CharField(max_length=50)  # Soul, Judgment
    filter_conditions = models.JSONField(default=dict)
    scope_type = models.CharField(max_length=10)  # READ/WRITE/DELETE
    priority = models.IntegerField(default=0)
    is_active = models.BooleanField(default=True)
```

---

### 4. RolePermission 条件扩展
**状态**: ✅ 完成

**修改文件**: `apps/perm/models.py`

**新增字段**:
```python
class RolePermission(AuditUserFields):
    # ... 现有字段 ...
    conditions = models.JSONField(
        default=dict,
        blank=True,
        help_text='权限生效条件，如 {"current_state": ["PENDING", "APPEALING"]}'
    )
    data_scope = models.ForeignKey(
        'permissions.DataScope',
        on_delete=models.SET_NULL,
        null=True, blank=True
    )
```

---

## P2 - API 权限检查

### 5. API 权限装饰器
**状态**: ✅ 完成

**创建文件**:
- `apps/permissions/decorators.py`

**实现**:
```python
def require_api_permission(permission_code: str, require_all: bool = False):
    """API 权限检查装饰器"""
    def decorator(view_func):
        @wraps(view_func)
        def wrapper(view_instance, request, *args, **kwargs):
            # 检查认证和权限
            if not check_api_permission(request.user, permission_code):
                return Response({'detail': f'权限不足: {permission_code}'}, status=403)
            return view_func(view_instance, request, *args, **kwargs)
        return wrapper
    return decorator

def check_api_permission(user, permission_code: str) -> bool:
    """检查用户是否有特定 API 权限"""
    # 1. ADMIN 拥有所有权限
    # 2. 检查 RolePermission 表
    # 3. 检查 ROLE_PERMISSIONS 字典
    # 4. 检查跨租户权限
```

**使用示例**:
```python
class SoulViewSet(viewsets.ModelViewSet):
    @action(detail=True, methods=["post"])
    @require_api_permission('soul.update')
    def die(self, request, pk=None):
        """Mark soul as dead"""
        ...
```

---

## 后端研究改进建议 (来自 backend_researcher)

### 缺失功能
| 功能 | 优先级 | 建议 |
|------|--------|------|
| User CRUD API | P0 | 添加用户列表/详情/更新/删除 |
| Role FK 修复 | P0 | RolePermission.role 从 CharField 改为 ForeignKey |
| 密码管理 API | P1 | change-password, reset-password, forgot-password |
| Redis 权限缓存 | P1 | 替代内存缓存 |
| 角色层级继承 | P2 | Role.parent 实现继承 |
| 数据范围过滤 | P2 | 增强 TenantPermission |
| 完整审计日志 | P3 | 权限变更审计 |

---

## 前端研究改进建议 (来自 frontend_researcher)

### 当前问题
| 问题 | 优先级 | 建议 |
|------|--------|------|
| 无用户管理页面 | P0 | 创建 `/app/users/page.tsx` |
| 表单缺少 Zod 验证 | P0 | 所有表单添加 schema 验证 |
| Permissions 页面过大 | P1 | 拆分为小组件 |
| 缺少骨架屏 | P1 | 添加 skeleton loaders |
| 缺少批量操作 | P1 | 用户批量启用/禁用 |
| 无用户头像上传 | P3 | 头像上传功能 |

### 最佳实践建议
```typescript
// 1. 用户管理 hooks
export const userKeys = {
  list: (params?: UserFilters) => ['users', 'list', params] as const,
  detail: (id: string) => ['users', 'detail', id] as const,
};

// 2. Zod 表单验证
export const userSchema = z.object({
  username: z.string().min(3).max(50),
  email: z.string().email(),
  role: z.enum(["ADMIN", "JUDGE", "GUARDIAN", "VIEWER"]),
});

// 3. TanStack Query 优化
const mutation = useMutation({
  onMutate: async (newData) => { /* 乐观更新 */ },
  onError: (err, newData, context) => { /* 回滚 */ },
});
```

---

## 迁移应用

```bash
# 应用新迁移
python manage.py migrate permissions

# 验证安装
python -c "from apps.permissions.models import CrossTenantPermission, DataScope; print('OK')"
```

---

## 相关文档

- Snowy 项目分析: https://github.com/xiaonuobase/Snowy
- Django 多租户: django-tenants vs django-multitenant
- 权限系统参考: django-guardian, django-rules

---

## 待完成 (建议后续迭代)

- [ ] User CRUD API 实现
- [ ] 密码管理 API (修改/重置)
- [ ] Redis 权限缓存
- [ ] 角色层级继承
- [ ] 前端用户管理页面
- [ ] Zod 表单验证
- [ ] 骨架屏加载状态
