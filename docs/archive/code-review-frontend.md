# SoulLedger Frontend Code Review

> ### Follow-up — 2026-08-28
>
> A 2026-05-27 snapshot. Two things to know before reading it:
>
> - The `CIVILIZATION_LABELS` tables below list **three** civilizations. There are **four** —
>   GREEK was added on 2026-08-18 (`48a5e74`).
> - **Finding #1 is still open.** `frontend/app/layout.tsx:29` still hardcodes
>   `<html lang="zh-Hans" className={`dark …`}>`.
>
> The other findings were not re-verified for this note. Do not read a missing note as "fixed".

> Date: 2026-05-27
> Scope: All frontend pages, components, hooks, contexts

## Critical Issues

### 1. Root Layout Hardcoded Language & Theme
**File**: `frontend/app/layout.tsx`
**Severity**: CRITICAL

```tsx
<html lang="zh-Hans" className="dark">
```

Language is hardcoded to Chinese instead of using i18n context. Theme is hardcoded to `dark` with no toggle support.

**Fix**: Use `useI18n()` for lang, implement theme context for className.

### 2. `bg-surface-1` / `border-hairline` Without `hsl()` Wrapper
**Severity**: HIGH (broken styling)

Multiple files use Tailwind class names that match CSS variable names but lack the `hsl(var(...))` wrapper. These silently produce invalid CSS colors.

| File | Line(s) | Classes |
|------|---------|---------|
| `app/users/page.tsx` | 66, 134, 194 | `bg-canvas`, `text-ink-muted`, `bg-surface-2`, `border-hairline`, `text-ink` |
| `app/permissions/page.tsx` | 398, 457, 505 | `bg-surface-1`, `border-hairline` |
| `app/test/page.tsx` | 36 | `bg-surface-1`, `border-hairline` |
| `src/components/permissions/PermissionFormModal.tsx` | various | `bg-surface-1`, `border-hairline` |
| `src/components/permissions/RoleFormModal.tsx` | various | `bg-surface-1`, `border-hairline` |

**Fix**: Either add Tailwind plugins mapping CSS variables to utility classes, or use `hsl(var(--color-surface-1))` consistently.

## High-Severity Issues

### 3. Hardcoded Chinese Strings (Zero i18n)

| File | Strings |
|------|---------|
| `src/components/souls/SoulEditModal.tsx` | All labels, validation messages, placeholders (~20 strings) |
| `src/components/workflow/WorkflowEditor.tsx` | All labels, buttons, status text (~50+ strings, 624 lines) |
| `src/components/rbac/PermissionDenied.tsx` | "权限不足", "需要权限:", "请联系管理员" |
| `src/components/ui/IconPicker.tsx` | "选择图标", "搜索图标..." |
| `src/components/TestModal.tsx` | "测试弹窗", "确认", "取消" |
| `src/components/users/UserModal.tsx` | Validation messages |
| `app/organizations/page.tsx` | `CIVILIZATION_LABELS` — "中国地府", "欧洲天堂地狱", "埃及冥界" |
| `app/profile/page.tsx` | `ROLE_LABELS` — "管理员", "审判官", etc. |
| `app/welcome/page.tsx` | Heavy hardcoded Chinese throughout |
| `app/workflow/[id]/page.tsx` | `NODE_TYPE_LABELS` — "审判", "评估", "申诉", "终审", "执行" |
| `app/actors/page.tsx` | `CIVILIZATION_LABELS` — "中国地府", "欧洲天堂地狱", "埃及冥界" |

### 4. Hardcoded English Strings (Zero i18n)

| File | Strings |
|------|---------|
| `app/admin/stats/page.tsx` | Almost entirely hardcoded English: "Admin Stats", "Overview", "Souls by State" |
| `src/components/karma/KarmaChart.tsx` | "Balance:", "Effective:", "No karma history available" |
| `app/dispatch/page.tsx` | `"Soul #"`, `"→"` |
| `app/dispatch/propose/page.tsx` | "Target Soul", "Target Tenant", "Reason", "Select soul...", "Submitting...", "Submit Proposal", "Cancel" |
| `app/cross-judgments/[id]/page.tsx` | "← Back", "Initiated by:", "Participants", "No participants yet", "Verdict" |

