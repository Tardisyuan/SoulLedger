/**
 * 殿名按界面语言(2026-10-19 用户决定):库里中英混写的同一个殿对到一个键 `workflow.court.<slug>`,
 * 中文界面写中文、英文界面写英文、埃及文界面写英文;认不出的原样显示。
 */
import en from "@soulledger/core/messages/en.json";
import zhHans from "@soulledger/core/messages/zh-Hans.json";
import egy from "@soulledger/core/messages/egy.json";
import { COURT_EN, courtLabel, courtSlug } from "@soulledger/core/domain/courts";
import { WORKFLOW_TEMPLATES } from "@soulledger/core/config/workflow-templates";
import { pickHall } from "@soulledger/core/domain/workflowSegments";
import egyPendingKeys from "./support/egyPendingKeys.json";

type Bundle = Record<string, unknown>;
const lookup = (bundle: Bundle, key: string): string | undefined => {
  const v = key.split(".").reduce<unknown>((node, part) => (node && typeof node === "object" ? (node as Bundle)[part] : undefined), bundle);
  return typeof v === "string" ? v : undefined;
};
/** The apps' `t`: the active bundle, then zh-Hans, then the key; `{{x}}` filled. */
const tFor = (bundle: Bundle) => (key: string, vars?: Record<string, string>) =>
  (lookup(bundle, key) ?? lookup(zhHans as Bundle, key) ?? key).replace(/\{\{(\w+)\}\}/g, (w, k: string) => vars?.[k] ?? w);
const tZh = tFor(zhHans as Bundle);
const tEn = tFor(en as Bundle);
const tEgy = tFor(egy as Bundle);

describe("courtLabel", () => {
  it("zh shows 天堂 / 第十殿, en Heaven / Tenth Court", () => {
    expect(courtLabel(tZh, "天堂", "zh-Hans")).toBe("天堂");
    expect(courtLabel(tZh, "第十殿", "zh-Hans")).toBe("第十殿");
    expect(courtLabel(tEn, "天堂", "en")).toBe("Heaven");
    expect(courtLabel(tEn, "第十殿", "en")).toBe("Tenth Court");
  });

  it("the Chinese and the English spelling of one court are one key", () => {
    for (const [a, b] of [["Heaven", "天堂"], ["Heaven Gate", "天堂之门"], ["Hall of Two Truths", "两真之殿"], ["Duat", "杜阿特"], ["Purgatory Court", "炼狱"]]) {
      expect(courtSlug(a)).not.toBeNull();
      expect(courtSlug(a)).toBe(courtSlug(b));
    }
    // Absence: a zh screen never shows the stored English, an en screen never the stored Chinese.
    expect(courtLabel(tZh, "Heaven", "zh-Hans")).not.toContain("Heaven");
    expect(courtLabel(tZh, "Hall of Two Truths", "zh-Hans")).toBe("两真之殿");
    expect(courtLabel(tEn, "两真之殿", "en")).toBe("Hall of Two Truths");
    expect(courtLabel(tEn, "第一殿", "en")).not.toMatch(/[一-鿿]/);
  });

  it("an unknown court is shown as stored; nothing gives nothing", () => {
    expect(courtLabel(tEn, "本殿自定", "en")).toBe("本殿自定");
    expect(courtLabel(tZh, "Somewhere", "zh-Hans")).toBe("Somewhere");
    expect(courtLabel(tZh, "", "zh-Hans")).toBe("");
    expect(courtLabel(tZh, null, "zh-Hans")).toBe("");
  });

  it("egy shows the English, not the Chinese the bundle fallback would give", () => {
    expect(courtLabel(tEgy, "天堂", "egy")).toBe("Heaven");
    expect(courtLabel(tEgy, "第十殿", "egy")).toBe("Tenth Court");
  });

  it("every preset court is known, and every slug has zh and en words; egy waits on the pending list", () => {
    const courts = Object.values(WORKFLOW_TEMPLATES).flatMap((tpl) => tpl.nodes.map((n) => n.court));
    expect(courts.length).toBeGreaterThan(30);
    expect(courts.filter((c) => c && courtSlug(c) === null)).toEqual([]);
    for (const [slug, english] of Object.entries(COURT_EN)) {
      expect(lookup(zhHans as Bundle, `workflow.court.${slug}`)).toBeTruthy();
      expect(lookup(en as Bundle, `workflow.court.${slug}`)).toBe(english);
      expect(egyPendingKeys).toContain(`workflow.court.${slug}`);
    }
    expect(Object.keys((zhHans as { workflow: { court: object } }).workflow.court).sort()).toEqual(Object.keys(COURT_EN).sort());
  });

  it("the built-in templates' English spellings are known too", () => {
    // backend/apps/workflow/templates.py `WORKFLOW_TEMPLATES` (2026-10-19).
    for (const c of ["Diocese", "Archdiocese", "Vatican", "Confessional", "Purgatory Court", "Heaven Gate", "Heaven", "Hall of Two Truths", "Duat"]) {
      expect(courtSlug(c)).not.toBeNull();
    }
  });

  it("the 待我选站 hall puts the court in the UI language", () => {
    const row = { realm: "CN_DIYU", hall: "Chinese Afterlife", court: "第十殿" };
    expect(pickHall(tZh, row, "zh-Hans")).toBe("酆都第十殿");
    expect(pickHall(tEn, row, "en")).toContain("Tenth Court");
    expect(pickHall(tEn, row, "en")).not.toContain("第十殿");
  });
});
