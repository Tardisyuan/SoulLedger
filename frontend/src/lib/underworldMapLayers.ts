import type { Realm, RealmOccupancy } from "@soulledger/core/api";
import {
  CSS_ESCAPE,
  STROKE,
  SVG_NS,
  bboxOf,
  byId,
  cellsOf,
  edgesOf,
  isBranch,
  labelLines,
  nodesOf,
  viewBoxOf,
} from "@/src/lib/underworldMap";

/**
 * 冥界地图上代码加的层(2026-11-08 用户决定:A 光与动,B 图上的数)。`underworldMap.ts` 管 Design 的约定
 * (id、`data-state`、`.edge`、`#labels`)与三态着色,这里只**加**东西,不改那些约定:
 *   - 走过的线:细亮的核心(`.edge`)+ 静止的柔光(`.edge-glow`,模糊只在它上面)+ 流光(`.flow`,只动 dashoffset);
 *   - 当前处:静止细环(`.pulse`)+ 转动的一段弧(`.scan`,只转 transform);
 *   - 图下 24 单位网格与底边刻度(`.map-grid`);
 *   - 每站一个等宽读数「在押/容量」(`.map-badge`),热度决定柔光强弱与流光快慢;
 *   - 窄屏镜头:改写 viewBox,让最小的字在屏上 ≥ 11px。
 * 颜色:路线三态仍从图里读;代码加的层只用令牌(globals.css 的 `.v4-map` 一节)。动画元素上没有滤镜 ——
 * 华为一类安卓 Chrome 上,动画的 filter 每帧重算模糊,会掉帧。
 */

/** 一站的在押与容量;容量 null = 未记录(不是无限)。 */
export interface StationLoad {
  held: number;
  capacity: number | null;
  /** 今日进 / 出(人次)与在押者的平均停留天数(`GET /realms/occupancy/`);null = 接口没给。不给就是没取。 */
  flow?: StationFlow;
}

export interface StationFlow {
  arrived: number | null;
  left: number | null;
  avgDays: number | null;
}

/**
 * 世界图的读数:这个文明的界域码 → 在押 / 容量 / 今日进出。接口没列出的界域是 0 人、今天没有进出(那是事实);
 * 列出了却缺某个数(旧接口、演示录像)是 null —— 卡上写「未记录」,不写 0。/realms 与概览的缩略图共用。
 */
export function stationLoadsOf(
  realms: readonly Realm[],
  occupancy: readonly RealmOccupancy[],
  civilization: string,
): Map<string, StationLoad> {
  const rows = new Map(occupancy.map((o) => [o.realm_id, o]));
  return new Map(
    realms.filter((r) => r.civilization === civilization).map((r): [string, StationLoad] => {
      const o = rows.get(r.id);
      return [r.realm_code, {
        held: o?.count ?? 0,
        capacity: r.capacity ?? null,
        flow: o
          ? { arrived: o.arrived_today ?? null, left: o.left_today ?? null, avgDays: o.avg_stay_days ?? null }
          : { arrived: 0, left: 0, avgDays: null },
      }];
    }),
  );
}

/**
 * 几格合成一站的进出:进、出相加(任何一格没给,合计就没给);平均停留按各格在押人数加权 ——
 * 每格的平均本来就是「在押者的平均」,加权后仍是合起来那群人的平均。没人在押是 null。
 */
export function mergeFlow(parts: readonly StationLoad[]): StationFlow | undefined {
  const flows = parts.map((p) => p.flow);
  if (!flows.some(Boolean)) return undefined;
  const sum = (pick: (f: StationFlow) => number | null) =>
    flows.every((f) => f && pick(f) !== null) ? flows.reduce((n, f) => n + (pick(f!) as number), 0) : null;
  const held = parts.reduce((n, p) => n + p.held, 0);
  const weighed = parts.filter((p) => p.held > 0);
  const avgDays =
    held > 0 && weighed.every((p) => p.flow?.avgDays != null)
      ? Math.round((weighed.reduce((n, p) => n + (p.flow!.avgDays as number) * p.held, 0) / held) * 10) / 10
      : null;
  return { arrived: sum((f) => f.arrived), left: sum((f) => f.left), avgDays };
}