### 5. Hardcoded Tailwind Status/Role Colors

Nearly every page has its own `STATUS_COLORS`, `VERDICT_COLORS`, or similar objects with hardcoded Tailwind classes like `bg-green-500/20 text-green-400`. These don't respond to theme changes.

| File | Object | Colors |
|------|--------|--------|
| `app/karma/page.tsx` | state indicators | `bg-green-500`, `bg-amber-500`, `bg-gray-500`, `bg-blue-500`, `bg-red-500` |
| `app/karma/page.tsx` | action badges | `bg-green-500/20`, `bg-blue-500/20`, `bg-red-500/20`, `bg-purple-500/20` |
| `app/realms/page.tsx` | `REALM_TYPE_CONFIG` | `bg-red-500/10`, `bg-blue-500/10`, `bg-green-500/10` |
| `app/audit/page.tsx` | action badges | `bg-green-500/20`, `bg-amber-500/20`, `bg-red-500/20`, `bg-blue-500/20` |
| `app/dispatch/page.tsx` | `statusColors` | `bg-yellow-500/20`, `bg-green-500/20`, `bg-red-500/20`, `bg-blue-500/20` |
| `app/users/page.tsx` | role/status badges | `bg-red-500/20`, `bg-blue-500/20`, `bg-gray-500/20`, `text-green-400`, `text-red-400` |
| `app/cross-judgments/[id]/page.tsx` | `statusColors` | `bg-yellow-500/20`, `bg-blue-500/20`, `bg-green-500/20`, `bg-gray-500/20` |
| `app/menus/page.tsx` | active badge | `bg-green-500/20 text-green-400` |
| `app/souls/[id]/page.tsx` | `STATE_COLORS` | `bg-emerald-600/20`, `bg-amber-600/20`, `bg-blue-600/20` |
| `app/souls/[id]/page.tsx` | verdict buttons | `bg-green-600`, `bg-red-700`, `bg-yellow-600` |
| `app/souls/[id]/page.tsx` | karma text | `text-green-400`, `text-red-400` |
| `app/workflow/[id]/page.tsx` | status/verdict | Multiple hardcoded Tailwind colors |
| `src/components/ui/Toast.tsx` | toast variants | Hardcoded hex: `#059669`, `#dc2626`, `#d97706` |

**Fix**: Define semantic color tokens in CSS variables (e.g., `--color-status-success`, `--color-status-error`, `--color-karma-merit`) and use them consistently.

### 6. Toast System Uses Hardcoded Hex Colors
**File**: `src/components/ui/Toast.tsx`
**Severity**: HIGH

Toast notifications use hardcoded hex colors (`#059669`, `#dc2626`, `#d97706`) instead of CSS variables. Won't respond to theme changes.

### 7. Root Layout Metadata Hardcoded
**File**: `frontend/app/layout.tsx`
**Severity**: MEDIUM

```tsx
metadata.title = "跨文明灵魂管理系统"
metadata.description = "SoulLedger - Cross-civilization soul management system"
```

Hardcoded Chinese title. Should use i18n or at minimum be configurable.

## Medium-Severity Issues

### 8. Fallback Anti-Pattern: `t("key") || "fallback"`
**Severity**: MEDIUM (code quality)

Many files use `t("key") || "Fallback"` instead of proper i18n default values. This masks missing translations and creates inconsistent UX.

Affected: `app/audit/page.tsx`, `app/(auth)/login/page.tsx`, `app/(auth)/layout.tsx`, `app/dispatch/propose/page.tsx`, `src/components/settings/SettingsDrawer.tsx`, `src/components/users/UserDeleteDialog.tsx`

### 9. `SoulEditModal` — Zero i18n, Hardcoded Chinese
**File**: `src/components/souls/SoulEditModal.tsx`
**Severity**: MEDIUM

