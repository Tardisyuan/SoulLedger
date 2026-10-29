/**
 * 批准、驳回前认面容 (Design 第二十八批 O1). The phone's own check -- face, finger or, failing both, the lock-screen
 * passcode (the OS falls back; the app adds nothing) -- before an approve or reject is sent. On by default whenever the
 * phone can authenticate at all. Comments and co-sign opinions never ask.
 *
 * The switch is remembered per officer on this phone (RBAC review A8): one officer turning it off does not turn it
 * off for the next one. Turning it OFF asks the phone first, like a decision does -- otherwise whoever holds an
 * unlocked officer phone could switch it off and then decide. Turning it on asks nothing.
 */
import { platform } from "@soulledger/core/platform";
import * as LocalAuthentication from "expo-local-authentication";
import { useEffect, useState } from "react";

import { currentOwner } from "./owner";
import { useI18n } from "./shared";

/** The prefix: each officer's switch is `officer_bio_confirm:<owner>` (owner.ts). */
export const CONFIRM_KEY = "officer_bio_confirm";
export const confirmKey = () => `${CONFIRM_KEY}:${currentOwner() ?? ""}`;

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
export const confirmWished = () => platform().persistent.get(confirmKey()) !== "0";
export const setConfirmWished = (on: boolean) => (on ? platform().persistent.remove(confirmKey()) : platform().persistent.set(confirmKey(), "0"));

/** The system check itself: true only when it passed (a cancel or an error is a no). */
export async function deviceConfirms(promptMessage: string): Promise<boolean> {
  try {
    return (await LocalAuthentication.authenticateAsync({ promptMessage })).success;
  } catch {
    return false;
  }
}

/**
 * True when the decision may go ahead: the switch is off, the phone cannot check, or the system check passed.
 * `promptMessage` is the reason the system shows with its check, in the app's language
 * (`officer_app.biometric.prompt`) — it was a fixed Chinese string, shown to an English-language officer too.
 */
export async function decisionAllowed(promptMessage: string): Promise<boolean> {
  if (!confirmWished() || !(await canCheck())) return true;
  return deviceConfirms(promptMessage);
}
