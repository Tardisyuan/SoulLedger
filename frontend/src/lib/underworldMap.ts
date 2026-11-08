import { CIVILIZATION_SHORT_CODES } from "@soulledger/core/config/civilizations";

/**
 * 冥界地图(规范 v4 第七批 S07 / 第八批第 3 条):Design 交付的四张 SVG(`public/v4/maps/`,文明 × 深浅)
 * 上按一个灵魂的行程改 `data-state`。这里只放**纯 DOM 操作**,组件在 `components/realms/UnderworldMap.tsx`。
 *
 * SVG 的约定(Design 第八批回复 §3):
 *   - `#terrain` 路线、底景、节点;`#labels` 全部文字;`#you-are-here` 空组,`data-for` 指当前站。
 *   - 节点 `<g class="node" id=… data-state="walked|current|ahead">`;线 `.edge` 带 `data-from` / `data-to`。
 *     id 是地府站码(`diyuStations.ts`)、界域码(`realms.names`),没有码的用小写短名(`dy-ten-courts`、`gr-death` …)。
 *   - 子格是节点里带 id 的 `<circle>`:十殿 `DY_COURT_xx`、九圈 `EU_HELL_xx`、七台 `EU_PURGATORY_Tn_*`、
 *     `gr-millennium-n`。子格没有 `data-state`,改它的 fill / stroke。
 *   - 埃及的七道通路、二十一道门户**没有子格**(第十二批第 4 条):逐门的 `EG_SEVEN_ARRWT-n` /
 *     `EG_TWENTYONE_SEBKHET-n` 删了,换成一条不分格、没有 id 的拱门装饰带(`path.gates-ornament`),
 *     随所在大站整体亮暗 —— 门不入行程,系统不逐门记录。当前时外框的脉动圈照整个节点画。
 *   - 图里的颜色是一个样例进度;三种状态的颜色就是图里的颜色 —— 所以调色板**从图里读**(`readPalette`),不另写一份。
 *   - 支线 `class="branch"`;根元素加 `map-hide-branches` 收起。
 *   - 缩放只缩 `#terrain`;`#labels` 只跟着平移(字号不变)。
 *
 * **规则 16 照旧**(`routeTopology.ts`):界域码的站只从 path 来,没记录的是「没走」。没有码的小写节点
 * (死亡、三判官、鬼门关……)不会出现在 path 里,在一个走过的站的上游就算走过 —— 不这样,
 * 每个灵魂的「死亡」都会是虚线。
 */

export type MapState = "walked" | "current" | "ahead";
export type MapSkin = "cn" | "eu" | "eg" | "gr";
export type MapTheme = "dark" | "light";

/** 文明 → 图的皮(CHINESE → cn)。认不出的文明没有图。 */
export function mapSkinOf(civilization: string | null | undefined): MapSkin | null {
  const skin = civilization ? CIVILIZATION_SHORT_CODES[civilization] : undefined;
  return skin === "cn" || skin === "eu" || skin === "eg" || skin === "gr" ? skin : null;
}

export const mapUrl = (skin: MapSkin, theme: MapTheme) => `/v4/maps/soulledger-map-${skin}-${theme}.svg`;

export const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * 线宽只有这几档(viewBox 单位)。`.edge` 与流光另由 CSS 设 `vector-effect: non-scaling-stroke`,放大、窄屏时屏幕上也是这几档 ——
 * 此前走过的线随 `#terrain` 的 scale 一起变粗,放到 4 倍是 10 个单位,而同屏的字不变。
 */
export const STROKE = { ahead: 1.5, walked: 2, ring: 1.5 } as const;

/**
 * 解析并消毒。文件是 Design 交付、随仓库发布的静态资源(`underworldMap.test.ts` 逐份确认没有脚本、外链、
 * 事件属性);这里再删一遍,因为它是用 importNode 插进页面的:
 *   - `<script>` / `<foreignObject>` / `<style>`(样式在 globals.css 的 `.v4-map` 里,按页面作用域写;
 *     SVG 自带的 `<style>` 一插进文档就是全局的,`.pulse` 会撞别人的类名)。
 *   - `on*` 属性;不以 `#` 开头的 `href` / `xlink:href`。
 * 解析失败返回 null。
 *
 * `keepStyle`:落地页内联的文明主视觉是构建时嵌入的原文(`LandingEmblem`),underworldMap.test.ts 用这一档证明消毒器对它无事可做 —— 它的 `<style>` 每条都写在
 * `.emblem2[data-civ][data-theme]` 下,插进文档也撞不到别人;带 `@import` 或外部 `url()` 的照删。
 */
