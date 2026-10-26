"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  handoverApi,
  handoverProblemsOf,
  officerRefusalOf,
  usersApi,
  type HandoverPreview,
  type HandoverResult,
  type User,
} from "@soulledger/core/api";
import { userKeys } from "@soulledger/core/query_keys";
import { useI18n } from "@/src/contexts/I18nContext";
import { BaseModal } from "@/src/components/ui/Modal";
import { Button } from "@/src/components/ui/Button";
import { SelectField } from "@/src/components/ui/Field";

/** 预览里一共有几件会动:申诉退回待复核的那几件也算(它们换了复核人,只是清空)。 */
export function previewTotal(p: HandoverPreview): number {
  return p.judgments + p.appeals + p.appeals_returned_to_pool + p.city_gods.length + p.letters;
}

const name = (u: Pick<User, "username" | "display_name">) => u.display_name || u.username;

/**
 * 「移交在途案件」(第五十四批 H-1 ~ H-4):对话框。选好交出人与接手人就自动预览(没有「预览」按钮),
 * 任一人改了,旧预览丢掉重新取。预览四类各占一行、0 也写;回到待复核池的申诉写在申诉那一行下面;
 * 有 `problems`(或提交时真收到 409)= 少见的真阻断,danger 框、接手人描红、提交置灰;全 0 = `empty`、提交置灰。
 * 提交按钮写总件数。结果写实际件数:比预览少才有 `result_fewer`,有申诉回池才有 `result_pool`。
 */
