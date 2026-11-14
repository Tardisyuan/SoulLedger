"use client";

import { useSyncExternalStore } from "react";
import { useI18n } from "@/src/contexts/I18nContext";
import { Modal } from "@/src/components/ui/Modal";
import { Button } from "@/src/components/ui/Button";
import { DomainEnum } from "@/src/components/ui/DomainValue";
import { verdictNamespace } from "@/src/lib/domainNames";

/**
 * 偏好「落印前先确认」(2026-11-14 用户决定,review-r2-usability §3c / §4 冲突 1):WCAG 2.2.1 的「可关」。
 *
 * 默认关:快审与案卷台照旧 ⌘⏎ 一下落印、5 秒撤回条(到点才发)。打开后这两处的 ⌘⏎ 改开一层回读 —— 人名、案号、判决 ——
 * 没有计时;按层里的「落印」当场提交,不再走撤回窗口。层里不接 ⌘⏎(连按两下 ⌘⏎ 不读也过,正是审判台确认层被评审抓到的那一条),
 * 打开时焦点在右上角的关闭键上,不在「落印」上。审判台整页本来就有确认层,不受这个开关管。
 *
 * 存在本浏览器的 localStorage,与「单字母快捷键」总开关(`lib/hotkeys.ts`)同一种做法;服务端偏好是另一条后端改动。
 * 官员 App 的同一个开关在 `mobile-officer/src/prefs.tsx`(那边的存储是设备上的 persistent)。
 */
export const SEAL_READBACK_STORAGE_KEY = "soulledger_seal_readback";
const listeners = new Set<() => void>();

export function sealReadbackEnabled(): boolean {
  try {
    return localStorage.getItem(SEAL_READBACK_STORAGE_KEY) === "on";
  } catch {
    return false;
  }
}

export function setSealReadback(on: boolean): void {
  try {
    if (on) localStorage.setItem(SEAL_READBACK_STORAGE_KEY, "on");
    else localStorage.removeItem(SEAL_READBACK_STORAGE_KEY);
  } catch {
    // 存储被禁:记不住,开关不生效,也不报错。
  }
  listeners.forEach((fn) => fn());
}

export function useSealReadback(): boolean {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    sealReadbackEnabled,
    () => false,
  );
}

/** 「我的」页上的开关(与单字母快捷键同一节)。 */
export function SealReadbackToggle() {
  const { t } = useI18n();
  const on = useSealReadback();
  return (
    <label className="flex items-start gap-2 text-sm text-[oklch(var(--color-ink))]">
      <input type="checkbox" className="mt-1" checked={on} onChange={(e) => setSealReadback(e.target.checked)} data-testid="seal-readback-toggle" />
      <span>
        {t("judgment.seal_readback.pref")}
        <span className="block text-xs text-[oklch(var(--color-ink-muted))]">{t("judgment.seal_readback.pref_hint")}</span>
      </span>
    </label>
  );
}

export interface SealReadbackItem {
  name: string;
  caseNumber: string;
  verdict: string;
  civilization?: string | null;
}

/**
 * 回读层:念出这一印落在谁身上、哪一案、什么判决。没有计时。按钮次序是「取消 · 落印」,焦点由弹层放在第一个可聚焦处
 * (标题栏的关闭键),所以 ↵ / 空格不会顺手落印。
 */
export function SealReadbackDialog({
  item,
  pending = false,
  onCancel,
  onConfirm,
}: {
  item: SealReadbackItem | null;
  pending?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useI18n();
  return (
    <Modal
      isOpen={item !== null}
      onClose={onCancel}
      title={t("judgment.seal_readback.title")}
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCancel} disabled={pending} data-testid="seal-readback-cancel">
            {t("common.cancel")}
          </Button>
          <Button type="button" variant="primary" onClick={onConfirm} loading={pending} data-testid="seal-readback-confirm">
            {t("caseDesk.dossier.judge.seal")}
          </Button>
        </div>
      }
    >
      {item ? (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm" data-testid="seal-readback">
          <dt className="text-[oklch(var(--color-ink-muted))]">{t("judgment.seal_readback.soul")}</dt>
          <dd className="m-0 font-semibold" data-testid="seal-readback-name">
            {item.name}
          </dd>
          <dt className="text-[oklch(var(--color-ink-muted))]">{t("judgment.seal_readback.case")}</dt>
          <dd className="m-0 font-mono tabular-nums" data-testid="seal-readback-case">
            {item.caseNumber}
          </dd>
          <dt className="text-[oklch(var(--color-ink-muted))]">{t("judgment.seal_readback.verdict")}</dt>
          <dd className="m-0 font-semibold" data-testid="seal-readback-verdict">
            <DomainEnum namespace={verdictNamespace(t, item.civilization ?? undefined, item.verdict)} value={item.verdict} />
          </dd>
          <dd className="col-span-2 m-0 pt-2 text-xs text-[oklch(var(--color-ink-muted))]">{t("judgment.seal_readback.note")}</dd>
        </dl>
      ) : null}
    </Modal>
  );
}