export function parseMapSvg(text: string, { keepStyle = false }: { keepStyle?: boolean } = {}): SVGSVGElement | null {
  if (typeof DOMParser === "undefined") return null;
  const doc = new DOMParser().parseFromString(text, "image/svg+xml");
  const root = doc.documentElement;
  if (!root || root.nodeName !== "svg" || doc.getElementsByTagName("parsererror").length) return null;
  doc.querySelectorAll("script, foreignObject").forEach((el) => el.remove());
  doc.querySelectorAll("style").forEach((el) => {
    if (!keepStyle || /@import|url\(\s*['"]?(?!#)/i.test(el.textContent ?? "")) el.remove();
  });
  for (const el of [root, ...Array.from(root.querySelectorAll("*"))]) {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith("on")) el.removeAttribute(attr.name);
      else if ((name === "href" || name === "xlink:href") && !attr.value.startsWith("#")) el.removeAttribute(attr.name);
    }
  }
  return root as unknown as SVGSVGElement;
}

/** 取一份 SVG 文本,同一网址只取一次(失败的不缓存,下次再取)。地图与落地页主视觉共用。 */
const svgCache = new Map<string, Promise<string>>();
export function loadSvg(url: string): Promise<string> {
  if (!svgCache.has(url)) {
    svgCache.set(
      url,
      fetch(url).then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status))))).catch((e) => {
        svgCache.delete(url);
        throw e;
      }),
    );
  }
  return svgCache.get(url)!;
}

