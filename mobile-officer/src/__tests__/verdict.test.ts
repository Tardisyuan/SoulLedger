/** 滑卡审判的规则(verdict.ts):天平挡哪边、理由选够了没有、发给 conclude/ 的是什么、判语预览。 */
import { translate } from "../shared";
import {
  NO_CHOICE,
  blockedSide,
  chooseAccount,
  courtNumeral,
  deadlineText,
  failPayload,
  passPayload,
  previewOf,
  rejectReady,
  toggleReason,
  waitedDays,
} from "../verdict";

const t = (key: string, vars?: Record<string, string>) => translate("zh-Hans", key, vars);
const weighed = (v: string) => ({ civilization: "EGYPTIAN", admitted_balance: { weighing: { weighed_verdict: v } } }) as never;

it("Egypt: the scale blocks the other side; other halls and an unweighed case block nothing", () => {
  expect(blockedSide(weighed("PASSED"))).toBe("left");
  expect(blockedSide(weighed("FAILED"))).toBe("right");
  expect(blockedSide({ civilization: "EGYPTIAN", admitted_balance: {} } as never)).toBeNull();
  expect(blockedSide({ civilization: "CHINESE", admitted_balance: { weighing: { weighed_verdict: "FAILED" } } } as never)).toBeNull();
});

it("地府 / 欧洲 take one reason; 「其他」 needs a sentence", () => {
  let c = toggleReason("CHINESE", NO_CHOICE, "TRADE_FRAUD");
  expect(rejectReady("CHINESE", c)).toBe(true);
  c = toggleReason("CHINESE", c, "MURDER");
  expect(c.reasons).toEqual(["MURDER"]);
  c = toggleReason("EUROPEAN", NO_CHOICE, "OTHER");
  expect(rejectReady("EUROPEAN", c)).toBe(false);
  expect(rejectReady("EUROPEAN", { ...c, note: "  " })).toBe(false);
  expect(failPayload("EUROPEAN", { ...c, note: " 一句 " })).toEqual({ verdict: "FAILED", fail_reasons: ["OTHER"], fail_reason_note: "一句" });
  expect(rejectReady("CHINESE", NO_CHOICE)).toBe(false);
});

it("希腊: account, at least one scar and the mark are all required; switching account drops the other set", () => {
  let c = chooseAccount(NO_CHOICE, "GORGIAS");
  c = toggleReason("GREEK", toggleReason("GREEK", c, "PERJURY"), "INJUSTICE");
  expect(c.reasons).toEqual(["PERJURY", "INJUSTICE"]);
  expect(rejectReady("GREEK", c)).toBe(false);
  c = { ...c, curability: "INCURABLE" };
  expect(rejectReady("GREEK", c)).toBe(true);
  expect(failPayload("GREEK", c)).toEqual({
    verdict: "FAILED", fail_reasons: ["PERJURY", "INJUSTICE"], fail_reason_note: "", greek_account: "GORGIAS", greek_curability: "INCURABLE",
  });
  expect(chooseAccount(c, "REPUBLIC").reasons).toEqual([]);
  expect(passPayload("GREEK", "REPUBLIC")).toEqual({ verdict: "PASSED", greek_account: "REPUBLIC" });
  expect(passPayload("CHINESE")).toEqual({ verdict: "PASSED" });
});

it("埃及 sends no reasons (the scale lists them; any reason is refused)", () => {
  expect(rejectReady("EGYPTIAN", NO_CHOICE)).toBe(true);
  expect(failPayload("EGYPTIAN", { ...NO_CHOICE, reasons: ["OTHER"], note: "x" })).toEqual({ verdict: "FAILED" });
});

it("the preview says the draft's sentence, and nothing where the destination is not known yet", () => {
  expect(previewOf(t, "CHINESE", { ...NO_CHOICE, reasons: ["TRADE_FRAUD"] }, "zh-Hans")).toBe("所犯交易欺诈，属第四殿所掌，解送第四殿。");
  expect(previewOf(t, "CHINESE", { ...NO_CHOICE, reasons: ["FIVE_HEINOUS"] }, "zh-Hans")).toBe("犯五逆，不经各殿，解送第九殿阿鼻大地狱。");
  expect(previewOf(t, "CHINESE", { ...NO_CHOICE, reasons: ["OTHER"] }, "zh-Hans")).toBeNull();
  expect(previewOf(t, "EUROPEAN", { ...NO_CHOICE, reasons: ["NEUTRAL"] }, "zh-Hans")).toBe("登记为中立者，留在地狱前庭。");
  expect(previewOf(t, "EUROPEAN", { ...NO_CHOICE, reasons: ["DENIED_IMMORTALITY"] }, "zh-Hans")).toBeNull();
  expect(previewOf(t, "EUROPEAN", { ...NO_CHOICE, reasons: ["MORTAL_SIN"] }, "zh-Hans")).toBeNull();
  expect(previewOf(t, "GREEK", { ...NO_CHOICE, account: "REPUBLIC", curability: "INCURABLE" }, "zh-Hans")).toBe("出口不纳，抛入塔尔塔罗斯。");
  expect(previewOf(t, "GREEK", { ...NO_CHOICE, account: "GORGIAS", curability: "CURABLE" }, "zh-Hans")).toBe("加上标记：可医。送往塔尔塔罗斯。");
  expect(previewOf(t, "GREEK", { ...NO_CHOICE, account: "GORGIAS" }, "zh-Hans")).toBeNull();
});

it("court numerals are Han in Chinese and digits elsewhere", () => {
  expect(courtNumeral(4, "zh-Hans")).toBe("四");
  expect(courtNumeral(4, "en")).toBe("4");
});

it("deadline and days waited", () => {
  expect(deadlineText(t, { deadline_remaining_seconds: null })).toBe("不计");
  expect(deadlineText(t, { deadline_remaining_seconds: 86_400 * 2 + 5 })).toBe("3 日");
  expect(deadlineText(t, { deadline_remaining_seconds: -86_400 })).toBe("超 1 日");
  // 候审中:期限还没开始,不按「从候至那天起」的剩余天数写。
  expect(deadlineText(t, { deadline_remaining_seconds: 86_400 * 10_956, held_until: "2056-11-01" })).toBe("候审中 · 不计期限");
  expect(deadlineText(t, { deadline_remaining_seconds: 86_400, conclude_refusal: "at_city_god" })).toBe("候审中 · 不计期限");
  expect(deadlineText(t, { deadline_remaining_seconds: 86_400, duat_stage: "NAMELESS" })).toBe("候审中 · 不计期限");
  const now = Date.parse("2026-11-06T12:00:00Z");
  expect(waitedDays({ claimable_since: "2026-11-02T11:00:00Z", created_at: "2026-10-01T00:00:00Z" }, now)).toBe(4);
  expect(waitedDays({ claimable_since: null, created_at: "2026-11-05T00:00:00Z" }, now)).toBe(1);
});
