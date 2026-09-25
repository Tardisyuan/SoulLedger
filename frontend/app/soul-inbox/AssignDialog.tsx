"use client";

import { useState } from "react";
import type { InboxConversation } from "@soulledger/core/api/soul-inbox";
import { useInboxAssign, useInboxAssignable } from "@soulledger/core/hooks/useSoulInbox";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { Modal } from "@/src/components/ui/Modal";
import { Button } from "@/src/components/ui/Button";
import { SelectField } from "@/src/components/ui/Field";

/*
 * 「标给同僚」(backend `OfficerInboxViewSet.assign`)。信不换殿:名单是这封信的收件殿司里能回信的
 * 在职官员(`assignable/`),服务端按同一条规则再核一次,不在名单里的人答 400 `invalid_assignee`。
 * 被标给的人收到官员通知;经办人是殿司共享的,线程头上人人看得见。
 */
export function AssignDialog({ conversation, onClose }: { conversation: InboxConversation | null; onClose: () => void }) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const officers = useInboxAssignable(conversation?.id ?? null);
  const assign = useInboxAssign();
  const [picked, setPicked] = useState("");
  const rows = officers.data ?? [];
  const current = conversation?.assignee?.user_id;
  const choice = picked || (rows.find((o) => o.user_id !== current)?.user_id.toString() ?? "");

  const submit = () => {
    if (!conversation || !choice) return;
    const name = rows.find((o) => String(o.user_id) === choice)?.display_name ?? "";
    assign.mutate(
      { id: conversation.id, userId: Number(choice) },
      {
        onSuccess: () => {
          showToast(t("soul_inbox.assign.done", { name }), "success");
          setPicked("");
          onClose();
        },
        onError: (error) => {
          const code = (error as { response?: { data?: { code?: unknown } } })?.response?.data?.code;
          showToast(typeof code === "string" ? t(`soul_inbox.errors.${code}`) : t("soul_inbox.failed"), "error");
        },
      }
    );
  };

  return (
    <Modal
      isOpen={conversation !== null}
      onClose={onClose}
      title={t("soul_inbox.assign.title")}
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={assign.isPending}>
            {t("common.cancel")}
          </Button>
          <Button type="button" variant="primary" onClick={submit} loading={assign.isPending} disabled={!choice}>
            {t("soul_inbox.assign.confirm")}
          </Button>
        </div>
      }
    >
      {officers.isSuccess && rows.length === 0 ? (
        <p className="text-sm text-[oklch(var(--color-ink-muted))]">{t("soul_inbox.assign.none")}</p>
      ) : (
        <SelectField
          label={t("soul_inbox.assign.to")}
          description={t("soul_inbox.assign.hint")}
          value={choice}
          onChange={(e) => setPicked(e.target.value)}
          options={rows.map((o) => ({ value: String(o.user_id), label: o.display_name }))}
        />
      )}
    </Modal>
  );
}