export const byId = (svg: Element, id: string): Element | null => svg.querySelector(`[id="${CSS_ESCAPE(id)}"]`);
export const CSS_ESCAPE = (s: string) => s.replace(/["\\]/g, "\\$&");

export const nodesOf = (svg: Element): Element[] => Array.from(svg.querySelectorAll("#terrain g.node[id]"));
export const edgesOf = (svg: Element): Element[] => Array.from(svg.querySelectorAll("#terrain .edge[data-from][data-to]"));
/** 节点里带 id 的子格(十殿、九圈、七台、千年)。 */
export const cellsOf = (node: Element): Element[] => Array.from(node.querySelectorAll("circle[id]"));
export const isBranch = (el: Element) => el.classList.contains("branch");

/** 一处有记录的停留:`id` 是图上的节点或子格;`current` = 还没离开。按先后排。 */
export interface MapVisit {
  id: string;
  current: boolean;
}

export interface MapStates {
  nodes: Map<string, MapState>;
  cells: Map<string, MapState>;
  /** 当前的节点,及其中当前的子格(没有就是 null)。 */
  current: { node: string; cell: string | null } | null;
}

/**
 * 记录 → 每个节点与子格的状态。认不出的 id(图上没有这一站,如 `EG_DEVOURER`)跳过 ——
 * 它在文字清单与行程条里照样在。多处「还没离开」时最后一处是当前,前面的算走过。
 */
export function mapStates(svg: Element, visits: readonly MapVisit[]): MapStates {
  const nodes = new Map<string, MapState>();
  const cells = new Map<string, MapState>();
  let current: MapStates["current"] = null;
  for (const visit of visits) {
    const el = byId(svg, visit.id);
    const node = el?.closest("g.node[id]");
    if (!el || !node) continue;
    const nodeId = node.id;
    const cellId = el === node ? null : visit.id;
    if (visit.current) {
      if (current) {
        nodes.set(current.node, "walked");
        if (current.cell) cells.set(current.cell, "walked");
      }
      current = { node: nodeId, cell: cellId };
      nodes.set(nodeId, "current");
      if (cellId) cells.set(cellId, "current");
    } else {
      if (cellId && cells.get(cellId) !== "current") cells.set(cellId, "walked");
      if (nodes.get(nodeId) !== "current") nodes.set(nodeId, "walked");
    }
  }
  // 没有码的小写节点:在一个走过 / 当前的节点上游就算走过。逆着线走,不走进起点(希腊的勒忒 → 死亡是一圈)。
  const all = nodesOf(svg);
  const start = all[0]?.id;
  const into = new Map<string, string[]>();
  for (const edge of edgesOf(svg)) {
    const from = edge.getAttribute("data-from")!;
    const to = edge.getAttribute("data-to")!;
    if (to === start) continue;
    into.set(to, [...(into.get(to) ?? []), from]);
  }
  const queue = [...nodes.keys()];
  const seen = new Set(queue);
  while (queue.length) {
    for (const from of into.get(queue.shift()!) ?? []) {
      if (seen.has(from)) continue;
      seen.add(from);
      queue.push(from);
      if (/^[a-z]/.test(from) && !nodes.has(from)) nodes.set(from, "walked");
    }
  }
  for (const node of all) if (!nodes.has(node.id)) nodes.set(node.id, "ahead");
  return { nodes, cells, current };
}

/** 世界图(/realms,没有灵魂):全部点亮,没有当前站。 */
export function worldStates(svg: Element): MapStates {
  const nodes = new Map(nodesOf(svg).map((n) => [n.id, "walked" as MapState]));
  return { nodes, cells: new Map(), current: null };
}

/**
 * 地府:十三站来自 `diyu_station`(与行程条同一个序号 —— 前面的站算走过),十殿的子格来自 path 的殿。
 * 十八层地狱、莲花台是挪站支线:不因序号在前而算走过,只有当前在那里时才是当前。
 */
export function diyuVisits(
  stations: readonly string[],
  station: string | null | undefined,
  path: readonly { realm_code: string | null; left_at: string | null }[] = [],
): MapVisit[] {
  const at = stations.indexOf(station ?? "");
  if (at < 0) return [];
  const branches = new Set(["EIGHTEEN_HELLS", "LOTUS_TERRACE"]);
  const visits: MapVisit[] = stations
    .slice(0, at)
    .filter((s) => !branches.has(s))
    .map((id) => ({ id, current: false }));
  const courts = path.filter((p) => p.realm_code?.startsWith("DY_COURT_"));
  const inCourt = station === "FENGDU_CITY" && courts.some((c) => c.left_at === null);
  visits.push({ id: stations[at], current: !inCourt });
  for (const c of courts) visits.push({ id: c.realm_code!, current: c.left_at === null && inCourt });
  return visits;
}

/** 其余三个文明:path 原样(界域码就是图上的 id)。 */
export const pathVisits = (path: readonly { realm_code: string | null; left_at: string | null }[]): MapVisit[] =>
  path.filter((p) => p.realm_code).map((p) => ({ id: p.realm_code!, current: p.left_at === null }));

/** 希腊千年格的格数:十期,每期一百年(Rep. 615a-b,`gr-millennium-1` … `-10`)。 */
export const MILLENNIUM_CELLS = 10;

/**
 * 希腊:path 之外,可医者在塔尔塔罗斯服的千年(Rep. 615a)点亮千年格(用户 2026-11-07)。
 * `years` 是账本 SENTENCE 读数的 `elapsed_years`;**不可医(永罚)、起点没登记的由调用方给 null**,千年格不亮。
 * 只在此刻就在塔尔塔罗斯时加:前面的格算走过,第 ⌊years / 100⌋ + 1 格是当前(满千年仍停在第十格)。
 * 当前于是落在千年格上,塔尔塔罗斯算走过 —— 与灵魂端路线(`soulRoute` 的 CYCLE)同一处。
 */
export function greekVisits(path: readonly { realm_code: string | null; left_at: string | null }[], years: number | null): MapVisit[] {
  const visits = pathVisits(path);
  const last = visits[visits.length - 1];
  if (years === null || !last?.current || last.id !== "GR_TARTARUS") return visits;
  const at = Math.min(MILLENNIUM_CELLS, Math.floor(Math.max(0, years) / 100) + 1);
  visits[visits.length - 1] = { ...last, current: false };
  for (let n = 1; n <= at; n++) visits.push({ id: `gr-millennium-${n}`, current: n === at });
  return visits;
}

/** 三种状态的颜色,从样例里读:走过 = 走过的线,没走 = 没走的线,当前 = 脉动圈,空心底 = 画布底。 */
export interface MapPalette {
  walked: string;
  current: string;
  ahead: string;
  hollow: string;
}

export function readPalette(svg: Element): MapPalette | null {
  const edge = (state: string) =>
    svg.querySelector(`#terrain .edge[data-state="${state}"]:not(.branch)`)?.getAttribute("stroke") ?? null;
  const walked = edge("walked");
  const ahead = edge("ahead");
  const current = svg.querySelector("#terrain .pulse")?.getAttribute("stroke") ?? null;
  const hollow = svg.querySelector(":scope > rect")?.getAttribute("fill") ?? null;
  return walked && ahead && current && hollow ? { walked, current, ahead, hollow } : null;
}

const FILL: Record<MapState, keyof MapPalette> = { walked: "walked", current: "current", ahead: "hollow" };
const STROKE_COLOUR: Record<MapState, keyof MapPalette> = { walked: "walked", current: "current", ahead: "ahead" };

/** 子格三种样子(照样例):走过实心、当前金属色实心、没走空心细圈。 */
function paintCell(cell: Element, state: MapState, p: MapPalette) {
  cell.setAttribute("data-state", state);
  cell.setAttribute("fill", state === "ahead" ? "none" : p[FILL[state]]);
  cell.setAttribute("stroke", p[STROKE_COLOUR[state]]);
  cell.setAttribute("stroke-opacity", state === "ahead" ? "0.6" : "1");
}

/**
 * 一个节点里的元素按状态换色。只换「原来那个状态的颜色」:样例里走过 / 当前的节点,走过色与当前色都算状态色
 * (十殿那种容器两样都有);没走的节点只认空心底与灰线 —— 它身上的金(孟婆碗)和危险红是装饰,不动。
 */
function recolor(el: Element, from: MapState | null, to: MapState, p: MapPalette) {
  if (!from || from === to) return;
  for (const [attr, table] of [["fill", FILL], ["stroke", STROKE_COLOUR]] as const) {
    const value = el.getAttribute(attr);
    const stateColours = from === "ahead" ? [p[table.ahead]] : [p[table.walked], p[table.current]];
    if (value && stateColours.includes(value)) el.setAttribute(attr, p[table[to]]);
  }
}

/**
 * 把状态画上去(就地改 `svg`,应在模板的克隆上调用)。线:两端都走过 / 当前才是走过。
 * 当前处加脉动圈(`.pulse`,动效在 globals.css,减少动效时停住);原图样例的脉动圈先删掉。
 */
export function paintStates(svg: Element, states: MapStates, palette: MapPalette) {
  svg.querySelectorAll("#terrain .pulse").forEach((el) => el.remove());
  for (const node of nodesOf(svg)) {
    const from = (node.getAttribute("data-state") as MapState | null) ?? null;
    const to = states.nodes.get(node.id) ?? "ahead";
    node.setAttribute("data-state", to);
    const cells = new Set(cellsOf(node));
    for (const el of [node, ...Array.from(node.querySelectorAll("*"))]) if (!cells.has(el)) recolor(el, from, to, palette);
    // 门的装饰带:没走时是淡的(样例 0.55),走过 / 当前是实的。颜色由上面的 recolor 换。
    for (const band of Array.from(node.querySelectorAll(".gates-ornament"))) band.setAttribute("stroke-opacity", to === "ahead" ? "0.55" : "1");
    for (const cell of cells) paintCell(cell, states.cells.get(cell.id) ?? (to === "current" ? "ahead" : to), palette);
  }
  const lit = (id: string) => {
    const s = states.nodes.get(id);
    return s === "walked" || s === "current";
  };
  for (const edge of edgesOf(svg)) {
    const to: MapState = lit(edge.getAttribute("data-from")!) && lit(edge.getAttribute("data-to")!) ? "walked" : "ahead";
    const from = edge.getAttribute("data-state");
    edge.setAttribute("data-state", to);
    const glow = edge.nextElementSibling?.classList.contains("edge-glow") ? edge.nextElementSibling : null;
    if (glow) glow.setAttribute("display", to === "walked" ? "inline" : "none");
    if (from === to) continue;
    if (to === "walked") {
      edge.setAttribute("stroke", palette.walked);
      edge.setAttribute("stroke-opacity", "1");
      edge.setAttribute("stroke-width", String(STROKE.walked));
      edge.removeAttribute("stroke-dasharray");
    } else {
      edge.setAttribute("stroke", palette.ahead);
      edge.setAttribute("stroke-opacity", "0.45");
      edge.setAttribute("stroke-width", String(STROKE.ahead));
      edge.setAttribute("stroke-dasharray", "4 5");
    }
  }
  const at = currentShape(svg, states);
  if (at) {
    const pulse = svg.ownerDocument.createElementNS(SVG_NS, "circle");
    pulse.setAttribute("class", "pulse");
    pulse.setAttribute("cx", String(at.cx));
    pulse.setAttribute("cy", String(at.cy));
    pulse.setAttribute("r", String(at.r));
    pulse.setAttribute("fill", "none");
    pulse.setAttribute("stroke", palette.current);
    pulse.setAttribute("stroke-width", "2");
    at.parent.appendChild(pulse);
  }
}

/** 当前处的圆心:子格读 cx / cy;整个节点要 getBBox(浏览器才有;jsdom 里没有就不画脉动圈)。 */
function currentShape(svg: Element, states: MapStates) {
  if (!states.current) return null;
  const node = byId(svg, states.current.node);
  if (!node) return null;
  const cell = states.current.cell ? byId(svg, states.current.cell) : null;
  if (cell) {
    const r = Number(cell.getAttribute("r") ?? 3) + 1.5;
    return { parent: cell.parentNode as Element, cx: Number(cell.getAttribute("cx")), cy: Number(cell.getAttribute("cy")), r };
  }
  const box = bboxOf(node);
  if (!box || cellsOf(node).length) return null;
  return { parent: node, cx: box.x + box.width / 2, cy: box.y + box.height / 2, r: Math.max(box.width, box.height) / 2 + 1 };
}

export function bboxOf(el: Element): { x: number; y: number; width: number; height: number } | null {
  const g = el as unknown as SVGGraphicsElement;
  if (typeof g.getBBox !== "function") return null;
  try {
    const b = g.getBBox();
    return b.width || b.height ? { x: b.x, y: b.y, width: b.width, height: b.height } : null;
  } catch {
    return null; // 不在文档里(Firefox 会抛)
  }
}

/**
 * 支线收起:根上加 `map-hide-branches`。当前就在支线上时只把那一条画出来(`branch-shown`),
 * 返回还收着的支线节点数(给 `map.branches_hidden` / `map.branch_only`)。
 */
export function applyBranches(svg: Element, hidden: boolean, current: string | null): { hiddenCount: number; onlyCurrent: boolean } {
  svg.classList.toggle("map-hide-branches", hidden);
  const branchNodes = nodesOf(svg).filter(isBranch);
  const shown = hidden && current && branchNodes.some((n) => n.id === current) ? current : null;
  svg.querySelectorAll(".branch").forEach((el) => {
    const mine =
      shown !== null &&
      (el.id === shown || el.getAttribute("data-to") === shown || el.getAttribute("data-for") === shown || el.closest(`[id="${shown}"]`) !== null);
    el.classList.toggle("branch-shown", mine);
  });
  return {
    hiddenCount: hidden ? branchNodes.filter((n) => n.id !== shown).length : 0,
    onlyCurrent: shown !== null,
  };
}

/** 视图:缩放 k,平移 x / y(都在 viewBox 单位里)。 */
export interface MapView {
  k: number;
  x: number;
  y: number;
}

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;

export function viewBoxOf(svg: Element): { width: number; height: number } {
  const [, , w, h] = (svg.getAttribute("viewBox") ?? "0 0 1120 400").split(/\s+/).map(Number);
  return { width: w || 1120, height: h || 400 };
}

/** 不让图拖出框:缩放 1 时只能在原位。 */
export function clampView(view: MapView, box: { width: number; height: number }): MapView {
  const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.k));
  const clamp = (v: number, size: number) => Math.min(0, Math.max(size * (1 - k), v));
  return { k, x: clamp(view.x, box.width), y: clamp(view.y, box.height) };
}

