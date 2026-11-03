/** An English reader sees reference names in English; what people typed, and the forms that edit those names, are left alone. */
import { configurePlatform } from "@soulledger/core/platform";
import { englishNames, isTranslated, originalNames } from "@/lib/i18n/englishApiNames";
import names from "@/src/lib/i18n/referenceNames.en.json";
import { WORKFLOW_TEMPLATES } from "@soulledger/core/config/workflow-templates";

jest.mock("@soulledger/core/platform", () => {
  const actual = jest.requireActual("@soulledger/core/platform");
  return { ...actual, getLocale: jest.fn(() => "en") };
});
void configurePlatform;
const { getLocale } = jest.requireMock("@soulledger/core/platform") as { getLocale: jest.Mock };

describe("englishNames", () => {
  it("translates a whole string, anywhere in the body", () => {
    expect(englishNames({ results: [{ node_name: "秦广王 · 分流", nested: { court_code: "第五殿" } }] })).toEqual({
      results: [{ node_name: "King Qinguang · triage", nested: { court_code: "Fifth Court" } }],
    });
  });

  it("does not touch a string that merely contains one", () => {
    expect(englishNames("第五殿的来信")).toBe("第五殿的来信");
    expect(englishNames("屈原")).toBe("屈原");
  });

  it("keeps the generated part of a prefixed name", () => {
    expect(englishNames("转生申请: ACZJ689D8Q")).toBe("Rebirth application: ACZJ689D8Q");
  });

  it("leaves numbers, nulls and blobs alone", () => {
    const blob = new Blob(["x"]);
    expect(englishNames({ a: 1, b: null, c: blob })).toEqual({ a: 1, b: null, c: blob });
  });
});

describe("isTranslated", () => {
  beforeEach(() => getLocale.mockReturnValue("en"));

  it("English GETs only", () => {
    expect(isTranslated("/workflows/1/", "get")).toBe(true);
    expect(isTranslated("/workflows/1/", "post")).toBe(false);
    getLocale.mockReturnValue("zh-Hans");
    expect(isTranslated("/workflows/1/", "get")).toBe(false);
    getLocale.mockReturnValue("egy");
    expect(isTranslated("/workflows/1/", "get")).toBe(false);
  });

  it.each(["/workflow/templates/3/", "/organizations/12/", "/perm/permissions/4/"])("not the form that edits it: %s", (url) => {
    expect(isTranslated(url, "get")).toBe(false);
  });

  it("the demo has no server to protect, so its templates read in English, and only those", () => {
    process.env.NEXT_PUBLIC_DEMO_MODE = "1";
    try {
      expect(isTranslated("/workflow/templates/3/", "get")).toBe(true);
      expect(isTranslated("/workflow/templates/", "get")).toBe(true);
      expect(isTranslated("/organizations/12/", "get")).toBe(false);
    } finally {
      delete process.env.NEXT_PUBLIC_DEMO_MODE;
    }
  });
});

describe("originalNames: English reference names are for reading only", () => {
  const [zh, en] = Object.entries(names as Record<string, string>)[0];

  it("reads in English and writes back the original, so an edit cannot rename the record", () => {
    const shown = englishNames({ name: zh, note: "写给殿司" }) as { name: string; note: string };
    expect(shown.name).toBe(en);
    expect(originalNames({ name: shown.name, nested: [{ name: en }], note: shown.note })).toEqual({
      name: zh,
      nested: [{ name: zh }],
      note: "写给殿司",
    });
  });

  it("leaves what is not plain JSON alone", () => {
    const form = new FormData();
    expect(originalNames(form)).toBe(form);
    expect(originalNames(undefined)).toBeUndefined();
  });
});

describe("the table itself", () => {
  const table = names as Record<string, string>;

  // Not `type`: it is read only by `nodeTypeFor` and never shown, and it is words like 等待 and 结束 that a person could type.
  const presets = Object.values(WORKFLOW_TEMPLATES);
  const shownInPresets = [...new Set(presets.flatMap((p) => [p.name, p.description, ...p.nodes.flatMap((n) => [n.name, n.court])]))];

  it("has every Chinese string a preset shows", () => {
    expect(shownInPresets.filter((s) => /[\u3400-\u9fff]/.test(s) && !table[s])).toEqual([]);
  });

  it("restores them on the way back, so a template saved from a preset stores what the preset says", () => {
    for (const s of shownInPresets) expect(originalNames(englishNames(s))).toBe(s);
  });

  it("never gives two Chinese strings one English string: a write could not tell which to restore", () => {
    const owners = new Map<string, string[]>();
    for (const [zh, en] of Object.entries(table)) owners.set(en, [...(owners.get(en) ?? []), zh]);
    expect([...owners].filter(([, zh]) => zh.length > 1)).toEqual([]);
  });

  // menuI18n.ts `DIRECTORY_KEYS` and useSidebarMenus.ts `hideTheWheel` find these by their Chinese name.
  // 系统设置 is not here on purpose: it is also a permission's name (/permissions), and the sidebar shows the same English.
  it.each(["概览", "灵魂业务", "流程协作", "组织与领域", "社交", "轮回", "全局"])("leaves the menu group %s to the code that matches on it", (group) => {
    expect(table[group]).toBeUndefined();
  });

  it("does not reach the corpus", () => {
    for (const statute of ["不仁門", "焚修門", "傲慢", "贪婪", "奪紀奪算"]) expect(table[statute]).toBeUndefined();
  });
});
