/**
 * 受刑站状态按「文明 × 去处类型」显示(v4 第十批第 3 条):`nodeStateNamespace` 只选命名空间,数据不动。
 * 站上没有 `realm_type`,core 的 `REALM_SHOWN_TYPE` 从种子表抄来;这里读那份 Python 逐条核对,
 * 第九批起与种子完全一致(`REALM_SHOWN_TYPE_OVERRIDES` 为空);两真之殿、欧洲阿刻戎、岔路口的草地另有按界域的词
 * (`node_states_by_realm`);希腊按《理想国》判的先查 `gr_republic`(第十二批 GR 9)。
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import en from "@soulledger/core/messages/en.json";
import egy from "@soulledger/core/messages/egy.json";
import zh from "@soulledger/core/messages/zh-Hans.json";
import { NODE_STATES, REALM_SHOWN_TYPE, REALM_SHOWN_TYPE_OVERRIDES, civKey, nodeStateNamespace } from "@soulledger/core/domain/sentenceNodeStates";

const SEED = path.resolve(__dirname, "../../../backend/apps/actors/mythology/realms.py");

const translator = (bundle: unknown) => (key: string) => {
  let cur: unknown = bundle;
  for (const seg of key.split(".")) cur = cur && typeof cur === "object" ? (cur as Record<string, unknown>)[seg] : undefined;
  return typeof cur === "string" ? cur : key;
};
const t = translator(zh);
const word = (civ: string, code: string, status: string) => t(`${nodeStateNamespace(t, civ, code, status)}.${status}`);

describe("nodeStateNamespace", () => {
  it("says the state in the place's words", () => {
    expect(word("EU_HEAVEN_HELL", "EU_PURGATORY_T1_PRIDE", "ACTIVE")).toBe("涤罪中");
    // 前庭按种子是 HELL(第九批第 3 条):读欧洲地狱的「永罚」,不再有「永留前庭」。
    expect(word("EUROPEAN", "EU_ANTINFERNO", "ETERNAL")).toBe("永罚");
    expect(word("EG_DUAT", "EG_SEVEN_ARRWT", "WAITING")).toBe("在杜阿特等候");
    // 按界域的覆盖先于按类型的:两真之殿、欧洲阿刻戎渡口。
    expect(word("EG_DUAT", "EG_HALL_TWO_TRUTHS", "ACTIVE")).toBe("等候称心");
    expect(word("EG_DUAT", "EG_ANNIHILATION", "ETERNAL")).toBe("已湮灭");
    expect(word("EU_HEAVEN_HELL", "EU_ACHERON", "ACTIVE")).toBe("岸边等候");
    expect(word("EU_HEAVEN_HELL", "GR_PLATO_MEADOW", "ACTIVE")).toBe("草地上候判");
    expect(word("GR_HADES", "GR_ISLES_OF_THE_BLESSED", "ACTIVE")).toBe("居于至福岛");
    // Absence: 炼狱 no longer reads 「受刑中」.
    expect(word("EU_HEAVEN_HELL", "EU_PURGATORY", "ACTIVE")).not.toBe(t("sentence_plan.node_states.ACTIVE"));
  });

  it("keeps the shared word where v4 keeps it, and where a place should not have the state", () => {
    // 地府整套沿用;四文明的未开始 / 调拨中 / 手动结束 / 已减项 / 随计划撤销沿用。
    expect(nodeStateNamespace(t, "CN_DIYU", "DY_COURT_05_YANLUO", "ACTIVE")).toBe(NODE_STATES);
    expect(nodeStateNamespace(t, "EU_HEAVEN_HELL", "EU_PURGATORY", "PENDING")).toBe(NODE_STATES);
    // 「沿用」与「(不出现)」:欧洲地狱的刑满暂留、湮灭的受刑中。
    expect(nodeStateNamespace(t, "EU_HEAVEN_HELL", "EU_HELL_2ND", "WAITING")).toBe(NODE_STATES);
    expect(nodeStateNamespace(t, "EG_DUAT", "EG_ANNIHILATION", "ACTIVE")).toBe(NODE_STATES);
    // An unknown place or civilization, or none.
    expect(nodeStateNamespace(t, "EU_HEAVEN_HELL", "EU_NOWHERE", "ACTIVE")).toBe(NODE_STATES);
    expect(nodeStateNamespace(t, "ATLANTEAN", "EU_PURGATORY", "ACTIVE")).toBe(NODE_STATES);
    expect(nodeStateNamespace(t, null, null, null)).toBe(NODE_STATES);
  });

  it("the three bundles carry the same 30 keys", () => {
    const keys = (b: unknown) => {
      const byCiv = (b as { sentence_plan: { node_states_by_civ: Record<string, Record<string, Record<string, string>>> } }).sentence_plan.node_states_by_civ;
      return Object.entries(byCiv).flatMap(([civ, types]) => Object.entries(types).flatMap(([type, states]) => Object.keys(states).map((s) => `${civ}.${type}.${s}`))).sort();
    };
    expect(keys(zh)).toHaveLength(30);
    expect(keys(en)).toEqual(keys(zh));
    expect(keys(egy)).toEqual(keys(zh));
  });

  it("REALM_SHOWN_TYPE is the seed's realm_type", () => {
    const seed = Object.fromEntries(
      // A row starts its line; the comments quote retired rows (`("EG_AM_TYAT", …`) after a `#`.
      [...readFileSync(SEED, "utf8").matchAll(/^ {4}\("((?:DY|EU|EG|GR)_[A-Z0-9_]+)",[\s\S]*?RealmType\.([A-Z]+)/gm)].map((m) => [m[1], m[2]])
    );
    // Empty-scan guard: the regex found the seed's rows.
    expect(Object.keys(seed).length).toBeGreaterThan(25);
    const ours = Object.fromEntries(Object.entries(REALM_SHOWN_TYPE).map(([code, type]) => [code, REALM_SHOWN_TYPE_OVERRIDES[code] ?? type]));
    expect(ours).toEqual(seed);
    // Batch 9 removed both overrides; any new one must really differ, or it would vouch for nothing.
    expect(Object.keys(REALM_SHOWN_TYPE_OVERRIDES).filter((code) => REALM_SHOWN_TYPE[code] === REALM_SHOWN_TYPE_OVERRIDES[code])).toEqual([]);
  });

  it("a case judged on the Republic reads gr_republic first, then gr (batch 12 GR 9)", () => {
    const greek = (code: string, status: string, account?: string) =>
      t(`${nodeStateNamespace(t, "GREEK", code, status, account)}.${status}`);
    expect(greek("GR_ISLES_OF_THE_BLESSED", "ACTIVE", "REPUBLIC")).toBe("天上千年");
    expect(greek("GR_TARTARUS", "ACTIVE", "REPUBLIC")).toBe("地下千年");
    expect(greek("GR_ISLES_OF_THE_BLESSED", "ACTIVE", "GORGIAS")).toBe("居于至福岛");
    expect(greek("GR_ISLES_OF_THE_BLESSED", "ACTIVE")).toBe("居于至福岛");
    // Absence: the Republic words stay out of the other civilizations.
    expect(nodeStateNamespace(t, "EUROPEAN", "EU_HEAVEN", "ACTIVE", "REPUBLIC")).toBe("sentence_plan.node_states_by_civ.eu.BLISS");
  });
});

describe("civKey (batch 12 §1)", () => {
  it("the plan layer is neutral, and the underworld keeps 受刑计划", () => {
    expect(t(civKey(t, "sentence_plan.panel_title", "CN_DIYU"))).toBe("受刑计划");
    expect(t(civKey(t, "sentence_plan.panel_title", "EUROPEAN"))).toBe("去处计划");
    expect(t(civKey(t, "souls.events.SENTENCE_PLAN_CREATED", "CHINESE"))).toBe("受刑计划生成");
    expect(t(civKey(t, "souls.events.SENTENCE_PLAN_CREATED", "GR_HADES"))).toBe("去处计划生成");
    // No civilization: the neutral word, never 受刑.
    expect(t(civKey(t, "sentence_plan.panel_title", null))).toBe("去处计划");
  });

  it("the soul's own layer goes by civilization × place, punishment keeps the base word", () => {
    expect(t(civKey(t, "soul_app.sentence.section_title", "EUROPEAN", "PURGATORY"))).toBe("我的涤罪");
    expect(t(civKey(t, "soul_app.sentence.section_title", "CHINESE", "BLISS"))).toBe("我的居所");
    expect(civKey(t, "soul_app.sentence.section_title", "CHINESE", "HELL")).toBe("soul_app.sentence.section_title");
    expect(t(civKey(t, "soul_app.sentence.state.active", "GREEK", "BLISS", "REPUBLIC"))).toBe("天上千年");
    expect(t(civKey(t, "soul_app.sentence.state.active", "GREEK", "BLISS", "GORGIAS"))).toBe("居于至福岛");
  });

  it("with a place and no typed word, the civilization's own fallback comes before the base (batch 13 §4)", () => {
    expect(t(civKey(t, "soul_app.sentence.all_done_title", "EGYPTIAN", "BLISS"))).toBe("去处计划已全部走完");
    expect(t(civKey(t, "soul_app.sentence.blocked_link", "EUROPEAN", "PURGATORY"))).toBe("看我的去处");
    // The typed word still wins over the fallback, and a civilization with neither keeps the base.
    expect(t(civKey(t, "soul_app.sentence.all_done_title", "CHINESE", "BLISS"))).toBe("停留期已满");
    expect(civKey(t, "soul_app.sentence.all_done_title", "CHINESE", "HELL")).toBe("soul_app.sentence.all_done_title");
  });
});
