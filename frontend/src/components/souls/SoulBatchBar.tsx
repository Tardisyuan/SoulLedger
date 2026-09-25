"use client";

import { useEffect, useState } from "react";
import { useBatchRecycleSouls } from "@soulledger/core/hooks/useSouls";
import { soulBatchRecycleErrorOf, type SoulBatchRecycleError, type SoulListItem } from "@soulledger/core/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { Button } from "@/src/components/ui/Button";
import { Modal } from "@/src/components/ui/Modal";
import type { DataTableSelection } from "@/components/ui/data-table";

/**
 * 规范 v1 §3.1「有接口」:/souls 的批量条 —— 已选 N · 移入回收站 · 取消选择。
 *
 * THE SELECTION BELONGS TO ONE QUERY. It is stored next to the key of the
 * query it was made on (`queryKey`: page, filters, sort), read back as empty
 * whenever the key on screen differs, and reset in that same render. So a page
 * turn or a filter change clears it by construction, not by an effect that
 * could run a render late: a box ticked on page 1 must never ride along into a
 * recycle issued from page 2, nor reappear on the way back.
 *
 * Names are captured at tick time, not looked up at refusal time: a refused id
 * is precisely one that may have vanished from the list by the time the 404
 * comes back, and the operator has to be told *which soul* in words.
 */
export function useSoulSelection(queryKey: string, souls: SoulListItem[]) {
  const { t } = useI18n();
  const [state, setState] = useState<{ key: string; names: Map<string, string> }>({
    key: queryKey,
    names: new Map(),
  });
  // A different question on screen: drop the old selection for good, not just
  // hide it — otherwise turning back to page 1 would bring page 1's ticks back.
  // (setState during render is React's own pattern for state derived from a
  // prop change; it re-renders before committing.)
  if (state.key !== queryKey) setState({ key: queryKey, names: new Map() });
  const names = state.key === queryKey ? state.names : new Map<string, string>();

  const set = (next: Map<string, string>) => setState({ key: queryKey, names: next });
  const clear = () => set(new Map());

  const tableSelection: DataTableSelection<SoulListItem> = {
    selected: new Set(names.keys()),
    onToggle: (key, soul, checked) => {
      const next = new Map(names);
      if (checked) next.set(key, soul.name);
      else next.delete(key);
      set(next);
    },
    onToggleAll: (checked) => {
      const next = new Map(names);
      for (const soul of souls) {
        if (checked) next.set(String(soul.id), soul.name);
        else next.delete(String(soul.id));
      }
      set(next);
    },
    rowLabel: (soul) => t("souls.batch.select_row", { name: soul.name }),
    allLabel: t("souls.batch.select_all"),
  };

  return { names, clear, tableSelection };
}

export type SoulSelection = ReturnType<typeof useSoulSelection>;

/** Is a dialog (the preview drawer, a confirm) open? Esc belongs to it then. */
function dialogIsOpen() {
  return document.querySelector('[role="dialog"], [role="alertdialog"]') !== null;
}

export function SoulBatchBar({ selection }: { selection: SoulSelection }) {
  const { t } = useI18n();
  const recycle = useBatchRecycleSouls();
  const [confirming, setConfirming] = useState(false);
  const [refusal, setRefusal] = useState<SoulBatchRecycleError | null>(null);
  const count = selection.names.size;

  // 「取消选择 · Esc」. Not while typing, and not while a dialog owns Esc.
  useEffect(() => {
    if (count === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || dialogIsOpen()) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))) return;
      selection.clear();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [count, selection]);

  if (count === 0 && !confirming) return null;

  const close = () => {
    if (recycle.isPending) return;
    setConfirming(false);
    setRefusal(null);
  };

  const submit = () => {
    setRefusal(null);
    recycle.mutate(
      { ids: [...selection.names.keys()] },
      {
        onSuccess: () => {
          setConfirming(false);
          selection.clear();
        },
        // All or nothing: on a refusal NOTHING was recycled, so the selection
        // stays exactly as it was and the dialog stays open to say why.
        onError: (error) => setRefusal(soulBatchRecycleErrorOf(error)),
      }
    );
  };

  return (
    <>
      <div
        role="region"
        aria-label={t("souls.batch.region")}
        className="sticky bottom-0 z-10 mt-3 flex flex-wrap items-center gap-3 border-t border-[oklch(var(--color-block))] bg-[oklch(var(--color-canvas))] px-4 py-2"
      >
        <span className="font-mono text-xs text-[oklch(var(--color-ink))]" aria-live="polite">
          {t("souls.batch.selected", { n: String(count) })}
        </span>
        <span className="flex-1" />
        <Button type="button" variant="danger" size="sm" onClick={() => setConfirming(true)} disabled={count === 0}>
          {t("souls.detail.confirm_delete_action")}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={selection.clear}>
          {t("souls.batch.clear")}
          <span aria-hidden="true" className="ml-1 font-mono text-2xs text-[oklch(var(--color-ink-subtle))]">· Esc</span>
        </Button>
      </div>

      <Modal
        isOpen={confirming}
        onClose={close}
        title={t("souls.batch.confirm_title", { n: String(count) })}
        footer={
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={close} disabled={recycle.isPending}>
              {t("common.cancel")}
            </Button>
            <Button type="button" variant="danger" onClick={submit} loading={recycle.isPending}>
              {t("souls.detail.confirm_delete_action")}
            </Button>
          </div>
        }
      >
        <p className="text-sm text-[oklch(var(--color-ink-muted))]">{t("souls.detail.delete_confirm_message")}</p>
        {refusal && (
          <div role="alert" className="mt-4 border-l-2 border-[oklch(var(--color-danger))] bg-[oklch(var(--color-danger-tint))] px-3 py-2 text-sm">
            <p className="text-[oklch(var(--color-danger))]">
              <span aria-hidden="true">! </span>
              {t("souls.batch.refused_title", { n: String(refusal.ids.length) })}
            </p>
            <p className="mt-1 text-xs text-[oklch(var(--color-ink-muted))]">
              {t(`souls.batch.refused_reason.${refusal.code}`)}
            </p>
            <ul className="mt-2 space-y-0.5" aria-label={t("souls.batch.refused_list")}>
              {refusal.ids.map((id) => {
                const name = selection.names.get(id);
                return (
                  <li key={id} className="text-[oklch(var(--color-ink))]">
                    {name ?? <span className="font-mono text-xs">{id}</span>}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </Modal>
    </>
  );
}
