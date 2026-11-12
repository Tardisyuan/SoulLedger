"use client";

import { CaseDesk } from "@/src/components/desk/CaseDesk";
import { PermissionDenied } from "@/src/components/rbac/PermissionDenied";
import { RequirePermission } from "@/src/components/rbac/RequirePermission";

/**
 * `/desk` — 案卷台(Design 第三十批 第 2 步):判官进来先看到的一页(`src/lib/defaultView.ts`)。
 * 门是 `judgment.read`,与 `GET /judgment/` 同一个码。壳是 `DeskShell`(门栏),不是 AppLayout。
 */
export default function DeskPage() {
  return (
    <RequirePermission permissions="judgment.read" fallback={<PermissionDenied permission="judgment.read" />}>
      <CaseDesk />
    </RequirePermission>
  );
}
