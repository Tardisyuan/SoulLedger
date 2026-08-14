# Permission Design — SoulLedger

> Detailed permission model for SoulLedger multi-tenant soul management system.
> This document provides comprehensive permission matrices and enforcement approaches.

---

## 1. Role Definitions

|| Role | Scope | Description | Examples |
|------|-------|-------------|----------|
| **TENANT_ADMIN** | Per-tenant | Full CRUD within tenant | 阎罗王 (CN), Satan (EU), Osiris (EG) |
| **JUDGE** | Per-tenant | Execute judgment, view souls | 判官, St. Peter, Anubis |
| **GUARDIAN** | Per-tenant | Add karma records, view souls | 牛头马面, Thanatos |
| **VIEWER** | Per-tenant | Read-only access | Auditors, Observers |
| **SYS_ADMIN** | Global | Read-only stats, no business intervention | System Administrator |
| **DISPATCH_JUDGE** | Per-tenant | Cross-tenant judgment participant | Can join foreign tenant's judgment sessions |

---

## 2. Permission Matrices

### 2.1 Page Visibility Matrix

Controls which menu items/navigation links are visible to each role.

|| Page | TENANT_ADMIN | JUDGE | GUARDIAN | VIEWER | SYS_ADMIN | DISPATCH_JUDGE |
|------|:------------:|:-----:|:--------:|:------:|:--------:|:--------------:|
| `/{tenant}/souls/` | ✓ | ✓ | ✓ | ✓ | ✓ (via /admin/) | ✓ |
| `/{tenant}/souls/[id]/` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `/{tenant}/dispatch/propose/` | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| `/{tenant}/dispatch/pending/` | ✓ | ✓ | ✗ | ✗ | ✗ | ✓ |
| `/{tenant}/cross-judgments/` | ✓ | ✓ | ✗ | ✗ | ✗ | ✓ |
| `/{tenant}/realms/` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `/{tenant}/actors/` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `/{tenant}/profile/` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `/admin/dashboard/` | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ |
| `/admin/dispatch/audit/` | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ |

### 2.2 Operation Permission Matrix

Controls which API operations are allowed for each role.

|| Operation | TENANT_ADMIN | JUDGE | GUARDIAN | VIEWER | DISPATCH_JUDGE |
|-----------|:------------:|:-----:|:--------:|:------:|:--------------:|
| `soul.create` | ✓ | ✓ | ✗ | ✗ | ✗ |
| `soul.die` | ✓ | ✓ | ✗ | ✗ | ✗ |
| `soul.transition` | ✓ | ✓ | ✗ | ✗ | ✗ |
| `soul.view` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `soul.add_record` | ✓ | ✓ | ✓ | ✗ | ✗ |
| `judgment.conclude` | ✓ | ✓ | ✗ | ✗ | ✗ |
| `disposition.execute` | ✓ | ✓ | ✗ | ✗ | ✗ |
| `dispatch.propose` | ✓ | ✓ | ✗ | ✗ | ✗ |
| `dispatch.approve` | ✓ | ✓ | ✗ | ✗ | ✗ |
| `cross_judgment.create` | ✓ | ✓ | ✗ | ✗ | ✗ |
| `cross_judgment.join` | ✓ | ✓ | ✗ | ✗ | ✓ |
| `cross_judgment.conclude` | ✓ | ✓ | ✗ | ✗ | ✗ |
| `realm.view` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `actor.view` | ✓ | ✓ | ✓ | ✓ | ✓ |

### 2.3 Field-Level Visibility Matrix

Controls which data fields are exposed in API responses based on role.

**Soul Model:**

| Field | TENANT_ADMIN | JUDGE | GUARDIAN | VIEWER |
|-------|:------------:|:-----:|:--------:|:------:|
| `id` | ✓ | ✓ | ✓ | ✓ |
| `name` | ✓ | ✓ | ✓ | ✓ |
| `birth_name` | ✓ | ✓ | ✓ | ✓ |
| `current_state` | ✓ | ✓ | ✓ | ✓ |
| `birth_date` | ✓ | ✓ | ✓ | ✓ |
| `death_date` | ✓ | ✓ | ✓ | ✓ |
| `origin_location` | ✓ | ✓ | ✓ | ✓ |
| `merit_score` | ✓ | ✓ | ✓ | ✗ |
| `demerit_score` | ✓ | ✓ | ✓ | ✗ |
| `karmic_balance` | ✓ | ✓ | ✗ | ✓ |
| `dispatch_status` | ✓ | ✓ | ✗ | ✗ |
| `tenant` | ✓ | ✓ | ✓ | ✓ |

