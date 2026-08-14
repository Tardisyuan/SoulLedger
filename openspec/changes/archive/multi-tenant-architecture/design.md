# Multi-Tenant Architecture Design

## 1. 核心设计决策

### 1.1 多租户策略

**选择：Shared Database + tenant_id column**

| 方案 | 优点 | 缺点 | 适用场景 |
|------|------|------|---------|
| Shared DB + tenant_id | 运维简单，迁移容易，跨租户查询方便 | 隔离性弱（应用层保证） | 中小规模，多租户逻辑清晰 |
| Separate Schema per tenant | 隔离性强，备份恢复独立 | 迁移复杂，跨租户查询麻烦 | 大规模，需要物理隔离 |
| Separate Database | 完全隔离 | 运维成本高，跨租户几乎不可能 | 超大规模 or 合规要求极高 |

地府系统：三个租户，规模可控，但灵魂历史可能跨租户，所以 Shared DB + tenant_id 最合适。

### 1.2 租户识别方式

**方式：User → Tenant 直接关联**

```
User.tenant_id FK → Tenant.id
User.actor_id FK → Actor.id (Actor.tenant_id → Tenant.id)
```

用户登录后，Django middleware 从 request.user.tenant 读取当前租户，注入到所有 query context。

---

## 2. 数据模型变更

### 2.1 新增 Tenant 模型

```python
class Tenant(models.Model):
    """多租户：每个文明一个租户"""
    code = models.CharField(max_length=30, unique=True)  # CN_DIYU / EU_HEAVEN_HELL / EG_DUAT
    display_name = models.CharField(max_length=100)       # 中国地府 / European Heaven-Hell / Egyptian Duat
    description = models.TextField(blank=True)
    settings = models.JSONField(default=dict)            # 租户级配置（审判规则开关等）
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "tenants_tenant"
        ordering = ["code"]
```

### 2.2 各模型变更

所有租户相关模型加 `tenant = models.ForeignKey(Tenant, on_delete=CASCADE)`:

| 模型 | 表名 | 变更 |
|------|------|------|
| Soul | souls_soul | +tenant_id FK |
| SoulRecord | souls_soulrecord | +tenant_id FK（通过 Soul 级联） |
| Realm | realms_realm | +tenant_id FK |
| Actor | actors_actor | +tenant_id FK |
| Judgment | judgment_judgment | +tenant_id FK（通过 Soul 级联） |
| Disposition | disposition_disposition | +tenant_id FK（通过 Soul 级联） |
| Reincarnation | reincarnation_reincarnation | +tenant_id FK（通过 Soul 级联） |
| SoulEvent | events_solevents | +tenant_id FK（通过 Soul 级联） |

**User 模型变更：**
```python
class User(AbstractUser):
    tenant = models.ForeignKey("tenants.Tenant", on_delete=PROTECT, null=True)
    actor = models.ForeignKey("actors.Actor", on_delete=SET_NULL, null=True)
    role = models.CharField(choices=UserRole.choices, default=UserRole.VIEWER)
```

### 2.3 迁移策略

**Phase 1：** 创建 tenants_tenant 表，插入三条租户记录
**Phase 2：** 所有业务表加 tenant_id 列（NOT NULL DEFAULT 'CN_DIYU'）
**Phase 3：** 为现有数据中 `civilization=EUROPEAN` 的记录更新 tenant_id 为 'EU_HEAVEN_HELL'
**Phase 4：** 为现有数据中 `civilization=EGYPTIAN` 的记录更新 tenant_id 为 'EG_DUAT'
**Phase 5：** User 表加 tenant_id（从关联的 actor 反推，或默认为 CN_DIYU）
**Phase 6：** 删除 Soul.civilization 字段（不再需要，tenant_id 就是文明标识）

---

## 3. 后端架构

### 3.1 Django 中间件：TenantMiddleware

```python
class TenantMiddleware:
    def __init__(__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        # 从 JWT token 或 session 读取 tenant_id
        if hasattr(request, 'user') and request.user.is_authenticated:
            request.tenant = getattr(request.user, 'tenant', None)
        else:
            request.tenant = None
        return self.get_response(request)
```

### 3.2 QuerySet 自动过滤：TenantManager

