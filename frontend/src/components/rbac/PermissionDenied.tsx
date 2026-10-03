"use client";

import { useI18n } from "@/src/contexts/I18nContext";
import { Button } from "@/src/components/ui/Button";
import { StatusCard } from "@/src/components/ui/PageError";

/**
 * 403(规范 v3,2026-10-01):与 404 / 500 是同一块 `StatusCard` —— 代码「403」是 ink,
 * 不是冷玫红(冷玫红只表系统出错)。它是 `RequirePermission` / `RequireAdmin` 的 fallback,
 * 替换掉整页内容,所以它的 `<h1>` 就是这一页唯一的 `<h1>`。不画锁。
 * 传了 `permission` 就在细节行写出缺的那个权限码(等宽,不翻译 —— 它是标识符)。
 * 「请找本殿管理员」一句 Design E 组给了 egy:管理员在数据上挂在租户下(`User.tenant`,
 * 找回密码也通知本租户的管理员),所以写 `Dbh Er Sab Hery En Per Pen`。
 * 按钮「返回上一页」用 `window.history.back()` 而不是 `useRouter`:这个 fallback 在几十份
 * 测试里渲染,它们没有挂 app router;history 返回在 Next 里同样走客户端导航(popstate)。
 */
export function PermissionDenied({ permission }: { permission?: string }) {
  const { t } = useI18n();
  return (
    <StatusCard
      code="403"
      testId="permission-denied"
      title={t("permission.denied_title")}
      message={
        <>
          <span>{t("permission.denied_message")}</span>{" "}
          <span data-testid="permission-denied-ask">{t("permission.ask_admin")}</span>
        </>
      }
      detail={permission}
      detailTestId="permission-denied-code"
      action={
        <Button type="button" variant="secondary" size="sm" onClick={() => window.history.back()}>
          {t("permission.go_back")}
        </Button>
      }
    />
  );
}
