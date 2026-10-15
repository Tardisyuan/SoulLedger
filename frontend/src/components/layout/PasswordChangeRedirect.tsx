"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTenant } from "@/src/contexts/TenantContext";

/**
 * 密码须先改(首次登录 / 管理员重置 / 超期,`user.password_change_required`):除改密码外的接口此刻都是 403
 * `password_change_required`,所以别的页面一律带到个人中心,那里只剩改密码一节。什么都不画。
 */
export function PasswordChangeRedirect() {
  const { user } = useTenant();
  const pathname = usePathname();
  const router = useRouter();
  const must = user?.password_change_required === true;
  useEffect(() => {
    if (must && pathname !== "/profile") router.replace("/profile");
  }, [must, pathname, router]);
  return null;
}
