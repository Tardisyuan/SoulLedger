/**
 * Where a soul is on its civilization's road — v4's 「你现在在哪」 (soul.here.*), its vertical route on the 本世
 * page (map.soul.*, V4Batch07 01 地图「竖版 · 灵魂端：主干同上，支线不画」) and the lock-screen live progress
 * (live.*, 03「锁屏实时活动的步骤」). One reading for all three, pure, so it is tested without a screen.
 *
 * The steps are v4's (same names as the map). What places the soul on them is only what `/me/` and
 * `/me/sentence-plan/` already say: the 地府 station (`diyu_station`), the state, the Greek ferry, the European
 * vestibule, and the current sentence station's realm. Where those say nothing definite there is no route
 * (`null`) and the page keeps its five-stage line.
 *
 * Not drawn: 地府 鬼门关 (a label on the map, not a station of `DiyuStation`) and 希腊 三判官 (its only words
 * are the demo tour's, `demo.tour.gr.3.name`; the three judges sit at 岔路口的草地, which is drawn).
 */
import type { MeProfile, MeSentencePlan, MeSentenceStation } from "../api/soul";
import { DIYU_STATIONS, diyuStationOrdinal } from "./diyuStations";

/** The skins (mobile theme.ts `CivKey`): the road is drawn for the four civilizations; "neutral" has none. */
type CivKey = "neutral" | "cn" | "eu" | "eg" | "gr";

type Tr = (key: string, params?: Record<string, string>) => string;

export interface RouteStep {
  id: string;
  label: string;
  /** The line under the current step (第五殿 · 阎罗, 第三百年 …). */
  sub?: string;
  /** A road that ends here (湮灭, 永罚的塔尔塔罗斯): v4 draws it in a pale red, not the metal. */
  end?: boolean;
}

export interface SoulRoute {
  civ: Exclude<CivKey, "neutral">;
  steps: RouteStep[];
  at: number;
  /** The big line under 「你现在在哪」. */
  place: string;
  /** The sentence under it (soul.here.*), when v4 has one for this place. */
  line?: string;
  /** The road's name once the verdict has chosen one (live tag: 下行 / 上行 / 经至福岛 / 千年循环 / 通过 / 不过). */
  path?: string;
  /** 地府 only: the station's number (1–13) and the trunk's count, for 「第 10 站」 and 「10 / 11」. */
  station?: { n: number; pos: number; total: number };
}

/** 地府's trunk: the thirteen less the two officer-moved branches (十八层地狱、莲花台). */
const BRANCHES = new Set<string>(["EIGHTEEN_HELLS", "LOTUS_TERRACE"]);
const DIYU_TRUNK = DIYU_STATIONS.filter((s) => !BRANCHES.has(s));

/** The sentence station the soul is at now: serving, eternal, or waiting to move on. */
export function currentStation(plan: MeSentencePlan | null | undefined): MeSentenceStation | null {
  return plan?.stations.find((s) => s.status === "active" || s.status === "eternal" || s.status === "waiting") ?? null;
}

function realmOf(plan: MeSentencePlan | null | undefined): { code: string; station: MeSentenceStation } | null {
  const station = currentStation(plan);
  return station?.realm ? { code: station.realm.realm_code, station } : null;
}

export interface RouteInput {
  me: MeProfile;
  /** The HOME civilization: the road and its words are the home's (residence.ts). */
  civ: CivKey;
  plan?: MeSentencePlan | null;
  /** The hall the soul is in now, by its hall name (useCurrentHall). */
  hall: string;
  /** Unused since the Greek years come from the backend (2026-11-07); kept so callers need not change. */
  now: number;
}

