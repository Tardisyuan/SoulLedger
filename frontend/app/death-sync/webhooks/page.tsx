"use client";

import { usePlaque } from "@/src/components/plaque/Plaque";
import { useHall } from "@/src/components/plaque/useHall";
import { useI18n } from "@/src/contexts/I18nContext";
import { RequireAdmin } from "@/src/components/rbac/RequirePermission";
import { PermissionDenied } from "@/src/components/rbac/PermissionDenied";
import { MenuGloss } from "@/src/components/layout/MenuGloss";
import { PageShell } from "@/src/components/ui/PageShell";
import { DeathSyncTabs } from "@/src/components/death-sync/DeathSyncTabs";
import { WebhooksPanel } from "@/src/components/death-sync/WebhooksPanel";

/* 死亡同步 · Webhook. `RequireAdmin`, not a codename: `AdminWebhookViewSet` is
   `IsAdminPermission`, same as the keys tab beside it. Non-ADMIN never mounts
   the panel, so no webhook request is made at all. */
export default function DeathSyncWebhooksRoute() {
  const { t } = useI18n();
  usePlaque({ hall: useHall(t("plaque.office.records")) });
  return (
    <PageShell
      variant="page"
      title={
        <>
          {t("death_sync.title")}
          <MenuGloss path="/death-sync" />
        </>
      }
      subtitle={t("death_sync.subtitle")}
      tabs={<DeathSyncTabs />}
    >
      <RequireAdmin fallback={<PermissionDenied />}>
        <WebhooksPanel />
      </RequireAdmin>
    </PageShell>
  );
}