**Judgment Model:**

| Field | TENANT_ADMIN | JUDGE | GUARDIAN | VIEWER |
|-------|:------------:|:-----:|:--------:|:------:|
| `id` | ✓ | ✓ | ✓ | ✓ |
| `soul` | ✓ | ✓ | ✓ | ✓ |
| `court` | ✓ | ✓ | ✓ | ✓ |
| `verdict` | ✓ | ✓ | ✗ | ✓ |
| `judgment_method` | ✓ | ✓ | ✓ | ✓ |
| `notes` | ✓ | ✓ | ✗ | ✗ |
| `is_final` | ✓ | ✓ | ✗ | ✓ |
| `concluded_at` | ✓ | ✓ | ✗ | ✓ |

---

## 3. Dispatch Permission Model

The dispatch module has special cross-tenant permission requirements.

### 3.1 Dispatch Operation Permissions

| Permission | Allowed Roles | Target Constraint |
|------------|--------------|------------------|
| `dispatch:propose` | TENANT_ADMIN, JUDGE | Source tenant only |
| `dispatch:approve` | TENANT_ADMIN, JUDGE | Target tenant only |
| `dispatch:reject` | TENANT_ADMIN, JUDGE | Target tenant only |
| `dispatch:cancel` | TENANT_ADMIN, JUDGE | Source tenant only |
| `cross_judgment:create` | TENANT_ADMIN, JUDGE | Source tenant only |
| `cross_judgment:participate` | DISPATCH_JUDGE | Any invited tenant |

### 3.2 Cross-Tenant Judgment Roles

| Role in Session | Description | Required Permission |
|-----------------|-------------|-------------------|
| CHAIRMAN | Session leader, can conclude judgment | JUDGE (source tenant) |
| CO_JUDGE | Full participant, can vote | DISPATCH_JUDGE |
| ADVISOR | Observer, can provide input | DISPATCH_JUDGE |

---

## 4. Backend Enforcement

### 4.1 DRF Permission Classes

```python
# backend/apps/tenants/permissions.py

class TenantPermission(BasePermission):
    """Ensures user can only access resources within their tenant."""
    
    def has_object_permission(self, request, view, obj):
        if request.user.role == 'SYS_ADMIN':
            return True  # SYS_ADMIN bypasses tenant check (read-only)
        
        tenant = getattr(obj, 'tenant', None)
        if tenant is None:
            return True  # Non-tenant objects are public
        
        return str(request.user.tenant_id) == str(tenant.id)


class CrossTenantPermission(BasePermission):
    """Allows cross-tenant access for DISPATCH_JUDGE role."""
    
    def has_permission(self, request, view):
        # Check if this is a cross-tenant request
        target_tenant = getattr(view, 'target_tenant', None)
        if target_tenant is None:
            return True
        
        user_tenant = request.user.tenant_id
        if str(target_tenant) == str(user_tenant):
            return True  # Same tenant, normal access
        
        # Cross-tenant request - check for DISPATCH_JUDGE or cross_tenant permission
        user = request.user
        if user.role == 'DISPATCH_JUDGE':
            return True
        if hasattr(user, 'permissions') and 'cross_tenant' in user.permissions:
            return True
        
        return False


class RolePermission(BasePermission):
    """Checks if user's role is in allowed roles for this action."""
    
    def has_permission(self, request, view):
        allowed_roles = view.permission_classes[1].allowed_roles if len(view.permission_classes) > 1 else []
        return request.user.role in allowed_roles
```

### 4.2 ViewSet Configuration

```python
class SoulViewSet(ModelViewSet):
    permission_classes = [IsAuthenticated, TenantPermission]
    serializer_class = SoulSerializer
    
    def get_serializer_class(self):
        user = self.request.user
        if user.role == 'VIEWER':
            return SoulViewerSerializer
        elif user.role == 'GUARDIAN':
            return SoulGuardianSerializer
        return SoulSerializer
```

### 4.3 Service Layer Validation

```python
# All sensitive operations validate at service layer
class JudgmentService:
    @staticmethod
    def conclude_judgment(judgment_id, user, verdict):
        # Verify user has JUDGE or TENANT_ADMIN role
        if user.role not in ['JUDGE', 'TENANT_ADMIN']:
            raise PermissionDenied("Only judges can conclude judgments")
        
        # Verify user is in same tenant as judgment
        judgment = Judgment.objects.get(id=judgment_id)
        if judgment.tenant_id != user.tenant_id:
            raise PermissionDenied("Cannot judge foreign tenant souls")
```

