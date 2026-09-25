"use client";

import { useState } from "react";
import type { AssignableOfficer, JudgmentClaimRefusal } from "@soulledger/core/api";
import { useAssignableOfficers } from "@soulledger/core/hooks/useJudgments";
import { useI18n } from "@/src/contexts/I18nContext";
import { Modal } from "@/src/components/ui/Modal";
import { Button } from "@/src/components/ui/Button";
import { SelectField, TextAreaField } from "@/src/components/ui/Field";

/**
 * 认领一族(apps/judgment/claims.py)的两个弹层与一张拒绝码表。队列页的批量条和审判台的
 * D 键共用 —— 暂缓在两处是同一个动作、同一条「理由必填」,写两份就会有一份先漂。
 */

/** 服务端的稳定拒绝码(`JudgmentClaimRefusal.code`)。按码分支,不按 `error` 文案。 */
const REFUSAL_CODES = [
  "already_claimed",
  "not_claimed",
  "not_claimant",
  "not_pending",
  "already_deferred",
  "not_deferred",
  "invalid_assignee",
  "not_found",
  "permission_denied",
] as const;

type T = (key: string, params?: Record<string, string>) => string;

/** 一次被拒的认领 / 改派 / 暂缓,译成一句话。认不出的码落到通用句,不回显服务端英文。 */
export function claimRefusalMessage(err: unknown, t: T): string {
  const e = err as { response?: { status?: number; data?: Partial<JudgmentClaimRefusal> } };
  const code = e?.response?.data?.code;
  if (code && (REFUSAL_CODES as readonly string[]).includes(code)) return t(`judgment.claim.refused.${code}`);
  if (e?.response?.status === 403) return t("judgment.claim.refused.permission_denied");
  return t("judgment.claim.refused.generic");
}

/** 暂缓的理由上限,与 `JudgmentBatchPayload.reason` 的注释同一个数。 */
const REASON_MAX = 500;

/**
 * 一句必填的理由:暂缓一件或一批审判、不采信一条证据,都是这个形状。空白不算理由 ——
 * 服务端同样拒空理由,这里先拦,省一次往返。
 */
export function ReasonDialog({
  isOpen,
  title,
  hint,
  confirmText,
  pending,
  onCancel,
  onConfirm,
}: {
  isOpen: boolean;
  title: string;
  hint: string;
  confirmText: string;
  pending: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const { t } = useI18n();
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  const blank = reason.trim().length === 0;

  const close = () => {
    setReason("");
    setTouched(false);
    onCancel();
  };
  const submit = () => {
    setTouched(true);
    if (blank) return;
    onConfirm(reason.trim());
    setReason("");
    setTouched(false);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={close}
      title={title}
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={close} disabled={pending}>
            {t("common.cancel")}
          </Button>
          <Button type="button" variant="primary" onClick={submit} loading={pending}>
            {confirmText}
          </Button>
        </div>
      }
    >
      <TextAreaField
        label={t("judgment.claim.reason")}
        description={hint}
        error={touched && blank ? t("judgment.claim.reason_required") : null}
        required
        rows={3}
        maxLength={REASON_MAX}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
    </Modal>
  );
}

/** 暂缓:理由必填。`count` 只进标题 —— 一件与十件是同一个动作。 */
export function DeferDialog({
  count,
  ...rest
}: {
  isOpen: boolean;
  count: number;
  pending: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const { t } = useI18n();
  return (
    <ReasonDialog
      {...rest}
      title={t("judgment.claim.defer_title", { n: String(count) })}
      hint={t("judgment.claim.defer_reason_hint")}
      confirmText={t("judgment.claim.defer")}
    />
  );
}

/**
 * 改派:选一位能接下这些案子的官员。
 *
 * 名单来自 `GET /judgment/assignable-officers/`,要的是 `judgment.assign` —— 与改派本身
 * 同一个码名。此前读的是 `/users/`(要 ADMIN 的 `user.manage`),于是恰恰是改派的殿主
 * (MODERATOR)一打开就 403。服务端按案子的租户、用与 `reassign` 同一条
 * `claims.is_assignable` 筛好,这里不再自己按租户或在职过滤。那个端点也拒了(403 等)
 * 时照实说「名单读不到」,不给一个空下拉。
 */
export function ReassignDialog({
  isOpen,
  ids,
  count,
  pending,
  onCancel,
  onConfirm,
}: {
  isOpen: boolean;
  /** The cases about to be reassigned: the server reads their tenant, so ADMIN needs no tenant of its own. */
  ids: readonly string[];
  count: number;
  pending: boolean;
  onCancel: () => void;
  onConfirm: (to: number) => void;
}) {
  const { t } = useI18n();
  const [to, setTo] = useState("");
  const [touched, setTouched] = useState(false);
  const { data: officers, isError, isLoading } = useAssignableOfficers(ids, isOpen);
  const nameOf = (u: AssignableOfficer) => u.display_name || u.username;

  const close = () => {
    setTo("");
    setTouched(false);
    onCancel();
  };
  const submit = () => {
    setTouched(true);
    if (!to) return;
    onConfirm(Number(to));
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={close}
      title={t("judgment.claim.reassign_title", { n: String(count) })}
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={close} disabled={pending}>
            {t("common.cancel")}
          </Button>
          <Button type="button" variant="primary" onClick={submit} loading={pending} disabled={isError}>
            {t("judgment.claim.reassign_confirm")}
          </Button>
        </div>
      }
    >
      {isError ? (
        <p role="alert" className="text-sm text-[oklch(var(--color-danger))]">
          <span aria-hidden="true">! </span>
          {t("judgment.claim.officers_unavailable")}
        </p>
      ) : (
        <SelectField
          label={t("judgment.claim.reassign_to")}
          description={t("judgment.claim.reassign_hint")}
          error={touched && !to ? t("judgment.claim.officer_required") : null}
          required
          disabled={isLoading}
          value={to}
          onChange={(e) => setTo(e.target.value)}
          options={[
            { value: "", label: isLoading ? t("common.loading") : t("judgment.claim.pick_officer") },
            ...(officers ?? []).map((u) => ({ value: String(u.id), label: nameOf(u) })),
          ]}
        />
      )}
    </Modal>
  );
}
