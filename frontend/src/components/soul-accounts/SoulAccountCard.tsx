"use client";

import { useState } from "react";
import Link from "next/link";
import type { Soul, SoulAccount } from "@soulledger/core/api";
import { useSoulAccountChain } from "@soulledger/core/hooks/useSoulAccounts";
import { useI18n } from "@/src/contexts/I18nContext";
import { usePermissions } from "@/src/hooks/usePermissions";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { DomainEnum, MissingValue } from "@/src/components/ui/DomainValue";
import { QueryError } from "@/src/components/ui/PageError";
import { Skeleton } from "@/components/ui/skeleton";
import { AccountCredentialModal } from "./AccountCredentialModal";
import { lifeNumber } from "./soulAccountsView";

/**
 * Left-column 灵魂账号 card on a soul's detail page: this life's account, the
 * chain of every life's account, and the provision / reset verbs.
 *
 * Rendered by the page only for `soul_account.read`; the two verbs need
 * `soul_account.manage` and are absent — not disabled — without it.
 */
export function SoulAccountCard({ soul }: { soul: Soul }) {
  const { t, formatDateTime } = useI18n();
  const { hasPermission } = usePermissions();
  const canManage = hasPermission("soul_account.manage");
  const chain = useSoulAccountChain(soul.id);
  const [modal, setModal] = useState<"provision" | "reset" | null>(null);

  const accounts = chain.data ?? [];
  const current: SoulAccount | undefined = accounts.find((a) => a.retired_at === null);
  const life = soul.life_index ?? 0;
  const thisLifeHasAccount = accounts.some((a) => a.cycle === life);
  const passwordExpired =
    current?.must_change_password === true &&
    current.initial_password_expires_at !== null &&
    new Date(current.initial_password_expires_at).getTime() <= Date.now();

  const row = (label: string, value: React.ReactNode) => (
    <div className="flex justify-between gap-3">
      <dt className="text-[oklch(var(--color-ink-muted))] shrink-0">{label}</dt>
      <dd className="text-[oklch(var(--color-ink))] text-right min-w-0 break-words">{value}</dd>
    </div>
  );

  let body: React.ReactNode;
  if (chain.isLoading) {
    body = (
      <div className="space-y-2">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-2/3" />
      </div>
    );
  } else if (chain.isError && !chain.data) {
    body = <QueryError onRetry={() => chain.refetch()} />;
  } else {
    body = (
      <div className="space-y-4">
        {current ? (
          <dl className="space-y-2 text-03" data-testid="current-soul-account">
            {row(t("soul_accounts.fields.cycle"), t("soul_accounts.life", { n: lifeNumber(current.cycle) }))}
            {row(t("soul_accounts.fields.soul_code"), <span className="font-mono break-all">{current.soul_code}</span>)}
            {row(t("soul_accounts.account.origin_label"), <DomainEnum namespace="soul_accounts.origin" value={current.origin} />)}
            {row(
              t("soul_accounts.account.password_label"),
              current.must_change_password ? (
                <span className="inline-flex flex-wrap justify-end gap-1">
                  <Badge tone="warning">{t("soul_accounts.account.must_change")}</Badge>
                  {passwordExpired && <Badge tone="error">{t("soul_accounts.account.initial_expired")}</Badge>}
                </span>
              ) : (
                t("soul_accounts.account.password_set")
              )
            )}
            {row(
              t("soul_accounts.account.initial_expires_at"),
              current.initial_password_expires_at ? (
                <span className="font-mono">{formatDateTime(current.initial_password_expires_at)}</span>
              ) : (
                <MissingValue kind="inapplicable" reason={t("soul_accounts.account.initial_expires_na")} />
              )
            )}
            {row(t("soul_accounts.account.state_label"), <Badge tone="success">{t("soul_accounts.account.active")}</Badge>)}
            {row(
              t("soul_accounts.account.last_login"),
              current.last_login ? (
                <span className="font-mono">{formatDateTime(current.last_login)}</span>
              ) : (
                <MissingValue kind="unrecorded" reason={t("soul_accounts.account.never_logged_in")} />
              )
            )}
            {row(t("soul_accounts.account.contact_email"), current.contact_email_masked || <MissingValue kind="unrecorded" />)}
            {row(t("soul_accounts.account.contact_phone"), current.contact_phone_masked || <MissingValue kind="unrecorded" />)}
          </dl>
        ) : (
          <p className="text-03 text-[oklch(var(--color-ink-muted))]">
            {soul.current_state === "ALIVE" ? t("soul_accounts.account.alive_no_account") : t("soul_accounts.account.none")}
          </p>
        )}

        {canManage && current && (
          <Button type="button" size="sm" variant="warning" className="w-full" onClick={() => setModal("reset")}>
            {t("soul_accounts.account.actions.reset")}
          </Button>
        )}
        {canManage && !thisLifeHasAccount && soul.current_state !== "ALIVE" && (
          <Button type="button" size="sm" variant="primary" className="w-full" onClick={() => setModal("provision")}>
            {t("soul_accounts.account.actions.provision")}
          </Button>
        )}
        {current?.must_change_password && (
          <Link href="/soul-accounts/credentials" className="block text-02 underline text-[oklch(var(--color-accent-ink))]">
            {t("soul_accounts.account.pending_link")}
          </Link>
        )}

        {accounts.length > 0 && (
          <div>
            <h3 className="text-01 uppercase text-[oklch(var(--color-ink-subtle))] mb-2">{t("soul_accounts.account.chain")}</h3>
            <ol className="space-y-2" data-testid="soul-account-chain">
              {accounts.map((a) => (
                <li key={a.id} className="text-02 border-l-2 border-[oklch(var(--color-hairline))] pl-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-[oklch(var(--color-ink))]">{t("soul_accounts.life", { n: lifeNumber(a.cycle) })}</span>
                    <DomainEnum namespace="soul_accounts.origin" value={a.origin} className="text-[oklch(var(--color-ink-muted))]" />
                    {a.retired_at ? (
                      <Badge tone="neutral">{t("soul_accounts.account.retired")}</Badge>
                    ) : (
                      <Badge tone="success">{t("soul_accounts.account.active")}</Badge>
                    )}
                  </div>
                  <p className="font-mono text-[oklch(var(--color-ink-subtle))]">
                    {t("soul_accounts.account.created_at", { time: formatDateTime(a.created_at) })}
                    {a.retired_at && ` · ${t("soul_accounts.account.retired_at", { time: formatDateTime(a.retired_at) })}`}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    );
  }

  return (
    <section id="soul-account" className="bg-[oklch(var(--color-surface-1))] p-4 border border-[oklch(var(--color-hairline))]">
      <h2 className="text-01 text-[oklch(var(--color-ink-muted))] uppercase mb-3">{t("soul_accounts.account.title")}</h2>
      {body}
      {modal === "provision" && (
        <AccountCredentialModal mode="provision" soulId={soul.id} soulName={soul.name} onClose={() => setModal(null)} />
      )}
      {modal === "reset" && current && (
        <AccountCredentialModal mode="reset" accountId={current.id} soulName={soul.name} onClose={() => setModal(null)} />
      )}
    </section>
  );
}
