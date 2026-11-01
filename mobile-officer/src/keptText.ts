/**
 * What an officer is typing in a detail (a comment, a reason, a review note), kept by a key for as long as the app
 * runs. A detail is unmounted by a tab switch and a sheet is given a new key per opening, and with plain `useState`
 * either one dropped the words (review 2026-11-01). The screen drops its key once the server took the words.
 *
 * In memory only, never on disk: the reply drafts (drafts.ts) are the one text that outlives the process. Cleared on
 * every sign-out and session end with the rest (session.tsx) -- the next officer finds nothing.
 */
import { useCallback, useState } from "react";

const kept = new Map<string, string>();

export function useKeptText(key: string): [string, (next: string) => void, () => void] {
  const [text, setText] = useState(() => kept.get(key) ?? "");
  const set = useCallback(
    (next: string) => {
      setText(next);
      if (next) kept.set(key, next);
      else kept.delete(key);
    },
    [key]
  );
  const drop = useCallback(() => {
    kept.delete(key);
    setText("");
  }, [key]);
  return [text, set, drop];
}

export function clearKeptText(): void {
  kept.clear();
}
