"use client";

import { createContext, useContext } from "react";
import Link from "next/link";
import { useI18n } from "@/src/contexts/I18nContext";
import { Button, buttonVariants } from "@/src/components/ui/Button";
import { StatusCard } from "@/src/components/ui/PageError";
import { PermissionWhy } from "./PermissionWhy";

/**
 * 哪道门挡住了这一页:`RequirePermission` 把它的权限码、`RequireAdmin` 把「管理员」放进来,
 * 于是 45 处 `fallback={<PermissionDenied />}` 不用各自再写一遍(review-2026-11-01 Web 2)。
 */
export type MissingPermission = { permissions: string[] } | { admin: true };
export const MissingPermissionContext = createContext<MissingPermission | null>(null);

/**
 * 403(规范 v3,2026-10-01):与 404 / 500 是同一块 `StatusCard` —— 代码「403」是 ink,
 * 不是冷玫红(冷玫红只表系统出错)。它是 `RequirePermission` / `RequireAdmin` 的 fallback,
 * 替换掉整页内容,所以它的 `<h1>` 就是这一页唯一的 `<h1>`。不画锁。
 * 缺的权限写**可读名称**(`permission.names.<码>`,与后端 Permission.name 同一套说法),
 * 不露原始权限码:码是给管理员配权限用的标识符,读者拿它没有用。语言包里没有名称的码
 * 就不写这一行 —— 宁可少说,也不把码露出来。
 * 「请找本殿管理员」一句 Design E 组给了 egy:管理员在数据上挂在租户下(`User.tenant`,
 * 找回密码也通知本租户的管理员),所以写 `Dbh Er Sab Hery En Per Pen`。
 * 按钮「返回上一页」用 `window.history.back()` 而不是 `useRouter`:这个 fallback 在几十份
 * 测试里渲染,它们没有挂 app router;history 返回在 Next 里同样走客户端导航(popstate)。
 */
export function PermissionDenied({ permission, exitToDesk = false }: {
  permission?: string;
  /** 出口是「回案卷台」而不是「返回上一页」:这一页不在这个身份的门里(判官直接打开朋友圈,第三十六批 第一节第 4 条)。 */
  exitToDesk?: boolean;
}) {
  const { t } = useI18n();
  const gate = useContext(MissingPermissionContext);
  let needs: string | null = null;
  const codes = permission ? [permission] : gate && "permissions" in gate ? gate.permissions : null;
  if (codes) {
    const names = codes.map((c) => {
      const key = `permission.names.${c}`;
      const name = t(key);
      return name === key ? null : name;
    });
    if (names.length && names.every(Boolean)) needs = t("permission.needs", { names: names.join(t("permission.names_or")) });
  } else if (gate && "admin" in gate) {
    needs = t("permission.needs_admin");
  }
  return (
    <StatusCard
      code="403"
      testId="permission-denied"
      title={t("permission.denied_title")}
      message={
        <>
          <span>{t("permission.denied_message")}</span>{" "}
          {needs ? (
            <>
              <span data-testid="permission-denied-needs">{needs}</span>{" "}
            </>
          ) : null}
          <span data-testid="permission-denied-ask">{t("permission.ask_admin")}</span>
        </>
      }
      action={
        <>
          {exitToDesk ? (
            <Link href="/desk" className={buttonVariants({ variant: "secondary", size: "sm" })} data-testid="permission-denied-to-desk">
              {t("not_found.to_desk")}
            </Link>
          ) : (
            <Button type="button" variant="secondary" size="sm" onClick={() => window.history.back()}>
              {t("permission.go_back")}
            </Button>
          )}
          {/* 「为什么?」:原因由后端算(第二部分接入点 6)。有好几个码时问第一个 —— 任一个都能开这一页。
              放在 action 里而不是 message:message 是 <p>,答案里有段落与列表。 */}
          {codes?.length ? <PermissionWhy action={codes[0]} /> : null}
        </>
      }
    />
  );
}
