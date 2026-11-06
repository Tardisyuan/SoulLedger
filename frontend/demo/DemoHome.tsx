"use client";

import { useState } from "react";
import { Landing } from "@/src/components/landing/Landing";
import type { SealCiv } from "@/src/components/plaque/Seal";
import { useI18n } from "@/src/contexts/I18nContext";
import { DemoSecondary, ROLE_OF_SKIN, startEntrance, useEnter } from "./DemoEntrances";
import DemoSoul, { DemoSoulEntry } from "./DemoSoul";

/**
 * The product's landing page, with the demo's ways in: a card signs you in as that underworld's judge, behind the
 * seal; the band under the cards shows a few of the soul app's screens instead (v4 第十批第 1 条). The soul's view is
 * this page in another state, not a route: the demo adds no route a normal build could reach.
 */
export default function DemoHome() {
  const { t } = useI18n();
  const { enter } = useEnter();
  const [soul, setSoul] = useState<SealCiv | null>(null);
  if (soul) return <DemoSoul civ={soul} onCiv={setSoul} />;
  return (
    <Landing
      kicker={t("demo.landing.kicker")}
      onEnter={(skin, card) => {
        startEntrance(skin, card);
        void enter(ROLE_OF_SKIN[skin]);
      }}
      secondary={
        <>
          <DemoSoulEntry onLook={(civ) => {
            setSoul(civ);
            window.scrollTo(0, 0);
          }} />
          <DemoSecondary />
        </>
      }
    />
  );
}
