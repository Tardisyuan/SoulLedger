# Snowy vs SoulLedger — Permission & Data Management Comparison

> Date: 2026-05-27
> Source: https://github.com/xiaonuobase/Snowy

## 1. Snowy Architecture Overview

### Tech Stack
| Layer | Snowy | SoulLedger |
|-------|-------|------------|
| Frontend | Vue 3 + Ant Design Vue 3 + Vite + Pinia | Next.js 16 + TailwindCSS + TanStack Query |
| Backend | Spring Boot 3 + MyBatis-Plus + SaToken | Django 5.2 + DRF + django-multitenant |
| Auth | SaToken (token-based, 15+ auth modes) | JWT + session (SimpleJWT) |
| Crypto | SM2/SM3/SM4 (national cryptography) | Standard bcrypt/hashing |
| DB | MySQL/PostgreSQL | MySQL |

### Plugin Architecture
Snowy uses a **plugin-based modular system** (`snowy-plugin-sys`) with 9 sub-modules:

| Module | Purpose |
|--------|---------|
| `snowy-plugin-sys-group` | Group management |
| `snowy-plugin-sys-index` | Dashboard/index |
| `snowy-plugin-sys-org` | Organization management |
| `snowy-plugin-sys-position` | Position/title management |
| `snowy-plugin-sys-relation` | Entity relationships |
| `snowy-plugin-sys-resource` | Resource/menu/permission management |
| `snowy-plugin-sys-role` | Role management |
| `snowy-plugin-sys-sys` | System configuration |
| `snowy-plugin-sys-user` | User management |

Each module follows a standard layered architecture: `controller → service → mapper → entity → param/enums`.

## 2. Permission Management Comparison

### Snowy: Three-Layer Permission Model

Snowy implements a **three-dimensional permission model**:

1. **Menu Permissions** (菜单权限) — What pages/APIs a user can access
2. **Data Scope** (数据范围) — What data rows a user can see
3. **Element Permissions** (元素权限) — What UI elements (buttons, fields) are visible

```
User → Role → [Menu Permission + Data Scope + Element Permission]
```

#### Menu Permission Chain
```
snowy-plugin-sys-resource/
├── controller/SysMenuController.java    # CRUD for menus
├── entity/SysMenu.java                  # Menu model (type: catalogue/menu/button)
├── service/SysMenuService.java          # Business logic
├── param/SysMenuParam.java              # Request DTOs
└── enums/MenuTypeEnum.java              # CATALOGUE | MENU | BUTTON
```

Menu types:
- **CATALOGUE** — Top-level folder (sidebar group)
- **MENU** — Actual page/route
- **BUTTON** — Action permission (e.g., "Delete", "Export")

#### Data Scope (Data Allocation)
```
snowy-plugin-sys-role/
├── controller/SysRoleController.java
├── entity/SysRole.java                  # Role model with dataScopeType
├── service/SysRoleService.java          # Assigns data scope
└── enums/DataScopeTypeEnum.java         # ALL | THIS_DEPT | THIS_DEPT_AND_CHILD | CUSTOM | SELF
```

Data scope types:
- **ALL** — See all data across org
- **THIS_DEPT** — Only own department
- **THIS_DEPT_AND_CHILD** — Own department + children
- **CUSTOM** — Manually selected departments
- **SELF** — Only own data

### SoulLedger: Tenant-Scoped RBAC

SoulLedger implements a **two-dimensional model**:

1. **Menu Permissions** — What pages/APIs a user can access (via `MenuPermission` + `RoleMenuPermission`)
2. **Tenant Isolation** — All data auto-filtered by `TenantManager`

```
User → Role → [Menu Permission]
All data auto-filtered by tenant FK (TenantManager)
```

### Comparison Matrix

| Feature | Snowy | SoulLedger |
|---------|-------|------------|
| Menu permissions | Yes (3-level: catalogue/menu/button) | Yes (2-level: menu/button via `type` field) |
| Data scope/row-level | Yes (5 types: all/dept/child/custom/self) | Partial (tenant-level only via TenantManager) |
| Element permissions | Yes (button-level visibility) | Yes (RequirePermission component) |
| Role hierarchy | Yes (parent-child roles) | Yes (parent_role with cycle detection) |
| Permission caching | Redis + local | Redis + memory fallback (300s TTL) |
| Multi-tenancy | Organization-based | Tenant-based (3 civilizations) |
| API-level permission | SaToken annotations | DRF permission classes + middleware |

## 3. Page/Menu Management Comparison

### Snowy: Full CRUD with Drag-Drop Tree

Snowy's menu management is **tree-structured** with:
- Hierarchical tree view with drag-drop reordering
- Menu type selection (catalogue/menu/button)
- Icon picker integration
- Route path + component path mapping
- Permission code assignment per menu
- Sort order management
- Enable/disable toggle

### SoulLedger: Flat Menu with Role Toggles

SoulLedger's menu management (`/menus` page):
- Flat list (not tree-structured)
- CRUD operations with modal form
- Role-based permission toggles (assign menu to roles)
- Icon picker (lucide-react)
- Sort order + active/inactive toggle
- Full i18n support (zh-Hans, en, egy)

### Gaps in SoulLedger

| Feature | Snowy | SoulLedger | Gap |
|---------|-------|------------|-----|
| Tree structure | Hierarchical tree | Flat list | Missing parent-child menu relationships |
| Drag-drop reorder | Yes | No | Manual sort_order input |
| Route mapping | route_path + component_path | url + permission_code | Similar, both adequate |
| Menu types | catalogue/menu/button | directory/menu/button | Equivalent |
| Batch operations | Yes | No | Could add bulk role assignment |

