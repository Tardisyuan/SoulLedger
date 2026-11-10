/**
 * The demo home page's preview (Design 第二十七批): which recorded soul it follows per underworld, and how it moves.
 */
import { PEEK_FRAMES, nextCiv, peekStep, previewMode, previewSoul } from "@/demo/homePreview";
import type { Recording } from "@/demo/store";

const entry = (realm: string, left: string | null) => ({ id: `${realm}-e`, sequence: 1, realm_id: realm, realm_code: realm, entered_at: "2024-01-01T00:00:00Z", left_at: left });

function rec(): Recording {
  const souls = [
    { id: "other-civ", name: "Lucia", civilization: "EUROPEAN", current_state: "DISPOSED" },
    { id: "only-now", name: "王", civilization: "CHINESE", current_state: "JUDGING" },
    { id: "short", name: "马", civilization: "CHINESE", current_state: "DISPOSED" },
    { id: "long", name: "孙", civilization: "CHINESE", current_state: "DISPOSED" },
    { id: "gone", name: "屈", civilization: "CHINESE", current_state: "REINCARNATING" },
    { id: "no-path", name: "董", civilization: "CHINESE", current_state: "DISPOSED" },
  ];
  return {
    role: "judge",
    lang: "zh",
    recordedAt: "2026-11-01T00:00:00Z",
    login: { user: {} },
    lists: {
      "/souls/": { rows: souls, extra: {} },
      "/realms/": { rows: [{ id: "r1", civilization: "CHINESE" }], extra: {} },
      "/judgment/?soul=long": { rows: [{ id: "j1" }], extra: {} },
    },
    docs: {
      "/souls/other-civ/path/": { s: 200, b: [entry("a", "x"), entry("b", null), entry("c", "y"), entry("d", "z")] },
      "/souls/only-now/path/": { s: 200, b: [entry("a", null)] },
      "/souls/short/path/": { s: 200, b: [entry("a", "x"), entry("b", null)] },
      "/souls/long/path/": { s: 200, b: [entry("a", "x"), entry("b", "y"), entry("c", null)] },
      "/souls/gone/path/": { s: 200, b: [entry("a", "x"), entry("b", "y"), entry("c", "z"), entry("d", "w")] },
    },
  } as unknown as Recording;
}

describe("previewSoul", () => {
  it("follows the soul of this underworld with the longest walked road and one stop now", () => {
    const shown = previewSoul(rec(), "cn");
    expect(shown?.soul.id).toBe("long");
    expect(shown?.path).toHaveLength(3);
    expect(shown?.judgments).toEqual([{ id: "j1" }]);
    expect(shown?.dispositions).toEqual([]);
    expect(shown?.realms.map((r) => r.id)).toEqual(["r1"]);
  });

  it("skips a soul with no current stop, one that has walked nothing, and another underworld's", () => {
    const r = rec();
    r.docs["/souls/long/path/"] = { s: 200, b: [entry("a", "x"), entry("b", "y")] };
    r.docs["/souls/short/path/"] = { s: 200, b: [entry("a", null)] };
    expect(previewSoul(r, "cn")).toBeNull();
  });

  it("keeps the recording's order on a tie", () => {
    const r = rec();
    r.docs["/souls/long/path/"] = { s: 200, b: [entry("a", "x"), entry("b", null)] };
    expect(previewSoul(r, "cn")?.soul.id).toBe("short");
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