/** 将满:在押 ≥ 容量的 90%(树表图例「◐ 将满 = ≥ 90%」)。满了另算;容量未记录不判。 */
export const NEAR_FULL = 0.9;
export function loadOf(held: number, cap: number | null | undefined): "full" | "near" | null {
  if (cap == null) return null;
  if (held >= cap) return "full";
  return cap > 0 && held / cap >= NEAR_FULL ? "near" : null;
}

/**
 * 界域码 → 图上每个节点的读数:节点自己的码,加它里面子格的码(地府十殿 `DY_COURT_xx` 合到 `dy-ten-courts`)。
 * 一个码都对不上的节点不在结果里(小写节点、地府十三站 —— 它们不是界域,没有在押数)。
 * 容量:任何一格未记录,合计就是未记录(不能把「未记录」当 0 加)。
 */
export function nodeLoads(svg: Element, byCode: ReadonlyMap<string, StationLoad>): Map<string, StationLoad> {
  const out = new Map<string, StationLoad>();
  for (const node of nodesOf(svg)) {
    const parts = [node.id, ...cellsOf(node).map((c) => c.id)].map((id) => byCode.get(id)).filter((l): l is StationLoad => !!l);
    if (!parts.length) continue;
    const held = parts.reduce((n, p) => n + p.held, 0);
    const capacity = parts.every((p) => p.capacity !== null) ? parts.reduce((n, p) => n + (p.capacity as number), 0) : null;
    const flow = mergeFlow(parts);
    out.set(node.id, flow ? { held, capacity, flow } : { held, capacity });
  }
  return out;
}

/** 热度 0–1:有容量按占用(满了是 1,容量 0 而有人也是 1);容量未记录就和这张图上在押最多的一站比。没有人是 0。 */
export function heatOf(load: StationLoad | undefined, maxHeld: number): number {
  if (!load || load.held <= 0) return 0;
  if (load.capacity !== null) return load.capacity > 0 ? Math.min(1, load.held / load.capacity) : 1;
  return maxHeld > 0 ? Math.min(1, load.held / maxHeld) : 0;
}

/** 每个节点的热度(`nodeLoads` 的结果)。 */
export function heatByNode(loads: ReadonlyMap<string, StationLoad>): Map<string, number> {
  const maxHeld = Math.max(0, ...Array.from(loads.values(), (l) => l.held));
  return new Map(Array.from(loads, ([id, l]) => [id, heatOf(l, maxHeld)]));
}

/**
 * 一段线上的流光:热度越高越快、越密。`dash` 光点长,`gap` 间隔;dashoffset 一次走满 `period = dash + gap` 才接得上、不跳。
 * 热度 0 返回 null:那一段的终点没有人,不画流光 —— 流光说的是「有灵魂在往那里去」。
 */
export function flowOf(heat: number): { seconds: number; dash: number; gap: number; period: number } | null {
  if (!(heat > 0)) return null;
  const h = Math.min(1, heat);
  // Design 第十六批 §1.4:划长 2、间隔 22(金属色)。22 是中等热度(灵魂的行程一律中等)的间隔,世界图按热度在 30–14 之间。
  const dash = 2;
  const gap = Math.round(30 - 16 * h);
  return { seconds: Math.round((9 - 6 * h) * 10) / 10, dash, gap, period: dash + gap };
}

/** 柔光层的不透明度随热度:0 → 0.12,1 → 0.6。 */
export const glowAlphaOf = (heat: number) => Math.round((0.12 + 0.48 * Math.min(1, Math.max(0, heat))) * 100) / 100;

/** 没有热度数据(灵魂的行程、在押没取到)时的流光:一律中等。 */
const STEADY = 0.5;
/**
 * 世界图上终点不是界域的线(地府十三站、鬼门关、死亡这类小写节点没有在押数):「不知道」不是「没有人」,
 * 给慢而疏的流光。只有确实数到 0 的站才不画。
 */
export const UNMEASURED = 0.2;

/** 一段线的热度:没有热度表 → 中等;终点有读数 → 它的热度;终点不是界域 → `UNMEASURED`。 */
export const edgeHeat = (heat: ReadonlyMap<string, number> | null, to: string) =>
  heat ? (heat.has(to) ? heat.get(to)! : UNMEASURED) : STEADY;

/**
 * 每段走过的线加柔光与流光,在 `paintStates` 之后调用。Design 的样例只给样例里走过的线画了柔光层;
 * 没有的照现有的一条克隆一条。`heat` 给了(世界图,在押取到了)就按每段**终点**那一站的热度定柔光强弱与流光快慢。
 * 支线的柔光、流光也带 `branch` 与 `data-to`,跟着 `applyBranches` 收起。线宽统一成 `STROKE` 两档。
 */
