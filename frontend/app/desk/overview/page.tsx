"use client";

import { Zongbu } from "@/src/components/desk/Zongbu";
import { PermissionDenied } from "@/src/components/rbac/PermissionDenied";
import { RequireAdmin } from "@/src/components/rbac/RequirePermission";

/**
 * `/desk/overview` — 总簿(Design 第三十批 第 2 步 · 管理员):四个冥界各一栏的账,下面一张「跨界往来」。
 * 管理员登录后先到这里(`src/lib/defaultView.ts`);旧的 `/dashboard` 照旧在,页底有入口。
 */
export default function ZongbuPage() {
  return (
    <RequireAdmin fallback={<PermissionDenied />}>
      <Zongbu />
    </RequireAdmin>
  );
}
