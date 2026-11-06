import { describe, expect, it } from "vitest";

import en from "../../../messages/en.json";
import zh from "../../../messages/zh-Hans.json";
import { hanDigits, hanNumber, localParts, verdictDocument, type VerdictDocumentInput } from "../verdictDocument";

/** 真语言包的 `t`:缺键时返回键本身,于是「键写错了」在断言里看得见。 */
const tOf = (bundle: Record<string, unknown>) => (key: string, vars: Record<string, string> = {}) => {
  const v = key.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), bundle);
  return typeof v === "string" ? v.replace(/\{\{(\w+)\}\}/g, (_, n) => vars[n] ?? `{{${n}}}`) : key;
};
const tz = tOf(zh as Record<string, unknown>);
const ten = tOf(en as Record<string, unknown>);

const base: VerdictDocumentInput = {
  civilization: "CHINESE",
  verdict: "PASSED",
  soulName: "李青竹",
  concludedAtLocal: "2026-11-06T14:40:00+08:00",
  han: true,
  court: "第一殿",
  judgeName: "秦广王",
  merit: 30,
  demerit: 30,
  bornYear: 1931,
  diedYear: 2026,
};

describe("汉字数字", () => {
  it("年份逐位,计数按读法", () => {
    expect(hanDigits(1931)).toBe("一九三一");
    expect(hanDigits(2026)).toBe("二〇二六");
    expect([0, 6, 10, 11, 30, 42, 105, 1010, 23456].map(hanNumber)).toEqual([
      "零", "六", "十", "十一", "三十", "四十二", "一百零五", "一千零一十", "二万三千四百五十六",
    ]);
  });
});

describe("落印时刻按串里的本地时间,不按运行环境的时区", () => {
  it("取串里的年月日与钟点", () => {
    expect(localParts("2026-11-06T23:40:00-05:00")).toEqual({ year: 2026, month: 11, day: 6, hour: 23 });
    expect(localParts(null)).toBeNull();
  });
});

describe("地府(定稿第五、六批)", () => {
  it("功过两平:竖排、汉字数字,与定稿样张逐字相同", () => {
    const doc = verdictDocument(base, tz)!;
    expect(doc.vertical).toBe(true);
    expect(doc.title).toBe("第一殿判词");
    expect(doc.body).toBe("查 李青竹，一九三一年生，二〇二六年卒。功 三十，过 三十。");
    expect(doc.ruling).toBe("功过两平，送交第十殿发放，仍投人世。");
    expect(doc.date).toBe("二〇二六年十一月六日 · 未时");
    expect(doc.signs).toEqual(["第一殿 秦广王"]);
    expect(doc.seal).toBe("第一殿之印");
  });

  it("功多于过写道别;不过按罪目换殿号;五逆直送第九殿", () => {
    expect(verdictDocument({ ...base, merit: 42, demerit: 18, rebirthForm: "HUMAN" }, tz)!.ruling).toBe("功多于过，送交第十殿发放，投生人道。");
    expect(verdictDocument({ ...base, verdict: "FAILED", offence: "TRADE_FRAUD" }, tz)!.ruling).toBe("所犯交易欺诈，属第四殿所掌，解送第四殿。");
    expect(verdictDocument({ ...base, verdict: "FAILED", offence: "FIVE_HEINOUS" }, tz)!.ruling).toBe("犯五逆，不经各殿，解送第九殿阿鼻大地狱。");
  });

  it("英文界面横排、阿拉伯数字", () => {
    const doc = verdictDocument({ ...base, han: false, judgeName: "King Qinguang" }, ten)!;
    expect(doc.vertical).toBe(false);
    expect(doc.body).toContain("born 1931");
    expect(doc.date).toBe(`6/11/2026 · ${ten("hours.cn.wei")}`);
  });
});