/** 以 (cx, cy)(viewBox 单位)为中心缩放到 k。 */
export function zoomAt(view: MapView, k: number, cx: number, cy: number, box: { width: number; height: number }): MapView {
  const ratio = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k)) / view.k;
  return clampView({ k: view.k * ratio, x: cx - (cx - view.x) * ratio, y: cy - (cy - view.y) * ratio }, box);
}

/**
 * 缩放只给路线:`#terrain` 整体 translate + scale;`#labels` 每一组按它第一行字的锚点平移到放大后的位置,
 * 字本身不缩放(Design:字号不变,文字坐标是按原尺寸算的)。「你在这里」跟字一样处理。
 */
export function applyView(svg: Element, view: MapView) {
  svg.querySelector("#terrain")?.setAttribute("transform", `translate(${view.x} ${view.y}) scale(${view.k})`);
  const groups = [...Array.from(svg.querySelectorAll("#labels > g")), ...Array.from(svg.querySelectorAll("#you-are-here"))];
  for (const g of groups) {
    const text = g.querySelector("text");
    if (!text) continue;
    const ax = Number(text.getAttribute("x") ?? 0);
    const ay = Number(text.getAttribute("y") ?? 0);
    g.setAttribute("transform", `translate(${ax * (view.k - 1) + view.x} ${ay * (view.k - 1) + view.y})`);
  }
}

