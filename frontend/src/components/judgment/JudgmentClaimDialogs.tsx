"use client";

import { useState } from "react";
import { useTenant } from "@/src/contexts/TenantContext";
import { DomainEnum } from "@/src/components/ui/DomainValue";
import { fieldControl } from "@/src/components/ui/Field";
import { cn } from "@/lib/utils";
import { judgmentApi, type AssignableOfficer, type JudgmentClaimRefusal } from "@soulledger/core/api";
import { useAssignableOfficers } from "@soulledger/core/hooks/useJudgments";
import { useI18n } from "@/src/contexts/I18nContext";
import { Modal } from "@/src/components/ui/Modal";
import { Button } from "@/src/components/ui/Button";
import { TextAreaField } from "@/src/components/ui/Field";

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

type RequestState = { kind: "idle" | "sent" | "failed" } | { kind: "limited"; minutes: number };

/**
 * 「请管理员改派」:每件案子发一次 `POST /judgment/{id}/request-reassign/`,服务端通知
 * 案子所在租户的 ADMIN。同一人同一件 10 分钟一次:全部被 429 挡下时说还要等几分钟
 * (取各件 `retry_after` 的最大值);有一件真的发出去就算已请。
 */
function RequestAdminButton({ ids }: { ids: readonly string[] }) {
  const { t } = useI18n();
  const [state, setState] = useState<RequestState>({ kind: "idle" });
  const [pending, setPending] = useState(false);

  const send = async () => {
    setPending(true);
    const results = await Promise.allSettled(ids.map((id) => judgmentApi.requestReassign(id)));
    setPending(false);
    const refusals = results.flatMap((r) => (r.status === "rejected" ? [r.reason as ApiError] : []));
    const limited = refusals.filter((e) => e?.response?.status === 429);
    if (limited.length < refusals.length) setState({ kind: "failed" });
    else if (refusals.length < results.length) setState({ kind: "sent" });
    else {
      const wait = Math.max(...limited.map((e) => e.response?.data?.retry_after ?? 600));
      setState({ kind: "limited", minutes: Math.max(1, Math.ceil(wait / 60)) });
    }
  };

  if (state.kind === "sent") {
    return (
      <p role="status" className="mt-2 text-[oklch(var(--color-ink))]">
        {t("judgment.claim.request_admin_sent")}
      </p>
    );
  }
  return (
    <div className="mt-3">
      <Button type="button" variant="secondary" size="sm" loading={pending} onClick={send}>
        {t("judgment.claim.request_admin")}
      </Button>
      {state.kind === "limited" && (
        <p role="status" className="mt-2 text-[oklch(var(--color-ink-muted))]">
          {t("judgment.claim.request_admin_limited", { minutes: String(state.minutes) })}
        </p>
      )}
      {state.kind === "failed" && (
        <p role="alert" className="mt-2 text-[oklch(var(--color-danger))]">
          <span aria-hidden="true">! </span>
          {t("judgment.claim.request_admin_failed")}
        </p>
      )}
    </div>
  );
}

type ApiError = { response?: { status?: number; data?: { retry_after?: number } } };

