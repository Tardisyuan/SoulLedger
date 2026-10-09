/**
 * The numbers Siri may speak (docs/PLAN-voice-assistants.md §3, scheme A).
 *
 * Whenever a screen has fetched one -- the officer's to-do total, the soul's days of cooldown --
 * it is written, with the time, into the App Group's shared defaults through the local native
 * module (modules/soulledger-voice). The App Intent reads it there and speaks "as of HH:MM, N".
 * Nothing but a count and a time goes in: no case content, no tokens, no network on the native
 * side. Sign-out clears it, so a signed-out phone answers "open the app first". On Android, and
 * wherever the module is absent (jest, Expo Go), every call is a quiet no-op.
 */
import { requireOptionalNativeModule } from "expo";

/** The keys the Swift side reads; keep in step with plugins/voiceEntries.js `readouts[].cache`. */
export type VoiceKey = "todo" | "cooldown";

export interface VoiceNative {
  setNumber(key: string, value: number, at: number): void;
  clear(): void;
}

export function createVoiceCache(native: () => VoiceNative | null) {
  return {
    /** `value` is a whole number >= 0; anything else is not written. */
    publish(key: VoiceKey, value: number, now: number = Date.now()): void {
      if (!Number.isInteger(value) || value < 0) return;
      try {
        native()?.setNumber(key, value, now);
      } catch {
        // A speakable number is a convenience; it never breaks the screen that fetched it.
      }
    },
    clear(): void {
      try {
        native()?.clear();
      } catch {
        // Same: nothing to report.
      }
    },
  };
}

const cache = createVoiceCache(() => requireOptionalNativeModule<VoiceNative>("SoulLedgerVoice"));
export const publishVoiceNumber = cache.publish;
export const clearVoiceNumbers = cache.clear;

/** Whole days until `until`, rounded up like the server's; 0 for none or past. The cooldown form uses the same rule. */
export function daysLeft(until: string | null, now: number = Date.now()): number {
  if (!until) return 0;
  const ms = Date.parse(until) - now;
  return Number.isFinite(ms) ? Math.max(0, Math.ceil(ms / 86_400_000)) : 0;
}
