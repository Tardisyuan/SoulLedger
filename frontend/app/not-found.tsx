"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n } from "@/src/contexts/I18nContext";
import { buttonVariants } from "@/src/components/ui/Button";
import { StatusCard } from "@/src/components/ui/PageError";

/**
 * 404(规范 v3,2026-10-01):与 403 / 500 是同一块 `StatusCard`,代码「404」是 ink。
 * v2 的匾题「404」与两颗按钮(回首页 / 返回)换成卡片里的一颗次按钮「回到首页」;
 * 没找到的路径留在等宽细节行里。
 */
export default function NotFound() {
  const { t } = useI18n();
  const pathname = usePathname();

  return (
    <StatusCard
      code="404"
      title={t("not_found.title")}
      message={t("not_found.description")}
      detail={pathname}
      action={
        <Link href="/" className={buttonVariants({ variant: "secondary", size: "sm" })}>
          {t("not_found.home")}
        </Link>
      }
    />
  );
}
