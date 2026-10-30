"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { mfaApi, type MfaStatus } from "@soulledger/core/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { useTenant } from "@/src/contexts/TenantContext";
import { showToast } from "@/src/components/ui/Toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { BaseModal } from "@/src/components/ui/Modal";
import { TextField } from "@/src/components/ui/Field";
import { CodeInput } from "@/src/components/auth/CodeInput";
import { RecoveryCodesPanel } from "@/src/components/auth/RecoveryCodesPanel";
import { MfaSetupWizard } from "@/src/components/profile/MfaSetupWizard";
import { cn } from "@/lib/utils";
import { responseCode, responseStatus } from "@soulledger/core/api/client";

export const MFA_STATUS_KEY = ["profile", "mfa"] as const;

/** 一对 dt / dd 的行线(与个人中心「甲 · 基本信息」同一份写法)。 */
const DT = "py-2 border-b border-[oklch(var(--color-rule))] text-[oklch(var(--color-ink-subtle))] self-stretch flex items-center";
const DD = "py-2 border-b border-[oklch(var(--color-rule))] text-[oklch(var(--color-ink))] min-w-0 flex items-center gap-2 flex-wrap";

/**
 * 个人中心「两步验证」(A12):徽章 ✓ 已开启 / ○ 未开启;未开启给说明与「开启两步验证」,角色被要求时
 * 多一行提示;已开启给 开启于 / 最近一次使用 / 恢复码剩几个(重新生成)/ 关闭(动态码或密码确认,危险键)。
 * 状态一律字形 + 文字,危险键只用 `--color-danger`,不用文明色。
 */
export function MfaSection() {
  const { t, formatDateTime } = useI18n();
  const { user, setUser } = useTenant();
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: MFA_STATUS_KEY, queryFn: () => mfaApi.status().then((r) => r.data) });
  const [wizardOpen, setWizardOpen] = useState(false);
  const [regenConfirm, setRegenConfirm] = useState(false);
  const [newCodes, setNewCodes] = useState<string[] | null>(null);
  const [disableOpen, setDisableOpen] = useState(false);

  const setStatus = (next: MfaStatus) => {
    queryClient.setQueryData(MFA_STATUS_KEY, next);
    // Turning it on also lifts the server's hold (`mfa_setup_required`); the profile page fills out again.
    if (user) setUser({ ...user, mfa_enabled: next.enabled, mfa_required: next.required, ...(next.enabled ? { mfa_setup_required: false } : {}) });
  };

  const data = status.data;
  const username = user?.username ?? "";

  return (
    <div className="pt-3" id="mfa" data-testid="mfa-section">
      {status.isLoading ? (
        <Skeleton className="h-10 w-full" />
      ) : status.isError || !data ? (
        <p role="alert" className="text-sm text-[oklch(var(--color-danger))]">
          <span aria-hidden="true">✕ </span>
          {t("mfa.manage.load_failed")}
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          <div>
            <Badge tone={data.enabled ? "success" : "neutral"} glyph={data.enabled ? "✓" : "○"} data-testid="mfa-badge">
              {data.enabled ? t("mfa.badge_on") : t("mfa.badge_off")}
            </Badge>
          </div>

          {!data.enabled ? (
            <>
              <p className="text-sm text-[oklch(var(--color-ink-muted))]">{t("mfa.manage.off_body")}</p>
              {data.required ? (
                <p role="status" data-testid="mfa-required-note" className="text-sm text-[oklch(var(--color-warning))]">
                  <span aria-hidden="true">◐ </span>
                  {t("mfa.manage.required_note", { role: t(`users.roles.${user?.role ?? ""}`) })}
                </p>
              ) : null}
              <div>
                <Button type="button" variant="primary" onClick={() => setWizardOpen(true)}>
                  {t("mfa.setup.open")}
                </Button>
              </div>
            </>
          ) : (
            <dl className="grid grid-cols-[8rem_1fr] max-sm:grid-cols-[6rem_1fr] text-sm">
              <dt className={DT}>{t("mfa.manage.enabled_at")}</dt>
              <dd className={DD}>{data.confirmed_at ? formatDateTime(data.confirmed_at) : "-"}</dd>
              <dt className={DT}>{t("mfa.manage.last_used")}</dt>
              <dd className={DD}>
                {data.last_used_at
                  ? `${formatDateTime(data.last_used_at)} · ${t(data.last_used_method === "recovery" ? "mfa.manage.method_recovery" : "mfa.manage.method_totp")}`
                  : t("mfa.manage.never_used")}
              </dd>
              <dt className={DT}>{t("mfa.manage.codes_left")}</dt>
              <dd className={DD}>
                <span data-testid="mfa-codes-left">{t("mfa.manage.codes_left_value", { n: String(data.recovery_codes_remaining) })}</span>
                <Button type="button" variant="ghost" size="sm" className="ml-auto" onClick={() => setRegenConfirm(true)}>
                  {t("mfa.manage.regenerate")}
                </Button>
              </dd>
              <dt className={DT}>{t("mfa.title")}</dt>
              <dd className={DD}>
                <Button type="button" variant="ghost" size="sm" className="ml-auto text-[oklch(var(--color-danger))]" onClick={() => setDisableOpen(true)}>
                  {t("mfa.manage.disable")}
                </Button>
              </dd>
            </dl>
          )}
        </div>
      )}

      {wizardOpen ? (
        <MfaSetupWizard
          username={username}
          onClose={() => {
            setWizardOpen(false);
            void queryClient.invalidateQueries({ queryKey: MFA_STATUS_KEY });
          }}
          onEnabled={() => {
            if (data) setStatus({ ...data, enabled: true });
          }}
        />
      ) : null}

      {regenConfirm ? (
        <RegenerateDialog
          onClose={() => setRegenConfirm(false)}
          onRegenerated={(codes) => {
            setRegenConfirm(false);
            setNewCodes(codes);
            void queryClient.invalidateQueries({ queryKey: MFA_STATUS_KEY });
          }}
        />
      ) : null}

      {newCodes ? (
        <BaseModal
          isOpen
          wide
          title={t("mfa.manage.regenerate_done_title")}
          onClose={() => setNewCodes(null)}
          footer={
            <div className="flex justify-end">
              <Button type="button" variant="primary" onClick={() => setNewCodes(null)}>
                {t("common.close")}
              </Button>
            </div>
          }
        >
          <RecoveryCodesPanel codes={newCodes} username={username} />
        </BaseModal>
      ) : null}

      {disableOpen ? <DisableDialog onClose={() => setDisableOpen(false)} onDisabled={setStatus} /> : null}
    </div>
  );
}

