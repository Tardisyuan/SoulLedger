/**
 * 今日律条 is a fixed list (the login page has no session to read statutes
 * with). What keeps it from becoming invented copy is this: every quote must
 * appear VERBATIM in the corpus source the seeder writes, beside its code.
 *
 * The Python source splits long strings across implicit concatenation
 * (`"…岛，"\n            "在那里…"`), so the source is read with those joins
 * removed before searching.
 */
import fs from "node:fs";
import path from "node:path";
import { formatSigil } from "@soulledger/core/config/civilizationSigil";
import { LOGIN_STATUTES } from "@/src/lib/loginStatutes";

const MYTHOLOGY = path.resolve(__dirname, "../../../backend/apps/actors/mythology");
const source = fs
  .readdirSync(MYTHOLOGY)
  .filter((f) => f.endsWith(".py"))
  .map((f) => fs.readFileSync(path.join(MYTHOLOGY, f), "utf8"))
  .join("\n")
  .replace(/"\s*\n\s*"/g, "");

describe("LOGIN_STATUTES", () => {
  it("read the corpus (an empty source would make every check below vacuous)", () => {
    expect(source.length).toBeGreaterThan(10000);
  });

  it.each(LOGIN_STATUTES.map((s) => [s.code, s]))("%s is quoted verbatim from the corpus", (_code, statute) => {
    expect(source).toContain(statute.text);
  });

  it.each(LOGIN_STATUTES.map((s) => [s.code, s]))("%s names the rulebook its code belongs to", (_code, statute) => {
    // The 文献 half of 〔文献 · 条号〕: CN-GGG-* is the 功過格, GR-GRG-* the Gorgias.
    expect(statute.corpus).toBe(statute.code.startsWith("CN-GGG-") ? "GONGGUOGE" : "GORGIAS");
    expect(statute.code.startsWith("CN-GGG-") || statute.code.startsWith("GR-GRG-")).toBe(true);
  });

  it.each(LOGIN_STATUTES.map((s) => [s.code, s]))("%s cites a sigil its civilization can format", (_code, statute) => {
    expect(formatSigil(statute.civilization, statute.ref)).toBeTruthy();
  });

  it("names 功過格 codes the way statutes_chinese.py builds them, from the gate and gate ordinal", () => {
    const segment: Record<string, string> = { 用事門: "F-YS", 不仁門: "G-BR" };
    for (const s of LOGIN_STATUTES.filter((x) => x.civilization === "CHINESE")) {
      const expected = `CN-GGG-${segment[s.ref.division ?? ""]}-${String(s.ref.gateOrdinal).padStart(2, "0")}`;
      expect(s.code).toBe(expected);
    }
  });
});
