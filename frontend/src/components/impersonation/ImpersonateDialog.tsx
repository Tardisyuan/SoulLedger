"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { User } from "@soulledger/core/api";
import { startImpersonation } from "@soulledger/core/api/impersonation";
import { useI18n } from "@/src/contexts/I18nContext";
import { BaseModal } from "@/src/components/ui/Modal";
import { Button } from "@/src/components/ui/Button";
import { TextAreaField } from "@/src/components/ui/Field";
import { showToast } from "@/src/components/ui/Toast";

/**
 * 「以此人身份查看」的确认弹层(Design 第二十八批 W6):复用批准确认的「写理由」版式 —— 理由必填,
 * 正文说明只读与时限,另一行说明对方会收到通知、整个过程进审计。开始后整页重载到首页:
 * 被看者的缓存、菜单与权限全部按新令牌重新取。
 */
export function ImpersonateDialog({ user, onClose }: { user: User; onClose: () => void }) {
  const { t } = useI18n();
  const [reason, setReason] = useState("");
  const name = user.display_name || user.username;
  const start = useMutation({
    mutationFn: () => startImpersonation(user.id, reason.trim()),
    onSuccess: () => window.location.assign("/"),
    onError: () => showToast(t("admin.impersonate.failed"), "error"),
  });

  return (
    <BaseModal
      isOpen
      wide
      dismissOnOutsideClick={false}
      title={t("admin.impersonate.title", { name })}
      onClose={() => !start.isPending && onClose()}
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={start.isPending}>
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            variant="primary"
            data-testid="impersonate-start"
            disabled={reason.trim().length === 0 || start.isPending}
            loading={start.isPending}
            onClick={() => start.mutate()}
          >
            {t("admin.impersonate.start")}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4 text-sm text-[oklch(var(--color-ink))]">
        <p className="m-0">{t("admin.impersonate.body")}</p>
        <TextAreaField
          label={t("admin.impersonate.reason_label")}
          rows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={200}
          required
          disabled={start.isPending}
        />
        <p className="m-0 text-xs text-[oklch(var(--color-ink-muted))]">
          {t("admin.impersonate.notice", { name })} {t("admin.impersonate.audit_note")}
        </p>
      </div>
    </BaseModal>
  );
}