/** 「你在这里」:`#you-are-here` 里放一行字,`data-for` 指当前节点。坐标是当前处上方。 */
export function markYouAreHere(svg: Element, states: MapStates, text: string | null) {
  const group = svg.querySelector("#you-are-here");
  if (!group) return;
  group.replaceChildren();
  const node = states.current ? byId(svg, states.current.cell ?? states.current.node) : null;
  const at = node ? (node.tagName === "circle" ? { x: Number(node.getAttribute("cx")), y: Number(node.getAttribute("cy")) - 6 } : centreTop(node)) : null;
  if (!text || !at || !states.current) {
    group.setAttribute("style", "display:none");
    return;
  }
  group.setAttribute("data-for", states.current.node);
  group.removeAttribute("style");
  const label = svg.ownerDocument.createElementNS(SVG_NS, "text");
  label.setAttribute("x", String(at.x));
  label.setAttribute("y", String(at.y - 10));
  label.setAttribute("text-anchor", "middle");
  label.setAttribute("class", "you-are-here");
  label.textContent = text;
  group.appendChild(label);
}

function centreTop(node: Element) {
  const box = bboxOf(node);
  return box ? { x: box.x + box.width / 2, y: box.y } : null;
}

/** 一组标签的字:数字行(站号)跳过,第一行非数字是站名,其后是说明行(样例里的「第五殿 · 阎罗」等)。 */
export function labelLines(svg: Element, id: string): { name: SVGTextElement | null; details: SVGTextElement[] } {
  const group = svg.querySelector(`#labels [data-for="${CSS_ESCAPE(id)}"]`);
  const lines = group ? (Array.from(group.querySelectorAll("text")) as SVGTextElement[]).filter((t) => !/^\s*\d+\s*$/.test(t.textContent ?? "")) : [];
  return { name: lines[0] ?? null, details: lines.slice(1) };
}

