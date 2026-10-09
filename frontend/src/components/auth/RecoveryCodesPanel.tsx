"use client";

import { useState } from "react";
import { Button } from "@/src/components/ui/Button";
import { useI18n } from "@/src/contexts/I18nContext";

/**
 * 十个恢复码(A12 向导第四步,也是「重新生成」之后那一页):◐ 警示、两列 mono 17/28、
 * 复制全部 / 下载 .txt。`onSavedChange` 给向导的「我已妥善保存」复选框 —— 勾了才能「完成」。
 */
export function RecoveryCodesPanel({
  codes,
  saved,
  onSavedChange,
  username,
}: {
  codes: string[];
  saved?: boolean;
  onSavedChange?: (next: boolean) => void;
  username: string;
}) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const text = codes.join("\n");

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const download = () => {
    const blob = new Blob([`SoulLedger · ${username}\n${t("mfa.setup.step4_title")}\n\n${text}\n`], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `soulledger-recovery-codes-${username}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col gap-4" data-testid="mfa-recovery-codes">
      <div
        role="status"
        className="flex items-start gap-3 border border-[oklch(var(--color-warning))] bg-[oklch(var(--color-warning-tint))] px-4 py-3 text-sm text-[oklch(var(--color-ink))]"
      >
        <span aria-hidden="true">◐</span>
        <p>{t("mfa.setup.step4_warning")}</p>
      </div>
      <ol className="m-0 grid list-none grid-cols-2 gap-x-6 gap-y-1 border border-[oklch(var(--color-line))] bg-[oklch(var(--color-canvas))] p-4 font-mono text-md leading-7 text-[oklch(var(--color-ink))]">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" onClick={() => void copyAll()}>
          {copied ? t("common.value.copied") : t("mfa.setup.copy_all")}
        </Button>
        <Button type="button" variant="secondary" onClick={download}>
          {t("mfa.setup.download")}
        </Button>
      </div>
      {onSavedChange ? (
        <label className="flex min-h-11 items-center gap-2 text-sm text-[oklch(var(--color-ink))]">
          <input type="checkbox" className="size-4.5" checked={!!saved} onChange={(e) => onSavedChange(e.target.checked)} />
          {t("mfa.setup.saved_check")}
        </label>
      ) : null}
    </div>
  );
}
