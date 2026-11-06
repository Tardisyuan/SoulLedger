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
  mapStates,
  paintStates,
  parseMapSvg,
  pathVisits,
  readPalette,
  stationNameKeys,
} from "@/src/lib/underworldMap";

const PUBLIC_V4 = path.join(__dirname, "..", "..", "public", "v4");
const files = (dir: string) => readdirSync(path.join(PUBLIC_V4, dir)).filter((f) => f.endsWith(".svg")).map((f) => path.join(dir, f));
const MAPS = files("maps");
const EMBLEMS = files("emblems");
const read = (rel: string) => readFileSync(path.join(PUBLIC_V4, rel), "utf8");
const map = (skin: string, theme = "dark") => parseMapSvg(read(`maps/soulledger-map-${skin}-${theme}.svg`))!;

describe("the delivered SVGs are safe to put in the page", () => {
  it("are all there: four civilizations, dark and light, maps and emblems", () => {
    expect(MAPS).toHaveLength(8);
    expect(EMBLEMS).toHaveLength(8);
  });

  it.each([...MAPS, ...EMBLEMS])("%s has no script, foreign content, handler, outside link or import", (rel) => {
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
        { realm_code: "EU_PLATO_MEADOW", left_at: null },
      ]),
    );
    expect(s.nodes.get("gr-death")).toBe("walked");
    expect(s.nodes.get("gr-three-judges")).toBe("walked");
    expect(s.nodes.get("EU_PLATO_MEADOW")).toBe("current");
    expect(s.nodes.get("gr-millennium")).toBe("ahead");
    expect(s.nodes.get("gr-lethe")).toBe("ahead");
    expect(s.nodes.get("GR_ISLES_OF_THE_BLESSED")).toBe("ahead");
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
