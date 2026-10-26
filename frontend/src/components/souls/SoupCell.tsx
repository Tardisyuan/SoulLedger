"use client";

import { useState } from "react";
import { reincarnationApi, soupRefusalOf } from "@soulledger/core/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { RequirePermission } from "@/src/components/rbac/RequirePermission";
import { Button } from "@/src/components/ui/Button";
import { MissingValue } from "@/src/components/ui/DomainValue";
import { ConfirmDialog } from "@/src/components/ui/Modal";

/** 候转世名单的「孟婆汤」格(第五十四批 R-1/R-2):只有轮回中的地府灵魂有汤可饮,其余是「不适用」。 */
export function SoupCell({ soul, onChanged }: { soul: { id: number | string; name: string; civilization: string; current_state: string; soup_taken_at?: string | null }; onChanged: () => void }) {
  const { t, formatDateTime } = useI18n();
  const { showToast } = useToast();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  if (soul.civilization !== "CHINESE" || soul.current_state !== "REINCARNATING") {
    return <MissingValue kind="inapplicable" reason={t("mengpoSoup.hint")} />;
  }
  if (soul.soup_taken_at) return <span data-testid="soup-taken">{t("mengpoSoup.taken", { time: formatDateTime(soul.soup_taken_at) })}</span>;
  const register = async () => {
    setBusy(true);
    try {
      await reincarnationApi.drinkSoup(String(soul.id));
      showToast(t("mengpoSoup.registered_toast", { name: soul.name }), "success");
    } catch (e: unknown) {
      const code = soupRefusalOf(e);
      showToast(code ? t(`mengpoSoup.error.${code}`) : t("common.error"), "error");
    } finally {
      setBusy(false);
      setAsking(false);
      onChanged();
    }
  };
  return (
    <span className="relative z-[1] inline-flex items-center gap-2">
      <span data-testid="soup-not-taken" className="border border-[oklch(var(--color-line-strong))] px-2 text-xs">{t("mengpoSoup.not_taken")}</span>
      <RequirePermission permissions="reincarnation.manage">
        <Button type="button" variant="ghost" size="sm" data-testid="soup-register" onClick={() => setAsking(true)}>
          {t("mengpoSoup.register")}
        </Button>
      </RequirePermission>
      <ConfirmDialog
        isOpen={asking}
        variant="info"
        title={t("mengpoSoup.register_title", { name: soul.name })}
        message={t("mengpoSoup.register_body")}
        confirmText={t("mengpoSoup.register")}
        confirmLoading={busy}
        onConfirm={() => void register()}
        onCancel={() => setAsking(false)}
      />
    </span>
  );
}