```python
class TenantManager(models.Manager):
    def get_queryset(self):
        # 从 thread-local 获取当前 tenant
        tenant = getattr(thread_local, 'tenant', None)
        if tenant is not None:
            return super().get_queryset().filter(tenant=tenant)
        return super().get_queryset()
```

所有业务模型使用 TenantManager，API 查询自动按 tenant 过滤。

### 3.3 Admin 权限

- ADMIN 角色：可看所有租户数据，admin 页面可切换租户视图
- JUDGE/GUARDIAN/VIEWER：只能操作自己 tenant 的数据（middleware + manager 保证）

---

## 4. API 设计

### 4.1 认证与租户

```
POST /api/v1/auth/login/
  → { access, refresh, user: { id, username, role, tenant: { code, display_name } } }
```

登录返回用户所属租户信息，前端据此决定导航。

### 4.2 租户管理（仅 ADMIN）

| 方法 | 端点 | 描述 |
|------|------|------|
| GET | /api/v1/tenants/ | 租户列表 |
| GET | /api/v1/tenants/{code}/ | 租户详情 |
| PATCH | /api/v1/tenants/{code}/ | 更新租户配置 |

### 4.3 业务 API（租户自动过滤）

所有 `/souls/` `/realms/` `/actors/` `/judgment/` `/disposition/` `/reincarnation/` 端点：

- 非 ADMIN 用户：自动过滤 `?tenant=<current_tenant>`
- ADMIN 用户：可传 `?tenant=EU_HEAVEN_HELL` 查看特定租户，不传则返回所有

### 4.4 跨租户查询（仅 ADMIN）

| 方法 | 端点 | 描述 |
|------|------|------|
| GET | /api/v1/stats/global/ | 全局统计（所有租户汇总） |
| GET | /api/v1/stats/by-tenant/ | 按租户统计 |
| GET | /api/v1/souls/{id}/history/ | 跨租户灵魂历史（如果灵魂有跨租户记录） |

---

## 5. 前端架构

### 5.1 路由结构

```
/                       # 首页（选择租户入口）
/login                  # 登录页

# 租户内页面（登录后自动加载对应租户视图）
/<tenant>/souls/       # 灵魂列表（自动过滤到当前租户）
/<tenant>/souls/[id]/ # 灵魂详情
/<tenant>/realms/      # 地域列表
/<tenant>/actors/      # 角色列表

# 全局页面（仅 ADMIN）
/admin/dashboard/      # 全局统计大屏
/admin/tenants/        # 租户管理
```

URL 结构改为 `/<tenant>/` 前缀，每个租户有独立子路径。

### 5.2 导航逻辑

```
登录成功 → 解析 token 中的 tenant.code
  → 如果 role=ADMIN → 跳转 /admin/dashboard/
  → 如果 role≠ADMIN → 跳转 /{tenant_code}/souls/
```

NavBar 显示：当前租户名称 + 角色 + 退出

### 5.3 语言 × 租户 × 页面

每个租户的页面内容（地域名、角色名、审判庭名称）使用对应的 locale 文件。

---

## 6. 目录结构变更

```
backend/apps/
  ├── tenants/              # [NEW] 租户管理
  │   ├── models.py         # Tenant
  │   ├── views.py
  │   ├── serializers.py
  │   └── middleware.py     # TenantMiddleware
  ├── souls/
  │   ├── models.py         # Soul（移除 civilization 字段）
  │   ├── managers.py       # TenantManager
  │   └── views.py
  ├── realms/
  │   ├── models.py         # Realm +tenant FK（移除 civilization 字段）
  │   └── views.py
  ├── actors/
  │   ├── models.py         # Actor +tenant FK（移除 civilization 字段）
  │   └── views.py
  ...（其他 app 同理）
```

---

## 7. 种子数据重置

迁移完成后，重新 seed 三个租户的数据：

```
CN_DIYU (tenant_id=CN_DIYU):
  - 17 realms: 十八层地狱 + 十殿阎王 + 第一层天界
  - 31 actors: 阎罗王、判官、牛头马面等

EU_HEAVEN_HELL (tenant_id=EU_HEAVEN_HELL):
  - 17 realms: Heaven + Purgatory 7层 + Hell 9层
  - actors: St. Peter, Hades, Satan, Michael 等

EG_DUAT (tenant_id=EG_DUAT):
  - realms: Aaru, Duat regions
  - actors: Osiris, Anubis, Thoth, Ma'at
```