export function soulRoute({ me, civ, plan, hall }: RouteInput, tr: Tr): SoulRoute | null {
  const realm = (code: string) => tr(`realms.names.${code}`);
  const step = (id: string, label: string, extra?: Partial<RouteStep>): RouteStep => ({ id, label, ...extra });
  const judging = me.current_state === "JUDGING";

  // 地府's stations are where the soul is in 地府 now, as the 十三站 card always read them (not a residing soul's home).
  if (civ === "cn" && me.civilization === "CHINESE") {
    const station = me.diyu_station;
    const n = diyuStationOrdinal(station);
    if (n === null) return null;
    const name = (s: string) => tr(`souls.diyu_station.${s}`);
    const toFengdu = DIYU_TRUNK.slice(0, DIYU_TRUNK.indexOf("FENGDU_CITY") + 1).map((s) => step(s, name(s)));
    const steps: RouteStep[] = [
      ...toFengdu,
      step("TEN_COURTS", tr("map.diyu.ten_courts")),
      step("COURT10", tr("map.diyu.court10_bridges")),
      step("HUANHUN_CLIFF", name("HUANHUN_CLIFF")),
      step("SIX_PATHS", tr("map.diyu.six_paths")),
    ];
    let at: number;
    let place = name(station);
    let line: string | undefined = tr("soul_app.life.station_here", { station: place, desc: tr(`souls.diyu_station_desc.${station}`) });
    if (BRANCHES.has(station)) {
      // An officer moved the soul off the trunk: the branch is drawn where it leaves it, after 第十殿.
      at = steps.findIndex((s) => s.id === "HUANHUN_CLIFF");
      steps.splice(at, 0, step(station, place, { sub: tr("map.diyu.moved_by_officer") }));
    } else if (station === "FENGDU_CITY" && judging) {
      at = steps.findIndex((s) => s.id === "TEN_COURTS");
      steps[at] = { ...steps[at], sub: hall || undefined };
      place = hall ? `${steps[at].label} · ${hall}` : steps[at].label;
      line = hall ? tr("soul.here.cn_court", { court: hall }) : undefined;
    } else {
      at = steps.findIndex((s) => s.id === station);
    }
    const pos = BRANCHES.has(station) ? DIYU_TRUNK.indexOf("FENGDU_CITY") + 1 : DIYU_TRUNK.indexOf(station as (typeof DIYU_TRUNK)[number]) + 1;
    return { civ, steps, at, place, line, station: { n, pos, total: DIYU_TRUNK.length } };
  }

  if (civ === "eg") {
    const common = [
      step("EMBALMING", tr("map.egypt.embalming_70_days")),
      step("EG_DUAT_ENTRY", realm("EG_DUAT_ENTRY")),
      step("EG_SEVEN_ARRWT", realm("EG_SEVEN_ARRWT")),
      step("WEIGHING", tr("map.egypt.weighing")),
    ];
    const passed = [...common, step("EG_TWENTYONE_SEBKHET", realm("EG_TWENTYONE_SEBKHET")), step("EG_AARU", realm("EG_AARU"))];
    if (judging) return { civ, steps: passed, at: 3, place: common[3].label, line: tr("soul.here.eg_weighing") };
    const r = realmOf(plan);
    if (r?.code === "EG_ANNIHILATION") {
      const steps = [...common, step("EG_ANNIHILATION", realm("EG_ANNIHILATION"), { end: true })];
      return { civ, steps, at: 4, place: steps[4].label, path: tr("judgment.verdicts.failed") };
    }
    const at = r ? passed.findIndex((s) => s.id === r.code) : -1;
    return at < 0 ? null : { civ, steps: passed, at, place: passed[at].label, path: tr("judgment.verdicts.passed") };
  }

  if (civ === "eu") {
    const death = step("DEATH", tr("souls.detail.death"));
    const down = [death, step("EU_ACHERON", realm("EU_ACHERON")), step("EU_ANTINFERNO", realm("EU_ANTINFERNO")), step("CIRCLES", tr("map.europe.circles"))];
    const up = [death, step("TERRACES", tr("map.europe.terraces")), step("EU_EARTHLY_PARADISE", realm("EU_EARTHLY_PARADISE")), step("EU_HEAVEN", realm("EU_HEAVEN"))];
    const here = (steps: RouteStep[], at: number, where: string, path: string): SoulRoute => ({
      civ,
      steps,
      at,
      place: steps[at].label,
      line: tr("soul.here.eu_realm", { realm: where }),
      path,
    });
    const r = realmOf(plan);
    if (r?.code.startsWith("EU_HELL_")) {
      const steps = down.map((s, i) => (i === 3 ? { ...s, sub: realm(r.code) } : s));
      return here(steps, 3, realm(r.code), tr("live.path.eu_down"));
    }
    if (r?.code.startsWith("EU_PURGATORY")) {
      const steps = up.map((s, i) => (i === 1 ? { ...s, sub: realm(r.code) } : s));
      return here(steps, 1, realm(r.code), tr("live.path.eu_up"));
    }
    if (r?.code === "EU_EARTHLY_PARADISE") return here(up, 2, up[2].label, tr("live.path.eu_up"));
    if (r?.code === "EU_HEAVEN") return here(up, 3, up[3].label, tr("live.path.eu_up"));
    if (me.european_vestibule) return here(down, 2, down[2].label, tr("live.path.eu_down"));
    return null;
  }

  if (civ === "gr") {
    const base = [step("DEATH", tr("souls.detail.death")), step("GR_ACHERON", realm("GR_ACHERON")), step("EU_PLATO_MEADOW", realm("EU_PLATO_MEADOW"))];
    const cycle = step("CYCLE", tr("map.greece.thousand_year_cycle"));
    const lethe = step("LETHE", tr("souls.detail.memory_mechanisms.LETHE"));
    const r = realmOf(plan);
    if (r?.code === "GR_ISLES_OF_THE_BLESSED") {
      const steps = [...base, step(r.code, realm(r.code)), cycle, lethe];
      return { civ, steps, at: 3, place: steps[3].label, path: tr("live.path.gr_isles") };
    }
    if (r?.code === "GR_TARTARUS" && r.station.is_eternal) {
      const steps = [...base, step(r.code, realm(r.code), { end: true })];
      return { civ, steps, at: 3, place: steps[3].label, path: steps[3].label };
    }
    if (r?.code === "GR_TARTARUS") {
      // The repository's Tartarus is the thousand years of Rep. 615a (disposition/services.py): v4's 千年循环.
      // The years are the ledger's SENTENCE reading (`elapsed_years`, from `Disposition.term_start_*`), the same
      // figure the officer's map shows (user 2026-11-07) — not the station's start, which is when the office
      // carried the paperwork out. No term start recorded: no number.
      const run = r.station.elapsed_years;
      const years = run == null ? null : String(Math.max(0, run));
      const steps = [...base, years === null ? cycle : { ...cycle, sub: tr("map.greece.year_n", { n: years }) }, lethe];
      return {
        civ,
        steps,
        at: 3,
        place: cycle.label,
        line: years === null ? undefined : tr("soul.here.gr_thousand", { n: years }),
        path: cycle.label,
      };
    }
    if (judging) return { civ, steps: base, at: 2, place: base[2].label };
    if (me.greek_ferry && !me.greek_ferry.crossed) return { civ, steps: base, at: 1, place: base[1].label };
    return null;
  }
  return null;
}