/** 站名的两种字色,从样例里读:走过 / 当前的站名是 ink,没走的是 sub。读不到返回 null(不改字色)。 */
export function labelFills(svg: Element): Record<MapState, string> | null {
  const fillOf = (state: MapState) => {
    const node = svg.querySelector(`#terrain g.node[data-state="${state}"]`);
    return node ? labelLines(svg, node.id).name?.getAttribute("fill") ?? null : null;
  };
  const ink = fillOf("walked") ?? fillOf("current");
  const sub = fillOf("ahead");
  return ink && sub ? { walked: ink, current: ink, ahead: sub } : null;
}

/**
 * 没有码的节点在语言包里的名字。四张图的每个节点都要能从这里、`souls.diyu_station.*` 或 `realms.names|codes.*`
 * 取到名字 —— 取不到就退回图里的中文,英文界面上就会出现中文(演示 E2E「has no Chinese on it」抓到过「三判官」)。
 */
export const LOWER_KEYS: Record<string, string> = {
  "dy-ghost-gate": "map.diyu.ghost_gate",
  "dy-ten-courts": "map.diyu.ten_courts",
  "dy-court10-bridges": "map.diyu.court10_bridges",
  "dy-six-paths": "map.diyu.six_paths",
  "eg-embalming": "map.egypt.embalming_70_days",
  "eu-death": "souls.detail.death",
  "gr-death": "souls.detail.death",
  "eu-hell": "map.europe.circles",
  EU_PURGATORY: "map.europe.terraces",
  EG_HALL_TWO_TRUTHS: "map.egypt.weighing",
  "gr-millennium": "map.greece.thousand_year_cycle",
  "gr-three-judges": "map.greece.three_judges",
  "gr-lethe": "souls.detail.memory_mechanisms.LETHE",
};

/** 一站的名字去语言包里按这个次序找:小写节点的 `map.*`、地府站码、界域名、界域码。 */
export const stationNameKeys = (id: string): string[] =>
  [LOWER_KEYS[id], `souls.diyu_station.${id}`, `realms.names.${id}`, `realms.codes.${id}`].filter((k): k is string => !!k);

/** 没有 data-for 的说明字(「奈河」「向上 · 涤罪」……)。 */
export const freeLabels = (svg: Element): SVGTextElement[] =>
  Array.from(svg.querySelectorAll("#labels > g:not([data-for]) > text")) as SVGTextElement[];
