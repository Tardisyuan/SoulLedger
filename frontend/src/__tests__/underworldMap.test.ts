/**
 * 冥界地图(v4 阶段 5):Design 交付的 SVG 能安全地插进页面,站码与代码一致,状态按行程画对。
 *
 * 读文件:八张地图与十六个主视觉(第二十四批:emblems/ 是 G 版天体仪,emblems-f/ 是落地页卡上的 F 版嵌彩)就在 public/v4/ 里,改一份 SVG 不会让 import 图选中这份测试,
 * 所以它在 jest.always-run.txt 里。
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { DIYU_STATIONS } from "@soulledger/core/domain/diyuStations";
import en from "@soulledger/core/messages/en.json";
import { EMBLEM_SVGS } from "@/src/generated/emblemSvgs";
import zh from "@soulledger/core/messages/zh-Hans.json";
import {
  applyBranches,
  applyView,
  diyuVisits,
  greekVisits,
  mapStates,
  nodesOf,
  paintStates,
  parseMapSvg,
  passagesOf,
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
  ROUTE_PAD,
  routeExtent,
  anchorLabelsInside,
  LABEL_EDGE,
  staggerCrowdedNames,
} from "@/src/lib/underworldMapLayers";

const PUBLIC_V4 = path.join(__dirname, "..", "..", "public", "v4");
const files = (dir: string) => readdirSync(path.join(PUBLIC_V4, dir)).filter((f) => f.endsWith(".svg")).map((f) => path.join(dir, f));
const MAPS = files("maps");
const EMBLEMS = files("emblems").filter((f) => !f.endsWith("-mark.svg"));
const MARKS = files("emblems").filter((f) => f.endsWith("-mark.svg"));
/** 第二十四批 F 版(嵌彩):只给落地页卡上的内联主视觉(EMBLEM_SVGS 由它生成);别处的 <img> 用 emblems/ 里的 G 版。 */
const EMBLEMS_F = files("emblems-f");
const ALL_EMBLEMS = [...EMBLEMS, ...EMBLEMS_F];
const HEROES = files("maps/nodes");
const SOULFIRE = files("soulfire");
const read = (rel: string) => readFileSync(path.join(PUBLIC_V4, rel), "utf8");
const map = (skin: string, theme = "dark") => parseMapSvg(read(`maps/soulledger-map-${skin}-${theme}.svg`))!;