describe("欧洲", () => {
  const eu = { ...base, civilization: "EUROPEAN", soulName: "Giulia Ferri", han: true };
  it("地狱第 n 圈读处置界域;引用了七宗罪才写「哪一宗」", () => {
    const hell = verdictDocument({ ...eu, verdict: "FAILED", realmCode: "EU_HELL_4TH", citedDeadlySins: ["greed"] }, tz)!;
    expect(hell.ruling).toBe("有未悔的大罪，下地狱第 4 圈。");
    expect(hell.sins).toBe("贪婪");
    expect(hell.date).toBe("2026年11月6日 · 六时"); // 14:40 在六时(12–15 点),与顶栏同一张表
    expect(verdictDocument({ ...eu, verdict: "FAILED", realmCode: "EU_HELL_4TH" }, tz)!.sins).toBeUndefined();
  });

  it("前庭、否认灵魂不灭落第 6 圈、炼狱第 n 台、天国不写罪", () => {
    expect(verdictDocument({ ...eu, verdict: "FAILED", realmCode: "EU_ANTINFERNO" }, tz)!.ruling).toBe("登记为中立者，留在地狱前庭。");
    expect(verdictDocument({ ...eu, verdict: "FAILED", failReasons: ["DENIED_IMMORTALITY"] }, tz)!.ruling).toBe("有未悔的大罪，下地狱第 6 圈。");
    expect(verdictDocument({ ...eu, verdict: "PURGATORY", realmCode: "EU_PURGATORY_T5_AVARICE" }, tz)!.ruling).toBe("无未悔的大罪，入炼狱第 5 台，由下而上涤罪。");
    expect(verdictDocument({ ...eu, citedDeadlySins: ["pride"] }, tz)!.sins).toBeUndefined();
  });
});

describe("埃及", () => {
  it("跟天平;时辰是夜第几时", () => {
    const doc = verdictDocument({ ...base, civilization: "EGYPTIAN", soulName: "Nebamun", concludedAtLocal: "2026-11-06T23:40:00+02:00" }, tz)!;
    expect(doc.ruling).toBe("其中未见恶。不得交与阿米特。荷鲁斯引其至奥西里斯座前，往芦苇原。");
    expect(doc.date).toBe("2026年11月6日 · 夜 · 第 6 时");
  });
});

describe("希腊:按所选文书", () => {
  const gr = { ...base, civilization: "GREEK", soulName: "Elpenor", judgeName: "艾亚哥斯" };
  it("高尔吉亚:一审只写判官名 + 米诺斯终裁;不可医", () => {
    const doc = verdictDocument({ ...gr, verdict: "FAILED", greekAccount: "GORGIAS", greekCurability: "INCURABLE" }, tz)!;
    expect(doc.account).toBe("gr");
    expect(doc.name).toBe("Elpenor");
    expect(doc.ruling).toBe("加上标记：不可医。送往塔尔塔罗斯。");
    expect(doc.signs).toEqual(["艾亚哥斯", "米诺斯 终裁"]);
    expect(doc.date).toBe("2026年11月6日 · 昼");
  });

  it("理想国:不具名的审判者,不义与不可医两种判语", () => {
    const unjust = verdictDocument({ ...gr, verdict: "FAILED", greekAccount: "REPUBLIC", greekCurability: "CURABLE" }, tz)!;
    expect(unjust.account).toBe("gr_er");
    expect(unjust.title).toBe("四口之间 · 判决");
    expect(unjust.signs).toEqual(["四口之间的审判者"]);
    expect(unjust.ruling).toContain("判决佩在身后");
    expect(verdictDocument({ ...gr, verdict: "FAILED", greekAccount: "REPUBLIC", greekCurability: "INCURABLE" }, tz)!.ruling).toBe("出口不纳，抛入塔尔塔罗斯。");
  });
});

it("待定、重审、未结案没有文书", () => {
  expect(verdictDocument({ ...base, verdict: "RETRY" }, tz)).toBeNull();
  expect(verdictDocument({ ...base, verdict: null }, tz)).toBeNull();
});
