"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { soulAccountsApi, type InitialCredential, type RevealedCredential } from "@soulledger/core/api";
import { classifySoulAccountError, useMarkCredentialDelivered } from "@soulledger/core/hooks/useSoulAccounts";
import { soulAccountKeys } from "@soulledger/core/query_keys";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { BaseModal } from "@/src/components/ui/Modal";
import { Button } from "@/src/components/ui/Button";
import { failureKey, lifeNumber } from "./soulAccountsView";

interface Props {
  credential: InitialCredential;
  onClose: () => void;
}

/**
 * Two steps: a confirmation that says the plaintext can be seen once, then the
 * plaintext itself.
 *
 * WHERE THE PASSWORD LIVES: in this component's `useState`, and nowhere else.
 * Not the query cache (the list refetch after a reveal carries no secret), not
 * the mutation cache (the call is awaited directly — see `useSoulAccounts.ts`),
 * not storage. The parent mounts this only while a credential is chosen and
 * unmounts it on close, so closing drops the state with the component; there
 * is no path that shows the same plaintext twice. The server agrees: it wiped
 * the secret in the same transaction that returned it, and a second reveal is
 * a 409.
 *
 * The dialog ignores outside clicks once the password is on screen — a stray
 * click would destroy something that cannot be fetched again.
 */
export function RevealCredentialDialog({ credential, onClose }: Props) {
  const { t, formatDateTime } = useI18n();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const deliver = useMarkCredentialDelivered();
  const [revealing, setRevealing] = useState(false);
  const [secret, setSecret] = useState<RevealedCredential | null>(null);

  const close = () => {
    setSecret(null);
    onClose();
  };

  const reveal = async () => {
    setRevealing(true);
    try {
      const { data } = await soulAccountsApi.revealCredential(credential.id);
      setSecret(data);
    } catch (error) {
      showToast(t(failureKey(classifySoulAccountError(error), "soul_accounts.reveal.failed")), "error");
      onClose();
    } finally {
      setRevealing(false);
      // Success or refusal, the row's status has moved (REVEALED, or VOID on expiry).
      void queryClient.invalidateQueries({ queryKey: soulAccountKeys.all });
    }
  };

  const copy = async () => {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret.password);
      showToast(t("soul_accounts.reveal.copied"), "success");
    } catch {
      showToast(t("soul_accounts.reveal.copy_failed"), "error");
    }
  };

  const markDelivered = () =>
    deliver.mutate(credential.id, {
      onSuccess: () => {
        showToast(t("soul_accounts.credentials.delivered_ok"), "success");
        close();
      },
      onError: (error) =>
        showToast(t(failureKey(classifySoulAccountError(error), "soul_accounts.credentials.deliver_failed")), "error"),
    });

  if (secret === null) {
    return (
      <BaseModal
        isOpen
        onClose={close}
        title={t("soul_accounts.reveal.confirm_title")}
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="secondary" onClick={close} disabled={revealing}>
              {t("common.cancel")}
            </Button>
            <Button type="button" variant="warning" onClick={() => void reveal()} loading={revealing}>
              {t("soul_accounts.reveal.confirm")}
            </Button>
          </div>
        }
      >
        <p className="text-sm text-[oklch(var(--color-ink))]">
          {t("soul_accounts.reveal.confirm_body", {
            name: credential.soul_name,
            code: credential.soul_code,
            n: lifeNumber(credential.cycle),
          })}
        </p>
      </BaseModal>
    );
  }

  return (
    <BaseModal
      isOpen
      onClose={close}
      dismissOnOutsideClick={false}
      title={t("soul_accounts.reveal.shown_title")}
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="secondary" onClick={markDelivered} loading={deliver.isPending}>
            {t("soul_accounts.reveal.deliver_and_close")}
          </Button>
          <Button type="button" variant="primary" onClick={close} disabled={deliver.isPending}>
            {t("soul_accounts.reveal.close")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <p role="alert" className="text-sm text-[oklch(var(--color-status-warning))]">
          {t("soul_accounts.reveal.shown_warning")}
        </p>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
          <dt className="text-[oklch(var(--color-ink-subtle))]">{t("soul_accounts.fields.soul_code")}</dt>
          <dd className="font-mono break-all text-[oklch(var(--color-ink))]">{secret.soul_code}</dd>
          <dt className="text-[oklch(var(--color-ink-subtle))]">{t("soul_accounts.reveal.password_label")}</dt>
          <dd className="font-mono text-md break-all select-all text-[oklch(var(--color-ink))]" data-testid="revealed-password">
            {secret.password}
          </dd>
          <dt className="text-[oklch(var(--color-ink-subtle))]">{t("soul_accounts.fields.expires_at")}</dt>
          <dd className="font-mono text-[oklch(var(--color-ink))]">{formatDateTime(secret.expires_at)}</dd>
        </dl>
        <Button type="button" size="sm" variant="secondary" onClick={() => void copy()}>
          {t("soul_accounts.reveal.copy")}
        </Button>
      </div>
    </BaseModal>
  );
}
