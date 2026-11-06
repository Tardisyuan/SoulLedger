import { describe, expect, it } from "vitest";

import en from "../../../messages/en.json";
import { civilHour, civilHourAt, type HourCiv } from "../civilHours";

const flat = (obj: Record<string, unknown>, prefix = ""): string[] =>
  Object.entries(obj).flatMap(([k, v]) => (v && typeof v === "object" ? flat(v as Record<string, unknown>, `${prefix}${k}.`) : [`${prefix}${k}`]));
const KEYS = new Set(flat(en as Record<string, unknown>));
const HOURS = Array.from({ length: 24 }, (_, h) => h);

describe("civilHourAt", () => {
  it("地府:子时跨午夜(23 与 0 同属子时),每两小时一辰,22 点是亥时", () => {
    expect(civilHourAt("cn", 23).key).toBe("hours.cn.zi");
    expect(civilHourAt("cn", 0).key).toBe("hours.cn.zi");
    expect(civilHourAt("cn", 1).key).toBe("hours.cn.chou");
    expect(civilHourAt("cn", 12).key).toBe("hours.cn.wu");
    expect(civilHourAt("cn", 14).key).toBe("hours.cn.wei"); // 定稿样张 14:40 = 未时
    expect(civilHourAt("cn", 22).key).toBe("hours.cn.hai");
    expect(new Set(HOURS.map((h) => civilHourAt("cn", h).key)).size).toBe(12);
  });

  it("欧洲:八个时辰各管三小时,15:40 是九时(定稿样张)", () => {
    expect(civilHourAt("eu", 0).key).toBe("hours.eu.matins");
    expect(civilHourAt("eu", 3).key).toBe("hours.eu.lauds");
    expect(civilHourAt("eu", 15).key).toBe("hours.eu.none");
    expect(civilHourAt("eu", 23).key).toBe("hours.eu.compline");
    expect(new Set(HOURS.map((h) => civilHourAt("eu", h).key)).size).toBe(8);
  });

  it("埃及:6–17 是昼;18 是夜之第 1 时,5 点是第 12 时", () => {
    expect(civilHourAt("eg", 10)).toEqual({ key: "hours.eg.day" }); // 定稿样张 10:40 = 昼
    expect(civilHourAt("eg", 17)).toEqual({ key: "hours.eg.day" });
    expect(civilHourAt("eg", 18)).toEqual({ key: "hours.eg.night", params: { n: "1" } });
    expect(civilHourAt("eg", 0)).toEqual({ key: "hours.eg.night", params: { n: "7" } });
    expect(civilHourAt("eg", 5)).toEqual({ key: "hours.eg.night", params: { n: "12" } });
  });

  it("希腊:昼夜界线同埃及,20:40 是夜(定稿样张)", () => {
    expect(civilHourAt("gr", 6).key).toBe("hours.gr.day");
    expect(civilHourAt("gr", 5).key).toBe("hours.gr.night");
    expect(civilHourAt("gr", 20).key).toBe("hours.gr.night");
  });

  it("每个结果都是语言包里真有的键(断言不在场:没有生造的键)", () => {
    for (const civ of ["cn", "eu", "eg", "gr"] as HourCiv[]) for (const h of HOURS) expect(KEYS.has(civilHourAt(civ, h).key)).toBe(true);
  });

  it("钟点越界或不是整数就抛,不静默给名字", () => {
    expect(() => civilHourAt("cn", 24)).toThrow(RangeError);
    expect(() => civilHourAt("cn", -1)).toThrow(RangeError);
    expect(() => civilHourAt("cn", 1.5)).toThrow(RangeError);
  });

  it("civilHour 读 Date 的本地钟点(观看者的时区)", () => {
    expect(civilHour("cn", new Date(2026, 10, 6, 14, 40))).toEqual({ key: "hours.cn.wei" });
  });
});
