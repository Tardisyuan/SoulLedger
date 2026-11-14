/**
 * @jest-environment node
 *
 * 语言包的排印(设计参照 2026-11-15 §9,主会话确认 1):省略号是一个字形 `…`,不是三个点;英文与 egy 的撇号、引号是
 * 弯的(’ “ ”),中文的引号是「」。2026-11-15 前三份包里 `...` 与 `…` 混用(同一界面「提交中...」与「加载中…」并排),
 * 英文直撇号约 350 行。静态 import,不读文件,所以 `--findRelatedTests` 追得到,不进 always-run 清单。
 *
 * 变异:把 en.json 任一值改回 `Saving...` 或 `Can't` → 对应那条红并点名键。
 */
import en from "@soulledger/core/messages/en.json";
import zh from "@soulledger/core/messages/zh-Hans.json";
import egy from "@soulledger/core/messages/egy.json";

type Tree = { [k: string]: string | Tree };

function values(tree: Tree, prefix = ""): [string, string][] {
  return Object.entries(tree).flatMap(([k, v]) =>
    typeof v === "string" ? [[`${prefix}${k}`, v] as [string, string]] : values(v, `${prefix}${k}.`)
  );
}

const PACKS = { en, "zh-Hans": zh, egy } as unknown as Record<string, Tree>;
const offending = (lang: string, bad: RegExp) => values(PACKS[lang]).filter(([, v]) => bad.test(v)).map(([k]) => k);

describe("locale typography", () => {
  it("each pack has values to check (an empty walk checks nothing)", () => {
    for (const lang of Object.keys(PACKS)) expect(values(PACKS[lang]).length).toBeGreaterThan(1000);
  });

  it.each(Object.keys(PACKS))("%s: no three-dot ellipsis", (lang) => {
    expect(offending(lang, /\.\.\./)).toEqual([]);
  });

  it.each(Object.keys(PACKS))("%s: no straight double quotes", (lang) => {
    expect(offending(lang, /"/)).toEqual([]);
  });

  it.each(["en", "egy"])("%s: no straight apostrophe inside a word", (lang) => {
    expect(offending(lang, /[A-Za-z}]'[A-Za-z]/)).toEqual([]);
  });

  it("the check itself is live: it finds the pre-2026-11-15 spellings", () => {
    const sample: Tree = { a: "Saving...", b: "Can't reach the server", c: 'Type "Overwrite"' };
    expect(values(sample).filter(([, v]) => /\.\.\./.test(v)).map(([k]) => k)).toEqual(["a"]);
    expect(values(sample).filter(([, v]) => /[A-Za-z}]'[A-Za-z]/.test(v)).map(([k]) => k)).toEqual(["b"]);
    expect(values(sample).filter(([, v]) => /"/.test(v)).map(([k]) => k)).toEqual(["c"]);
  });
});