type OwnerMethod = "totp" | "password" | "recovery";

/** 重新生成恢复码的「确认是本人」:6 位动态码或密码二选一。 */
const ownerBody = (method: OwnerMethod, code: string, password: string) =>
  method === "password" ? ({ method: "password", password } as const) : ({ method: "totp", code } as const);

/** 关闭要第二因素本身:6 位动态码或一枚恢复码;只凭密码不行(2026-10-29)。与重新生成同一把锁。 */
const turnOffBody = (method: OwnerMethod, code: string) =>
  ({ method: method === "recovery" ? "recovery" : "totp", code: code.trim() } as const);

/** 失败时对话框里说的话:被锁了说锁,其余说「检查动态码或密码」。 */
function ownerFailure(err: unknown, fallback: string, t: (key: string) => string): string {
  return responseStatus(err) === 429 || responseCode(err) === "locked" ? t("officer_app.mfa.reasons.locked") : fallback;
}

/** 分段「动态码 / 密码」二选一 + 输入框 + 错误行。关闭与重新生成共用同一块。 */
function OwnerConfirmFields({
  label,
  method,
  onMethod,
  code,
  onCode,
  password,
  onPassword,
  error,
  disabled,
  secondFactor = false,
}: {
  label: string;
  method: OwnerMethod;
  onMethod: (m: OwnerMethod) => void;
  code: string;
  onCode: (v: string) => void;
  password: string;
  onPassword: (v: string) => void;
  error: string | null;
  disabled: boolean;
  /** 关闭用:第二种办法是恢复码而不是密码。 */
  secondFactor?: boolean;
}) {
  const { t } = useI18n();
  const methods: OwnerMethod[] = secondFactor ? ["totp", "recovery"] : ["totp", "password"];
  return (
    <>
      <div role="radiogroup" aria-label={label} className="grid grid-cols-2 border border-[oklch(var(--color-line-strong))]">
        {methods.map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={method === m}
            onClick={() => onMethod(m)}
            className={cn(
              "h-11 text-sm",
              method === m ? "bg-[oklch(var(--color-ink))] text-[oklch(var(--color-canvas))]" : "text-[oklch(var(--color-ink))]"
            )}
          >
            {t(m === "totp" ? "mfa.manage.confirm_by_totp" : m === "recovery" ? "mfa.manage.confirm_by_recovery" : "mfa.manage.confirm_by_password")}
          </button>
        ))}
      </div>
      {error ? (
        <p role="alert" className="text-sm font-medium text-[oklch(var(--color-danger))]">
          <span aria-hidden="true">! </span>
          {error}
        </p>
      ) : null}
      {method === "totp" ? (
        <CodeInput kind="totp" label={t("mfa.verify.code_label")} value={code} onChange={onCode} disabled={disabled} />
      ) : method === "recovery" ? (
        <CodeInput kind="recovery" label={t("mfa.verify.recovery_label")} value={code} onChange={onCode} disabled={disabled} />
      ) : (
        <TextField
          type="password"
          autoComplete="current-password"
          label={t("auth.password")}
          value={password}
          onChange={(e) => onPassword(e.target.value)}
          disabled={disabled}
        />
      )}
    </>
  );
}

