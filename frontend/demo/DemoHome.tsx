"use client";

import { Landing } from "@/src/components/landing/Landing";
import { useI18n } from "@/src/contexts/I18nContext";
import { DemoSecondary, ROLE_OF_SKIN, startEntrance, useEnter } from "./DemoEntrances";

/** The product's landing page, with the demo's way in: a card signs you in, behind the seal. */
export default function DemoHome() {
  const { t } = useI18n();
  const { enter } = useEnter();
  return (
    <Landing
      kicker={t("demo.landing.kicker")}
      onEnter={(skin, card) => {
        startEntrance(skin, card);
        void enter(ROLE_OF_SKIN[skin]);
      }}
      secondary={<DemoSecondary />}
    />
  );
}
