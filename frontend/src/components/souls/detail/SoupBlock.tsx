"use client";

import { useState } from "react";
import { useI18n } from "@/src/contexts/I18nContext";
import { RequirePermission } from "@/src/components/rbac/RequirePermission";
import { Button } from "@/src/components/ui/Button";
import { ConfirmDialog } from "@/src/components/ui/Modal";

/**
 * 孟婆汤(第五十四批 R-3 ~ R-5):只在「轮回中」的中国(地府)灵魂的操作卡里。
 * 未饮写「未饮」加文字按钮「登记已饮汤」,已饮写时间;转世被 409 `soup_not_taken` 拒了时同一块里多一句说明。
 * 登记要一步确认(主色,不是危险色:往前走),因为登记后没有撤销。
 */
export function SoupBlock({
  name,
  takenAt,
  refused,
  onRegister,
}: {
  name: string;
  takenAt: string | null | undefined;
  /** 办转世被拒了:写那句话。 */
  refused: boolean;
  onRegister: () => Promise<void>;
}) {
  const { t, formatDateTime } = useI18n();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const confirm = async () => {
    setBusy(true);
    try {
      await onRegister();
    } finally {
      setBusy(false);
      setAsking(false);
    }
  };
  return (
    <div data-testid="soup-block" className="space-y-2 border-t border-[oklch(var(--color-hairline))] pt-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-[oklch(var(--color-ink-muted))]">{t("mengpoSoup.title")}</span>
        {takenAt ? (
          <span data-testid="soup-taken">{t("mengpoSoup.taken", { time: formatDateTime(takenAt) })}</span>
        ) : (
          <>
            <span data-testid="soup-not-taken" className="border border-[oklch(var(--color-line-strong))] px-2 text-xs">{t("mengpoSoup.not_taken")}</span>
            <RequirePermission permissions="reincarnation.manage">
              <Button type="button" variant="ghost" size="sm" data-testid="soup-register" onClick={() => setAsking(true)}>
                {t("mengpoSoup.register")}
              </Button>
            </RequirePermission>
          </>
        )}
      </div>
      {!takenAt && refused ? (
        <p role="status" data-testid="soup-refused" className="text-xs text-[oklch(var(--color-ink-muted))]">
          {t("reincarnation.error.soup_not_taken", { name })}
        </p>
      ) : null}
      {!takenAt ? <p className="text-xs text-[oklch(var(--color-ink-subtle))]">{t("mengpoSoup.hint")}</p> : null}
      <ConfirmDialog
        isOpen={asking}
        variant="info"
        title={t("mengpoSoup.register_title", { name })}
        message={t("mengpoSoup.register_body")}
        confirmText={t("mengpoSoup.register")}
        confirmLoading={busy}
        onConfirm={() => void confirm()}
        onCancel={() => setAsking(false)}
      />
    </div>
  );
}
