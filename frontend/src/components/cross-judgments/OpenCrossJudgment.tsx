"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { crossTenantJudgmentsApi } from "@soulledger/core/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { Button } from "@/src/components/ui/Button";
import { BaseModal } from "@/src/components/ui/Modal";
import { TextAreaField, TextField } from "@/src/components/ui/Field";

function errorText(error: unknown): string | null {
  const data = (error as { response?: { data?: Record<string, unknown> } })?.response?.data;
  // DRF field errors arrive as `{judgment: ["…"]}`; the view's own refusals as `{error: "…"}`.
  const first = data?.error ?? Object.values(data ?? {})[0];
  const text = Array.isArray(first) ? first[0] : first;
  return typeof text === "string" ? text : null;
}

/**
 * 在原审判上开联审(设计稿 §2.1、Q1、Q12):联审挂到这份审判,外地各站在联审里定。
 *
 * 按钮给谁由审判页判(原属、`cross_judgment.create`、ORIGINAL、未结案);服务端
 * `CrossTenantJudgmentSerializer.validate_judgment` 再判一次,并拒绝「这份审判已有联审」——
 * 那句英文原样显示,因为它没有码。建好后去联审详情页请各方入席。
 */
export function OpenCrossJudgment({ judgmentId, soulName }: { judgmentId: string; soulName: string }) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  const create = useMutation({
    mutationFn: () =>
      crossTenantJudgmentsApi
        .create({ title: title.trim(), description: description.trim(), judgment: judgmentId })
        .then((r) => r.data),
    onSuccess: (created) => {
      setOpen(false);
      showToast(t("sentence_plan.cross.opened"), "success");
      queryClient.invalidateQueries({ queryKey: ["cross-judgments"] });
      router.push(`/cross-judgments/${created.id}`);
    },
    onError: (error) => showToast(errorText(error) ?? t("sentence_plan.cross.open_error"), "error"),
  });

  return (
    <>
      <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(true)}>
        {t("sentence_plan.cross.open")}
      </Button>
      <BaseModal
        isOpen={open}
        onClose={() => setOpen(false)}
        title={t("sentence_plan.cross.open_title", { soul: soulName })}
        footer={
          <div className="flex gap-3 justify-end">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              variant="primary"
              loading={create.isPending}
              disabled={!title.trim() || !description.trim()}
              onClick={() => create.mutate()}
            >
              {t("sentence_plan.cross.open")}
            </Button>
          </div>
        }
      >
        <p className="text-03 text-[oklch(var(--color-ink-muted))] mb-3">{t("sentence_plan.cross.open_hint")}</p>
        <div className="space-y-3">
          <TextField
            label={t("sentence_plan.cross.title_label")}
            value={title}
            maxLength={200}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
          <TextAreaField
            label={t("sentence_plan.cross.description_label")}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            required
          />
        </div>
      </BaseModal>
    </>
  );
}
