"use client";

import { useRef, useSyncExternalStore } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { useI18n } from "@/src/contexts/I18nContext";
import { Button } from "@/src/components/ui/Button";
import { DomainEnum } from "@/src/components/ui/DomainValue";
import { verdictNamespace } from "@/src/lib/domainNames";
import { useHotkeys } from "@/src/lib/hotkeys";
import s from "./sealReadback.module.css";

/**
 * 偏好「落印前先确认」(2026-11-14 用户决定,review-r2-usability §3c / §4 冲突 1):WCAG 2.2.1 的「可关」。
 *
 * 默认关:快审与案卷台照旧 ⌘⏎ 一下落印、5 秒撤回条(到点才发)。打开后这两处的 ⌘⏎ 改开一层回读 —— 人名、案号、判决 ——
 * 没有计时;按层里的「落印」或 ⌘⏎ 当场提交,不再走撤回窗口(第四十六批第 8 条:⌘⏎ 是层里唯一能落印的键;此前层里不接 ⌘⏎,
 * 防连按两下不读也过 —— 那一条现在只靠「开层的那一下不算」与按住不连发,见 `SealReadbackDialog`)。
 * 打开时焦点在「返回」上,不在「落印」上。审判台整页本来就有确认层,不受这个开关管。
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
 * 回读层(第四十六批第一节第 8 条):念出这一印落在谁身上、哪一案、什么判决。居中 440 宽、圆角 12,衬线标题;
 * 三行用卷宗字号,判决最大(`--readback-*`)。没有计时,不自动关闭。
 * 键位:默认焦点在「返回」(描边),所以 ↵ / 空格是返回;Esc 返回;⌘⏎ 是唯一能落印的键(层开着时快审 / 案卷台
 * 自己的 ⌘⏎ 不接,开层的那一下不会顺手落下 —— 监听在层打开之后才挂上)。也可以点「落印」(墨色实底)。
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
  const back = useRef<HTMLButtonElement>(null);
  useHotkeys({ "mod+Enter": onConfirm }, item !== null && !pending);
  return (
    <Dialog.Root
      open={item !== null}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop
          data-motion="fade"
          className="fixed inset-0 z-dialog bg-[oklch(var(--color-scrim)/var(--scrim-alpha))] transition-opacity duration-base ease-enter data-ending-style:duration-close data-ending-style:ease-exit data-ending-style:opacity-0 data-starting-style:opacity-0"
        />
        <Dialog.Viewport className="fixed inset-0 z-dialog flex items-center justify-center p-4">
          <Dialog.Popup
            data-motion="fade"
            initialFocus={back}
            className={`${s.panel} shadow-overlay transition-[opacity,translate] duration-base ease-enter data-ending-style:duration-close data-ending-style:ease-exit data-ending-style:opacity-0 data-ending-style:translate-y-3 data-starting-style:opacity-0 data-starting-style:translate-y-3`}
          >
            <Dialog.Title className={s.title}>{t("judgment.seal_readback.title")}</Dialog.Title>
            {item ? (
              <dl className={s.rows} data-testid="seal-readback">
                <div>
                  <dt>{t("judgment.seal_readback.soul")}</dt>
                  <dd data-testid="seal-readback-name">{item.name}</dd>
                </div>
                <div>
                  <dt>{t("judgment.seal_readback.case")}</dt>
                  <dd className={s.caseNo} data-testid="seal-readback-case">
                    {item.caseNumber}
                  </dd>
                </div>
                <div>
                  <dt>{t("judgment.seal_readback.verdict")}</dt>
                  <dd className={s.verdict} data-testid="seal-readback-verdict">
                    <DomainEnum namespace={verdictNamespace(t, item.civilization ?? undefined, item.verdict)} value={item.verdict} />
                  </dd>
                </div>
              </dl>
            ) : null}
            <p className={s.note}>{t("judgment.seal_readback.note")}</p>
            <div className={s.buttons}>
              <Button ref={back} type="button" variant="secondary" className={s.back} onClick={onCancel} disabled={pending} data-testid="seal-readback-cancel">
                {t("judgment.seal_readback.back")}
              </Button>
              <Button type="button" variant="primary" onClick={onConfirm} loading={pending} aria-keyshortcuts="Meta+Enter Control+Enter" data-testid="seal-readback-confirm">
                {t("caseDesk.dossier.judge.seal")}
              </Button>
            </div>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
