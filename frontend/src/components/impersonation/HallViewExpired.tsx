"use client";

import { useI18n } from "@/src/contexts/I18nContext";
import { Button } from "@/src/components/ui/Button";
import { leaveImpersonation } from "./wireImpersonation";

/** 进殿查看到期后顶替页面内容(Design 第五十四批 O-3):不悄悄跳走,只留「回到各殿概况」。 */
export function HallViewExpired() {
  const { t } = useI18n();
  return (
    <div data-testid="hall-view-expired" className="mx-auto flex max-w-md flex-col items-start gap-3 px-4 py-8">
      <h1 className="text-lg font-semibold">{t("halls.overview.expired_title")}</h1>
      <p className="text-sm">{t("halls.overview.expired_body")}</p>
      <Button type="button" variant="secondary" onClick={() => void leaveImpersonation()}>
        {t("halls.viewing.back")}
      </Button>
    </div>
  );
}
