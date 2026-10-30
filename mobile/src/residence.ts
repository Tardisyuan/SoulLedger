/**
 * Where the soul is versus where it belongs — a leaf, read by the life, applications and sentence
 * screens. It lived in `screens/life.tsx` and `screens/applications.tsx`, which made
 * applications -> life -> sentence -> applications a runtime require cycle (cq-apps 2026-10-30 #1);
 * `requireCyclesStayBroken.test.ts` keeps this file and `navTypes.ts` off the screens.
 */
import type { Locale } from "@soulledger/core/config/locale";
import { useContext } from "react";

import { useI18n } from "./i18n";
import { residenceOf, type Residence } from "./rules";
import { SessionContext } from "./session";
import { enumText, useTheme } from "./ui";

export function realmName(realm: { name_zh: string; name_en: string; name_local: string }, locale: Locale): string {
  return (locale === "zh-Hans" ? realm.name_zh : realm.name_en) || realm.name_local;
}

/** Skin by where the soul is (the theme already is); words by where it belongs. */
export function useResidence(): Residence {
  const t = useTheme();
  // Read the context directly: a screen rendered without a session (a test) is simply "at home".
  const session = useContext(SessionContext);
  const me = session?.state.status === "signedIn" ? session.state.profile : null;
  return residenceOf(t.civ, me);
}

/**
 * Handoff 3b: a residing soul's applications are still its home civilization's
 * to decide — said once, at the top of the tab, in the current skin.
 */
export function useResidenceNames(): { current: string; home: string } | null {
  const { t, enumLabel } = useI18n();
  const { residing } = useResidence();
  const session = useContext(SessionContext);
  const me = session?.state.status === "signedIn" ? session.state.profile : null;
  if (!me || !residing) return null;
  const civName = (c: string) => enumText(enumLabel("souls.civilizations", c), t);
  return { current: civName(me.civilization), home: civName(me.home_civilization) };
}