Entire modal (~100 lines) has hardcoded Chinese labels, validation messages, and placeholders. No i18n keys used.

### 10. `WorkflowEditor` — Zero i18n, 624 Lines
**File**: `src/components/workflow/WorkflowEditor.tsx`
**Severity**: MEDIUM

Largest component in the codebase with 50+ hardcoded Chinese strings. All labels, buttons, status text, error messages are Chinese-only.

### 11. `PermissionDenied` — Hardcoded Chinese
**File**: `src/components/rbac/PermissionDenied.tsx`
**Severity**: MEDIUM

Shows "权限不足" and "请联系管理员" — not usable for non-Chinese users.

### 12. Test Page Hardcoded Colors
**File**: `app/test/page.tsx`
**Severity**: LOW

Test/debug page with hardcoded `text-amber-400`, `bg-amber-500`. Not user-facing, but inconsistent.

### 13. Dispatch Propose — Type Casting Hack
**File**: `app/dispatch/propose/page.tsx` (line 46-48)
**Severity**: MEDIUM (potential runtime error)

```tsx
source_tenant: user.tenant.code as unknown as number,
target_tenant: form.target_tenant_code as unknown as number,
```

Casting string tenant codes to `number` via `as unknown as`. Backend expects numeric IDs but frontend only has codes. This will fail at runtime.

### 14. `souls/[id]` — Back Link Truncated
**File**: `app/souls/[id]/page.tsx` (line 196)
**Severity**: LOW

```tsx
{t("souls.detail.back_to_list").slice(0, 2)}
```

Slices the back-to-list text to 2 characters. Works for Chinese ("返回") but produces garbage for English ("Ba").

### 15. `souls/[id]` — Mixed Error Text
**File**: `app/souls/[id]/page.tsx` (line 179)
**Severity**: LOW

```tsx
<div className="text-red-400">{error || t("souls.detail.not_found")}</div>
```

Error from API (usually English) shown alongside i18n fallback. Inconsistent language mixing.

## Positive Patterns

- **Most pages use i18n well**: souls list, judgment list/detail, notifications, menus, realms, karma, permissions, users all use `t()` keys consistently
- **CSS variables for layout**: `--color-canvas`, `--color-surface-1/2/3`, `--color-hairline`, `--color-ink`, `--color-accent` used correctly in most components
- **Skeleton loading states**: Consistent use of `<Skeleton>`, `<SkeletonCard>`, `<TableSkeleton>` for loading UX
- **TanStack Query**: Proper caching, invalidation, and error handling across all data-fetching pages
- **RequirePermission**: Clean declarative RBAC gating component
- **Recharts integration**: Karma timeline chart uses CSS variables for tooltip/grid styling
- **IconPicker**: Uses lucide-react dynamic imports with search — good UX pattern
- **Menus page**: Full CRUD with role toggles, icon picker, and proper i18n — well-structured

## Summary Statistics

| Category | Count |
|----------|-------|
| Files with hardcoded Chinese | 11+ |
| Files with hardcoded English | 5+ |
| Files with hardcoded Tailwind colors | 15+ |
| Files with `bg-surface-*` without `hsl()` | 5 |
| Files with good i18n | 20+ |
| Files with good CSS variables | 25+ |

## Recommended Actions

1. **Create semantic color tokens** in `globals.css` for status colors (success, error, warning, info, karma-merit, karma-demerit)
2. **Add Tailwind plugin** mapping CSS variables to utility classes to eliminate `hsl(var(...))` verbosity
3. **Extract all hardcoded strings** from WorkflowEditor, SoulEditModal, PermissionDenied into i18n files
4. **Fix root layout** to use dynamic lang and theme
5. **Fix `bg-surface-*` without hsl()** — either via Tailwind plugin or manual replacement
6. **Fix dispatch propose** type casting hack with proper backend API
7. **Standardize color usage** — pick ONE approach (CSS vars or Tailwind) and enforce it
