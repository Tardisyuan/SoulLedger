"use client";

import { useI18n } from "@/src/contexts/I18nContext";
import { RequirePermission } from "@/src/components/rbac/RequirePermission";
import { PermissionDenied } from "@/src/components/rbac/PermissionDenied";
import { MenuGloss } from "@/src/components/layout/MenuGloss";
import { PageShell } from "@/src/components/ui/PageShell";
import { AnnualReport } from "@/src/components/dashboard/AnnualReport";

/** 冥界年报(v4 第八批 S14)。菜单在「概览」下(menus/0036),门与接口同一个码 `judgment.read`。 */
function AnnualContent() {
  const { t } = useI18n();
  return (
    <PageShell
      variant="page"
      title={
        <>
          {t("annual.title")}
          <MenuGloss path="/dashboard/annual" />
        </>
      }
    >
      <AnnualReport />
    </PageShell>
  );
}

export default function AnnualPage() {
  return (
    <RequirePermission permissions="judgment.read" fallback={<PermissionDenied permission="judgment.read" />}>
      <AnnualContent />
    </RequirePermission>
  );
}
