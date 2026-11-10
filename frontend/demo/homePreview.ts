import type { Disposition, Judgment, Realm, Reincarnation, Soul, SoulPathEntry } from "@soulledger/core/api";
import type { SealCiv } from "@/src/components/plaque/Seal";
import { allRows, type Recording } from "./store";

/**
 * The demo home page's moving preview (Design 第二十七批 §一.2, §二): one real soul per underworld, taken from that
 * underworld's judge recording, drawn with the soul page's own journey block. Pure, so it is tested without a page.
 */

export const PREVIEW_ORDER: readonly SealCiv[] = ["cn", "eu", "eg", "gr"];
export const CIVILIZATION_OF: Record<SealCiv, string> = { cn: "CHINESE", eu: "EUROPEAN", eg: "EGYPTIAN", gr: "GREEK" };

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

type Row = Record<string, unknown>;

/**
 * The soul the preview follows: one of this underworld with a road already walked and exactly one stop it is at now.
 * The longest walked road wins (more to see); a tie keeps the recording's order. `null` when no soul qualifies.
 */
export function previewSoul(rec: Recording, skin: SealCiv): PreviewSoul | null {
  const civilization = CIVILIZATION_OF[skin];
  let best: { soul: Row; path: SoulPathEntry[]; walked: number } | null = null;
  for (const soul of allRows(rec, "/souls/")) {
    if (soul.civilization !== civilization) continue;
    const path = rec.docs[`/souls/${String(soul.id)}/path/`]?.b;
    if (!Array.isArray(path)) continue;
    const entries = path as SoulPathEntry[];
    const now = entries.filter((e) => e.left_at === null).length;
    const walked = entries.length - now;
    if (now !== 1 || walked < 1) continue;
    if (!best || walked > best.walked) best = { soul, path: entries, walked };
  }
  if (!best) return null;
  const rows = <T,>(collection: string) => (rec.lists[`${collection}?soul=${String(best.soul.id)}`]?.rows ?? []) as T[];
  return {
    soul: best.soul as unknown as PreviewSoul["soul"],
    path: best.path,
    realms: allRows(rec, "/realms/") as unknown as Realm[],
    judgments: rows<Judgment>("/judgment/"),
    dispositions: rows<Disposition>("/disposition/"),
    reincarnations: rows<Reincarnation>("/reincarnation/"),
  };
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