export function paintLight(svg: Element, heat: ReadonlyMap<string, number> | null) {
  svg.querySelectorAll("#terrain .flow").forEach((el) => el.remove());
  const sample = svg.querySelector("#terrain .edge-glow");
  for (const edge of edgesOf(svg)) {
    const walked = edge.getAttribute("data-state") === "walked";
    edge.setAttribute("stroke-width", String(walked ? STROKE.walked : STROKE.ahead));
    let glow = edge.nextElementSibling?.classList.contains("edge-glow") ? edge.nextElementSibling : null;
    if (!glow && sample) {
      glow = sample.cloneNode(true) as Element;
      glow.setAttribute("d", edge.getAttribute("d") ?? "");
      edge.after(glow);
    }
    const to = edge.getAttribute("data-to")!;
    const h = edgeHeat(heat, to);
    if (glow) {
      glow.setAttribute("display", walked ? "inline" : "none");
      glow.setAttribute("data-to", to);
      glow.classList.toggle("branch", isBranch(edge));
      if (heat?.has(to)) glow.setAttribute("stroke-opacity", String(glowAlphaOf(h)));
    }
    const flow = walked ? flowOf(h) : null;
    if (!flow) continue;
    const path = svg.ownerDocument.createElementNS(SVG_NS, "path");
    path.setAttribute("class", isBranch(edge) ? "flow branch" : "flow");
    path.setAttribute("aria-hidden", "true");
    path.setAttribute("d", edge.getAttribute("d") ?? "");
    path.setAttribute("data-to", to);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke-width", String(STROKE.walked));
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-dasharray", `${flow.dash} ${flow.gap}`);
    path.setAttribute("style", `--flow-s:${flow.seconds}s;--flow-period:${flow.period}`);
    (glow ?? edge).after(path);
  }
}

/**
 * 当前处(Design 第十六批 §1.4):`paintStates` 画的 `.pulse` 成为一圈静止的虚线环,外面加一段 60° 的实弧(`.scan`),
 * 12 秒转一圈。颜色在 CSS。
 */
export function addScanRing(svg: Element) {
  const pulse = svg.querySelector("#terrain .pulse");
  if (!pulse) return;
  pulse.setAttribute("stroke-width", String(STROKE.ring));
  pulse.setAttribute("stroke-dasharray", "2 3");
  const r = Number(pulse.getAttribute("r") ?? 5) + 3;
  const scan = svg.ownerDocument.createElementNS(SVG_NS, "circle");
  scan.setAttribute("class", "scan");
  scan.setAttribute("aria-hidden", "true");
  scan.setAttribute("cx", pulse.getAttribute("cx") ?? "0");
  scan.setAttribute("cy", pulse.getAttribute("cy") ?? "0");
  scan.setAttribute("r", String(r));
  scan.setAttribute("fill", "none");
  scan.setAttribute("stroke-width", String(STROKE.ring));
  scan.setAttribute("stroke-linecap", "round");
  const c = 2 * Math.PI * r; // 60° 的弧 = 六分之一圈
  scan.setAttribute("stroke-dasharray", `${(c / 6).toFixed(1)} ${((c * 5) / 6).toFixed(1)}`);
  pulse.after(scan);
}

/** 网格的格距(viewBox 单位);刻度每格一短、每五格一长。 */
export const GRID = 24;

