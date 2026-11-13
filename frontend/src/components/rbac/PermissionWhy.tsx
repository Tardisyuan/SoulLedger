"use client";

import { useState } from "react";
import { permApi, type PermissionExplanation } from "@soulledger/core/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { Button } from "@/src/components/ui/Button";

/**
 * 「为什么?」(docs/audit/2026-11-12-portfolio-ai-ideas.md 第二部分接入点 6)。点了才问 `GET /perm/explain/`:
 * 原因由后端按权限规则算出(`reason`),这里总是先写语言包里那句(不靠模型的兜底);殿开了助手时,
 * 模型对同一结论的措辞(`explanation`)放在下面,标明是 AI 措辞。权限码不上页面,只写可读名称。
 * 不用 react-query:它画在几十处 403 里,那些地方(和它们的测试)不一定挂了 QueryClientProvider。
 */
export function PermissionWhy({ action, object }: { action: string; object?: string }) {
  const { t } = useI18n();
  const [state, setState] = useState<"idle" | "loading" | "failed" | PermissionExplanation>("idle");
  const label = (prefix: string, value: string) => {
    const key = `${prefix}.${value}`;
    const text = t(key);
    return text === key ? value : text;
  };
  const ask = async () => {
    setState("loading");
    try {
      setState((await permApi.explain(action, object)).data);
    } catch {
      setState("failed");
    }
  };

  if (state === "idle") {
    return (
      <Button type="button" variant="ghost" size="sm" data-testid="permission-why" onClick={ask}>
        {t("perm_explain.why")}
      </Button>
    );
  }
  if (state === "loading") return <span role="status">{t("perm_explain.loading")}</span>;
  if (state === "failed") return <span role="status" data-testid="permission-why-failed">{t("perm_explain.failed")}</span>;

  const roles = (names: string[]) => names.map((r) => label("users.roles", r)).join(t("permission.names_or"));
  return (
    <div data-testid="permission-why-answer" role="status" className="mt-2 space-y-1 text-left">
      <p data-testid="permission-why-reason">{t(`perm_explain.reason.${state.reason}`)}</p>
      <ul className="text-xs text-[oklch(var(--color-ink-muted))]">
        {state.permission_name ? <li>{t("perm_explain.needs", { name: state.permission_name })}</li> : null}
        <li>{t("perm_explain.your_roles", { roles: roles([state.role, ...state.extra_roles]) })}</li>
        {!state.allowed && state.reason !== "out_of_scope" ? (
          <li>{t("perm_explain.who_can", { roles: roles(state.roles_that_can) })}</li>
        ) : null}
        {state.scope_kinds.length > 0 ? (
          <li>
            {t("perm_explain.scope_kinds", {
              kinds: state.scope_kinds.map((k) => label("permissions.datascope.scope", k)).join(" · "),
            })}
          </li>
        ) : null}
      </ul>
      {state.explanation ? (
        <p data-testid="permission-why-ai">
          {state.explanation}
          <span className="ml-2 text-xs text-[oklch(var(--color-ink-subtle))]">{t("perm_explain.ai_label")}</span>
        </p>
      ) : null}
    </div>
  );
}
