"use client";

import { useI18n } from "@/src/contexts/I18nContext";

/**
 * The warning for `email_not_synced: "taken"`: the contact email is held by
 * another account, so it is not this account's login email and the soul
 * cannot reset by email. The server decides it (`soul_accounts.services.
 * email_not_synced`); callers only check the flag.
 */
export function EmailNotSyncedNote({ className = "" }: { className?: string }) {
  const { t } = useI18n();
  return (
    <p role="note" data-testid="email-not-synced" className={`text-xs text-[oklch(var(--color-warning))] break-words ${className}`}>
      {t("soul_accounts.account.email_not_synced")}
    </p>
  );
}
