"use client";

import { useState } from "react";
import type { User } from "@soulledger/core/api";
import { useBatchSetUsersActive } from "@soulledger/core/hooks/useUsers";
import { useI18n } from "@/src/contexts/I18nContext";
import { showToast } from "@/src/components/ui/Toast";
import { Button } from "@/src/components/ui/Button";
import { BATCH_BAR, type DataTableSelection } from "@/components/ui/data-table";

/**
 * /users 的批量条:已选 N · 启用所选 · 停用所选 · 取消选择。仅管理员(页面按 `user.manage` 才挂载)。
 *
 * 选择属于一次查询:和选择一起存下那次查询的键,键变了(翻页 / 筛选 / 排序)就当场读成空
 * —— 不靠 effect,同 `useSoulSelection`。服务端批量不碰管理员账号与调用者自己,
 * 所以返回的行数可能小于所选数;条上常驻一句说明,不替操作员猜。
 */
export function useUserSelection(queryKey: string, users: User[]) {
  const { t } = useI18n();
  const [state, setState] = useState<{ key: string; ids: Set<string> }>({ key: queryKey, ids: new Set() });
  if (state.key !== queryKey) setState({ key: queryKey, ids: new Set() });
  const ids = state.key === queryKey ? state.ids : new Set<string>();
  const set = (next: Set<string>) => setState({ key: queryKey, ids: next });

  const tableSelection: DataTableSelection<User> = {
    selected: ids,
    onToggle: (key, _user, checked) => {
      const next = new Set(ids);
      if (checked) next.add(key);
      else next.delete(key);
      set(next);
    },
    onToggleAll: (checked) => {
      const next = new Set(ids);
      for (const u of users) {
        if (checked) next.add(String(u.id));
        else next.delete(String(u.id));
      }
      set(next);
    },
    rowLabel: (u) => t("users.batch.select_row", { name: u.username }),
    allLabel: t("users.batch.select_all"),
  };
  return { ids, clear: () => set(new Set()), tableSelection };
}

export type UserSelection = ReturnType<typeof useUserSelection>;

export function UserBatchBar({ selection }: { selection: UserSelection }) {
  const { t } = useI18n();
  const batch = useBatchSetUsersActive();
  const count = selection.ids.size;
  if (count === 0) return null;

  const run = (active: boolean) =>
    batch.mutate(
      { ids: [...selection.ids], active },
      {
        onSuccess: (result) => {
          showToast(t("users.batch.done", { n: String(result.updated) }), "success");
          selection.clear();
        },
        onError: () => showToast(t("users.batch.failed"), "error"),
      }
    );

  return (
    <div
      role="region"
      aria-label={t("users.batch.region")}
      className={`sticky bottom-(--bottom-bar) z-10 mt-3 flex flex-wrap items-center gap-3 shadow-raised border-t border-[oklch(var(--color-block))] ${BATCH_BAR} px-4 py-2`}
    >
      <span className="font-mono text-xs" aria-live="polite">
        {t("users.batch.selected", { n: String(count) })}
      </span>
      <span className="text-xs">{t("users.batch.skipped_note")}</span>
      <span className="flex-1" />
      <Button type="button" variant="inverse" size="sm" onClick={() => run(true)} disabled={batch.isPending}>
        {t("users.batch.activate")}
      </Button>
      <Button type="button" variant="inverse" size="sm" onClick={() => run(false)} disabled={batch.isPending}>
        {t("users.batch.deactivate")}
      </Button>
      <Button type="button" variant="inverse" size="sm" onClick={selection.clear} disabled={batch.isPending}>
        {t("users.batch.clear")}
      </Button>
    </div>
  );
}
