"use client";

import type { ReactNode } from "react";
import { useI18n } from "@/src/contexts/I18nContext";
import { usePermissions } from "@/src/hooks/usePermissions";
import { usePlaque } from "@/src/components/plaque/Plaque";
import { useHall } from "@/src/components/plaque/useHall";
import { MenuGloss } from "@/src/components/layout/MenuGloss";
import { PageShell } from "@/src/components/ui/PageShell";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { PermissionsPending } from "@/src/components/rbac/RequirePermission";

/**
 * What the four audit pages show without `audit.read` (audit 2026-11-26 §3.1: the same refusal was written four
 * times). Each page's default export still asks the codename itself, `if (!canReadAudit) return <AuditRefusal …/>`:
 * `backend/tests/test_page_gates_match_the_backend.py` reads that early return from the default export, and the
 * content below it then runs only for a reader who holds the code, so it needs no `enabled: canReadAudit` of its own.
 *
 * A refusal is a note in the file, not a poster, so it goes through EmptyState (left-aligned, civ-marked) instead of
 * a centred box, and the page keeps its header, so the operator can still see *which* page refused them. Until the
 * permissions have loaded it is the pending state, not a refusal. `backLink` marks the detail page's document shell.
 */
export function AuditRefusal({ backLink }: { backLink?: ReactNode }) {
  const { t } = useI18n();
  const hall = useHall(t("plaque.office.records"));
  usePlaque(backLink ? { title: t("audit.title"), hall } : { hall });
  const { permissionsReady } = usePermissions();
  const body =
    permissionsReady === false ? (
      <PermissionsPending />
    ) : (
      <EmptyState title={t("audit.access_denied")} reason={t("audit.needs_audit_read")} />
    );
  if (backLink) {
    return (
      <PageShell density="document" variant="page" title={t("audit.title")} backLink={backLink}>
        {body}
      </PageShell>
    );
  }
  return (
    <PageShell
      variant="full"
      title={
        <>
          {t("audit.title")}
          <MenuGloss path="/audit" />
        </>
      }
    >
      {body}
    </PageShell>
  );
}
