"use client";

import { useState } from "react";
import type { ArchiveFields } from "@soulledger/core/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { Button } from "@/src/components/ui/Button";
import { Modal } from "@/src/components/ui/Modal";
import { TextAreaField } from "@/src/components/ui/Field";

/**
 * 归档的共用件(第三十四批 W-2):详情页顶部横条与归档对话框。
 * 灵魂、审判、处置三类记录同一套字。
 */

/**
 * 详情页顶部横条:谁在哪天归档、理由,右边「取消归档」(取消归档的**唯一**入口)。
 * 没给 `onUnarchive` 就不画按钮(没有权限)。不加 ⚠、不用红色:归档是可撤回的。
 */
export function ArchiveBanner({
  record,
  onUnarchive,
  pending,
}: {
  record: ArchiveFields;
  onUnarchive?: () => void;
  pending?: boolean;
}) {
  const { t, formatDate } = useI18n();
  if (!record.is_archived) return null;
  return (
    <div
      role="status"
      data-testid="archive-banner"
      className="mb-4 flex flex-wrap items-center justify-between gap-3 border border-[oklch(var(--color-line-strong))] bg-[oklch(var(--color-surface-2))] px-4 py-3 text-sm"
    >
      <div className="min-w-0">
        <p className="text-[oklch(var(--color-ink))]">
          <span aria-hidden="true">□ </span>
          {t("records.archive.banner", {
            // Inside a sentence a dash cannot say which kind of missing it is; the words can.
            date: record.archived_at ? formatDate(record.archived_at) : t("common.value.unrecorded"),
            name: record.archived_by_name || t("common.value.unrecorded"),
          })}
        </p>
        {record.archive_reason ? (
          <p className="text-[oklch(var(--color-ink-muted))]">
            {t("officer_app.dispatch_status.reason", { reason: record.archive_reason })}
          </p>
        ) : null}
        <p className="text-xs text-[oklch(var(--color-ink-subtle))]">{t("records.archive.read_only")}</p>
      </div>
      {onUnarchive && (
        <Button type="button" variant="secondary" onClick={onUnarchive} loading={pending}>
          {t("records.archive.unarchive")}
        </Button>
      )}
    </div>
  );
}

/** 归档对话框:理由选填,会记进审计日志。 */
export function ArchiveDialog({
  isOpen,
  name,
  onClose,
  onConfirm,
  isPending,
}: {
  isOpen: boolean;
  name: string;
  onClose: () => void;
  onConfirm: (reason: string) => void;
  isPending: boolean;
}) {
  const { t } = useI18n();
  const [reason, setReason] = useState("");
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t("records.archive.title", { name })}
      footer={
        <div className="flex justify-end gap-3">
          <Button type="button" variant="ghost" onClick={onClose} disabled={isPending}>
            {t("common.cancel")}
          </Button>
          <Button type="button" variant="primary" onClick={() => onConfirm(reason.trim())} loading={isPending}>
            {t("records.archive.confirm")}
          </Button>
        </div>
      }
    >
      <TextAreaField
        label={t("records.archive.reason")}
        value={reason}
        maxLength={500}
        rows={3}
        onChange={(e) => setReason(e.target.value)}
      />
    </Modal>
  );
}
