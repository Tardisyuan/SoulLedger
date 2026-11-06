/**
 * 受刑站状态按「文明 × 去处类型」显示(v4 第十批第 3 条):`nodeStateNamespace` 只选命名空间,数据不动。
 * 站上没有 `realm_type`,core 的 `REALM_SHOWN_TYPE` 从种子表抄来;这里读那份 Python 逐条核对,
 * 除了写明理由的两处(`REALM_SHOWN_TYPE_OVERRIDES`)。
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import en from "@soulledger/core/messages/en.json";
import egy from "@soulledger/core/messages/egy.json";
import zh from "@soulledger/core/messages/zh-Hans.json";
import { NODE_STATES, REALM_SHOWN_TYPE, REALM_SHOWN_TYPE_OVERRIDES, nodeStateNamespace } from "@soulledger/core/domain/sentenceNodeStates";

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
    expect(word("EUROPEAN", "EU_ANTINFERNO", "ETERNAL")).toBe("永留前庭");
    expect(word("EG_DUAT", "EG_SEVEN_ARRWT", "WAITING")).toBe("门前等候");
    expect(word("EG_DUAT", "EG_HALL_TWO_TRUTHS", "ACTIVE")).toBe("等候称心");
    expect(word("EG_DUAT", "EG_ANNIHILATION", "ETERNAL")).toBe("已湮灭");
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

  it("the three bundles carry the same 29 keys", () => {
    const keys = (b: unknown) => {
      const byCiv = (b as { sentence_plan: { node_states_by_civ: Record<string, Record<string, Record<string, string>>> } }).sentence_plan.node_states_by_civ;
      return Object.entries(byCiv).flatMap(([civ, types]) => Object.entries(types).flatMap(([type, states]) => Object.keys(states).map((s) => `${civ}.${type}.${s}`))).sort();
    };
    expect(keys(zh)).toHaveLength(29);
    expect(keys(en)).toEqual(keys(zh));
    expect(keys(egy)).toEqual(keys(zh));
  });

  it("REALM_SHOWN_TYPE is the seed's realm_type, except the two written down", () => {
    const seed = Object.fromEntries(
      // A row starts its line; the comments quote retired rows (`("EG_AM_TYAT", …`) after a `#`.
      [...readFileSync(SEED, "utf8").matchAll(/^ {4}\("((?:EU|EG|GR)_[A-Z0-9_]+)",[\s\S]*?RealmType\.([A-Z]+)/gm)].map((m) => [m[1], m[2]])
    );
    // Empty-scan guard: the regex found the seed's rows.
    expect(Object.keys(seed).length).toBeGreaterThan(25);
    const ours = Object.fromEntries(Object.entries(REALM_SHOWN_TYPE).map(([code, type]) => [code, REALM_SHOWN_TYPE_OVERRIDES[code] ?? type]));
    expect(ours).toEqual(seed);
    // The overrides really differ, or they would vouch for nothing.
    expect(Object.keys(REALM_SHOWN_TYPE_OVERRIDES).filter((code) => REALM_SHOWN_TYPE[code] === REALM_SHOWN_TYPE_OVERRIDES[code])).toEqual([]);
  });
});
