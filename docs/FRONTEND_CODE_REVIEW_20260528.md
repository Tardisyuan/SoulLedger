# 前端代码验证报告

**日期**: 2026-05-28
**验证范围**: 前端页面与后端API对比、代码错误检查
**验证模块**: API端点一致性、组件导出、TypeScript类型、动态路由、TanStack Query、翻译文件、API覆盖

---

## 一、严格检查结果汇总

| 检查项 | 状态 | 发现问题数 |
|--------|------|------------|
| API 端点一致性 | ⚠️ 待确认 | 1个问题 |
| 组件导出完整性 | ✅ 通过 | 0个问题 |
| TypeScript 类型一致性 | ⚠️ 部分问题 | 1个问题 |
| 动态路由和嵌套页面 | ✅ 通过 | 0个问题 |
| TanStack Query v5 使用 | ✅ 通过 | 0个问题 |
| 翻译文件完整性 | ✅ 已完成 | 134个key已补充 |
| API 与页面覆盖 | ✅ 可接受 | 12个API无专属页面 |

---

## 二、API 端点一致性问题

### dispatchApi URL 需验证 (P1)

**问题**: `dispatchApi.propose()` 调用 `/dispatch/records/`，需确认后端 URL 配置

```typescript
// frontend/lib/api.ts
export const dispatchApi = {
  propose: (data) => api.post("/dispatch/records/", data),
}
```

**待确认**: 后端 ViewSet basename 为 `dispatch`，URL prefix 为 `/api/v1/dispatch/`

**验证方法**: 启动后端并测试 `POST /api/v1/dispatch/dispatch/records/` 是否返回正确

---

## 三、TypeScript 类型一致性问题

### karmaApi.statsOverview 缺少 tenant_id (P1)

**问题**: `statsOverview()` 返回的 `tenants` 数组只有 `tenant_code`，但 `dispatch/propose` 需要 `tenant_id`

```typescript
// frontend/lib/api.ts
export interface KarmaStatsOverview {
  tenants: {
    tenant_code: string;   // ✅ 有
    tenant_name: string;   // ✅ 有
    total_souls: number;   // ✅ 有
    state_breakdown: Record<string, number>;  // ✅ 有
    // tenant_id: number;  ❌ 缺少
  }[];
}
```

**影响**: `dispatch/propose/page.tsx` 只能使用 `tenant_code`，但后端 `DispatchProposeSerializer` 期望 `IntegerField`

**解决方案** (二选一):
1. 修改后端 `DispatchProposeSerializer` 接受 `tenant_code` 字符串
2. 修改 `karmaApi.statsOverview()` 返回 tenants 时包含 `tenant_id`

---

## 四、翻译文件完整性 ✅

| 语言 | Key 数量 | 状态 |
|------|----------|------|
| en.json | 735 | ✅ |
| zh-Hans.json | 735 | ✅ 完整 |
| egy.json | 735 | ✅ 已补充 134 个 key |

---

## 五、后端有API但前端无页面的情况

| 后端API | 状态 | 说明 |
|---------|------|------|
| `/api/v1/auth/login-logs/` | ⚠️ 无专属页面 | 审核日志可能包含部分登录记录 |
| `/api/v1/perm/init/` | ⚠️ 无专属页面 | 权限初始化仅需管理员操作一次 |
| `/api/v1/perm/export/` | ⚠️ 无专属页面 | 权限导出功能无UI入口 |
| `/api/v1/perm/import/` | ⚠️ 无专属页面 | 权限导入功能无UI入口 |
| `/api/v1/karma/balance/<soul_id>/` | ⚠️ 入口不明确 | souls/[id] 页面可能展示部分 |
| `/api/v1/karma/calculate/<soul_id>/` | ⚠️ 无UI入口 | 仅后台计算使用 |
| `/api/v1/karma/effective/<soul_id>/` | ⚠️ 无UI入口 | 仅后台计算使用 |
| `/api/v1/karma/inheritance/<soul_id>/` | ⚠️ 无UI入口 | 仅后台计算使用 |
| `/api/v1/disposition/{id}/execute/` | ⚠️ 无专属按钮 | souls/[id] 可能集成 |
| `/api/v1/reincarnation/{id}/complete/` | ⚠️ 无专属按钮 | souls/[id] 可能集成 |
| `/api/v1/audit-logs/timeline/` | ⚠️ 无专属页面 | audit 页面可能展示 |
| `/api/v1/audit-logs/trace/{trace_id}/` | ⚠️ 无专属页面 | 仅调试用途 |

**评估**: 以上 API 多为内部/管理用途，前端无专属页面是可接受的

---

## 六、后端有且前端已覆盖的功能

| 功能 | 前端页面 |
|------|----------|
| 灵魂 CRUD | ✅ souls, souls/[id] |
| 审判 | ✅ judgment, judgment/[id] |
| 业力统计 | ✅ dashboard, karma |
| 审核日志 | ✅ audit |
| 权限管理 | ✅ permissions |
| 菜单管理 | ✅ menus, menus/buttons |
| 工作流 | ✅ workflow, workflow/[id] |
| 通知 | ✅ notifications |
| 用户管理 | ✅ users |
| 领域 | ✅ realms |
| 角色 | ✅ permissions |
| 演员 | ✅ actors |
| 事件 | ✅ souls/[id] 内 |
| 派遣 | ✅ dispatch, dispatch/propose |
| 跨文明审判 | ✅ cross-judgments, cross-judgments/[id] |

---

## 七、组件导出检查

✅ `components/ui/skeleton.tsx` 正确导出:
- `Skeleton`
- `TableSkeleton`
- `CardSkeleton`
- `ListSkeleton`
- `SkeletonText`

✅ `src/components/ui/skeleton.tsx` 正确导出:
- `Skeleton`
- `SkeletonText`
- `SkeletonCard`

⚠️ 两处 skeleton.tsx 内容不同，但各自独立使用

---

## 八、待处理问题

| 优先级 | 问题 | 状态 |
|--------|------|------|
| P1 | dispatchApi URL 需验证正确性 | 待确认 |
| P1 | dispatch/propose tenant_id 缺失 (需后端配合) | 待处理 |
| P2 | 缺失 loading.tsx (10个页面) | 待处理 |
| ✅ | egy.json 翻译补充 134 个 key | **已完成** |
