/**
 * @jest-environment node
 *
 * The demo home page's preview (Design 第二十七批): the extract it draws from, and how it moves.
 *
 * The extract (`frontend/demo/data/home-preview.json`) is written by `scripts/demo-home-preview.mjs` from the judge
 * recordings, so the page never loads a 1.6–3.6 MB recording just to draw a few stops. Two things can go wrong
 * silently: a re-record without re-running the script (the preview shows a soul the recordings no longer have), and
 * the extract growing back toward a recording's size. Both are checked here.
 */
import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import path from "node:path";
import extract from "@/demo/data/home-preview.json";
import { PEEK_FRAMES, PREVIEW_ORDER, nextCiv, peekStep, previewMode, previewOf, type PreviewExtract } from "@/demo/homePreviewFrames";

const FRONTEND = path.resolve(__dirname, "..", "..");
const SCRIPT = path.join(FRONTEND, "..", "scripts", "demo-home-preview.mjs");
const EXTRACT = path.join(FRONTEND, "demo", "data", "home-preview.json");
const committed = extract as unknown as PreviewExtract;

describe("the preview's extract", () => {
  it("is what the script gives from the committed recordings", () => {
    // Throws (exit 1) when they differ; the message says to run the script.
    expect(() => execFileSync(process.execPath, [SCRIPT, "--check"], { stdio: "pipe" })).not.toThrow();
  });

  it("stays small: under 30 KB", () => {
    expect(statSync(EXTRACT).size).toBeLessThan(30 * 1024);
  });

  it.each(PREVIEW_ORDER.flatMap((skin) => (["zh", "en"] as const).map((lang) => [skin, lang] as const)))(
    "%s / %s: a soul with a walked road and one stop now, and its underworld's realms",
    (skin, lang) => {
      const shown = previewOf(committed, skin, lang);
      expect(shown).not.toBeNull();
      const now = shown!.path.filter((e) => e.left_at === null);
      expect(now).toHaveLength(1);
      expect(shown!.path.length).toBeGreaterThan(1);
      expect(shown!.realms.some((r) => r.id === now[0].realm_id)).toBe(true);
    },
  );

  it("moves its stamps with the calendar, as the recordings' are moved", () => {
    const at = "2026-01-01T00:00:00.000Z";
    const fake: PreviewExtract = {
      realms: { cn: [{ id: "r1" }] },
      zh: {
        cn: {
          recordedAt: at,
          soul: { id: "s", name: "马", civilization: "CHINESE", current_state: "DISPOSED" },
          path: [{ id: "e", sequence: 1, realm_id: "r1", realm_code: "X", entered_at: at, left_at: null }],
          judgments: [],
          dispositions: [],
          reincarnations: [],
        },
      },
      en: {},
    };
    const shown = previewOf(fake, "cn", "zh")!;
    expect(shown.realms).toEqual([{ id: "r1" }]);
    expect(Date.parse(shown.path[0].entered_at)).toBeGreaterThan(Date.parse(at));
    expect(previewOf(fake, "cn", "en")).toBeNull();
  });
});

describe("how the preview moves", () => {
  it("cycles when it may, stays put for reduced motion (even when narrow), is a still frame when narrow", () => {
    expect(previewMode({ reduced: false, narrow: false })).toBe("cycle");
    expect(previewMode({ reduced: true, narrow: false })).toBe("manual");
    expect(previewMode({ reduced: true, narrow: true })).toBe("manual");
    expect(previewMode({ reduced: false, narrow: true })).toBe("still");
  });

  it("turns 地府 → 欧洲 → 埃及 → 希腊 → 地府", () => {
    expect([nextCiv("cn"), nextCiv("eu"), nextCiv("eg"), nextCiv("gr")]).toEqual(["eu", "eg", "gr", "cn"]);
  });

  it("the 30-second look steps through four frames without wrapping", () => {
    expect(PEEK_FRAMES).toHaveLength(4);
    expect(peekStep(0, -1)).toBe(0);
    expect(peekStep(0, 1)).toBe(1);
    expect(peekStep(3, 1)).toBe(3);
  });
});