/** 关闭:动态码或恢复码确认(只凭密码不行),危险实心键。错了留在对话框里,提示跟着后端的 code。 */
function DisableDialog({ onClose, onDisabled }: { onClose: () => void; onDisabled: (s: MfaStatus) => void }) {
  const { t } = useI18n();
  const [method, setMethod] = useState<OwnerMethod>("totp");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const disable = useMutation({
    mutationFn: () => mfaApi.disable(turnOffBody(method, code)).then((r) => r.data),
    onSuccess: (next) => {
      onDisabled(next);
      showToast(t("mfa.manage.disabled_toast"), "success");
      onClose();
    },
    onError: (err) => setError(ownerFailure(err, t("mfa.manage.turn_off_failed"), t)),
  });
  const ready = method === "totp" ? code.length === 6 : code.trim().length >= 8;

  return (
    <BaseModal
      isOpen
      title={t("mfa.manage.disable_title")}
      onClose={() => !disable.isPending && onClose()}
      dismissOnOutsideClick={false}
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={disable.isPending}>
            {t("common.cancel")}
          </Button>
          <Button type="button" variant="secondary" data-testid="mfa-disable-confirm" disabled={!ready || disable.isPending} loading={disable.isPending} onClick={() => disable.mutate()}>
            <span aria-hidden="true">✕</span>
            {t("mfa.manage.disable_confirm")}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-[oklch(var(--color-ink-muted))]">{t("mfa.manage.turn_off_body")}</p>
        <OwnerConfirmFields
          label={t("mfa.manage.disable_title")}
          secondFactor
          method={method}
          onMethod={(m) => {
            setMethod(m);
            setCode("");
            setError(null);
          }}
          code={code}
          onCode={(v) => {
            setError(null);
            setCode(v);
          }}
          password={password}
          onPassword={(v) => {
            setError(null);
            setPassword(v);
          }}
          error={error}
          disabled={disable.isPending}
        />
      </div>
    </BaseModal>
  );
}

/** 重新生成恢复码:与关闭同一个确认(动态码或密码);旧码在确认通过之前原样有效,通过后立即作废。 */
function RegenerateDialog({ onClose, onRegenerated }: { onClose: () => void; onRegenerated: (codes: string[]) => void }) {
  const { t } = useI18n();
  const [method, setMethod] = useState<OwnerMethod>("totp");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const regenerate = useMutation({
    mutationFn: () => mfaApi.regenerateRecoveryCodes(ownerBody(method, code, password)).then((r) => r.data.recovery_codes),
    onSuccess: onRegenerated,
    onError: (err) => setError(ownerFailure(err, t("mfa.manage.disable_failed"), t)),
  });
  const ready = method === "totp" ? code.length === 6 : password.length > 0;

  return (
    <BaseModal
      isOpen
      title={t("mfa.manage.regenerate_title")}
      onClose={() => !regenerate.isPending && onClose()}
      dismissOnOutsideClick={false}
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={regenerate.isPending}>
            {t("common.cancel")}
          </Button>
          <Button type="button" variant="primary" data-testid="mfa-regenerate-confirm" disabled={!ready || regenerate.isPending} loading={regenerate.isPending} onClick={() => regenerate.mutate()}>
            {t("mfa.manage.regenerate")}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-[oklch(var(--color-ink-muted))]">{t("mfa.manage.regenerate_body")}</p>
        <OwnerConfirmFields
          label={t("mfa.manage.regenerate_title")}
          method={method}
          onMethod={(m) => {
            setMethod(m);
            setError(null);
          }}
          code={code}
          onCode={(v) => {
            setError(null);
            setCode(v);
          }}
          password={password}
          onPassword={(v) => {
            setError(null);
            setPassword(v);
          }}
          error={error}
          disabled={regenerate.isPending}
        />
      </div>
    </BaseModal>
  );
}