describe("the delivered SVGs are safe to put in the page", () => {
  it("are all there: four civilizations, dark and light, maps and emblems", () => {
    expect(MAPS).toHaveLength(8);
    expect(EMBLEMS).toHaveLength(8);
    expect(EMBLEMS_F).toHaveLength(8);
    expect(EMBLEMS_F.map((f) => path.basename(f)).sort()).toEqual(EMBLEMS.map((f) => path.basename(f)).sort());
    expect(MARKS).toHaveLength(4);
  });

  it.each([...MAPS, ...ALL_EMBLEMS, ...MARKS, ...HEROES, ...SOULFIRE])("%s has no script, foreign content, handler, outside link or import", (rel) => {
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
  it.each(ALL_EMBLEMS)("%s keeps its halo inside the 240×240 viewBox", (rel) => {
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

  // F 版的柔影(`.e-shadow`)是一条画椭圆的路径 `M x y a rx ry …`(从最左点起),同样要整个落在框里,不然边被切平。
  it.each(EMBLEMS_F)("%s keeps its soft shadow inside the 240×240 viewBox", (rel) => {
    const shadows = [...read(rel).matchAll(/class="e-shadow"[^>]*\sd="M([-\d.]+) ([-\d.]+)a([-\d.]+) ([-\d.]+) /g)];
    for (const m of shadows) {
      const [x, y, rx, ry] = m.slice(1).map(Number);
      expect(Math.min(x, y - ry)).toBeGreaterThanOrEqual(0);
      expect(Math.max(x + 2 * rx, y + ry)).toBeLessThanOrEqual(240);
    }
    // 有柔影的文件,每一条都要被上面的正则认出来(格式变了就红,而不是静默不查)。
    expect(shadows.length).toBe((read(rel).match(/class="e-shadow"/g) ?? []).length);
  });

  // 主视觉用 <img> 加载,<img> 里的 SVG 不加载网页字体:字要转成路径(第十九批起的冥字印),不能留 <text>。
  // F 版内联在页面里,但首帧时网页字体里「冥」那一片未必到了:同样转成路径,不闪字。
  it.each(ALL_EMBLEMS)("%s draws no text (an <img> SVG would fall back to a system font)", (rel) => {
    expect(read(rel)).not.toMatch(/<text\b|font-family/);
  });

  // 小号在 CivEmblem.tsx 里内联(currentColor 才跟随文字色):每个形状的参数都要和交付的文件一致。
  it.each(MARKS)("%s is what CivEmblem inlines", (rel) => {
    const source = readFileSync(path.join(__dirname, "..", "components", "brand", "CivEmblem.tsx"), "utf8");
    const body = read(rel).replace(/^<svg[^>]*>|<\/svg>\s*$/g, "");
    const shapes = [...body.matchAll(/<(path|circle|rect)\b([^>]*?)\/>/g)];
    expect(shapes.length).toBeGreaterThan(0);
    const jsx = (attrs: string) => attrs.replace(/\s+$/, "").replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    for (const [, tag, attrs] of shapes) expect(source).toContain(`<${tag}${jsx(attrs)} />`);
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

  // 落地页的描线与光泽只认类名(emblemFx.ts):每份主视觉都要有主线 .e-l,G 要有刻度 .e-t、F 要有金丝 .e-l2,样式写在自己的作用域里。
  it.each(ALL_EMBLEMS)("%s has the classes the landing effects work off, and scopes its own style", (rel) => {
    const text = read(rel);
    const [, civ, theme] = rel.match(/emblem-(\w+)-(dark|light)\.svg$/)!;
    const v = rel.startsWith("emblems-f") ? "F" : "G";
    const svg = parseMapSvg(text, { keepStyle: true })!;
    expect(svg.querySelectorAll(".e-l").length).toBeGreaterThan(0);
    // G 有刻度(.e-t,描线后淡入);F 嵌彩没有刻度,金丝是 .e-l2(描线就画它)。
    expect(svg.querySelectorAll(v === "G" ? ".e-t" : ".e-l2").length).toBeGreaterThan(0);
    expect(svg.getAttribute("class")).toBe("emblem2");
    expect(svg.getAttribute("data-civ")).toBe(civ);
    expect(svg.getAttribute("data-theme")).toBe(theme);
    expect(svg.getAttribute("data-v")).toBe(v);
    // 每条规则都写在自己的作用域下(F、G、深浅同页也不串):去掉 @keyframes 与 @media 外壳,剩下的选择器都以它开头。
    const scope = `.emblem2[data-v="${v}"][data-civ="${civ}"][data-theme="${theme}"] `;
    const css = svg
      .querySelector("style")!
      .textContent!.replace(/@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "")
      .replace(/@media[^{]*\{/g, "");
    const selectors = [...css.matchAll(/([^{}]+)\{[^{}]*\}/g)].flatMap((m) => m[1].split(",").map((x) => x.trim())).filter(Boolean);
    expect(selectors.length).toBeGreaterThan(10);
    expect(selectors.filter((sel) => !sel.startsWith(scope))).toEqual([]);
    // 描线临时设 pathLength=1,收尾整个删掉:文件里本来就不能有。
    expect(text).not.toMatch(/pathLength/);
  });

  // 落地页把主视觉原文在构建时嵌进来(src/generated/emblemSvgs.ts),不等请求(水合后插入,见 LandingEmblem.tsx)。它不能和文件漂移,
  // 而且是不经运行时消毒直接插进页面的:所以这里证明消毒器对它无事可做。
  it("the embedded emblems are exactly the F files (if not, rerun the gen-emblem-svgs script in frontend)", () => {
    expect(Object.keys(EMBLEM_SVGS).sort()).toEqual(EMBLEMS_F.map((rel) => rel.match(/emblem-(\w+-(?:dark|light))\.svg$/)![1]).sort());
    for (const rel of EMBLEMS_F) expect(EMBLEM_SVGS[rel.match(/emblem-(\w+-(?:dark|light))\.svg$/)![1]]).toBe(read(rel));
  });

  it.each(EMBLEMS_F)("%s loses nothing to parseMapSvg's keepStyle sanitising, so it can go in unsanitised", (rel) => {
    const raw = new DOMParser().parseFromString(read(rel), "image/svg+xml").documentElement;
    expect(parseMapSvg(read(rel), { keepStyle: true })!.outerHTML).toBe(raw.outerHTML);
  });

  // 深浅两份同在 DOM 里(按主题 display:none 一份),四张卡同在一页:id 不能有一个重复。F、G 两版一起查
  // (哪天 B 也内联到同一页不会撞);每个 url(#…) 都要指向自己文件里的 id(渐变 ink / ip / sh / bg)。
  it("ids are unique across all sixteen emblems, and every url(#id) resolves in its own file", () => {
    for (const rel of ALL_EMBLEMS) {
      const own = new Set([...read(rel).matchAll(/\sid="([^"]*)"/g)].map((m) => m[1]));
      const refs = [...read(rel).matchAll(/url\(#([^)]*)\)/g)].map((m) => m[1]);
      expect(refs.length).toBeGreaterThan(0);
      expect(refs.filter((id) => !own.has(id))).toEqual([]);
    }
    const ids = ALL_EMBLEMS.flatMap((rel) => [...read(rel).matchAll(/\sid="([^"]*)"/g)].map((m) => m[1]));
    expect(ids.length).toBeGreaterThanOrEqual(16);
    expect(new Set(ids).size).toBe(ids.length);
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

  it("Greece at the meadow: death and the ferry are walked, the cycle back to death is not followed", () => {
    const svg = map("gr");
    const s = mapStates(
      svg,
      pathVisits([
        { realm_code: "GR_ACHERON", left_at: "2026-01-01T00:00:00Z" },
        { realm_code: "GR_PLATO_MEADOW", left_at: null },
      ]),
    );
    expect(s.nodes.get("gr-death")).toBe("walked");
    expect(s.nodes.get("GR_ACHERON")).toBe("walked");
    // The three judges sit on the meadow, not at a station of their own (batch 34; Gorgias 524a).
    expect(s.nodes.has("gr-three-judges")).toBe(false);
    expect(svg.querySelector('[id="gr-three-judges"]')).toBeNull();
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
    // The Isles are the same thousand years (Rep. 615a; docs/02 §4.3 — audit 2026-11-13 GR-2): the cells light there too.
    const isles = mapStates(svg, greekVisits([{ realm_code: "GR_ISLES_OF_THE_BLESSED", left_at: null }], 299));
    expect(isles.current).toEqual({ node: "gr-millennium", cell: "gr-millennium-3" });
    expect(isles.nodes.get("GR_ISLES_OF_THE_BLESSED")).toBe("walked");
    // The Asphodel Meadow carries no term (docs/04 §四): never the cells, whatever figure is passed.
    expect(greekVisits([{ realm_code: "GR_ASPHODEL_MEADOW", left_at: null }], 299)).toEqual([
      { id: "GR_ASPHODEL_MEADOW", current: true },
    ]);
  });

  it("paints edges by their two ends, and the sample's walked edge turns dashed when it is no longer walked", () => {
    const svg = map("eu");
    const palette = readPalette(svg)!;
    paintStates(svg, mapStates(svg, pathVisits([{ realm_code: "EU_PURGATORY_T3_WRATH", left_at: null }])), palette);
    const edge = (from: string, to: string) => svg.querySelector(`.edge[data-from="${from}"][data-to="${to}"]`)!;
    expect(edge("eu-death", "EU_PURGATORY").getAttribute("data-state")).toBe("walked");
    expect(edge("eu-death", "EU_PURGATORY").getAttribute("stroke")).toBe(palette.walked);
    expect(edge("eu-death", "EU_ANTINFERNO").getAttribute("data-state")).toBe("ahead");
    expect(edge("eu-death", "EU_ANTINFERNO").getAttribute("stroke-dasharray")).toBe("4 5");
    expect(stateOf(svg, "eu-hell")).toBe("ahead");
    // The ferry is on the hell road only (user 2026-11-14): a purgatory soul never lights it.
    expect(stateOf(svg, "EU_ACHERON")).toBe("ahead");
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

describe("Europe's roads (batch 34): death → vestibule → ferry → circles; heaven straight from death", () => {
  const edge = (svg: Element, from: string, to: string) => svg.querySelector(`.edge[data-from="${from}"][data-to="${to}"]`);
  it.each(["dark", "light"])("%s: the edges run in that order, and there is a direct line to heaven", (theme) => {
    const svg = map("eu", theme);
    for (const [from, to] of [["eu-death", "EU_ANTINFERNO"], ["EU_ANTINFERNO", "EU_ACHERON"], ["EU_ACHERON", "eu-hell"], ["eu-death", "EU_HEAVEN"]]) {
      expect(edge(svg, from, to)).not.toBeNull();
    }
    expect(edge(svg, "eu-death", "EU_ACHERON")).toBeNull();
    expect(edge(svg, "EU_ACHERON", "EU_ANTINFERNO")).toBeNull();
  });
  it("the hell road lights all three; heaven lights only its own line", () => {
    const svg = map("eu");
    const palette = readPalette(svg)!;
    paintStates(svg, mapStates(svg, pathVisits([
      { realm_code: "EU_ANTINFERNO", left_at: "2026-01-01" },
      { realm_code: "EU_ACHERON", left_at: "2026-01-01" },
      { realm_code: "EU_HELL_4TH", left_at: null },
    ])), palette);
    for (const [from, to] of [["eu-death", "EU_ANTINFERNO"], ["EU_ANTINFERNO", "EU_ACHERON"], ["EU_ACHERON", "eu-hell"]]) {
      expect(edge(svg, from, to)!.getAttribute("data-state")).toBe("walked");
    }
    const heaven = map("eu");
    paintStates(heaven, mapStates(heaven, pathVisits([{ realm_code: "EU_HEAVEN", left_at: null }])), palette);
    expect(edge(heaven, "eu-death", "EU_HEAVEN")!.getAttribute("data-state")).toBe("walked");
    expect(stateOf(heaven, "EU_ACHERON")).toBe("ahead");
    expect(stateOf(heaven, "EU_PURGATORY")).toBe("ahead");
  });
});

describe("Egypt's seven approaches are a passage, not a station (batch 34)", () => {
  it.each(["dark", "light"])("%s: class passage, kept by id, not among the stations", (theme) => {
    const svg = map("eg", theme);
    expect(svg.querySelector("#EG_SEVEN_ARRWT")!.getAttribute("class")).toBe("passage");
    expect(nodesOf(svg).map((n) => n.id)).not.toContain("EG_SEVEN_ARRWT");
    expect(passagesOf(svg).map((n) => n.id)).toEqual(["EG_SEVEN_ARRWT"]);
    // One edge from the Duat's entry to the hall, no longer two through the approaches.
    expect(svg.querySelector('.edge[data-from="EG_DUAT_ENTRY"][data-to="EG_HALL_TWO_TRUTHS"]')).not.toBeNull();
    expect(svg.querySelectorAll('.edge[data-from="EG_SEVEN_ARRWT"], .edge[data-to="EG_SEVEN_ARRWT"]')).toHaveLength(0);
  });
  it("lit once the hall after it is reached, with no record of its own; dark before", () => {
    const svg = map("eg");
    const palette = readPalette(svg)!;
    const band = () => svg.querySelector("#EG_SEVEN_ARRWT .gates-ornament")!;
    const reached = mapStates(svg, pathVisits([
      { realm_code: "EG_DUAT_ENTRY", left_at: "2026-01-01" },
      { realm_code: "EG_HALL_TWO_TRUTHS", left_at: null },
    ]));
    expect(reached.nodes.get("EG_SEVEN_ARRWT")).toBe("walked");
    paintStates(svg, reached, palette);
    expect(band().getAttribute("stroke")).toBe(palette.walked);
    const before = mapStates(svg, pathVisits([{ realm_code: "EG_DUAT_ENTRY", left_at: null }]));
    expect(before.nodes.get("EG_SEVEN_ARRWT")).toBe("ahead");
    paintStates(svg, before, palette);
    expect(band().getAttribute("stroke")).toBe(palette.ahead);
    expect(band().getAttribute("stroke-opacity")).toBe("0.55");
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

  // 第二十九批加了第十六个:希腊中路的阿斯福得草原(hero-gr-asphodel.svg)。
  it("there are sixteen, and every delivered file is wired to a node", () => {
    const wired = Object.values(HERO_NODES).flatMap((nodes) => Object.values(nodes).map((n) => `maps/nodes/hero-${n}.svg`));
    expect(wired.sort()).toEqual([...HEROES].sort());
    expect(wired).toHaveLength(16);
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

  it("at 393 the camera is 1.25 px per unit, full height when no extent is given, with the station about 60% across", () => {
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

  // 2026-11-14: the camera's height is the drawn route's, not the whole map's. Egypt's route is one band across the middle
  // (y 104-284 of 400), so a whole-height close-up at 393 was mostly empty grid. Diyu's route goes out along the top and
  // back along the bottom, so its extent is still both roads.
  const extentOf = (skin: string) => routeExtent(map(skin, "light"))!;
  /** The y of every point of every route segment (the four maps' edges use absolute M / L / C / S / H only). */
  const edgeYs = (skin: string) =>
    [...map(skin, "light").querySelectorAll("#terrain .edge")].flatMap((e) =>
      (e.getAttribute("d")!.match(/[MLCS][^A-Za-z]*/g) ?? []).flatMap((seg) =>
        seg.slice(1).trim().split(/[\s,]+/).map(Number).filter((_, i) => i % 2 === 1),
      ),
    );

  it("Egypt's camera is framed on its route: the empty grid above and below is left out", () => {
    const egBox = { width: 1120, height: 400 };
    const extent = extentOf("eg");
    const c = narrowCamera(egBox, { x: 60, y: 200 }, 330, 11, extent)!;
    expect(c.y).toBe(extent.y);
    expect(c.h).toBe(extent.h);
    // Absence: not the whole map's height any more (the old rule's camera was 0 / 400).
    expect(c.h).toBeLessThan(egBox.height * 0.8);
    expect(c.y).toBeGreaterThan(40);
    // Every point of the route, with its padding, is inside the frame; so is the lowest label (湮灭 · 第二次死亡).
    const ys = edgeYs("eg");
    expect(ys.length).toBeGreaterThan(5);
    expect(Math.min(...ys) - ROUTE_PAD).toBeGreaterThanOrEqual(c.y);
    expect(Math.max(...ys) + ROUTE_PAD).toBeLessThanOrEqual(c.y + c.h);
    expect(c.y + c.h).toBeGreaterThan(325);
  });

  it("Diyu's extent keeps both roads, the upper (stations 1-10) and the lower (十八层地狱 · 莲花台)", () => {
    const extent = extentOf("cn");
    expect(extent.y).toBeLessThanOrEqual(80 - ROUTE_PAD);
    expect(extent.y + extent.h).toBeGreaterThanOrEqual(435);
  });

  it("each civilization's extent holds every label and stays inside the map", () => {
    for (const skin of ["cn", "eu", "eg", "gr"]) {
      const svg = map(skin, "light");
      const e = routeExtent(svg)!;
      expect(e.y).toBeGreaterThanOrEqual(0);
      expect(e.y + e.h).toBeLessThanOrEqual(Number(svg.getAttribute("viewBox")!.split(" ")[3]));
      for (const t of svg.querySelectorAll("#labels text[y]")) {
        const y = Number(t.getAttribute("y"));
        expect(y).toBeGreaterThan(e.y);
        expect(y).toBeLessThanOrEqual(e.y + e.h);
      }
    }
  });

  // 2026-11-14: Egypt's first station in English, 「Embalming · seventy days」, is centred on x=60 and starts left of the map,
  // where no camera can reach. Close up, a line past either edge of the map is anchored inside it.
  it("a line past the map's edge is anchored inside it; the others stay where Design put them", () => {
    const svg = map("eg", "light");
    const first = svg.querySelector('[data-for="eg-embalming"] text')!;
    first.textContent = "Embalming · seventy days"; // about 161 units: -20..140
    const last = svg.querySelector('[data-for="EG_AARU"] text')!;
    last.textContent = "Field of Reeds (Aaru)"; // centred on 1064, ends past 1120
    const hall = svg.querySelector('[data-for="EG_HALL_TWO_TRUTHS"] text')!;
    const hallX = hall.getAttribute("x");
    anchorLabelsInside(svg, 1120);
    expect(first.getAttribute("text-anchor")).toBe("start");
    expect(first.getAttribute("x")).toBe(String(LABEL_EDGE));
    expect(last.getAttribute("text-anchor")).toBe("end");
    expect(last.getAttribute("x")).toBe(String(1120 - LABEL_EDGE));
    // Absence: a line well inside the map is not touched.
    expect(hall.getAttribute("x")).toBe(hallX);
    expect(hall.getAttribute("text-anchor")).toBe("middle");
  });

  // 2026-11-14: the Diyu panorama in English — 「Road of the Yellow Springs」 is wider than the 94 units between stations,
  // so neighbouring names overlapped. A name that would hit one already placed moves down a line; zh is untouched.
  it("staggers English station names that would overlap; Chinese names stay where Design put them", () => {
    const zhMap = map("cn");
    const before = Array.from(zhMap.querySelectorAll("#labels text"), (t) => t.getAttribute("y"));
    staggerCrowdedNames(zhMap);
    expect(Array.from(zhMap.querySelectorAll("#labels text"), (t) => t.getAttribute("y"))).toEqual(before);
    expect(zhMap.querySelector("[data-staggered]")).toBeNull();

    const svg = map("cn");
    const names: Record<string, string> = {
      TUDI_TEMPLE: "Earth God's Temple", "dy-ghost-gate": "Ghost Gate", YELLOW_SPRINGS_ROAD: "Road of the Yellow Springs",
      WANGXIANG_TERRACE: "Terrace for Viewing Home", EVIL_DOG_VILLAGE: "Vicious Dog Ridge", GOLDEN_ROOSTER_HILL: "Golden Rooster Hill",
    };
    const line = (id: string) => svg.querySelector(`[data-for="${id}"] text:last-of-type`)!;
    for (const [id, text] of Object.entries(names)) line(id).textContent = text;
    anchorLabelsInside(svg, 1120);
    staggerCrowdedNames(svg);
    const box = (t: Element) => {
      const size = Number(t.getAttribute("font-size"));
      const w = (t.textContent ?? "").length * size * 0.56;
      const x = Number(t.getAttribute("x"));
      const a = t.getAttribute("text-anchor");
      const x0 = a === "middle" ? x - w / 2 : a === "end" ? x - w : x;
      return { x0, x1: x0 + w, y0: Number(t.getAttribute("y")) - size, y1: Number(t.getAttribute("y")) };
    };
    const boxes = Object.keys(names).map((id) => box(line(id)));
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const [a, b] = [boxes[i], boxes[j]];
        expect(a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1).toBe(false);
      }
    expect(svg.querySelectorAll("[data-staggered]").length).toBeGreaterThan(0);
    // Absence: the first name keeps its line.
    expect(line("TUDI_TEMPLE").hasAttribute("data-staggered")).toBe(false);
  });

  it("reads the smallest label size from the map (the Diyu map has 10)", () => {
    expect(minLabelFont(map("cn"))).toBe(10);
  });
});
