"use client";

import { useState } from "react";
import type { SoulContactUpdate } from "@soulledger/core/api";
import {
  classifySoulAccountError,
  useProvisionSoulAccount,
  useResetSoulCredential,
} from "@soulledger/core/hooks/useSoulAccounts";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { BaseModal } from "@/src/components/ui/Modal";
import { Button } from "@/src/components/ui/Button";
import { TextField } from "@/src/components/ui/Field";
import { failureKey } from "./soulAccountsView";

type Props =
  | { mode: "provision"; soulId: string; soulName: string; onClose: () => void }
  | { mode: "reset"; accountId: string; soulName: string; onClose: () => void };

/**
 * Provision this life's account, or reset its initial password — the same
 * confirmation either way, with optional contact fields.
 *
 * Blank fields are NOT sent. The backend treats a present-but-blank contact as
 * "clear it" (`_apply_contacts` sets whatever key arrives), so sending the
 * empty inputs would silently erase the contacts on file.
 */
export function AccountCredentialModal(props: Props) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const provision = useProvisionSoulAccount();
  const reset = useResetSoulCredential();
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [fields, setFields] = useState<Record<string, string[]>>({});
  const pending = provision.isPending || reset.isPending;

  const contacts: SoulContactUpdate = {
    ...(email.trim() ? { contact_email: email.trim() } : {}),
    ...(phone.trim() ? { contact_phone: phone.trim() } : {}),
  };

  const fail = (error: unknown, fallback: string) => {
    const failure = classifySoulAccountError(error);
    setFields(failure.fields);
    if (Object.keys(failure.fields).length === 0) showToast(t(failureKey(failure, fallback)), "error");
  };

  const submit = () => {
    setFields({});
    if (props.mode === "provision") {
      provision.mutate(
        { soulId: props.soulId, contacts },
        {
          onSuccess: ({ created }) => {
            showToast(t(created ? "soul_accounts.account.provisioned" : "soul_accounts.account.provision_existing"), created ? "success" : "info");
            props.onClose();
          },
          onError: (error) => fail(error, "soul_accounts.account.failed"),
        }
      );
    } else {
      reset.mutate(
        { accountId: props.accountId, contacts },
        {
          onSuccess: (credential) => {
            showToast(
              t(credential.status === "PENDING" ? "soul_accounts.account.reset_pending" : "soul_accounts.account.reset_queued"),
              "success"
            );
            props.onClose();
          },
          onError: (error) => fail(error, "soul_accounts.account.failed"),
        }
      );
    }
  };

  const prefix = props.mode === "provision" ? "soul_accounts.account.provision" : "soul_accounts.account.reset";

  return (
    <BaseModal
      isOpen
      onClose={props.onClose}
      title={t(`${prefix}_title`, { name: props.soulName })}
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="secondary" onClick={props.onClose} disabled={pending}>
            {t("common.cancel")}
          </Button>
          <Button type="button" variant={props.mode === "reset" ? "warning" : "primary"} onClick={submit} loading={pending}>
            {t(`soul_accounts.account.actions.${props.mode}`)}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-[oklch(var(--color-ink))]">{t(`${prefix}_body`)}</p>
        <TextField
          label={t("soul_accounts.account.contact_email")}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          description={t("soul_accounts.account.contact_hint")}
          error={fields.contact_email?.join(" ")}
          autoComplete="off"
        />
        <TextField
          label={t("soul_accounts.account.contact_phone")}
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          error={fields.contact_phone?.join(" ")}
          autoComplete="off"
        />
      </div>
    </BaseModal>
  );
}
