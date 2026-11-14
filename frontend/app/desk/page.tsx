"use client";

import { Suspense } from "react";
import { CaseDesk } from "@/src/components/desk/CaseDesk";
import { PermissionDenied } from "@/src/components/rbac/PermissionDenied";
import { RequirePermission } from "@/src/components/rbac/RequirePermission";

/**
 * `/desk` — 案卷台(Design 第三十批 第 2 步):判官进来先看到的一页(`src/lib/defaultView.ts`)。
 * 门是 `judgment.read`,与 `GET /judgment/` 同一个码。壳是 AppLayout 的 `bare`(门栏 + 门内导航,没有工具条)。
 */
export default function DeskPage() {
  return (
    <RequirePermission permissions="judgment.read" fallback={<PermissionDenied permission="judgment.read" />}>
      {/* `CaseDesk` 读 `?case=`(useSearchParams),要一个 Suspense 边界,否则这一页的静态渲染整个退出。 */}
      <Suspense fallback={null}>
        <CaseDesk />
      </Suspense>
    </RequirePermission>
  );
}
