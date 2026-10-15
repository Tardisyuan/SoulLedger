import * as Clipboard from "expo-clipboard";

export const CLEAR_AFTER_MS = 60_000;
let pending: ReturnType<typeof setTimeout> | undefined;

/**
 * Copy a secret (recovery codes, the two-step key) and take it back 60 s later -- but only if the
 * clipboard still holds exactly `text`; anything the user copied since is left alone. A second call
 * replaces the pending check. If the clipboard cannot be read, nothing is cleared.
 * The screens say so with `soul_app.mfa.copied_clears` (seconds = this constant).
 */
export async function copySecret(text: string): Promise<void> {
  await Clipboard.setStringAsync(text);
  if (pending) clearTimeout(pending);
  pending = setTimeout(() => {
    pending = undefined;
    void (async () => {
      try {
        if ((await Clipboard.getStringAsync()) === text) await Clipboard.setStringAsync("");
      } catch {
        // unreadable or unwritable: leave the clipboard as it is
      }
    })();
  }, CLEAR_AFTER_MS);
}
