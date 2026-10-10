"use client";

import { useState } from "react";
import type { DispatchRecord } from "@soulledger/core/api/dispatch";
import { useCancelDispatch } from "@soulledger/core/hooks/useDispatchDrafts";
import { useI18n } from "@/src/contexts/I18nContext";
import { useTenant } from "@/src/contexts/TenantContext";
import { useToast } from "@/src/contexts/ToastContext";
import { usePermissions } from "@/src/hooks/usePermissions";
import { Button } from "@/src/components/ui/Button";
import { TextAreaField } from "@/src/components/ui/Field";
import { BaseModal } from "@/src/components/ui/Modal";

/**
 * 「取消移交」:发起方在对方批准之前撤回自己的提案(2026-10-11 用户决定)。
 *
 * 只给能成功的人:这个提案**是本殿发起的**(或 ADMIN)、状态还是 PROPOSED、持有 `dispatch.manage`
 * (与发起同一个码);其余一律什么都不渲染 —— 不显示禁用而没有说明的按钮。服务端再判一次:
 * 对方在这期间批准了,答 409 `not_cancellable`,这里说清「对方已经处理了」而不是笼统的失败。
 * 理由必填(按钮在输入框为空时不可点)。
 */
export function CancelDispatchButton({
  dispatch,
  size = "md",
  triggerClassName,
  onCancelled,
}: {
  dispatch: Pick<DispatchRecord, "id" | "status" | "source_tenant_code" | "soul_name">;
  size?: "sm" | "md";
  /** In a `linkedRows` table the trigger has to sit above the row link's overlay (`relative z-10`). */
  triggerClassName?: string;
  onCancelled?: () => void;
}) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const { user } = useTenant();
  const { hasPermission, isAdmin } = usePermissions();
  const cancel = useCancelDispatch();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");

  const ownHall = isAdmin || (!!user?.tenant?.code && user.tenant.code === dispatch.source_tenant_code);
  if (dispatch.status !== "PROPOSED" || !ownHall || !hasPermission("dispatch.manage")) return null;

  const close = () => {
    setOpen(false);
    setReason("");
  };
  const submit = () =>
    cancel.mutate(
      { id: dispatch.id, reason: reason.trim() },
      {
        onSuccess: () => {
          close();
          showToast(t("dispatch.cancel_success"), "success");
          onCancelled?.();
        },
        onError: (err: unknown) => {
          const code = (err as { response?: { data?: { code?: string } } })?.response?.data?.code;
          setOpen(false);
          showToast(t(code === "not_cancellable" ? "dispatch.cancel_not_cancellable" : "dispatch.cancel_error"), "error");
        },
      },
    );

  return (
    <>
      <Button
        type="button"
        size={size}
        variant="secondary"
        className={triggerClassName}
        onClick={() => setOpen(true)}
        data-testid="cancel-dispatch"
      >
        {t("dispatch.cancel_dispatch")}
      </Button>
      <BaseModal
        isOpen={open}
        onClose={close}
        title={t("dispatch.cancel_title")}
        footer={
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={close}>
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={submit}
              loading={cancel.isPending}
              disabled={!reason.trim()}
            >
              {t("dispatch.confirm_cancel")}
            </Button>
          </div>
        }
      >
        <p className="mb-3 text-sm text-[oklch(var(--color-ink-muted))]">{t("dispatch.cancel_warning")}</p>
        <TextAreaField
          label={t("dispatch.cancel_reason")}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          placeholder={t("dispatch.cancel_placeholder")}
        />
      </BaseModal>
    </>
  );
}
