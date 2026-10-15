"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { SignInSession } from "@soulledger/core/api";
import { useRevokeOtherSessions, useRevokeSession, useSignInSessions } from "@soulledger/core/hooks/useSignInSessions";
import { signInSessionKeys } from "@soulledger/core/query_keys";
import { useI18n } from "@/src/contexts/I18nContext";
import { showToast } from "@/src/components/ui/Toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { ConfirmDialog } from "@/src/components/ui/Modal";

/** 退出一台之后,这一行显示「已退出」这么久再消失(Design 第二十八批 W2)。 */
export const SIGNED_OUT_LINGER_MS = 3000;

const ROW = "min-h-16 grid grid-cols-[minmax(0,1fr)_160px_120px] max-sm:grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t border-[oklch(var(--color-line))]";
const MUTED = "text-xs text-[oklch(var(--color-ink-muted))]";

const pad = (n: number) => String(n).padStart(2, "0");
/** `YYYY-MM-DD`,本地时区。 */
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** `YYYY-MM-DD HH:MM`,本地时区。 */
const ymdHm = (d: Date) => `${ymd(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

/**
 * 个人中心「登录设备」(Design 第二十八批 W2):一台设备一行,这台在前(服务端排好)。
 * 退出别台不输密码、立即生效,行内显示「已退出」3 秒后消失;「这台」没有按钮,行末写「在右上角退出」。
 * 「退出其他全部」先过一道确认(带台数)。「30 天内不再询问」是行下的一枚标签,不另起一张表。
 * 不显示位置:没有可靠的地理来源。
 */
/** `onChangePassword`:链接用锚点跳到「修改密码」一节,这里只负责把表单展开。 */
export function DevicesSection({ onChangePassword }: { onChangePassword: () => void }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const sessions = useSignInSessions();
  const revoke = useRevokeSession();
  const revokeOthers = useRevokeOtherSessions();
  // 退出成功的 id:先显示「已退出」(signedOut),3 秒后从列表里拿掉(hidden)再重取。
  // 拿掉靠本地的 hidden 而不是等重取回来,否则这一行会在 3 秒后闪回成带「退出这台」的原样。
  const [signedOut, setSignedOut] = useState<ReadonlySet<string>>(new Set());
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const rows = (sessions.data ?? []).filter((r) => !hidden.has(r.id));
  const others = rows.filter((r) => !r.current && !signedOut.has(r.id));

  const signOut = (id: string) =>
    revoke.mutate(id, {
      onSuccess: () => {
        setSignedOut((prev) => new Set(prev).add(id));
        timers.current.push(
          setTimeout(() => {
            setHidden((prev) => new Set(prev).add(id));
            void queryClient.invalidateQueries({ queryKey: signInSessionKeys.all });
          }, SIGNED_OUT_LINGER_MS),
        );
      },
      onError: () => showToast(t("profile.devices.sign_out_failed"), "error"),
    });

  return (
    <div
      data-testid="devices-section"
      className="mt-3 flex max-w-[720px] flex-col gap-4 border border-[oklch(var(--color-line))] bg-[oklch(var(--color-surface-1))] p-4"
    >
      {sessions.isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : sessions.isError ? (
        <p role="alert" className="text-sm text-[oklch(var(--color-danger))]">
          <span aria-hidden="true">✕ </span>
          {t("profile.devices.load_failed")}
        </p>
      ) : (
        <>
          <div className="flex items-center gap-3">
            <span className="text-[oklch(var(--color-ink-muted))]">
              {t("profile.devices.count", { n: String(rows.length) })}
            </span>
            {others.length > 0 ? (
              <Button type="button" variant="secondary" size="sm" className="ml-auto" onClick={() => setConfirmOpen(true)}>
                {t("profile.devices.sign_out_others")}
              </Button>
            ) : null}
          </div>
          <p className="text-sm text-[oklch(var(--color-ink-muted))]">{t("profile.devices.intro")}</p>
          <ul className="flex flex-col">
            {rows.map((row) => (
              <DeviceRow
                key={row.id}
                row={row}
                gone={signedOut.has(row.id)}
                busy={revoke.isPending && revoke.variables === row.id}
                onSignOut={() => signOut(row.id)}
              />
            ))}
          </ul>
          <p className="border-t border-[oklch(var(--color-line))] pt-3 text-sm text-[oklch(var(--color-ink-muted))]">
            {t("profile.devices.stranger")}{" "}
            <a href="#password-section" onClick={onChangePassword} className="text-[oklch(var(--color-ink))] underline underline-offset-2">
              {t("profile.change_password")}
            </a>{" "}
            · {t("profile.devices.audit_note")}
          </p>
        </>
      )}

      <ConfirmDialog
        isOpen={confirmOpen}
        title={t("profile.devices.confirm_title", { n: String(others.length) })}
        message={t("profile.devices.confirm_body")}
        confirmText={t("profile.devices.confirm_action", { n: String(others.length) })}
        confirmLoading={revokeOthers.isPending}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() =>
          revokeOthers.mutate(undefined, {
            onSuccess: () => setConfirmOpen(false),
            onError: () => {
              setConfirmOpen(false);
              showToast(t("profile.devices.sign_out_failed"), "error");
            },
          })
        }
      />
    </div>
  );
}

function DeviceRow({
  row,
  gone,
  busy,
  onSignOut,
}: {
  row: SignInSession;
  gone: boolean;
  busy: boolean;
  onSignOut: () => void;
}) {
  const { t } = useI18n();
  // 日期要排成等宽字:把占位符换成哨兵,再在哨兵处断开(各语言的词序不同)。
  const [before, after = ""] = t("profile.devices.mfa_until", { date: "\u0000" }).split("\u0000");
  return (
    <li data-testid="device-row" data-current={row.current ? "true" : "false"} className={ROW}>
      <span className="flex flex-col">
        <span className="flex items-center gap-2 font-medium">
          {row.label}
          {row.current ? <Badge tone="neutral">{t("profile.devices.this")}</Badge> : null}
        </span>
        {row.trusted_until ? (
          <span className={MUTED}>
            {before}
            <span className="font-mono">{ymd(new Date(row.trusted_until))}</span>
            {after}
          </span>
        ) : null}
      </span>
      <span className="font-mono max-sm:hidden">
        {row.current ? t("profile.devices.in_use") : ymdHm(new Date(row.last_seen_at))}
      </span>
      {row.current ? (
        <span className={MUTED}>{t("profile.devices.sign_out_here")}</span>
      ) : gone ? (
        <span role="status" className={MUTED}>
          {t("profile.devices.signed_out")}
        </span>
      ) : (
        <Button type="button" variant="ghost" size="sm" loading={busy} onClick={onSignOut}>
          {t("profile.devices.sign_out")}
        </Button>
      )}
    </li>
  );
}
