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
import { AppState } from "react-native";

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

/**
 * The system check itself: `ok` only when it passed. A check the officer (or the system) cancelled is `cancelled`;
 * anything else -- not recognised, locked out, an error -- is `failed`. The screens say which (phone QA 10-29b:
 * cancelling the prompt was reported as 没有认出指纹).
 */
export type CheckResult = "ok" | "cancelled" | "failed";
const CANCELS = new Set(["user_cancel", "system_cancel", "app_cancel"]);
export async function deviceCheck(promptMessage: string): Promise<CheckResult> {
  try {
    const r = await LocalAuthentication.authenticateAsync({ promptMessage });
    if (r.success) return "ok";
    return CANCELS.has(r.error) ? "cancelled" : "failed";
  } catch {
    return "failed";
  }
}

/**
 * `ok` when the decision may go ahead: the switch is off, the phone cannot check, or the system check passed.
 * `promptMessage` is the reason the system shows with its check, in the app's language
 * (`officer_app.biometric.prompt`) — it was a fixed Chinese string, shown to an English-language officer too.
 */
export async function decisionAllowed(promptMessage: string): Promise<CheckResult> {
  if (!confirmWished() || !(await canCheck())) return "ok";
  return deviceCheck(promptMessage);
}

/** What `confirmedDecision` throws when the check did not pass: nothing was sent. */
export class NotConfirmed extends Error {
  constructor(readonly result: "cancelled" | "failed") {
    super(`device check ${result}`);
  }
}

/**
 * Every decision a screen sends -- approve / reject, a wangsi conclusion, a release, a city god send-on or return --
 * goes through here, so the switch on 我的 covers all of them (phone QA 10-29b: the wangsi review and both releases
 * skipped it). `decisionsAreChecked.test.ts` fails a screen that calls one of those APIs any other way.
 * Comments, co-sign opinions, claims and deferrals are not decisions and never ask.
 */
export async function confirmedDecision<T>(promptMessage: string, send: () => Promise<T>): Promise<T> {
  const result = await decisionAllowed(promptMessage);
  if (result !== "ok") throw new NotConfirmed(result);
  await foreground();
  return send();
}

/**
 * Resolves once the app is in front again (at most `ms` later). Android pauses the activity behind the system's
 * check (AppState `background`) and calls back with the result while the prompt is still closing -- before the
 * activity resumes. A release sent at that moment on the Honor/EMUI phone (phone QA 10-29c, o13b) never reached
 * the server and came back with no response, which the screen reported as 释放失败. Waiting for `active` sends it
 * from the foreground. Inferred from the device behaviour, not reproduced in jest (it cannot pause an activity).
 * ponytail: a fixed 2 s cap; if a phone resumes later the send goes anyway and a no-response error says 网络错误.
 */
export function foreground(ms = 2000): Promise<void> {
  // Only a known paused state waits: `unknown` / unset (a start, jest) is treated as in front.
  if (AppState.currentState !== "background" && AppState.currentState !== "inactive") return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      sub?.remove();
      resolve();
    };
    const timer = setTimeout(done, ms);
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") done();
    });
  });
}

/** The key of the line a screen shows when `confirmedDecision` threw; null when the error was the server's. */
export function notConfirmedKey(e: unknown): string | null {
  if (!(e instanceof NotConfirmed)) return null;
  return e.result === "cancelled" ? "officer_app.biometric.cancelled" : "officer_app.biometric.failed_any";
}
