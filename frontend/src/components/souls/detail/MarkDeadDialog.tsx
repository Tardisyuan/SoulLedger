"use client";

import { useState } from "react";
import { localDateString } from "@soulledger/core/domain/dates";
import { useI18n } from "@/src/contexts/I18nContext";
import { BaseModal } from "@/src/components/ui/Modal";
import { Button } from "@/src/components/ui/Button";
import { TextField } from "@/src/components/ui/Field";

/**
 * 「标记死亡」的确认框(F-DEATH-01,2026-11-12)。此前是一句确认、固定发今天的日期:已录的死亡日被改成今天,
 * 生年距今超过 150 年的灵魂(埃及、希腊的公元前生年)一律 400,标不了。
 *
 * 已录死亡日的,写出那一天、什么都不发(后端沿用已录的);没录的,让官员填,默认今天(用户本地日期 ——
 * 不发时服务端按 UTC 取「今天」,东八区凌晨会写成前一天)。
 */
export function MarkDeadDialog({
  soulName,
  recordedDeath,
  isOpen,
  onClose,
  onConfirm,
}: {
  soulName: string;
  /** 已录死亡日的显示文字;没录是 null。 */
  recordedDeath: string | null;
  isOpen: boolean;
  onClose: () => void;
  /** 官员填的日期(YYYY-MM-DD);沿用已录的时为 undefined。 */
  onConfirm: (deathDate: string | undefined) => void;
}) {
  const { t } = useI18n();
  const [deathDate, setDeathDate] = useState(() => localDateString());
  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title={t("common.confirm")}
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            variant="primary"
            data-testid="mark-dead-submit"
            disabled={!recordedDeath && !deathDate}
            onClick={() => {
              onConfirm(recordedDeath ? undefined : deathDate);
              onClose();
            }}
          >
            {t("common.confirm")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-[oklch(var(--color-ink))]">{t("souls.detail.mark_dead_confirm", { name: soulName })}</p>
        {recordedDeath ? (
          <div data-testid="mark-dead-recorded">
            <p className="text-2xs text-[oklch(var(--color-ink-subtle))]">{t("souls.death")}</p>
            <p className="text-sm text-[oklch(var(--color-ink))]">{recordedDeath}</p>
          </div>
        ) : (
          <TextField
            id="mark-dead-date"
            label={t("souls.death")}
            type="date"
            required
            value={deathDate}
            max={localDateString()}
            onChange={(e) => setDeathDate(e.target.value)}
          />
        )}
      </div>
    </BaseModal>
  );
}
