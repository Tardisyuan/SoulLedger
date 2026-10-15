/**
 * 批准、驳回前认面容 (Design 第二十八批 O1). The phone's own check -- face, finger or, failing both, the lock-screen
 * passcode (the OS falls back; the app adds nothing) -- before an approve or reject is sent. On by default whenever the
 * phone can authenticate at all; the switch is remembered on this phone. Comments and co-sign opinions never ask.
 */
import { platform } from "@soulledger/core/platform";
import * as LocalAuthentication from "expo-local-authentication";
import { useEffect, useState } from "react";

import { useI18n } from "./shared";

export const CONFIRM_KEY = "officer_bio_confirm";

/** A phone with no screen lock at all cannot check anyone: the switch is greyed and nothing is asked. */
export async function canCheck(): Promise<boolean> {
  try {
    return (await LocalAuthentication.getEnrolledLevelAsync()) !== LocalAuthentication.SecurityLevel.NONE;
  } catch {
    return false;
  }
}

/**
 * `{{bio}}` for the O1 sentences (Design batch 30): 面容 on a phone with face recognition, otherwise 指纹 -- the soul
 * app's own words (`soul_app.bio.face / finger`; egy has one word for both). In English the word is capitalised at
 * the start of a sentence and lower-case inside one, so callers say which.
 */
export function useBioWord(): { start: string; inside: string } {
  const { t, locale } = useI18n();
  const [face, setFace] = useState(false);
  useEffect(() => {
    let live = true;
    LocalAuthentication.supportedAuthenticationTypesAsync()
      .then((types) => live && setFace(types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  const word = t(face ? "soul_app.bio.face" : "soul_app.bio.finger");
  return { start: word, inside: locale === "en" ? word.toLowerCase() : word };
}

/** Stored only when turned off, so a missing value means on. */
export const confirmWished = () => platform().persistent.get(CONFIRM_KEY) !== "0";
export const setConfirmWished = (on: boolean) => (on ? platform().persistent.remove(CONFIRM_KEY) : platform().persistent.set(CONFIRM_KEY, "0"));

/** The reason the system shows with its check. A system string, not in the language bundles (as the soul app's). */
const PROMPT = "批准或驳回前，确认是你本人。";

/** True when the decision may go ahead: the switch is off, the phone cannot check, or the system check passed. */
export async function decisionAllowed(): Promise<boolean> {
  if (!confirmWished() || !(await canCheck())) return true;
  try {
    return (await LocalAuthentication.authenticateAsync({ promptMessage: PROMPT })).success;
  } catch {
    return false;
  }
}
