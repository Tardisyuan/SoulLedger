import { useEffect, useState } from "react";

import { knownBiometry, readBiometry, type Biometry } from "./deviceLogin";
import { useI18n } from "./i18n";

/** What this phone has enrolled, read once when the screen appears, and `{{bio}}` ready for a sentence (面容 / 指纹). */
export function useBiometry(): Biometry & { ready: boolean; word: string } {
  const { t } = useI18n();
  const [bio, setBio] = useState<Biometry | null>(knownBiometry);
  useEffect(() => {
    let live = true;
    void readBiometry().then((b) => live && setBio(b));
    return () => {
      live = false;
    };
  }, []);
  const known = bio ?? { enrolled: false, wordKey: "soul_app.bio.finger" as const };
  return { ...known, ready: bio !== null, word: t(known.wordKey) };
}