/**
 * What the lock screen shows (V4Batch07 05 App「锁屏 · 实时活动」, 灵动岛三种状态). Every string is localised
 * here; the native side only lays them out. 地府's eleven steps are too many: it names the start, the current
 * station and the end (03「地府 11 格太多，下面只写起点、当前、终点三个名字」), and so does every other road.
 */
export interface LiveContent {
  title: string;
  tag: string;
  headline: string;
  count: string;
  /** The Dynamic Island's compact right end: 「10/11」. */
  compact: string;
  /** Expanded island: the place, and under it the soul and the step. */
  place: string;
  island: string;
  first: string;
  current: string;
  last: string;
  /** 0–1 along the road. */
  progress: number;
  /** The road ends here (湮灭, 永罚): drawn in the pale red. */
  ended: boolean;
}

export function liveContent(route: SoulRoute, soul: string, tr: Tr): LiveContent {
  const here = route.steps[route.at];
  const s = route.station;
  const n = s ? s.pos : route.at + 1;
  const total = s ? s.total : route.steps.length;
  const step = s ? tr("live.cn_station", { n: String(s.n), station: here.label }) : here.label;
  return {
    title: tr("live.title"),
    tag: route.path ?? "",
    headline: tr("live.headline", { soul, step }),
    count: s ? tr("live.count", { n: String(n), total: String(total) }) : tr("demo.tour.progress", { n: String(n), total: String(total) }),
    compact: `${n}/${total}`,
    place: route.place,
    island: s ? tr("live.island_sub", { soul, n: String(s.n) }) : tr("live.headline", { soul, step }),
    first: route.steps[0].label,
    current: here.label,
    last: route.steps[route.steps.length - 1].label,
    progress: total > 1 ? (n - 1) / (total - 1) : 1,
    ended: !!here.end,
  };
}
