import type { Disposition, Judgment, Realm, Reincarnation, Soul, SoulPathEntry } from "@soulledger/core/api";
import type { SealCiv } from "@/src/components/plaque/Seal";
import { type DemoLang, shiftStamps } from "./store";

/**
 * The demo home page's moving preview (Design 第二十七批 §一.2, §二): one real soul per underworld, drawn with the soul
 * page's own journey block. Not from the judge recordings (1.6–3.6 MB each, loaded only on the way in): from their
 * extract `data/home-preview.json` (~19 KB), written by `scripts/demo-home-preview.mjs`, which also holds the rule for
 * which soul. Pure, so it is tested without a page.
 */

export const PREVIEW_ORDER: readonly SealCiv[] = ["cn", "eu", "eg", "gr"];

/** One underworld's turn: 1.4 s draw-on + 9 s hold + the 400 ms crossfade, rounded (four turns ≈ 44 s). */
export const TURN_MS = 11_000;

export interface PreviewSoul {
  soul: Pick<Soul, "id" | "name" | "civilization" | "current_state">;
  path: SoulPathEntry[];
  realms: Realm[];
  judgments: Judgment[];
  dispositions: Disposition[];
  reincarnations: Reincarnation[];
}

type Shown = Omit<PreviewSoul, "realms"> & { recordedAt: string };
export interface PreviewExtract {
  realms: Partial<Record<SealCiv, unknown[]>>;
  zh: Partial<Record<SealCiv, Shown | null>>;
  en: Partial<Record<SealCiv, Shown | null>>;
}

/** The soul to draw for one underworld and language, its stamps moved with the calendar like the recordings'. */
export function previewOf(extract: PreviewExtract, skin: SealCiv, lang: DemoLang): PreviewSoul | null {
  const shown = extract[lang][skin];
  if (!shown) return null;
  const { soul, path, judgments, dispositions, reincarnations } = shiftStamps(shown, shown.recordedAt);
  return { soul, path, judgments, dispositions, reincarnations, realms: (extract.realms[skin] ?? []) as Realm[] };
}

/**
 * How the preview moves (§二):
 *   cycle   the four underworlds in turn, paused while hovered or focused
 *   manual  reduced motion: 地府 stays, the tabs switch by hand
 *   still   narrow: a still frame; a tap plays it once in place
 */
export type PreviewMode = "cycle" | "manual" | "still";
export const previewMode = ({ reduced, narrow }: { reduced: boolean; narrow: boolean }): PreviewMode =>
  reduced ? "manual" : narrow ? "still" : "cycle";

export const nextCiv = (skin: SealCiv): SealCiv => PREVIEW_ORDER[(PREVIEW_ORDER.indexOf(skin) + 1) % PREVIEW_ORDER.length];

/** The 30-second look (§一.6): four frames, 7 s each. */
export const PEEK_FRAMES = ["bench", "road", "app", "farewell"] as const;
export const PEEK_MS = 7_000;
/** The frame after `i` when stepping by `by` (±1), clamped at both ends: the look does not wrap. */
export const peekStep = (i: number, by: number): number => Math.min(PEEK_FRAMES.length - 1, Math.max(0, i + by));