export function OfficerHandoverDialog({ from, onClose }: { from: User; onClose: () => void }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [fromId, setFromId] = useState(from.id);
  const [toId, setToId] = useState<number | null>(null);
  const [result, setResult] = useState<{ done: HandoverResult; planned: number; to: string } | null>(null);
  const [blocked, setBlocked] = useState<HandoverPreview["problems"] | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  // 本殿在职官员。后端另按殿与角色校验;这里只是不把不可能的人放进下拉。
  const officersQuery = useQuery({
    queryKey: [...userKeys.all, "handover-officers", from.tenant?.id ?? null],
    queryFn: async () => (await usersApi.list({ is_active: "true", page_size: 200 })).data.results,
  });
  const officers = (officersQuery.data ?? []).filter(
    (u) => u.role !== "SOUL" && u.is_active !== false && (u.tenant?.id ?? null) === (from.tenant?.id ?? null),
  );
  const source = officers.find((u) => u.id === fromId) ?? (fromId === from.id ? from : undefined);
  const target = officers.find((u) => u.id === toId);

  const previewQuery = useQuery({
    queryKey: ["officer-handover-preview", fromId, toId],
    queryFn: async () => (await handoverApi.preview(fromId, toId as number)).data,
    enabled: toId !== null && fromId !== toId,
    gcTime: 0,
    staleTime: 0,
    retry: false,
  });
  const preview = previewQuery.data;
  const previewCode = previewQuery.isError ? officerRefusalOf(previewQuery.error)?.code : undefined;
  const problems = blocked ?? preview?.problems ?? [];
  const total = preview ? previewTotal(preview) : 0;

  const commit = useMutation({
    mutationFn: async () => (await handoverApi.commit(fromId, toId as number)).data,
    onSuccess: (done) => {
      void queryClient.invalidateQueries({ queryKey: userKeys.all });
      setResult({ done, planned: total, to: target ? name(target) : "" });
    },
    onError: (error) => {
      const list = handoverProblemsOf(error);
      if (list) setBlocked(list);
      else setErrorCode(officerRefusalOf(error)?.code ?? "unknown");
    },
  });

  const pick = (setter: (id: number | null) => void) => (e: React.ChangeEvent<HTMLSelectElement>) => {
    setter(e.target.value ? Number(e.target.value) : null);
    setBlocked(null);
    setErrorCode(null);
  };
  const options = (skip: number | null) => [
    { value: "", label: t("officerHandover.pick") },
    ...officers.filter((u) => u.id !== skip).map((u) => ({ value: String(u.id), label: name(u) })),
  ];

  const box = "border px-3 py-2 text-sm";
  const row = (label: string, value: string | number, extra?: React.ReactNode) => (
    <li className="flex flex-col gap-0.5 border-t border-[oklch(var(--color-line))] py-2 first:border-t-0">
      <div className="flex justify-between gap-3">
        <span>{label}</span>
        <span className="font-mono">{value}</span>
      </div>
      {extra}
    </li>
  );
  const subNote = "text-xs text-[oklch(var(--color-ink-muted))]";

  const errorKey = errorCode ?? previewCode;
  const errorText = errorKey
    ? ["same_officer", "invalid_target", "not_found"].includes(errorKey)
      ? t(`officerHandover.error.${errorKey}`)
      : t("common.error")
    : previewQuery.isError
      ? t("common.error")
      : null;

  if (result) {
    const { done } = result;
    const actual = done.judgments + done.appeals + done.appeals_returned_to_pool + done.city_gods + done.letters;
    return (
      <BaseModal
        isOpen
        onClose={onClose}
        title={t("officerHandover.result_title", { name: result.to })}
        footer={
          <div className="flex justify-end">
            <Button type="button" variant="primary" onClick={onClose}>
              {t("common.close")}
            </Button>
          </div>
        }
      >
        <div role="status" className="flex flex-col gap-2 text-sm text-[oklch(var(--color-ink))]" data-testid="handover-result">
          <p className="font-mono">
            {t("officerHandover.result_counts", {
              judgments: String(done.judgments),
              appeals: String(done.appeals + done.appeals_returned_to_pool),
              city_gods: String(done.city_gods),
              letters: String(done.letters),
            })}
          </p>
          {done.appeals_returned_to_pool > 0 && (
            <p>{t("officerHandover.result_pool", { n: String(done.appeals_returned_to_pool) })}</p>
          )}
          {actual < result.planned && <p className={subNote}>{t("officerHandover.result_fewer")}</p>}
          <p className={subNote}>{t("officerHandover.result_notified", { name: result.to })}</p>
        </div>
      </BaseModal>
    );
  }

  const canSubmit = preview !== undefined && total > 0 && problems.length === 0 && !commit.isPending;

  return (
    <BaseModal
      isOpen
      onClose={() => !commit.isPending && onClose()}
      title={t("officerHandover.title")}
      dismissOnOutsideClick={false}
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={commit.isPending}>
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            variant="primary"
            data-testid="handover-submit"
            disabled={!canSubmit}
            loading={commit.isPending}
            onClick={() => commit.mutate()}
          >
            {commit.isPending ? t("officerHandover.submitting") : t("officerHandover.submit_n", { n: total })}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-[oklch(var(--color-ink-muted))]">{t("officerHandover.intro")}</p>
        <SelectField
          label={t("officerHandover.from")}
          value={String(fromId)}
          onChange={pick((id) => id !== null && setFromId(id))}
          options={[
            ...(officers.some((u) => u.id === from.id) ? [] : [{ value: String(from.id), label: name(from) }]),
            ...options(toId).slice(1),
          ]}
        />
        <SelectField
          label={t("officerHandover.to")}
          value={toId === null ? "" : String(toId)}
          onChange={pick(setToId)}
          error={problems.length > 0 ? t("officerHandover.blocked_title") : undefined}
          options={options(fromId)}
        />

        {problems.length > 0 && target && (
          <div role="alert" className={`${box} border-[oklch(var(--color-danger))] text-[oklch(var(--color-danger))]`} data-testid="handover-blocked">
            <p className="font-medium">
              <span aria-hidden="true">! </span>
              {t("officerHandover.blocked_title")}
            </p>
            <ul className="mt-1 list-none p-0">
              {problems.map((p) => (
                <li key={p}>{t(`officerHandover.problem.${p}`, { name: name(target) })}</li>
              ))}
            </ul>
          </div>
        )}
        {errorText && (
          <p role="alert" className="text-sm text-[oklch(var(--color-danger))]">
            <span aria-hidden="true">! </span>
            {errorText}
          </p>
        )}

        {previewQuery.isFetching && <p role="status" className={subNote}>{t("common.loading")}</p>}
        {preview && !previewQuery.isFetching && total === 0 && problems.length === 0 && (
          <p role="status" className="text-sm" data-testid="handover-empty">
            {t("officerHandover.empty", { name: source ? name(source) : "" })}
          </p>
        )}
        {preview && !previewQuery.isFetching && total > 0 && (
          <>
            <ul className="m-0 list-none border border-[oklch(var(--color-line))] px-3 text-sm" data-testid="handover-preview">
              {row(t("officerHandover.row_judgments"), preview.judgments)}
              {row(
                t("officerHandover.row_appeals"),
                preview.appeals + preview.appeals_returned_to_pool,
                preview.appeals_returned_to_pool > 0 ? (
                  <p className={subNote} data-testid="handover-pool">
                    {t("officerHandover.returned_to_pool", { n: String(preview.appeals_returned_to_pool) })}
                  </p>
                ) : null,
              )}
              {row(
                t("officerHandover.row_city_gods"),
                preview.city_gods.length,
                preview.city_gods.length > 0 ? (
                  <p className={subNote}>{t("officerHandover.row_city_gods_names", { names: preview.city_gods.join("、") })}</p>
                ) : null,
              )}
              {row(t("officerHandover.row_letters"), preview.letters)}
            </ul>
            <p className={subNote}>{t("officerHandover.may_shrink")}</p>
          </>
        )}
      </div>
    </BaseModal>
  );
}
