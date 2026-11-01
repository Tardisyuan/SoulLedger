"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/src/contexts/I18nContext";
import { useTenant } from "@/src/contexts/TenantContext";
import { defaultViewFor, loadDefaultView, saveDefaultView, type DefaultView } from "@/src/lib/defaultView";

/**
 * 个人资料里的「默认视图」(review-2026-11-01 Web 1):此前只在首次设置第 2 步出现一次,
 * 官员不知道有这个设置。与 `WelcomeSetup` 同一份服务端偏好、同一套词;没选过时
 * 勾的是按角色的那一项(就是登录实际落到的地方),并写明「未设置,按角色」。
 */
export function DefaultViewSection() {
  const { t } = useI18n();
  const { user } = useTenant();
  const [view, setView] = useState<DefaultView | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadDefaultView()
      .then((saved) => {
        if (!cancelled) setView(saved);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  const effective = view ?? defaultViewFor(user);
  const choose = (next: DefaultView) => {
    const previous = view;
    setView(next);
    saveDefaultView(next)
      .then(setView)
      .catch(() => setView(previous));
  };
  return (
    <div className="py-3">
      <p className="mb-3 text-xs text-[oklch(var(--color-ink-muted))]">{t("welcome.default_view_desc")}</p>
      <div role="radiogroup" aria-label={t("welcome.default_view")} className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {(["operator", "admin"] as const).map((option) => (
          <label key={option} className="grid min-h-11 cursor-pointer grid-cols-[auto_minmax(0,1fr)] gap-x-3 text-sm">
            <input
              type="radio"
              name="profile-default-view"
              data-testid={`profile-view-${option}`}
              className="row-span-2 mt-0.5 size-4.5"
              checked={effective === option}
              onChange={() => choose(option)}
            />
            <span className="font-medium text-[oklch(var(--color-ink))]">
              {option === "admin" ? t("profile.default_view_admin") : t("welcome.view_operator")}
            </span>
            <span className="text-xs text-[oklch(var(--color-ink-muted))]">
              {t(option === "admin" ? "welcome.view_admin_desc" : "welcome.view_operator_desc")}
            </span>
          </label>
        ))}
      </div>
      {view === null ? (
        <p data-testid="profile-view-unset" className="mt-2 text-xs text-[oklch(var(--color-ink-subtle))]">
          {t("profile.default_view_unset")}
        </p>
      ) : null}
    </div>
  );
}