/** 图下的网格与顶边刻度(第十六批 §1.4:每 5 格一根长刻度):插在底色之后、`#terrain` 之前,不随缩放动(它是参照,不是地形)。 */
export function addGrid(svg: Element) {
  svg.querySelector(":scope > .map-grid")?.remove();
  const doc = svg.ownerDocument;
  const { width, height } = viewBoxOf(svg);
  let lines = "";
  for (let x = GRID; x < width; x += GRID) lines += `M${x} 0V${height}`;
  for (let y = GRID; y < height; y += GRID) lines += `M0 ${y}H${width}`;
  let ticks = "";
  for (let x = 0; x <= width; x += GRID) ticks += `M${x} 0v${x % (GRID * 5) === 0 ? 8 : 4}`;
  const g = doc.createElementNS(SVG_NS, "g");
  g.setAttribute("class", "map-grid");
  g.setAttribute("aria-hidden", "true");
  for (const [cls, d] of [["map-grid-lines", lines], ["map-grid-ticks", ticks]] as const) {
    const p = doc.createElementNS(SVG_NS, "path");
    p.setAttribute("class", cls);
    p.setAttribute("d", d);
    p.setAttribute("fill", "none");
    g.appendChild(p);
  }
  const terrain = svg.querySelector(":scope > #terrain");
  if (terrain) svg.insertBefore(g, terrain);
  else svg.appendChild(g);
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 一站在图上占的框:浏览器里是包围盒;jsdom 没有 getBBox,按站名锚点估一个 20 见方的框(Design 的站名写在站下方约 25 处)。
 * 读不到返回 null。
 */
export function nodeBox(svg: Element, id: string): Rect | null {
  const el = byId(svg, id);
  const box = el ? bboxOf(el) : null;
  if (box) return box;
  const name = el ? labelLines(svg, id).name : null;
  if (!name) return null;
  const x = Number(name.getAttribute("x"));
  const y = Number(name.getAttribute("y"));
  return { x: x - 10, y: y - 45, width: 20, height: 20 };
}

/** 读数胶囊的尺寸(第十六批 §1.4):18 高,等宽 10.5 号,前面一条 14 宽的小进度条。 */
export const BADGE = { height: 18, font: 10.5, bar: 14, padX: 7, gap: 5 } as const;
/** 等宽字一个字宽约 0.6em。 */
export const badgeWidth = (text: string) => Math.round(BADGE.padX * 2 + BADGE.bar + BADGE.gap + text.length * BADGE.font * 0.6);
/** 满八成以上:描边与进度条换金属色,外加一圈光(第十六批)。 */
export const BADGE_HOT = 0.8;

/**
 * 胶囊放在站的右上方;右边放不下(超出图宽)就放到左上方。两边都放不下(站贴着左边又很宽)就夹进图里,
 * 顶上同样不出图 —— 全景的框就是 viewBox,胶囊出了 viewBox 就被框切掉。
 */
export function badgePlacement(node: Rect, width: number, mapWidth: number): { x: number; y: number; side: "right" | "left" } {
  const y = Math.max(0, Math.round(node.y - BADGE.height - 2));
  const right = Math.round(node.x + node.width + 4);
  if (right + width <= mapWidth) return { x: right, y, side: "right" };
  return { x: Math.max(0, Math.min(mapWidth - width, Math.round(node.x - width - 4))), y, side: "left" };
}

/** 读数的字:满 / 将满前面加字形(■ / ◐,同树表图例),不只靠颜色;容量未记录写 —。 */
export function badgeText(load: StationLoad): string {
  const level = loadOf(load.held, load.capacity);
  return `${level === "full" ? "■ " : level === "near" ? "◐ " : ""}${load.held} / ${load.capacity ?? "—"}`;
}

/**
 * 每站一个读数胶囊「在押 / 容量」,挂在那一站标签组里(跟着标签平移,字号不随缩放变)。返回每个胶囊占的框(给分组名避让)。
 */
export function markLoads(svg: Element, loads: ReadonlyMap<string, StationLoad>): Map<string, Rect> {
  svg.querySelectorAll("#labels .map-badge").forEach((el) => el.remove());
  const placed = new Map<string, Rect>();
  const doc = svg.ownerDocument;
  const mapWidth = viewBoxOf(svg).width;
  const make = (tag: string, attrs: Record<string, string | number>) => {
    const el = doc.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    return el;
  };
  for (const [id, load] of loads) {
    const group = svg.querySelector(`#labels [data-for="${CSS_ESCAPE(id)}"]`);
    const box = nodeBox(svg, id);
    if (!group || !box) continue;
    const text = badgeText(load);
    const w = badgeWidth(text);
    const at = badgePlacement(box, w, mapWidth);
    const level = loadOf(load.held, load.capacity);
    const ratio = load.capacity ? Math.min(1, load.held / load.capacity) : 0;
    const g = make("g", { class: "map-badge", transform: `translate(${at.x} ${at.y})`, "aria-hidden": "true" });
    if (level) g.setAttribute("data-load", level);
    if (load.capacity !== null && (load.capacity === 0 ? load.held > 0 : ratio >= BADGE_HOT)) g.setAttribute("data-hot", "");
    const h = BADGE.height;
    if (g.hasAttribute("data-hot")) g.appendChild(make("rect", { class: "map-badge-halo", x: -2, y: -2, width: w + 4, height: h + 4, rx: (h + 4) / 2 }));
    g.appendChild(make("rect", { class: "map-badge-pill", width: w, height: h, rx: h / 2 }));
    g.appendChild(make("rect", { class: "map-badge-track", x: BADGE.padX, y: h / 2 - 1, width: BADGE.bar, height: 2, rx: 1 }));
    g.appendChild(make("rect", { class: "map-badge-bar", x: BADGE.padX, y: h / 2 - 1, width: Math.round(BADGE.bar * ratio * 10) / 10, height: 2, rx: 1 }));
    const label = make("text", { class: "map-badge-text", x: BADGE.padX + BADGE.bar + BADGE.gap, y: h / 2 + 3.6 });
    label.textContent = text;
    g.appendChild(label);
    group.appendChild(g);
    placed.set(id, { x: at.x, y: at.y, width: w, height: h });
  }
  return placed;
}

// ── 主角节点(Design 第十六批 §1)───────────────────────────────────────────────────────
/** 节点 id → 主角节点文件名(`public/v4/maps/nodes/hero-<名>.svg`)。每份文件的 `data-node` 就是这里的键。 */
export const HERO_NODES: Record<"cn" | "eu" | "eg" | "gr", Record<string, string>> = {
  cn: { "dy-ghost-gate": "cn-ghost-gate", FENGDU_CITY: "cn-fengdu-city", "dy-ten-courts": "cn-ten-courts", "dy-six-paths": "cn-six-paths" },
  eu: { EU_ANTINFERNO: "eu-hell-gate", "eu-hell": "eu-cocytus", EU_PURGATORY: "eu-purgatory-mount", EU_HEAVEN: "eu-heaven" },
  eg: { EG_DUAT_ENTRY: "eg-duat-gate", EG_HALL_TWO_TRUTHS: "eg-two-truths", EG_AARU: "eg-aaru" },
  gr: { GR_ACHERON: "gr-acheron", GR_PLATO_MEADOW: "gr-three-judges", GR_ASPHODEL_MEADOW: "gr-asphodel", GR_TARTARUS: "gr-tartarus", GR_ISLES_OF_THE_BLESSED: "gr-isles" },
};
export const heroUrl = (name: string) => `/v4/maps/nodes/hero-${name}.svg`;

/** 普通站 56、挂在点列旁的 48(按 1120 宽的图)。 */
export const HERO_SIZE = { station: 56, row: 48 } as const;

/**
 * 主角节点的位置:普通站以站的中心为中心;点列(十殿、九圈、炼狱七层 —— 节点里有子格的)不替换,
 * 48 宽挂在点列左边,竖直居中。
 */
export function heroPlacement(node: Rect, dotRow: boolean): Rect {
  const size = dotRow ? HERO_SIZE.row : HERO_SIZE.station;
  const cy = node.y + node.height / 2;
  const x = dotRow ? node.x - size - 6 : node.x + node.width / 2 - size / 2;
  return { x: Math.round(x), y: Math.round(cy - size / 2), width: size, height: size };
}

/**
 * 把主角节点放进图里(在 `paintStates` 之后、`addScanRing` 之前):`heroes` 是解析好的模板(`parseMapSvg` 消毒过、
 * 去掉了自带的 <style>,样式在 globals.css 的 `.v4-map .hero`)。放进节点的 `<g data-state>` 里,状态随节点。
 * 普通站加 `data-hero="replace"`,CSS 藏起原来那一小块图形;点列不替换。当前站是整个节点时,`.pulse` 移到主角节点的中心、
 * 半径按它的大小。返回每个主角节点占的框。
 */
export function addHeroes(svg: Element, heroes: ReadonlyMap<string, Element>): Map<string, Rect> {
  const placed = new Map<string, Rect>();
  for (const [id, template] of heroes) {
    const node = byId(svg, id);
    const box = node ? nodeBox(svg, id) : null;
    if (!node || !box || !node.matches("g.node")) continue;
    const dotRow = cellsOf(node).length > 0;
    const at = heroPlacement(box, dotRow);
    const hero = template.cloneNode(true) as Element;
    hero.setAttribute("class", "hero");
    hero.removeAttribute("data-state");
    for (const [k, v] of Object.entries({ x: at.x, y: at.y, width: at.width, height: at.height })) hero.setAttribute(k, String(v));
    node.appendChild(hero);
    if (!dotRow) {
      node.setAttribute("data-hero", "replace");
      const pulse = node.querySelector(":scope > .pulse");
      if (pulse) {
        pulse.setAttribute("cx", String(at.x + at.width / 2));
        pulse.setAttribute("cy", String(at.y + at.height / 2));
        pulse.setAttribute("r", String(at.width / 2 + 2));
      }
    }
    placed.set(id, at);
  }
  return placed;
}

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/**
 * 分组名(没有 `data-for` 的说明字)压到主角节点时,挪到那个节点加它读数胶囊的右边(第十六批 §1.4:地府「赴冥 · 十三站之一至十」
 * 与鬼门关)。字的框:浏览器里取包围盒,jsdom 按字数 × 字号估。
 */
export function moveGroupLabelsOffHeroes(svg: Element, heroes: ReadonlyMap<string, Rect>, badges: ReadonlyMap<string, Rect>) {
  for (const text of Array.from(svg.querySelectorAll("#labels > g:not([data-for]) > text"))) {
    const size = Number(text.getAttribute("font-size") ?? 11);
    const len = (text.textContent ?? "").length * size;
    const x = Number(text.getAttribute("x") ?? 0);
    const y = Number(text.getAttribute("y") ?? 0);
    const anchor = text.getAttribute("text-anchor");
    const left = anchor === "middle" ? x - len / 2 : anchor === "end" ? x - len : x;
    const box = bboxOf(text) ?? { x: left, y: y - size, width: len, height: size * 1.3 };
    for (const [id, hero] of heroes) {
      if (!overlaps(box, hero)) continue;
      const badge = badges.get(id);
      const right = Math.max(hero.x + hero.width, badge ? badge.x + badge.width : 0);
      text.setAttribute("x", String(right + 8));
      text.setAttribute("text-anchor", "start");
      break;
    }
  }
}

// ── 窄屏镜头 ─────────────────────────────────────────────────────────────────────────────
/** 标签字号不随缩放变(只平移),屏上字号 = 字号 × 容器宽 / viewBox 宽。393 宽时整张 1120 的图约 310px 宽,10 号字约 3px。 */
export const MIN_LABEL_PX = 11;
/** 窄屏镜头的比例:一个 viewBox 单位 1.25 屏幕像素(第十六批 §1.4「393 宽默认放大 1.25 倍」)。 */
export const CLOSE_SCALE = 1.25;
/** 当前站放在镜头横向六成处,左边看得见走过来的那一段。 */
export const FOCUS_AT = 0.6;
/**
 * 镜头只给窄屏:容器宽到这里就开全景(2026-11-09)。只看字号时桌面也进近处 —— 地府的 10 号字要 1232px 宽的容器才到 11px,
 * 1280 宽的桌面容器约 870px,于是默认镜头把酆都那一头、埃及「两真之殿」的读数切在框外。393 宽的手机容器约 330px。
 */
export const CLOSE_UP_BELOW_PX = 640;

/** 图里最小的标签字号(viewBox 单位);读不到按 12。 */
export function minLabelFont(svg: Element): number {
  const sizes = Array.from(svg.querySelectorAll("#labels text[font-size]"), (t) => Number(t.getAttribute("font-size"))).filter((n) => n > 0);
  return sizes.length ? Math.min(...sizes) : 12;
}

/** 镜头 = 改写后的 viewBox(viewBox 单位)。 */
export interface MapCamera {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 路线上下留的边(viewBox 单位):主角节点 56 高、以站为中心,读数胶囊在站上方 20 —— 线上下各 36 都装得下。 */
export const ROUTE_PAD = 36;

/**
 * 一条路径 `d` 里经过的 y(端点与控制点)。
 * ponytail: 只认绝对命令(M L C S Q T V;H 没有 y)—— Design 的四张图的 `.edge` 全是绝对坐标;哪天出现相对命令,这里就漏算那一段。
 */
function pathYs(d: string): number[] {
  const ys: number[] = [];
  for (const [, cmd, args] of d.matchAll(/([A-Za-z])([^A-Za-z]*)/g)) {
    const n = (args.match(/-?(?:\d+\.?\d*|\.\d+)/g) ?? []).map(Number);
    if (cmd === "V") ys.push(...n);
    else if ("MLCSQT".includes(cmd)) ys.push(...n.filter((_, i) => i % 2 === 1));
  }
  return ys;
}

/**
 * 图上真正画了东西的竖向范围(viewBox 单位):路线(`.edge`)上下各留 `ROUTE_PAD`,站名与组名的字整行算进去。读不到就 null(镜头取整图)。
 * 中国两段路(赴冥在上、回程在下)都在路线里,所以两段都在框内;埃及的路只占中间一条,镜头就不再带着上下两大片空网格。
 */
export function routeExtent(svg: Element, box: { width: number; height: number } = viewBoxOf(svg)): { y: number; h: number } | null {
  const top: number[] = [];
  const bottom: number[] = [];
  for (const edge of edgesOf(svg)) {
    const ys = pathYs(edge.getAttribute("d") ?? "");
    if (!ys.length) continue;
    top.push(Math.min(...ys) - ROUTE_PAD);
    bottom.push(Math.max(...ys) + ROUTE_PAD);
  }
  if (!top.length) return null;
  for (const text of Array.from(svg.querySelectorAll("#labels text[y]"))) {
    const y = Number(text.getAttribute("y"));
    const size = Number(text.getAttribute("font-size")) || 12;
    if (!Number.isFinite(y)) continue;
    top.push(y - size - 4);
    bottom.push(y + size / 2);
  }
  const y0 = Math.max(0, Math.floor(Math.min(...top)));
  const y1 = Math.min(box.height, Math.ceil(Math.max(...bottom)));
  return y1 > y0 ? { y: y0, h: y1 - y0 } : null;
}

/**
 * 窄屏镜头:容器窄于 `CLOSE_UP_BELOW_PX`、且整图时最小的字在屏上小于 `MIN_LABEL_PX` 才要镜头(否则 null)。镜头按 `CLOSE_SCALE` 取宽(393 宽约 290 单位,
 * 10 号字约 12.5px);高取 `extent`(`routeExtent`:画出来的路线与字的竖向范围,没给就是整图);`focus` 落在横向 `FOCUS_AT` 处,不出图。
 * 2026-11-14 前高总是整图:埃及的路只在中间一条,393 宽的近处是一大片空网格。
 */
export function narrowCamera(
  box: { width: number; height: number },
  focus: { x: number; y: number } | null,
  containerPx: number,
  fontUnits: number,
  extent: { y: number; h: number } | null = null,
): MapCamera | null {
  if (!(containerPx > 0) || containerPx >= CLOSE_UP_BELOW_PX) return null;
  if ((fontUnits * containerPx) / box.width >= MIN_LABEL_PX) return null;
  const w = Math.min(box.width, Math.round(containerPx / CLOSE_SCALE));
  const { y, h } = extent ?? { y: 0, h: box.height };
  const fx = focus?.x ?? 0;
  const x = Math.min(box.width - w, Math.max(0, Math.round(fx - w * FOCUS_AT)));
  return { x, y, w, h };
}

/** 贴图边的字离边留的空(viewBox 单位)。 */
export const LABEL_EDGE = 4;

/**
 * 出了图边的字往里收 —— 左边出界的改成左对齐贴 `LABEL_EDGE`,右边出界的右对齐。近处与全景都调用(2026-11-14):
 * 镜头夹在图内,全景的图框就是整张图,出了图的那一截哪种视图都看不到(英文「Embalming · seventy days」以 x=60 居中,
 * 左端约在 -8;地府「Earth God's Temple」、埃及「Field of Reeds (Aaru)」同理)。图内的字不动,照 Design 的位置画。
 * 宽:浏览器里量(`getComputedTextLength`),jsdom 里估(汉字一个字号宽,其余 0.56 个)。
 * ponytail: 只管图边;横跨镜头左右边的字仍会切一截(平移就能看全),要第一眼全见得另做镜头适配或折行。
 */
export function anchorLabelsInside(svg: Element, width: number) {
  for (const t of Array.from(svg.querySelectorAll("#labels text"))) {
    if (t.closest(".map-badge") || !(t.textContent ?? "").trim()) continue;
    const { x, x0, w } = textSpan(t);
    if (!Number.isFinite(x) || w > width - 2 * LABEL_EDGE) continue;
    if (x0 < LABEL_EDGE) {
      t.setAttribute("text-anchor", "start");
      t.setAttribute("x", String(LABEL_EDGE));
    } else if (x0 + w > width - LABEL_EDGE) {
      t.setAttribute("text-anchor", "end");
      t.setAttribute("x", String(width - LABEL_EDGE));
    }
  }
}

/** 一行字的横向范围:浏览器里量(`getComputedTextLength`),jsdom 里估(汉字一个字号宽,其余 0.56 个)。 */
function textSpan(t: Element): { x: number; x0: number; w: number; size: number } {
  const size = Number(t.getAttribute("font-size")) || 12;
  let w = (t as SVGTextElement).getComputedTextLength?.() || 0;
  if (!w) for (const ch of t.textContent ?? "") w += (ch.codePointAt(0) ?? 0) >= 0x2e80 ? size : size * 0.56;
  const x = Number(t.getAttribute("x"));
  const anchor = t.getAttribute("text-anchor") ?? "start";
  return { x, w, size, x0: anchor === "middle" ? x - w / 2 : anchor === "end" ? x - w : x };
}

/** 两个站名之间至少留的空(viewBox 单位)。 */
export const NAME_GAP = 6;

/**
 * 挤在一起的站名错开(2026-11-14):地府英文全景的「Road of the Yellow Springs」一类长名比站距宽,邻站的名字压在一起。
 * 从左往右逐个放:和已放好的名字(框 = 字宽 × 字号,左右各留 `NAME_GAP`)撞上的,连同它的说明行往下挪一行;
 * 挪了还撞就再挪一行(最多两行)。中文名短,撞不上,原样画。
 * ponytail: 只看站名之间,不看说明行与图上的画;站距窄到三行也放不下时仍会挤,那时要折行或缩字。
 */
export function staggerCrowdedNames(svg: Element) {
  const items: { name: Element; details: Element[]; x0: number; w: number; size: number; y: number }[] = [];
  for (const node of nodesOf(svg)) {
    const { name, details } = labelLines(svg, node.id);
    if (!name || !(name.textContent ?? "").trim()) continue;
    const y = Number(name.getAttribute("y"));
    const span = textSpan(name);
    if (Number.isFinite(y) && Number.isFinite(span.x)) items.push({ name, details, y, ...span });
  }
  items.sort((p, q) => p.x0 - q.x0);
  const placed: Rect[] = [];
  for (const it of items) {
    const step = Math.round(it.size * 1.2);
    const boxAt = (dy: number): Rect => ({ x: it.x0 - NAME_GAP / 2, y: it.y + dy - it.size, width: it.w + NAME_GAP, height: it.size });
    let dy = 0;
    while (dy < 2 * step && placed.some((r) => overlaps(boxAt(dy), r))) dy += step;
    placed.push(boxAt(dy));
    if (!dy) continue;
    for (const line of [it.name, ...it.details]) line.setAttribute("y", String(Number(line.getAttribute("y")) + dy));
    it.name.setAttribute("data-staggered", "");
  }
}

/** 平移镜头:横向移 dx 并夹在图内(竖向不动)。 */
export function panCamera(c: MapCamera, dx: number, box: { width: number; height: number }): MapCamera {
  return { ...c, x: Math.min(box.width - c.w, Math.max(0, Math.round(c.x + dx))) };
}

export const cameraCentre = (c: MapCamera) => ({ x: c.x + c.w / 2, y: c.y + c.h / 2 });

/** 一站在图上的位置:子格读圆心;节点取包围盒中心;jsdom 没有 getBBox,退回站名的锚点(标签就在站下方)。 */
export function stationPoint(svg: Element, id: string): { x: number; y: number } | null {
  const el = byId(svg, id);
  if (!el) return null;
  if (el.tagName === "circle") return { x: Number(el.getAttribute("cx")), y: Number(el.getAttribute("cy")) };
  const box = bboxOf(el);
  if (box) return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const name = labelLines(svg, id).name;
  return name ? { x: Number(name.getAttribute("x")), y: Number(name.getAttribute("y")) } : null;
}

/** 镜头写进 viewBox;null 恢复整图。 */
export function applyCamera(svg: Element, camera: MapCamera | null, box: { width: number; height: number }) {
  const c = camera ?? { x: 0, y: 0, w: box.width, h: box.height };
  svg.setAttribute("viewBox", `${c.x} ${c.y} ${c.w} ${c.h}`);
}
