"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { notificationsApi } from "@soulledger/core/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { Button } from "@/src/components/ui/Button";
import { ConfirmDialog } from "@/src/components/ui/Modal";
import { BATCH_BAR } from "@/components/ui/data-table";

/** 批量一次至多多少条:与后端 `NOTIFICATION_BATCH_MAX` 同一个数,勾选超过它就不再往上加。 */
export const NOTIFICATION_BATCH_MAX = 100;

/**
 * /notifications 的批量条(规范 v1 §3.1,照 `SoulBatchBar`):已选 N · 标为已读 · 删除… · 取消选择。
 * 选中后才出现;「全部已读」另在页头,不需要先选。移交、处置不在这里 —— 通知只有这两种批量。
 *
 * 数以服务端回的为准(`marked_read` / `deleted`):别人的、已不存在的 id 混在里面时后端不报错也不动它,
 * 条上说的是真正处理的条数,不是勾了几条。删除先问一句。两种操作之后都由调用方
 * 失效刷新列表与外壳角标(`onDone`)。
 */
export function NotificationBatchBar({
  ids,
  onClear,
  onDone,
}: {
  ids: string[];
  onClear: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const [confirming, setConfirming] = useState(false);

  const read = useMutation({
    mutationFn: () => notificationsApi.batchRead(ids),
    onSuccess: (res) => {
      onDone();
      onClear();
      showToast(t("notifications.mark_all_success", { count: String(res.data.marked_read) }), "success");
    },
    onError: () => showToast(t("notifications.mark_read_error"), "error"),
  });
  const remove = useMutation({
    mutationFn: () => notificationsApi.batchDelete(ids),
    onSuccess: (res) => {
      setConfirming(false);
      onDone();
      onClear();
      showToast(t("notifications.batch_deleted", { count: String(res.data.deleted) }), "success");
    },
    onError: () => {
      setConfirming(false);
      showToast(t("notifications.batch_delete_error"), "error");
    },
  });

  if (ids.length === 0 && !confirming) return null;
  const busy = read.isPending || remove.isPending;

  return (
    <>
      <div
        role="region"
        aria-label={t("notifications.batch_region")}
        className={`sticky bottom-(--bottom-bar) z-10 mt-3 flex flex-wrap items-center gap-3 shadow-raised border-t border-[oklch(var(--color-block))] ${BATCH_BAR} px-4 py-2`}
      >
        <span className="font-mono text-xs" aria-live="polite">
          {t("notifications.batch_selected", { n: String(ids.length) })}
          {ids.length >= NOTIFICATION_BATCH_MAX && ` · ${t("notifications.batch_limit", { n: String(NOTIFICATION_BATCH_MAX) })}`}
        </span>
        <span className="flex-1" />
        <Button type="button" variant="inverse" size="sm" onClick={() => read.mutate()} loading={read.isPending} disabled={busy}>
          {t("notifications.mark_read")}
        </Button>
        <Button type="button" variant="inverse" size="sm" onClick={() => setConfirming(true)} disabled={busy}>
          {t("common.delete")}
        </Button>
        <Button type="button" variant="inverse" size="sm" onClick={onClear} disabled={busy}>
          {t("notifications.batch_clear")}
        </Button>
      </div>
      <ConfirmDialog
        isOpen={confirming}
        title={t("notifications.batch_delete_title", { n: String(ids.length) })}
        message={t("notifications.batch_delete_message")}
        confirmText={t("common.delete")}
        confirmLoading={remove.isPending}
        onConfirm={() => remove.mutate()}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}
