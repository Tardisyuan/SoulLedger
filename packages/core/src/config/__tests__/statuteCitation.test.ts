import { describe, expect, it } from "vitest";

import type { Statute } from "../../api/judgment";
import { citationOf, formatCitation, resolveCitation, squash } from "../statuteCitation";

/**
 * 〔文献 · 条号〕 is written in three places and read back in one. What must hold:
 * what `citationOf` writes, `resolveCitation` reads back to the same article; a
 * bare sigil and a code resolve too; a miss is a miss, not the nearest article.
 */
const base = {
  polarity: "OFFENCE", title_zh: "", title_en: "", title_egy: "", text_zh: "", text_en: "", text_egy: "",
  display_title: "", display_text: "", is_derived: false, source: "", source_notes: [],
} as const;
const S = (o: Partial<Statute> & Pick<Statute, "id" | "code" | "civilization" | "corpus" | "ordinal">): Statute =>
  ({ ...base, payload_json: {}, ...o }) as Statute;

const JIUJI = S({ id: "cn", code: "CN-GGG-J-06", civilization: "CHINESE", corpus: "GONGGUOGE", ordinal: 42,
  payload_json: { gate: "救濟門", gate_ordinal: 6 } });
const INFERNO = S({ id: "eu", code: "EU-INF-26", civilization: "EUROPEAN", corpus: "INFERNO", ordinal: 26,
  payload_json: { circle: 9 } });
const ER = S({ id: "gr", code: "GR-ER-04", civilization: "GREEK", corpus: "REPUBLIC_ER", ordinal: 4,
  payload_json: { stephanus: "614b" } });
const ALL = [JIUJI, INFERNO, ER];
const NAMES: Record<string, string> = { GONGGUOGE: "功過格", INFERNO: "地獄篇", REPUBLIC_ER: "厄爾神話" };
const name = (c: string) => NAMES[c] ?? c;

describe("statuteCitation", () => {
  it("writes 〔文献 · 条号〕", () => {
    expect(formatCitation("功過格", "救濟門 · 六")).toBe("〔功過格 · 救濟門 · 六〕");
    expect(citationOf(JIUJI, name)).toBe("〔功過格 · 救濟門 · 六〕");
    expect(citationOf(INFERNO, name)).toBe("〔地獄篇 · IX · XXVI〕");
  });

  it.each(ALL.map((s) => [s.code, s]))("reads back what it writes: %s", (_code, s) => {
    expect(resolveCitation(ALL, citationOf(s, name), name)?.id).toBe(s.id);
  });

  it("resolves a bare sigil and a code, ignoring spacing, 「·」 and case", () => {
    expect(resolveCitation(ALL, "救濟門六", name)?.id).toBe("cn");
    expect(resolveCitation(ALL, "ix xxvi", name)?.id).toBe("eu");
    expect(resolveCitation(ALL, "614B", name)?.id).toBe("gr");
    expect(resolveCitation(ALL, "eu-inf-26", name)?.id).toBe("eu");
  });

  it("a miss is undefined — not the nearest article", () => {
    expect(resolveCitation(ALL, "〔功過格 · 救濟門 · 七〕", name)).toBeUndefined();
    expect(resolveCitation(ALL, "〔地獄篇 · 救濟門 · 六〕", name)).toBeUndefined();
    expect(resolveCitation(ALL, "   ", name)).toBeUndefined();
  });

  it("squash is the one comparison", () => {
    expect(squash(" IX · XXVI ")).toBe("ixxxvi");
  });
});