---

## 5. Frontend Enforcement

### 5.1 useAuth Hook

```typescript
// frontend/hooks/useAuth.ts

interface AuthContextType {
  user: User | null;
  role: Role | null;
  tenantCode: string | null;
  hasPermission: (operation: string) => boolean;
  canAccessPage: (path: string) => boolean;
}

const ROLE_PERMISSIONS: Record<Role, string[]> = {
  TENANT_ADMIN: ['soul.create', 'soul.die', 'soul.transition', 'soul.view', 
                  'soul.add_record', 'judgment.conclude', 'disposition.execute',
                  'dispatch.propose', 'dispatch.approve', 'realm.view', 'actor.view'],
  JUDGE: ['soul.create', 'soul.die', 'soul.transition', 'soul.view', 
          'soul.add_record', 'judgment.conclude', 'disposition.execute',
          'dispatch.propose', 'dispatch.approve', 'realm.view', 'actor.view'],
  GUARDIAN: ['soul.view', 'soul.add_record', 'realm.view', 'actor.view'],
  VIEWER: ['soul.view', 'realm.view', 'actor.view'],
  DISPATCH_JUDGE: ['soul.view', 'cross_judgment.join'],
  SYS_ADMIN: [], // Read-only, handled separately
};

const PAGE_ACCESS: Record<string, Role[]> = {
  '/{tenant}/souls/': ['TENANT_ADMIN', 'JUDGE', 'GUARDIAN', 'VIEWER', 'DISPATCH_JUDGE'],
  '/{tenant}/dispatch/propose/': ['TENANT_ADMIN', 'JUDGE'],
  '/{tenant}/dispatch/pending/': ['TENANT_ADMIN', 'JUDGE', 'DISPATCH_JUDGE'],
  '/{tenant}/cross-judgments/': ['TENANT_ADMIN', 'JUDGE', 'DISPATCH_JUDGE'],
  '/admin/dashboard/': ['SYS_ADMIN'],
};
```

### 5.2 Route Guard Component

```typescript
// frontend/components/RouteGuard.tsx

export function RouteGuard({ children, requiredPermission }) {
  const { hasPermission, isSysAdmin } = useAuth();
  const router = useRouter();
  
  useEffect(() => {
    if (isSysAdmin && !requiredPermission) return; // SYS_ADMIN can access most
    
    if (requiredPermission && !hasPermission(requiredPermission)) {
      router.push('/unauthorized');
    }
  }, [hasPermission, isSysAdmin, requiredPermission]);
  
  return children;
}
```

### 5.3 Menu Visibility

```typescript
// frontend/components/NavBar.tsx

const dispatchMenuItems = [
  { path: 'propose', label: '发起外派', permission: 'dispatch.propose' },
  { path: 'pending', label: '待处理', permission: 'dispatch.approve' },
  { path: 'history', label: '历史记录', permission: 'soul.view' },
];

// Filter menu items based on permissions
const visibleItems = dispatchMenuItems.filter(item => 
  hasPermission(item.permission)
);
```

---

## 6. SYS_ADMIN Read-Only Enforcement

SYS_ADMIN role has special handling to ensure read-only access at all levels:

|| Layer | Enforcement |
|-------|-------------|
| API | `SYS_ADMIN.role == 'SYS_ADMIN'` bypasses tenant filter but all write operations return 403 |
| Serializer | SYS_ADMIN sees all tenants' data but no sensitive fields (no karmic_balance for foreign tenants) |
| Service | All mutation methods check `user.role != 'SYS_ADMIN'` and raise `PermissionDenied` |
| Frontend | SYS_ADMIN menu shows only `/admin/*` pages, no business operation buttons |

---

## 7. Implementation Checklist

- [ ] Create `backend/apps/tenants/permissions.py` with TenantPermission and RolePermission
- [ ] Apply TenantPermission to all business ViewSets
- [ ] Create role-specific serializers (SoulViewerSerializer, SoulGuardianSerializer, etc.)
- [ ] Add permission checks in all service layer mutation methods
- [ ] Create `frontend/hooks/useAuth.ts` with hasPermission() function
- [ ] Create RouteGuard component for route protection
- [ ] Update NavBar to filter menu items by permission
- [ ] Write integration tests for all permission scenarios
