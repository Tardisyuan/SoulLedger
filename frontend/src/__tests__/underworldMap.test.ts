/**
 * 冥界地图(v4 阶段 5):Design 交付的 SVG 能安全地插进页面,站码与代码一致,状态按行程画对。
 *
 * 读文件:八张地图与八个主视觉就在 public/v4/ 里,改一份 SVG 不会让 import 图选中这份测试,
 * 所以它在 jest.always-run.txt 里。
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { DIYU_STATIONS } from "@soulledger/core/domain/diyuStations";
import en from "@soulledger/core/messages/en.json";
import zh from "@soulledger/core/messages/zh-Hans.json";
import {
  applyBranches,
  applyView,
  diyuVisits,
  greekVisits,
  mapStates,
  paintStates,
  parseMapSvg,
  pathVisits,
  readPalette,
  stationNameKeys,
} from "@/src/lib/underworldMap";
import {
  BADGE,
  CLOSE_SCALE,
  HERO_NODES,
  UNMEASURED,
  addGrid,
  addHeroes,
  addScanRing,
  badgePlacement,
  badgeText,
  edgeHeat,
  flowOf,
  glowAlphaOf,
  heatByNode,
  heatOf,
  heroPlacement,
  loadOf,
  markLoads,
  mergeFlow,
  minLabelFont,
  moveGroupLabelsOffHeroes,
  narrowCamera,
  CLOSE_UP_BELOW_PX,
  nodeLoads,
  paintLight,
  panCamera,
} from "@/src/lib/underworldMapLayers";

const PUBLIC_V4 = path.join(__dirname, "..", "..", "public", "v4");
const files = (dir: string) => readdirSync(path.join(PUBLIC_V4, dir)).filter((f) => f.endsWith(".svg")).map((f) => path.join(dir, f));
const MAPS = files("maps");
const EMBLEMS = files("emblems").filter((f) => !f.endsWith("-mark.svg"));
const MARKS = files("emblems").filter((f) => f.endsWith("-mark.svg"));
const HEROES = files("maps/nodes");
const SOULFIRE = files("soulfire");
const read = (rel: string) => readFileSync(path.join(PUBLIC_V4, rel), "utf8");
const map = (skin: string, theme = "dark") => parseMapSvg(read(`maps/soulledger-map-${skin}-${theme}.svg`))!;

describe("the delivered SVGs are safe to put in the page", () => {
  it("are all there: four civilizations, dark and light, maps and emblems", () => {
    expect(MAPS).toHaveLength(8);
    expect(EMBLEMS).toHaveLength(8);
    expect(MARKS).toHaveLength(4);
  });

  it.each([...MAPS, ...EMBLEMS, ...MARKS, ...HEROES, ...SOULFIRE])("%s has no script, foreign content, handler, outside link or import", (rel) => {
    const text = read(rel);
    expect(text).not.toMatch(/<script/i);
    expect(text).not.toMatch(/foreignObject/i);
    expect(text).not.toMatch(/\son[a-z]+\s*=/i);
    expect(text).not.toMatch(/@import/i);
    expect(text).not.toMatch(/javascript:/i);
    // href 只许指向文件内的 #id;url() 同样。
    expect([...text.matchAll(/href\s*=\s*"([^"]*)"/g)].filter((m) => !m[1].startsWith("#"))).toEqual([]);
    expect([...text.matchAll(/url\(([^)]*)\)/g)].filter((m) => !m[1].startsWith("#"))).toEqual([]);
    // 唯一的网址是 SVG 的命名空间。
    expect([...text.matchAll(/https?:\/\/[^"' )]+/g)].map((m) => m[0])).toEqual(["http://www.w3.org/2000/svg"]);
  });

  // 主视觉背后那团光(填渐变的圆 / 椭圆)要整个落在 viewBox 里:伸出去的部分被 SVG 视口切掉,
  // 光晕顶上就是一条平边(2026-11-09 落地页:埃及 cy 60 / ry 90、希腊 cy 80 / ry 90,顶端在 −30、−10)。
  it.each(EMBLEMS)("%s keeps its halo inside the 240×240 viewBox", (rel) => {
    const text = read(rel);
    expect(text).toContain('viewBox="0 0 240 240"');
    const halos = [...text.matchAll(/<(circle|ellipse)\b[^>]*fill="url\(#[^)]*\)"[^>]*>/g)].map((m) => {
      const n = (a: string) => Number(m[0].match(new RegExp(`\\s${a}="([-\\d.]+)"`))![1]);
      const [rx, ry] = m[1] === "circle" ? [n("r"), n("r")] : [n("rx"), n("ry")];
      return { top: n("cy") - ry, bottom: n("cy") + ry, left: n("cx") - rx, right: n("cx") + rx };
    });
    expect(halos.length).toBeGreaterThan(0);
    for (const h of halos) {
      expect(Math.min(h.top, h.left)).toBeGreaterThanOrEqual(0);
      expect(Math.max(h.bottom, h.right)).toBeLessThanOrEqual(240);
    }
  });

  // 主视觉用 <img> 加载,<img> 里的 SVG 不加载网页字体:字要转成路径(第十九批的冥字印),不能留 <text>。
  it.each(EMBLEMS)("%s draws no text (an <img> SVG would fall back to a system font)", (rel) => {
    expect(read(rel)).not.toMatch(/<text\b|font-family/);
  });

  // 小号在 CivEmblem.tsx 里内联(currentColor 才跟随文字色):每个形状的参数都要和交付的文件一致。
  it.each(MARKS)("%s is what CivEmblem inlines", (rel) => {
    const source = readFileSync(path.join(__dirname, "..", "components", "brand", "CivEmblem.tsx"), "utf8");
    const body = read(rel).replace(/^<svg[^>]*>|<\/svg>\s*$/g, "");
    const shapes = [...body.matchAll(/<(path|circle|rect)\b([^>]*?)\/>/g)];
    expect(shapes.length).toBeGreaterThan(0);
    for (const [, tag, attrs] of shapes) expect(source).toContain(`<${tag}${attrs.replace(/\s+$/, "")} />`);
  });

  it("parseMapSvg drops script, style, handlers and outside links even if a file grows them", () => {
    const svg = parseMapSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" onload="x()"><style>.a{}</style><script>x()</script>' +
        '<a href="https://example.com"><rect onclick="x()" /></a><use href="#ok" /></svg>',
    )!;
    expect(svg.querySelector("script, style")).toBeNull();
    expect(svg.getAttribute("onload")).toBeNull();
    expect(svg.querySelector("rect")!.getAttribute("onclick")).toBeNull();
    expect(svg.querySelector("a")!.getAttribute("href")).toBeNull();
    expect(svg.querySelector("use")!.getAttribute("href")).toBe("#ok");
  });

  // 落地页内联主视觉(LandingEmblem)留图里的 <style>:它全写在 .emblem2[data-civ][data-theme] 下;带外链的照删。
  it("parseMapSvg keeps a scoped <style> only when asked, and never one that reaches outside", () => {
    const scoped = '<svg xmlns="http://www.w3.org/2000/svg"><style>.emblem2 .e-l{stroke-width:6}</style></svg>';
    expect(parseMapSvg(scoped)!.querySelector("style")).toBeNull();
    expect(parseMapSvg(scoped, { keepStyle: true })!.querySelector("style")!.textContent).toContain(".e-l");
    for (const bad of ["@import 'x.css';", ".a{background:url(https://example.com/x.png)}", '.a{fill:url("/x.svg")}']) {
      const svg = parseMapSvg(`<svg xmlns="http://www.w3.org/2000/svg"><style>${bad}</style></svg>`, { keepStyle: true })!;
      expect(svg.querySelector("style")).toBeNull();
    }
    const local = parseMapSvg('<svg xmlns="http://www.w3.org/2000/svg"><style>.a{fill:url(#g)}</style></svg>', { keepStyle: true })!;
    expect(local.querySelector("style")).not.toBeNull();
  });

  // 落地页的描线与光泽只认类名(emblemFx.ts):每份主视觉都要有主线 .e-l、刻度 .e-t,样式写在自己的作用域里。
  it.each(EMBLEMS)("%s has the classes the landing effects work off, and scopes its own style", (rel) => {
    const text = read(rel);
    const [, civ, theme] = rel.match(/emblem-(\w+)-(dark|light)\.svg$/)!;
    const svg = parseMapSvg(text, { keepStyle: true })!;
    expect(svg.querySelectorAll(".e-l").length).toBeGreaterThan(0);
    expect(svg.querySelectorAll(".e-t").length).toBeGreaterThan(0);
    expect(svg.getAttribute("class")).toBe("emblem2");
    expect(svg.getAttribute("data-civ")).toBe(civ);
    expect(svg.getAttribute("data-theme")).toBe(theme);
    expect(svg.querySelector("style")!.textContent).toContain(`.emblem2[data-civ="${civ}"][data-theme="${theme}"]`);
    // 描线临时设 pathLength=1,收尾整个删掉:文件里本来就不能有。
    expect(text).not.toMatch(/pathLength/);
  });

  it.each(MAPS)("%s has the terrain / labels / you-are-here layers and a readable palette", (rel) => {
    const svg = parseMapSvg(read(rel))!;
    expect(svg.querySelector("#terrain")).not.toBeNull();
    expect(svg.querySelector("#labels")).not.toBeNull();
    expect(svg.querySelector("#you-are-here")).not.toBeNull();
    expect(readPalette(svg)).not.toBeNull();
  });
});

describe("the Diyu map's ids are the codes the code uses", () => {
  it.each(["dark", "light"])("%s: all thirteen stations are nodes, with the four unnumbered ones", (theme) => {
    const svg = map("cn", theme);
    const nodes = [...svg.querySelectorAll("#terrain g.node[id]")].map((n) => n.id);
    for (const s of DIYU_STATIONS) expect(nodes).toContain(s);
    expect(nodes.filter((id) => !(DIYU_STATIONS as readonly string[]).includes(id)).sort()).toEqual(
      ["dy-court10-bridges", "dy-ghost-gate", "dy-six-paths", "dy-ten-courts"].sort(),
    );
    // 十殿是 dy-ten-courts 里的十个子格。
    expect(svg.querySelectorAll('#dy-ten-courts circle[id^="DY_COURT_"]')).toHaveLength(10);
  });
});

const lookup = (bundle: unknown, key: string): unknown =>
  key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], bundle);

describe("every station on every map has a name in the language packs", () => {
  // 取不到名字时组件退回图里的中文:英文界面上出现「三判官」(演示 E2E 2026-11-06)。egy 可以待补(egyPendingKeys)。
  it.each(MAPS.filter((f) => f.endsWith("-dark.svg")))("%s", (rel) => {
    const svg = parseMapSvg(read(rel))!;
    const unnamed = [...svg.querySelectorAll("#terrain g.node[id]")]
      .map((n) => n.id)
      .filter((id) => !stationNameKeys(id).some((k) => typeof lookup(en, k) === "string" && typeof lookup(zh, k) === "string"));
    expect(unnamed).toEqual([]);
  });
});

const stateOf = (svg: Element, id: string) => svg.querySelector(`[id="${id}"]`)!.getAttribute("data-state");

describe("states follow the soul", () => {
  it("Diyu on the Yellow Springs road: the first station and the ghost gate are walked, nothing after", () => {
    const svg = map("cn");
    const s = mapStates(svg, diyuVisits(DIYU_STATIONS, "YELLOW_SPRINGS_ROAD"));
    expect(s.nodes.get("TUDI_TEMPLE")).toBe("walked");
    expect(s.nodes.get("dy-ghost-gate")).toBe("walked");
    expect(s.nodes.get("YELLOW_SPRINGS_ROAD")).toBe("current");
    expect(s.nodes.get("WANGXIANG_TERRACE")).toBe("ahead");
    expect(s.nodes.get("dy-ten-courts")).toBe("ahead");
    expect(s.nodes.get("EIGHTEEN_HELLS")).toBe("ahead");
  });

  it("Diyu inside Fengdu at the fifth court: the courts node is current, the court cell too, the city walked", () => {
    const svg = map("cn");
    const path = [
      { realm_code: "DY_COURT_01_QINGUANG", left_at: "2026-01-02T00:00:00Z" },
      { realm_code: "DY_COURT_05_YANLUO", left_at: null },
    ];
    const s = mapStates(svg, diyuVisits(DIYU_STATIONS, "FENGDU_CITY", path));
    expect(s.current).toEqual({ node: "dy-ten-courts", cell: "DY_COURT_05_YANLUO" });
    expect(s.nodes.get("FENGDU_CITY")).toBe("walked");
    expect(s.cells.get("DY_COURT_01_QINGUANG")).toBe("walked");
    // Rule 16: a court with no record is not walked, even though its number is lower.
    expect(s.cells.has("DY_COURT_02_CHUJIANG")).toBe(false);
    const palette = readPalette(svg)!;
    paintStates(svg, s, palette);
    expect(svg.querySelector("#DY_COURT_05_YANLUO")!.getAttribute("fill")).toBe(palette.current);
    expect(svg.querySelector("#DY_COURT_01_QINGUANG")!.getAttribute("fill")).toBe(palette.walked);
    expect(svg.querySelector("#DY_COURT_02_CHUJIANG")!.getAttribute("data-state")).toBe("ahead");
    expect(stateOf(svg, "HUANHUN_CLIFF")).toBe("ahead");
  });

  it("the branches are not walked because their number is lower; only the current one is drawn when folded", () => {
    const svg = map("cn");
    const s = mapStates(svg, diyuVisits(DIYU_STATIONS, "HUANHUN_CLIFF"));
    expect(s.nodes.get("EIGHTEEN_HELLS")).toBe("ahead");
    expect(s.nodes.get("LOTUS_TERRACE")).toBe("ahead");
    expect(applyBranches(svg, true, s.current!.node)).toEqual({ hiddenCount: 2, onlyCurrent: false });

    const inHell = mapStates(svg, diyuVisits(DIYU_STATIONS, "EIGHTEEN_HELLS"));
    expect(inHell.nodes.get("dy-ten-courts")).toBe("walked");
    expect(applyBranches(svg, true, "EIGHTEEN_HELLS")).toEqual({ hiddenCount: 1, onlyCurrent: true });
    expect(svg.querySelector("#EIGHTEEN_HELLS")!.classList.contains("branch-shown")).toBe(true);
    expect(svg.querySelector("#LOTUS_TERRACE")!.classList.contains("branch-shown")).toBe(false);
    expect(svg.classList.contains("map-hide-branches")).toBe(true);
  });

  it("Greece at the meadow: death and the three judges are walked, the cycle back to death is not followed", () => {
    const svg = map("gr");
    const s = mapStates(
      svg,
      pathVisits([
        { realm_code: "GR_ACHERON", left_at: "2026-01-01T00:00:00Z" },
        { realm_code: "GR_PLATO_MEADOW", left_at: null },
      ]),
    );
    expect(s.nodes.get("gr-death")).toBe("walked");
    expect(s.nodes.get("gr-three-judges")).toBe("walked");
    expect(s.nodes.get("GR_PLATO_MEADOW")).toBe("current");
    expect(s.nodes.get("gr-millennium")).toBe("ahead");
    expect(s.nodes.get("gr-lethe")).toBe("ahead");
    expect(s.nodes.get("GR_ISLES_OF_THE_BLESSED")).toBe("ahead");
  });

  it("Greece: a curable soul in Tartarus lights the thousand-year cells up to its century; the incurable light none", () => {
    const svg = map("gr");
    const path = [
      { realm_code: "GR_PLATO_MEADOW", left_at: "2026-01-01T00:00:00Z" },
      { realm_code: "GR_TARTARUS", left_at: null },
    ];
    const s = mapStates(svg, greekVisits(path, 299));
    expect(s.current).toEqual({ node: "gr-millennium", cell: "gr-millennium-3" });
    expect(s.nodes.get("GR_TARTARUS")).toBe("walked");
    expect(s.cells.get("gr-millennium-1")).toBe("walked");
    expect(s.cells.get("gr-millennium-2")).toBe("walked");
    expect(s.cells.get("gr-millennium-4")).toBeUndefined();
    // Past a thousand years it stays on the tenth cell, never an eleventh.
    expect(greekVisits(path, 1450).filter((v) => v.current)).toEqual([{ id: "gr-millennium-10", current: true }]);
    // Incurable (the caller passes null), or no term start: Tartarus stays current and no cell is lit.
    const incurable = mapStates(svg, greekVisits(path, null));
    expect(incurable.current).toEqual({ node: "GR_TARTARUS", cell: null });
    expect(incurable.nodes.get("gr-millennium")).toBe("ahead");
    expect(incurable.cells.size).toBe(0);
    // Not in Tartarus now (the Isles): the years do not light the cells.
    expect(greekVisits([{ realm_code: "GR_ISLES_OF_THE_BLESSED", left_at: null }], 299)).toEqual([
      { id: "GR_ISLES_OF_THE_BLESSED", current: true },
    ]);
  });

  it("paints edges by their two ends, and the sample's walked edge turns dashed when it is no longer walked", () => {
    const svg = map("eu");
    const palette = readPalette(svg)!;
    paintStates(svg, mapStates(svg, pathVisits([{ realm_code: "EU_PURGATORY_T3_WRATH", left_at: null }])), palette);
    const edge = (from: string, to: string) => svg.querySelector(`.edge[data-from="${from}"][data-to="${to}"]`)!;
    expect(edge("eu-death", "EU_PURGATORY").getAttribute("data-state")).toBe("walked");
    expect(edge("eu-death", "EU_PURGATORY").getAttribute("stroke")).toBe(palette.walked);
    expect(edge("eu-death", "EU_ACHERON").getAttribute("data-state")).toBe("ahead");
    expect(edge("eu-death", "EU_ACHERON").getAttribute("stroke-dasharray")).toBe("4 5");
    expect(stateOf(svg, "eu-hell")).toBe("ahead");
    expect(svg.querySelector("#EU_PURGATORY_T3_WRATH")!.getAttribute("fill")).toBe(palette.current);
    // The sample's pulse is gone; with no getBBox in jsdom the new one sits on the cell.
    expect(svg.querySelectorAll(".pulse")).toHaveLength(1);
  });

  it.each(["dark", "light"])("Egypt %s: the gates are one ornament band lit with their station, never one gate at a time (batch 12 §4)", (theme) => {
    const svg = map("eg", theme);
    // The per-gate ids are gone, and nothing else may be addressed gate by gate.
    for (const node of ["EG_SEVEN_ARRWT", "EG_TWENTYONE_SEBKHET"]) {
      expect(svg.querySelectorAll(`[id^="${node}-"]:not([id$="-label"])`)).toHaveLength(0);
      expect(svg.querySelectorAll(`#${node} .gates-ornament`)).toHaveLength(1);
      expect(svg.querySelector(`#${node} .gates-ornament`)!.hasAttribute("id")).toBe(false);
    }
    const palette = readPalette(svg)!;
    // Walked through the seven, now at the twenty-one: both bands take their station's colour.
    paintStates(svg, mapStates(svg, pathVisits([
      { realm_code: "EG_DUAT_ENTRY", left_at: "2026-01-01" },
      { realm_code: "EG_SEVEN_ARRWT", left_at: "2026-01-02" },
      { realm_code: "EG_HALL_TWO_TRUTHS", left_at: "2026-01-03" },
      { realm_code: "EG_TWENTYONE_SEBKHET", left_at: null },
    ])), palette);
    const band = (node: string) => svg.querySelector(`#${node} .gates-ornament`)!;
    expect(band("EG_SEVEN_ARRWT").getAttribute("stroke")).toBe(palette.walked);
    expect(band("EG_TWENTYONE_SEBKHET").getAttribute("stroke")).toBe(palette.current);
    expect(band("EG_TWENTYONE_SEBKHET").getAttribute("stroke-opacity")).toBe("1");
    // Absence: a station not reached keeps a faint grey band.
    paintStates(svg, mapStates(svg, pathVisits([{ realm_code: "EG_DUAT_ENTRY", left_at: null }])), palette);
    expect(band("EG_TWENTYONE_SEBKHET").getAttribute("stroke")).toBe(palette.ahead);
    expect(band("EG_TWENTYONE_SEBKHET").getAttribute("stroke-opacity")).toBe("0.55");
  });
});

describe("zoom scales the route and only moves the words", () => {
  it("the terrain is scaled; a label is translated to where its anchor went, not scaled", () => {
    const svg = map("gr");
    applyView(svg, { k: 2, x: -100, y: -50 });
    expect(svg.querySelector("#terrain")!.getAttribute("transform")).toBe("translate(-100 -50) scale(2)");
    const label = svg.querySelector('#labels [data-for="GR_ACHERON"]')!;
    const text = label.querySelector("text")!;
    const ax = Number(text.getAttribute("x"));
    const ay = Number(text.getAttribute("y"));
    expect(label.getAttribute("transform")).toBe(`translate(${ax - 100} ${ay - 50})`);
    expect(label.getAttribute("transform")).not.toMatch(/scale/);
  });
});

describe("light on the map (2026-11-08 A, Design batch 16 §1.4)", () => {
  it("occupancy → heat: by capacity when recorded, against the fullest station when not, zero when empty", () => {
    expect(heatOf({ held: 30, capacity: 120 }, 999)).toBe(0.25);
    expect(heatOf({ held: 200, capacity: 120 }, 0)).toBe(1);
    expect(heatOf({ held: 3, capacity: 0 }, 0)).toBe(1);
    expect(heatOf({ held: 5, capacity: null }, 20)).toBe(0.25);
    expect(heatOf({ held: 0, capacity: 10 }, 20)).toBe(0);
    expect(heatOf(undefined, 20)).toBe(0);
    expect(heatByNode(new Map([["a", { held: 10, capacity: null }], ["b", { held: 5, capacity: null }]]))).toEqual(
      new Map([["a", 1], ["b", 0.5]]),
    );
  });

  it("heat → flow: hotter is faster and denser, the middle is Design's dash 2 / gap 22, and nobody there means no flow", () => {
    const cold = flowOf(0.1)!;
    const mid = flowOf(0.5)!;
    const hot = flowOf(1)!;
    expect(mid).toMatchObject({ dash: 2, gap: 22, period: 24 });
    expect(hot.seconds).toBeLessThan(mid.seconds);
    expect(mid.seconds).toBeLessThan(cold.seconds);
    expect(hot.gap).toBeLessThan(cold.gap);
    expect(flowOf(0)).toBeNull();
    expect(glowAlphaOf(0)).toBeLessThan(glowAlphaOf(1));
  });

  it("an edge into a station that is not a realm is 'not measured', not 'empty'", () => {
    const heat = new Map([["EU_HEAVEN", 0]]);
    expect(edgeHeat(heat, "EU_HEAVEN")).toBe(0);
    expect(edgeHeat(heat, "eu-death")).toBe(UNMEASURED);
    expect(flowOf(edgeHeat(heat, "eu-death"))).not.toBeNull();
    expect(edgeHeat(null, "anything")).toBe(0.5);
  });

  it("realm codes fold into the map's nodes, cells included; one unrecorded capacity makes the sum unrecorded", () => {
    const svg = map("cn");
    const loads = nodeLoads(svg, new Map([
      ["DY_COURT_01_QINGUANG", { held: 3, capacity: 10 }],
      ["DY_COURT_02_CHUJIANG", { held: 4, capacity: null }],
      ["NOT_ON_THE_MAP", { held: 9, capacity: 9 }],
    ]));
    expect(loads.get("dy-ten-courts")).toEqual({ held: 7, capacity: null });
    expect([...loads.keys()]).toEqual(["dy-ten-courts"]);
  });

  it("today's flow folds with the cells: in / out add up, the average stay is weighted by who is held", () => {
    const svg = map("cn");
    const loads = nodeLoads(svg, new Map([
      ["DY_COURT_01_QINGUANG", { held: 3, capacity: 10, flow: { arrived: 2, left: 1, avgDays: 4 } }],
      ["DY_COURT_02_CHUJIANG", { held: 1, capacity: 10, flow: { arrived: 0, left: 5, avgDays: 8 } }],
    ]));
    // (4·3 + 8·1) / 4 = 5 —— not the plain mean of the two averages (6).
    expect(loads.get("dy-ten-courts")).toEqual({ held: 4, capacity: 20, flow: { arrived: 2, left: 6, avgDays: 5 } });
    // One cell without a figure makes the sum unknown, not smaller; nobody held means no average.
    expect(mergeFlow([
      { held: 0, capacity: null, flow: { arrived: null, left: 2, avgDays: null } },
      { held: 0, capacity: null, flow: { arrived: 1, left: 0, avgDays: null } },
    ])).toEqual({ arrived: null, left: 2, avgDays: null });
    // No flow given at all stays absent (the card then draws no flow line).
    expect(mergeFlow([{ held: 1, capacity: 1 }])).toBeUndefined();
  });

  it("walked edges get a glow under them and a moving flow on top; edges ahead get neither", () => {
    const svg = map("eu");
    paintStates(svg, mapStates(svg, pathVisits([{ realm_code: "EU_PURGATORY_T3_WRATH", left_at: null }])), readPalette(svg)!);
    paintLight(svg, null);
    const flows = [...svg.querySelectorAll("#terrain .flow")];
    expect(flows.length).toBeGreaterThan(0);
    for (const f of flows) {
      expect(f.getAttribute("stroke-dasharray")).toBe("2 22");
      // No filter on anything that moves (Huawei-class Chrome re-blurs every frame).
      expect(f.hasAttribute("filter")).toBe(false);
      const edge = svg.querySelector(`.edge[data-to="${f.getAttribute("data-to")}"]`)!;
      expect(edge.getAttribute("data-state")).toBe("walked");
    }
    // Every edge has a glow sibling now, shown only when walked; widths are the two STROKE steps.
    for (const edge of svg.querySelectorAll("#terrain .edge")) {
      const glow = edge.nextElementSibling!;
      expect(glow.classList.contains("edge-glow")).toBe(true);
      expect(glow.getAttribute("display")).toBe(edge.getAttribute("data-state") === "walked" ? "inline" : "none");
      expect(edge.getAttribute("stroke-width")).toBe(edge.getAttribute("data-state") === "walked" ? "2" : "1.5");
    }
  });

  it("the current place gets a dashed ring and one 60° arc", () => {
    const svg = map("eu");
    paintStates(svg, mapStates(svg, pathVisits([{ realm_code: "EU_PURGATORY_T3_WRATH", left_at: null }])), readPalette(svg)!);
    addScanRing(svg);
    expect(svg.querySelector(".pulse")!.getAttribute("stroke-dasharray")).toBe("2 3");
    const [arc, rest] = svg.querySelector(".scan")!.getAttribute("stroke-dasharray")!.split(" ").map(Number);
    expect(arc / (arc + rest)).toBeCloseTo(1 / 6, 2);
  });

  it("the grid sits under the terrain, and the long ticks are every fifth cell along the top", () => {
    const svg = map("gr");
    addGrid(svg);
    expect(svg.querySelector(":scope > .map-grid")!.nextElementSibling!.id).toBe("terrain");
    const ticks = svg.querySelector(".map-grid-ticks")!.getAttribute("d")!;
    expect(ticks).toContain("M0 0v8");
    expect(ticks).toContain("M24 0v4");
    expect(ticks).toContain("M120 0v8");
  });
});

describe("data on the map (2026-11-08 B)", () => {
  it("the badge says held / capacity, with a glyph when full or nearly full, not only a colour", () => {
    expect(badgeText({ held: 12, capacity: 40 })).toBe("12 / 40");
    expect(badgeText({ held: 40, capacity: 40 })).toBe("■ 40 / 40");
    expect(badgeText({ held: 37, capacity: 40 })).toBe("◐ 37 / 40");
    expect(badgeText({ held: 3, capacity: null })).toBe("3 / —");
    expect(loadOf(3, null)).toBeNull();
  });

  it("the badge goes up and to the right of its station, and to the left when the right edge would cut it", () => {
    expect(badgePlacement({ x: 100, y: 60, width: 20, height: 20 }, 80, 1120)).toEqual({ x: 124, y: 60 - BADGE.height - 2, side: "right" });
    expect(badgePlacement({ x: 1060, y: 60, width: 20, height: 20 }, 80, 1120).side).toBe("left");
  });

  it("the badge never leaves the drawing: clamped at the left and top edges when neither side fits", () => {
    // A wide node hugging the left edge: right side runs past 1120, left side would start below 0.
    const at = badgePlacement({ x: 20, y: 5, width: 1060, height: 40 }, 80, 1120);
    expect(at.x).toBeGreaterThanOrEqual(0);
    expect(at.x + 80).toBeLessThanOrEqual(1120);
    expect(at.y).toBe(0);
    // A station at the right end flips left and stays inside.
    const end = badgePlacement({ x: 1100, y: 60, width: 20, height: 20 }, 80, 1120);
    expect(end.x + 80).toBeLessThanOrEqual(1120);
    expect(end.x).toBeGreaterThanOrEqual(0);
  });

  it("markLoads hangs one badge per station in its label group, metal-hot at 80% and above", () => {
    const svg = map("eu");
    const placed = markLoads(svg, new Map([
      ["EU_HEAVEN", { held: 9, capacity: 10 }],
      ["EU_ACHERON", { held: 1, capacity: 10 }],
    ]));
    expect(placed.size).toBe(2);
    const badge = (id: string) => svg.querySelector(`#labels [data-for="${id}"] .map-badge`)!;
    expect(badge("EU_HEAVEN").hasAttribute("data-hot")).toBe(true);
    expect(badge("EU_HEAVEN").querySelector(".map-badge-halo")).not.toBeNull();
    // Absence: a quiet station has no halo and is not hot.
    expect(badge("EU_ACHERON").hasAttribute("data-hot")).toBe(false);
    expect(badge("EU_ACHERON").querySelector(".map-badge-halo")).toBeNull();
    expect(badge("EU_ACHERON").querySelector(".map-badge-bar")!.getAttribute("width")).toBe(String(BADGE.bar / 10));
  });
});

describe("hero nodes (Design batch 16 §1)", () => {
  it.each(Object.entries(HERO_NODES).flatMap(([skin, nodes]) => Object.entries(nodes).map(([id, name]) => [skin, id, name])))(
    "%s: %s → hero-%s.svg exists, declares that node, and the node is on both maps",
    (skin, id, name) => {
      expect(read(`maps/nodes/hero-${name}.svg`)).toContain(`data-node="${id}"`);
      for (const theme of ["dark", "light"]) expect(map(skin, theme).querySelector(`#terrain g.node[id="${id}"]`)).not.toBeNull();
    },
  );

  it("there are fifteen, and every delivered file is wired to a node", () => {
    const wired = Object.values(HERO_NODES).flatMap((nodes) => Object.values(nodes).map((n) => `maps/nodes/hero-${n}.svg`));
    expect(wired.sort()).toEqual([...HEROES].sort());
    expect(wired).toHaveLength(15);
  });

  it("a station hero is 56 and centred; a dot-row hero is 48 and hangs left of the row", () => {
    expect(heroPlacement({ x: 100, y: 70, width: 20, height: 20 }, false)).toEqual({ x: 82, y: 52, width: 56, height: 56 });
    const row = heroPlacement({ x: 600, y: 60, width: 300, height: 40 }, true);
    expect(row).toMatchObject({ width: 48, height: 48 });
    expect(row.x + row.width).toBeLessThan(600);
  });

  it("goes into the node's <g data-state>; a station's own graphic is replaced, a dot row's is not", () => {
    const svg = map("cn");
    const hero = (name: string) => parseMapSvg(read(`maps/nodes/hero-${name}.svg`))!;
    const placed = addHeroes(svg, new Map([["dy-ghost-gate", hero("cn-ghost-gate")], ["dy-ten-courts", hero("cn-ten-courts")]]));
    expect(placed.size).toBe(2);
    expect(svg.querySelector("#dy-ghost-gate > svg.hero")).not.toBeNull();
    expect(svg.querySelector("#dy-ghost-gate")!.getAttribute("data-hero")).toBe("replace");
    expect(svg.querySelector("#dy-ten-courts > svg.hero")!.getAttribute("width")).toBe("48");
    expect(svg.querySelector("#dy-ten-courts")!.hasAttribute("data-hero")).toBe(false);
    // The file's own <style> is gone (it would be global once in the page); the court cells are untouched.
    expect(svg.querySelector(".hero style")).toBeNull();
    expect(svg.querySelectorAll("#dy-ten-courts circle[id^='DY_COURT_']")).toHaveLength(10);
  });

  it("a group label that a hero covers moves to the right of that hero and its badge", () => {
    const svg = map("cn");
    const groupLabels = () => [...svg.querySelectorAll("#labels > g:not([data-for]) > text")];
    const label = groupLabels().find((t) => t.textContent === "赴冥 · 十三站之一至十")!;
    const x0 = Number(label.getAttribute("x"));
    const hero = { x: x0 + 40, y: Number(label.getAttribute("y")) - 20, width: 56, height: 56 };
    const badge = { x: hero.x + 60, y: hero.y, width: 70, height: 18 };
    const river = groupLabels().find((t) => t.textContent === "奈河")!;
    const riverX = river.getAttribute("x");
    moveGroupLabelsOffHeroes(svg, new Map([["dy-ghost-gate", hero]]), new Map([["dy-ghost-gate", badge]]));
    expect(Number(label.getAttribute("x"))).toBe(badge.x + badge.width + 8);
    expect(label.getAttribute("text-anchor")).toBe("start");
    // Absence: a label nowhere near a hero stays where Design put it.
    expect(river.getAttribute("x")).toBe(riverX);
  });
});

describe("narrow screens: close up on the current station", () => {
  const box = { width: 1120, height: 450 };

  it("no camera when the whole map already shows labels at 11px or more", () => {
    expect(narrowCamera(box, { x: 500, y: 200 }, 1300, 10)).toBeNull();
    expect(narrowCamera(box, { x: 500, y: 200 }, 0, 10)).toBeNull();
  });

  it("a desktop container opens at Fit even though the Diyu 10-unit labels are under 11px there", () => {
    // 1280-wide desktop: the map's container is about 870px; 10 x 870 / 1120 is about 7.8px.
    expect((10 * 870) / box.width).toBeLessThan(11);
    expect(narrowCamera(box, { x: 500, y: 200 }, 870, 10)).toBeNull();
    expect(narrowCamera(box, { x: 500, y: 200 }, CLOSE_UP_BELOW_PX, 10)).toBeNull();
    // Just under the threshold it is still a phone-ish width and closes up.
    expect(narrowCamera(box, { x: 500, y: 200 }, CLOSE_UP_BELOW_PX - 1, 10)).not.toBeNull();
  });

  it("at 393 the camera is 1.25 px per unit, full height, with the station about 60% across", () => {
    const c = narrowCamera(box, { x: 700, y: 300 }, 361, 10)!;
    expect(c.w).toBe(Math.round(361 / CLOSE_SCALE));
    expect(c.h).toBe(box.height);
    expect((700 - c.x) / c.w).toBeCloseTo(0.6, 1);
    // The smallest label is now at least 11 px on screen.
    expect((10 * 361) / c.w).toBeGreaterThanOrEqual(11);
  });

  it("stays inside the map at either end, and panning is clamped", () => {
    expect(narrowCamera(box, { x: 10, y: 0 }, 361, 10)!.x).toBe(0);
    const end = narrowCamera(box, { x: 1115, y: 0 }, 361, 10)!;
    expect(end.x + end.w).toBe(box.width);
    expect(panCamera(end, 500, box).x).toBe(end.x);
    expect(panCamera(end, -5000, box).x).toBe(0);
  });

  it("reads the smallest label size from the map (the Diyu map has 10)", () => {
    expect(minLabelFont(map("cn"))).toBe(10);
  });
});