## 4. Data Allocation / Data Scope Comparison

### Snowy: Fine-Grained Data Scope

Snowy's data scope system allows per-role configuration of which rows of data a user can see:

```
Role → DataScopeType → [Department Filter]
```

The backend applies data scope filters automatically:
```java
// Snowy applies data scope as a SQL filter
@DataScope(deptAlias = "d", userAlias = "u")
public List<SysUser> list(SysUserParam param) {
    // Query automatically filtered by user's data scope
}
```

### SoulLedger: Tenant-Only Isolation

SoulLedger uses `TenantManager` which auto-filters all querysets:

```python
# SoulLedger's approach — all data filtered by tenant
class TenantManager(models.Manager):
    def get_queryset(self):
        request = get_current_request()
        tenant = getattr(request, 'tenant', None)
        if tenant:
            return super().get_queryset().filter(tenant=tenant)
        return super().get_queryset()
```

This provides **civilization-level isolation** (Chinese/European/Egyptian souls separated) but no finer-grained control.

### Key Gap: No Data Scope in SoulLedger

SoulLedger lacks the ability to restrict data visibility within a tenant. For example:
- A "Judge" role in Chinese Diyu currently sees ALL Chinese souls
- With data scope, they could be restricted to only souls assigned to their court (e.g., First Hall only)
- An "Overseer" could see all data in their department + children

## 5. Upgrade Recommendations for SoulLedger

### Priority 1: Add Data Scope Support (High Impact)

**What**: Implement Snowy-style data scope filtering on top of TenantManager.

**Design**:
```python
# New model
class DataScope(models.TextChoices):
    ALL = "ALL", "All data"
    REALM = "REALM", "Own realm only"
    REALM_AND_CHILD = "REALM_AND_CHILD", "Own realm + children"
    COURT = "COURT", "Own court only"
    CUSTOM = "CUSTOM", "Custom selection"
    SELF = "SELF", "Own records only"

# Add to Role model
class Role(models.Model):
    # ... existing fields ...
    data_scope = models.CharField(
        max_length=20,
        choices=DataScope.choices,
        default=DataScope.ALL,
    )
    custom_realms = models.ManyToManyField(
        'realms.Realm',
        blank=True,
        help_text="For CUSTOM scope: which realms this role can see"
    )
```

**Backend filter**:
```python
class DataScopeFilter:
    """Apply data scope filtering to querysets."""
    
    @staticmethod
    def apply(queryset, user, scope_field='realm'):
        if not user.is_authenticated:
            return queryset.none()
        
        data_scope = getattr(user.role, 'data_scope', 'ALL')
        
        if data_scope == 'ALL':
            return queryset
        elif data_scope == 'REALM':
            return queryset.filter(**{scope_field: user.realm})
        elif data_scope == 'COURT':
            return queryset.filter(court=user.court)
        elif data_scope == 'SELF':
            return queryset.filter(assignee=user)
        # ... etc
```

**Frontend**: Add data scope selector in role edit form.

### Priority 2: Tree-Structured Menu Management (Medium Impact)

**What**: Convert flat menu list to hierarchical tree.

**Changes**:
- Add `parent` FK to `Menu` model (self-referential)
- Add `level` field (0=top, 1=child, 2=button)
- Frontend: Use existing `@xyflow/react` tree visualization or a tree component
- Add drag-drop reordering via `sort_order` updates

### Priority 3: Element-Level Permissions (Medium Impact)

**What**: Fine-grained control over which buttons/fields are visible per role.

**Current state**: SoulLedger already has `RequirePermission` component and button-level permissions in the menu system. The gap is **declarative field-level hiding**.

**Design**:
```tsx
// New component for field-level permission gating
<RequireField permission="souls.edit.karma_score">
  <KarmaScoreInput value={soul.merit_score} />
</RequireField>
```

### Priority 4: Audit Trail for Permission Changes (Low Impact)

**What**: Log when roles/permissions are modified.

**Current state**: SoulLedger has `AuditLog` model but doesn't track permission changes specifically.

**Design**: Add `permission_change` action type to audit logging, capturing before/after state of role-permission assignments.

### Priority 5: Permission Import/Export (Low Impact)

**What**: Export role-permission configurations as JSON for backup/migration.

**Benefit**: Useful for setting up new tenants with pre-configured permission sets.

## 6. What SoulLedger Does Better Than Snowy

| Feature | SoulLedger | Snowy |
|---------|------------|-------|
| Multi-civilization support | Native (CN/EU/EG) with civilization-specific workflows | Single-org focus |
| Soul state machine | Full lifecycle (ALIVE→JUDGING→DISPOSED→REINCARNATING) | N/A |
| Karma system | Time-decay formula with Redis caching | N/A |
| Cross-civilization dispatch | Cross-tenant soul transfer with approval | N/A |
| i18n | 3 locales with custom context | Standard i18n |
| Workflow engine | Multi-stage approval with ReactFlow visualization | Simpler workflow |

## 7. Summary

| Area | Snowy Advantage | SoulLedger Advantage | Recommended Action |
|------|----------------|---------------------|-------------------|
| Data scope | 5-level data filtering | Tenant isolation | **Add data scope to Role model** |
| Menu structure | Tree with drag-drop | Flat with role toggles | Add parent FK + tree UI |
| Permission model | 3D (menu + data + element) | 2D (menu + element) | Add data scope dimension |
| Crypto | SM2/SM3/SM4 national standard | Standard bcrypt | Low priority, optional |
| Plugin architecture | Modular plugins | Monolithic apps | Not needed at current scale |
| Role hierarchy | Parent-child with scope | Parent-child with cycle detection | Equivalent |
