/**
 * @jest-environment node
 */
/** A preset has no database row, so its English lives in `workflowPresetEnglish.ts`. Complete in both directions. */
import { WORKFLOW_TEMPLATES } from "@soulledger/core/config/workflow-templates";
import { PRESET_ENGLISH, presetEnglish, presetLabel } from "@soulledger/core/config/workflowPresetEnglish";

const CJK = /[㐀-鿿]/;
const presets = Object.values(WORKFLOW_TEMPLATES);
const shown = [...new Set(presets.flatMap((p) => [p.name, p.description, ...p.nodes.map((n) => n.name)]))].filter((s) => CJK.test(s));

describe("the presets' English", () => {
  it("has every Chinese string a preset shows", () => {
    expect(shown.filter((s) => !PRESET_ENGLISH[s])).toEqual([]);
  });

  it("has nothing no preset shows: a stale entry would look like a name that is still in use", () => {
    expect(Object.keys(PRESET_ENGLISH).filter((s) => !shown.includes(s))).toEqual([]);
  });

  it("is English", () => {
    expect(Object.values(PRESET_ENGLISH).filter((s) => CJK.test(s))).toEqual([]);
  });

  it("shows the English only to an English reader, and the source when there is none", () => {
    expect(presetLabel("十殿审判流程", "en")).toBe(presetEnglish("十殿审判流程"));
    expect(presetLabel("十殿审判流程", "zh-Hans")).toBe("十殿审判流程");
    expect(presetLabel("十殿审判流程", "egy")).toBe("十殿审判流程");
    expect(presetLabel("没有这个预设", "en")).toBe("没有这个预设");
    expect(presetEnglish("没有这个预设")).toBe("");
  });
});
