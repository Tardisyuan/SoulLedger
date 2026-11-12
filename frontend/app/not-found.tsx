"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n } from "@/src/contexts/I18nContext";
import { useTenant } from "@/src/contexts/TenantContext";
import { buttonVariants } from "@/src/components/ui/Button";
import { StatusCard } from "@/src/components/ui/PageError";
import { routeForView } from "@/src/lib/defaultView";

/**
 * 404:与 403 / 500 是同一块 `StatusCard`。第三十批「卷宗」第 1 步第 5 条:等宽小码 + 宋体一句「卷宗里没有这一页」
 * + 说明 + 一个出口;主出口是「回案卷台」(墨色实底)。案卷台的路由第 2 步才有,在那之前这个出口指向此刻这个人的
 * 默认页(`routeForView`:判官是待办队列,管理员与没有审判权限的人是概览;没登录是 /dashboard,壳会再送去登录)。
 * 没找到的路径留在等宽细节行里。
 */
export default function NotFound() {
  const { t } = useI18n();
  const pathname = usePathname();
  const { user } = useTenant();

  return (
    <StatusCard
      code="404"
      title={t("not_found.title")}
      message={t("not_found.description")}
      detail={pathname}
      action={
        <Link href={routeForView(null, user)} className={buttonVariants({ variant: "primary", size: "md" })}>
          {t("not_found.to_desk")}
        </Link>
      }
    />
  );
}