/**
 * 改派:选一位能接下这些案子的官员。
 *
 * 名单来自 `GET /judgment/assignable-officers/`,要的是 `judgment.assign` —— 与改派本身
 * 同一个码名。此前读的是 `/users/`(要 ADMIN 的 `user.manage`),于是恰恰是改派的殿主
 * (MODERATOR)一打开就 403。服务端按案子的租户、用与 `reassign` 同一条
 * `claims.is_assignable` 筛好,这里不再自己按租户或在职过滤。那个端点也拒了(403 等)
 * 时照实说「名单读不到」,不给一个空下拉。
 *
 * 第三类 F 组 2.7:搜索判官 + 名单(方形首字块、姓名、角色、右侧等宽「在手」件数,读
 * `in_hand`)。自己也列出但置灰、写「· 你」、件数「—」,不可选。除自己之外没有人时是
 * 虚线框的空状态,带边框按钮「请管理员改派」(`RequestAdminButton`)。
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
  const { user } = useTenant();
  const [to, setTo] = useState("");
  const [query, setQuery] = useState("");
  const [touched, setTouched] = useState(false);
  const { data: officers, isError, isLoading } = useAssignableOfficers(ids, isOpen);
  const nameOf = (u: AssignableOfficer) => u.display_name || u.username;
  const all = officers ?? [];
  const others = all.filter((u) => u.id !== user?.id);
  const q = query.trim().toLowerCase();
  const shown = q ? all.filter((u) => `${u.display_name} ${u.username}`.toLowerCase().includes(q)) : all;

  const close = () => {
    setTo("");
    setQuery("");
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
          <Button type="button" variant="primary" onClick={submit} loading={pending} disabled={isError || others.length === 0}>
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
      ) : isLoading ? (
        <p className="text-sm text-[oklch(var(--color-ink-subtle))]">{t("common.loading")}</p>
      ) : others.length === 0 ? (
        <div data-testid="reassign-empty" className="border border-dashed border-[oklch(var(--color-line))] px-4 py-3 text-sm">
          <p className="font-semibold text-[oklch(var(--color-ink))]">{t("judgment.claim.reassign_empty_title")}</p>
          <p className="mt-1 text-[oklch(var(--color-ink-muted))]">{t("judgment.claim.reassign_empty_body")}</p>
          <RequestAdminButton ids={ids} />
        </div>
      ) : (
        <div className="space-y-2">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("judgment.claim.reassign_search")}
            aria-label={t("judgment.claim.reassign_search")}
            className={cn(fieldControl({ size: "md" }), "w-full")}
          />
          <div className="flex justify-between border-b border-[oklch(var(--color-block))] pb-1 font-mono text-2xs text-[oklch(var(--color-ink-subtle))]">
            <span>{t("judgment.claim.reassign_count", { n: String(others.length) })}</span>
            <span>{t("judgment.claim.in_hand")}</span>
          </div>
          <div role="radiogroup" aria-label={t("judgment.claim.reassign_to")} className="max-h-72 overflow-y-auto">
            {shown.map((u) => {
              const self = u.id === user?.id;
              const on = to === String(u.id);
              return (
                <label
                  key={u.id}
                  data-officer={u.id}
                  className={cn(
                    "flex min-h-11 items-center gap-3 border-b border-[oklch(var(--color-rule))] px-1 py-1.5 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-[oklch(var(--color-accent))]",
                    self ? "opacity-50" : "cursor-pointer hover:bg-[oklch(var(--color-surface-2))]",
                    on && "bg-[oklch(var(--color-surface-2))] shadow-[inset_3px_0_0_oklch(var(--color-ink))]"
                  )}
                >
                  <input
                    type="radio"
                    name="reassign-to"
                    value={u.id}
                    checked={on}
                    disabled={self}
                    onChange={() => setTo(String(u.id))}
                    className="sr-only"
                  />
                  {/* 方形首字块:画布画成了圆,规范是方形(第三类 F 组答复)。 */}
                  <span aria-hidden="true" className="flex size-8 flex-none items-center justify-center bg-[oklch(var(--color-surface-3))] text-sm font-medium text-[oklch(var(--color-ink))]">
                    {Array.from(nameOf(u))[0] ?? "?"}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span title={nameOf(u)} className="block truncate text-sm text-[oklch(var(--color-ink))]">{nameOf(u)}</span>
                    <span className="block text-xs text-[oklch(var(--color-ink-subtle))]">
                      <DomainEnum namespace="users.roles" value={u.role} />
                      {self && ` · ${t("judgment.claim.reassign_you")}`}
                    </span>
                  </span>
                  <span className="font-mono text-xs tabular-nums text-[oklch(var(--color-ink-muted))]">
                    {self ? "—" : t("judgment.claim.in_hand_n", { n: String(u.in_hand) })}
                  </span>
                </label>
              );
            })}
          </div>
          {touched && !to && (
            <p role="alert" className="text-xs text-[oklch(var(--color-danger))]">
              <span aria-hidden="true">! </span>
              {t("judgment.claim.officer_required")}
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}
