"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/src/contexts/I18nContext";
import { Button } from "@/src/components/ui/Button";
import { useImpersonation } from "./useImpersonation";
import { leaveImpersonation, wireImpersonation } from "./wireImpersonation";

wireImpersonation();

/** 固定条的高度(= `--imp-h`):AppLayout 把它加进工具条、身份带、导航的吸顶偏移。 */
export const IMPERSONATION_BANNER_HEIGHT = "2.5rem";

function mmss(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * 「以此人身份查看」时顶栏之上的固定警示条(Design 第二十八批 W6):不随页面滚动、不能收起、刷新换页都保留
 * (状态在 session 存储,见 core `impersonation.ts`)。◐ 只读 + 正在以谁(殿 · 角色)的身份查看 · 理由 +
 * 等宽倒计时 + 退出查看。到点自动退出并回到用户管理。进殿查看时同一条:「正在以全局管理员身份查看 X」+ 回到各殿概况。
 */
export function ImpersonationBanner() {
  const { t, locale } = useI18n();
  const state = useImpersonation();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!state) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [state]);

  const remaining = state ? state.expiresAt - now : 0;
  const expired = Boolean(state) && remaining <= 0;
  useEffect(() => {
    if (expired) void leaveImpersonation();
  }, [expired]);

  if (!state) return null;

  const roleKey = `users.roles.${state.target.role}`;
  const roleLabel = t(roleKey) === roleKey ? state.target.role : t(roleKey);
  const hall = state.target.hall?.[locale] || Object.values(state.target.hall ?? {})[0];
  const who = `${state.target.name}(${[hall, roleLabel].filter(Boolean).join(" · ")})`;
  // 进殿查看(第五十四批 O-2):没有「被看的人」与理由,只说看的是哪一殿;退出回到各殿概况。
  const text = state.hallView
    ? t("halls.viewing.banner", { name: hall || state.hallView.code })
    : `${t("admin.impersonate.banner", { name: who })} · ${t("admin.impersonate.reason_line", { reason: state.reason })}`;

  return (
    <div
      role="status"
      data-testid="impersonation-banner"
      style={{ height: IMPERSONATION_BANNER_HEIGHT }}
      className="sticky top-0 z-progress flex items-center gap-3 border-b border-[oklch(var(--color-warning))] bg-[oklch(var(--color-warning-tint))] px-4 text-xs text-[oklch(var(--color-warning))] md:px-8"
    >
      <span className="shrink-0 font-semibold">
        <span aria-hidden="true">◐ </span>
        {t("admin.impersonate.readonly")}
      </span>
      <span className="min-w-0 flex-1 truncate" title={text}>
        {text}
      </span>
      <span className="shrink-0 font-mono tabular-nums" data-testid="impersonation-countdown">
        {t("admin.impersonate.remaining", { time: mmss(remaining) })}
      </span>
      <Button type="button" size="sm" variant="secondary" data-testid="impersonation-exit" onClick={() => void leaveImpersonation()}>
        {state.hallView ? t("halls.viewing.back") : t("admin.impersonate.exit")}
      </Button>
    </div>
  );
}
