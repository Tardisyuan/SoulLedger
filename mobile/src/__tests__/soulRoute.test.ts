/**
 * soulRoute: where a soul is on v4's road, read only from what /me/ and the sentence plan already say.
 * Absence as well as presence: a soul whose data says nothing definite gets no route at all.
 */
import type { MeProfile, MeSentencePlan } from "@soulledger/core/api/soul";

import { translate } from "../i18n";
import { liveContent, soulRoute } from "@soulledger/core/domain/soulRoute";
import { PROFILE } from "./stubApi";

const tr = (key: string, params?: Record<string, string>) => translate("zh-Hans", key, params);
const me = (over: Partial<MeProfile> = {}) => ({ ...PROFILE, ...over }) as unknown as MeProfile;
const NOW = Date.parse("2026-11-06T12:00:00Z");
const plan = (realm_code: string, over: Record<string, unknown> = {}) =>
  ({
    state: "serving",
    rebirth_open: false,
    stations: [
      { id: "s1", n: 1, status: "done", is_home: true, civilization: "X", realm: { realm_code: "EU_ACHERON", name_local: "", name_zh: "", name_en: "" }, sentence_years: 1, is_eternal: false, started_on: null, ends_on: null },
      { id: "s2", n: 2, status: "active", is_home: true, civilization: "X", realm: { realm_code, name_local: "", name_zh: "", name_en: "" }, sentence_years: 1000, is_eternal: false, started_on: "1726-11-06", ends_on: null, ...over },
    ],
  }) as unknown as MeSentencePlan;

describe("soulRoute", () => {
  it("地府 judging at 酆都城: here is 十殿 · the hall, with v4's sentence; the lock screen counts station 10 of the 11", () => {
    const r = soulRoute({ me: me({ current_state: "JUDGING", diyu_station: "FENGDU_CITY" } as never), civ: "cn", hall: "第五殿", now: NOW }, tr)!;
    expect(r.steps[r.at]).toMatchObject({ id: "TEN_COURTS", label: "十殿", sub: "第五殿" });
    expect(r.place).toBe("十殿 · 第五殿");
    expect(r.line).toBe("你正在第五殿受审。判官在看你这一生的功与过。");
    expect(r.steps.map((s) => s.id)).not.toContain("EIGHTEEN_HELLS");
    const live = liveContent(r, "李青竹", tr);
    expect([live.headline, live.count, live.compact, live.first, live.last]).toEqual(["李青竹 · 第 10 站 · 十殿", "10 / 11", "10/11", "土地庙", "六道轮回"]);
  });

  it("地府 moved onto a branch: the branch is drawn as the current step, marked as an officer's move", () => {
    const r = soulRoute({ me: me({ diyu_station: "EIGHTEEN_HELLS" } as never), civ: "cn", hall: "", now: NOW }, tr)!;
    expect(r.steps[r.at]).toMatchObject({ id: "EIGHTEEN_HELLS", sub: "官员挪站" });
    expect(r.steps[r.at + 1].id).toBe("HUANHUN_CLIFF");
  });

  it("埃及: weighing while judging; 湮灭 ends the road and is marked so", () => {
    const judging = soulRoute({ me: me({ current_state: "JUDGING" }), civ: "eg", hall: "", now: NOW }, tr)!;
    expect([judging.place, judging.line, judging.path]).toEqual(["两真之殿 · 称心", "你的心正在天平上，和玛特之羽相比。", undefined]);
    const gone = soulRoute({ me: me({ current_state: "DISPOSED" }), civ: "eg", plan: plan("EG_ANNIHILATION"), hall: "", now: NOW }, tr)!;
    expect(gone.steps[gone.at]).toMatchObject({ id: "EG_ANNIHILATION", end: true });
    expect(liveContent(gone, "Nebamun", tr).ended).toBe(true);
  });

  it("欧洲: a hell station puts the soul in 地狱九圈 with the circle beneath, on the downward road", () => {
    const r = soulRoute({ me: me({ current_state: "DISPOSED" }), civ: "eu", plan: plan("EU_HELL_9TH"), hall: "", now: NOW }, tr)!;
    expect(r.steps[r.at]).toMatchObject({ id: "CIRCLES", sub: "第九圈 - 背叛" });
    expect([r.line, r.path]).toEqual(["你在第九圈 - 背叛。", "下行"]);
  });

  it("希腊: the (non-eternal) Tartarus is the thousand years, counted from the station's start", () => {
    const r = soulRoute({ me: me({ current_state: "DISPOSED" }), civ: "gr", plan: plan("GR_TARTARUS"), hall: "", now: NOW }, tr)!;
    expect(r.steps[r.at]).toMatchObject({ id: "CYCLE", sub: "第 299 年" });
    expect(r.line).toBe("你在千年的路上，已经走了 299 年。");
    const eternal = soulRoute({ me: me({ current_state: "DISPOSED" }), civ: "gr", plan: plan("GR_TARTARUS", { is_eternal: true, status: "eternal" }), hall: "", now: NOW }, tr)!;
    expect(eternal.steps[eternal.at]).toMatchObject({ id: "GR_TARTARUS", end: true });
  });

  it("no definite place, no route: alive, an unknown station, a plan with nothing current", () => {
    expect(soulRoute({ me: me({ diyu_station: "" } as never), civ: "cn", hall: "", now: NOW }, tr)).toBeNull();
    expect(soulRoute({ me: me({ current_state: "ALIVE" }), civ: "eg", hall: "", now: NOW }, tr)).toBeNull();
    expect(soulRoute({ me: me({ current_state: "DISPOSED", european_vestibule: null }), civ: "eu", plan: { state: "none", rebirth_open: false, stations: [] } as never, hall: "", now: NOW }, tr)).toBeNull();
    expect(soulRoute({ me: me(), civ: "neutral", hall: "", now: NOW }, tr)).toBeNull();
  });
});
