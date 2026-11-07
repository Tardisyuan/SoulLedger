"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import { useI18n } from "@/src/contexts/I18nContext";
import { useTheme } from "@/src/contexts/ThemeContext";
import { cn } from "@/lib/utils";
import {
  applyBranches,
  applyView,
  bboxOf,
  clampView,
  freeLabels,
  labelFills,
  labelLines,
  mapSkinOf,
  mapStates,
  mapUrl,
  markYouAreHere,
  nodesOf,
  paintStates,
  parseMapSvg,
  readPalette,
  stationNameKeys,
  viewBoxOf,
  worldStates,
  zoomAt,
  type MapState,
  type MapStates,
  type MapView,
  type MapVisit,
} from "@/src/lib/underworldMap";

/**
 * 冥界地图(规范 v4 第七批 S07,Design 第八批的四张 SVG):挂在 /realms(世界图,全部点亮)与灵魂详情
 * 「走到了哪一步」(这个灵魂的行程)。纯 DOM 的部分在 `src/lib/underworldMap.ts`。
 *
 * - 全景 / 拖动平移 / 双击放大 / − 100% ＋(`workflow.editor.zoom.*`,同工作流画布的四个钮)。缩放只缩路线,字号不变。
 * - 键盘:缩放钮那一组(role="toolbar")里方向键平移、+ / − 缩放、0 全景;站名清单(读屏的文字替代)每一站是一个按钮,
 *   按下把图移到那一站并标出来。清单平时视觉隐藏,Tab 进去时显出来。
 * - 支线(十八层地狱、莲花台)默认收起,`map.branches_hidden` 点开;灵魂就在支线上时只画那一条(`map.branch_only`)。
 * - 一生回放(`map.replay.*`):按到达先后一站一站点亮,卡片写「{日期} · 到达{站}」;点卡片或「停止回放」回到现在。
 * - 深浅主题各一份图(`useTheme`)。图载不到(jsdom 没有 fetch、网络错)就整块不画 —— 行程条与树表照样在。
 *
 * 站名:中文用图里 Design 写的字(就是定稿措辞);其他语言按 id 取语言包(地府站码 → `souls.diyu_station.*`,
 * 界域码 → `realms.names.*`,小写节点 → `map.*`),取不到才退回图里的中文。
 */

const cache = new Map<string, Promise<string>>();
function loadSvg(url: string): Promise<string> {
  if (!cache.has(url)) {
    cache.set(
      url,
      fetch(url).then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status))))).catch((e) => {
        cache.delete(url);
        throw e;
      }),
    );
  }
  return cache.get(url)!;
}

/** 图里不属于任何一站的说明字(按 Design 的中文认)。 */
const FREE_KEYS: Record<string, string> = {
  "赴冥 · 十三站之一至十": "map.diyu.road_down",
  "酆都城之内 · 十殿": "map.diyu.inside_fengdu",
  奈河: "map.diyu.nai_river",
  官员挪站: "map.diyu.moved_by_officer",
  "向上 · 涤罪": "map.europe.upward",
  "向下 · 按罪下沉": "map.europe.downward",
  岸边百年: "map.greece.wait_on_bank",
  通过: "judgment.verdicts.passed",
  不通过: "crossJudgments.end_fail",
};
/** 说明行不随进度的那几站。 */
const STATIC_DETAIL: Record<string, string> = { EG_ANNIHILATION: "map.egypt.second_death_note" };

const STATE_KEY: Record<MapState, string> = {
  walked: "realms.topology.state_travelled",
  current: "realms.topology.state_current",
  ahead: "realms.topology.state_pending",
};

const ZOOM_STEP = 1.25;
const PAN_STEP = 40;
const REPLAY_MS = 1200;
const BUTTON =
  "inline-flex h-9 min-w-9 items-center justify-center border-l first:border-l-0 border-[oklch(var(--color-line-strong))] px-2 font-mono text-xs hover:bg-[oklch(var(--color-surface-2))]";

export interface MapArrival {
  /** 图上的节点或子格 id。 */
  id: string;
  /** 到达时间(ISO);没有记录是 null —— 回放照样停在这一站,卡片只写站名。 */
  at: string | null;
}

export function UnderworldMap({
  civilization,
  visits,
  arrivals = [],
  label,
  currentDetail,
  className,
}: {
  civilization: string;
  /** 外框(边距、分隔线):图载不到时整块连同外框都不画。 */
  className?: string;
  /** 这个灵魂的行程;不给就是世界图(全部点亮、没有「你在这里」)。 */
  visits?: readonly MapVisit[];
  /** 一生回放的站序(按到达先后);空就不出回放钮。 */
  arrivals?: readonly MapArrival[];
  /** 读屏给整张图的名字(文明名)。 */
  label: string;
  /** 当前那一站的说明行(希腊千年格的「第 n 年」);不给就用当前子格的名字。回放时不用。 */
  currentDetail?: string | null;
}) {
  const { t, locale, formatDate } = useI18n();
  const { theme } = useTheme();
  const skin = mapSkinOf(civilization);
  const url = skin ? mapUrl(skin, theme) : null;
  const [template, setTemplate] = useState<SVGSVGElement | null>(null);
  const [view, setView] = useState<MapView>({ k: 1, x: 0, y: 0 });
  const [branchesHidden, setBranchesHidden] = useState(true);
  const [replayAt, setReplayAt] = useState<number | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const live = useRef<SVGSVGElement | null>(null);
  const drag = useRef<{ x: number; y: number; view: MapView } | null>(null);

  useEffect(() => {
    if (!url || typeof fetch !== "function") return;
    let alive = true;
    loadSvg(url).then(
      (text) => alive && setTemplate(parseMapSvg(text)),
      () => alive && setTemplate(null),
    );
    return () => {
      alive = false;
    };
  }, [url]);

  const known = useCallback((key: string) => {
    const v = t(key);
    return v === key ? null : v;
  }, [t]);
  // String():不少测试把 useI18n 整个 mock 掉、不给 locale;图在那里画不出来,但这一行照样会跑。
  const zh = String(locale).startsWith("zh");
  /** 一站的名字:中文取图里的字,别的语言取语言包。 */
  const nameOf = useCallback(
    (id: string): string | null => {
      const baked = template ? labelLines(template, id).name?.textContent?.trim() || null : null;
      const fromPack = stationNameKeys(id).map(known).find(Boolean) ?? null;
      return zh ? baked ?? fromPack : fromPack ?? baked;
    },
    [template, known, zh],
  );

  const shownVisits = useMemo<readonly MapVisit[] | undefined>(() => {
    if (replayAt === null || !visits) return visits;
    return arrivals.slice(0, replayAt + 1).map((a, i) => ({ id: a.id, current: i === replayAt }));
  }, [visits, arrivals, replayAt]);

  const states = useMemo<MapStates | null>(() => {
    if (!template) return null;
    return shownVisits ? mapStates(template, shownVisits) : worldStates(template);
  }, [template, shownVisits]);

  const [branchInfo, setBranchInfo] = useState({ hiddenCount: 0, onlyCurrent: false });
  const cur = states?.current ?? null;
  const here = cur ? (cur.cell && nameOf(cur.cell)) || nameOf(cur.node) : null;
  /** 读屏念整张图:文明名,有灵魂时加「你现在在这里 · 站名」。写在 SVG 的 role="img" 上。 */
  const summary = visits && here ? `${label} · ${t("map.soul.here")} · ${here}` : label;

  // 每次状态变了:从模板克隆一份,画状态、支线、字,再插进来。拖动只改 transform,不重画。
  useEffect(() => {
    const el = host.current;
    if (!el || !template || !states) return;
    const svg = template.cloneNode(true) as SVGSVGElement;
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", summary);
    svg.removeAttribute("width");
    svg.removeAttribute("height");
    svg.setAttribute("data-mode", visits ? "soul" : "world");
    el.replaceChildren(svg);
    live.current = svg;
    const palette = readPalette(template);
    if (palette) paintStates(svg, states, palette);
    const fills = labelFills(template);
    for (const node of nodesOf(svg)) {
      const { name, details } = labelLines(svg, node.id);
      const shown = nameOf(node.id);
      if (name && shown) name.textContent = shown;
      if (name && fills) name.setAttribute("fill", fills[states.nodes.get(node.id) ?? "ahead"]);
      // 说明行在样例里是样例的进度(「第五殿 · 阎罗」「第三百年」):换成当前子格的名字,没有就空着。
      const cell = cur && cur.node === node.id ? cur.cell : null;
      const ownDetail = cur && cur.node === node.id && replayAt === null ? currentDetail : null;
      const detail = ownDetail || (cell && nameOf(cell)) || (STATIC_DETAIL[node.id] ? known(STATIC_DETAIL[node.id]) : null);
      details.forEach((line, i) => (line.textContent = i === 0 && detail ? detail : ""));
    }
    if (!zh) {
      for (const line of freeLabels(svg)) {
        const key = FREE_KEYS[line.textContent?.trim() ?? ""];
        const shown = key ? known(key) : null;
        if (shown) line.textContent = shown;
      }
    }
    markYouAreHere(svg, states, visits ? t("map.soul.here") : null);
    setBranchInfo(applyBranches(svg, branchesHidden, states.current?.node ?? null));
    if (focused) svg.querySelector(`[id="${focused}"]`)?.setAttribute("data-focused", "");
    applyView(svg, view);
    // view 不在依赖里:平移由下一个 effect 单独处理。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template, states, cur, branchesHidden, nameOf, known, zh, visits, t, focused, summary, currentDetail, replayAt]);

  useEffect(() => {
    if (live.current) applyView(live.current, view);
  }, [view]);

  // 回放:一站一站往前走,走到头停在现在。
  useEffect(() => {
    if (replayAt === null) return;
    const timer = setTimeout(() => setReplayAt((i) => (i === null || i + 1 >= arrivals.length ? null : i + 1)), REPLAY_MS);
    return () => clearTimeout(timer);
  }, [replayAt, arrivals.length]);

  const box = template ? viewBoxOf(template) : { width: 1120, height: 400 };
  const zoomBy = (factor: number) => setView((v) => zoomAt(v, v.k * factor, box.width / 2, box.height / 2, box));
  const fit = () => setView({ k: 1, x: 0, y: 0 });
  const unitsPerPx = () => box.width / Math.max(1, host.current?.clientWidth ?? box.width);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    drag.current = { x: e.clientX, y: e.clientY, view };
    e.currentTarget.setPointerCapture?.(e.pointerId);
    e.currentTarget.setAttribute("data-dragging", "");
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (!start) return;
    const u = unitsPerPx();
    setView(clampView({ ...start.view, x: start.view.x + (e.clientX - start.x) * u, y: start.view.y + (e.clientY - start.y) * u }, box));
  };
  const endDrag = (e: PointerEvent<HTMLDivElement>) => {
    drag.current = null;
    e.currentTarget.removeAttribute("data-dragging");
  };
  const onDoubleClick = (e: MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const u = unitsPerPx();
    setView((v) => zoomAt(v, v.k * 1.5, (e.clientX - rect.left) * u, (e.clientY - rect.top) * u, box));
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const pan = (dx: number, dy: number) => setView((v) => clampView({ ...v, x: v.x + dx, y: v.y + dy }, box));
    const keys: Record<string, () => void> = {
      ArrowLeft: () => pan(PAN_STEP, 0),
      ArrowRight: () => pan(-PAN_STEP, 0),
      ArrowUp: () => pan(0, PAN_STEP),
      ArrowDown: () => pan(0, -PAN_STEP),
      "+": () => zoomBy(ZOOM_STEP),
      "=": () => zoomBy(ZOOM_STEP),
      "-": () => zoomBy(1 / ZOOM_STEP),
      "0": fit,
    };
    const run = keys[e.key];
    if (!run) return;
    e.preventDefault();
    run();
  };
  /** 站名清单里按下一站:放大到至少 2 倍,把那一站移到图中间,并标出来。 */
  const focusStation = (id: string) => {
    setFocused(id);
    const node = live.current?.querySelector(`[id="${id}"]`);
    const b = node ? bboxOf(node) : null;
    if (!b) return;
    const k = Math.max(view.k, 2);
    setView(clampView({ k, x: box.width / 2 - (b.x + b.width / 2) * k, y: box.height / 2 - (b.y + b.height / 2) * k }, box));
  };

  if (!skin || !template || !states) return null;

  // 清单只写站名;站码(节点 id)只当 React key 和聚焦的目标,不进文字。没有名字的站不列。
  const stations: { key: string; name: string; state: MapState }[] = [];
  for (const node of nodesOf(template)) {
    if (node.classList.contains("branch") && branchesHidden && cur?.node !== node.id) continue;
    const name = nameOf(node.id);
    const state: MapState = states.nodes.get(node.id) || "ahead";
    if (name) stations.push({ key: node.id, name, state });
  }
  const behind = stations.filter((s) => s.state === "walked").length;
  const ahead = stations.filter((s) => s.state === "ahead").length;
  const step = replayAt !== null ? arrivals[replayAt] : null;
  // 回放卡只写站名(没有名字就空着),不写站码。
  const stepStation = step ? nameOf(step.id) || "" : "";

  return (
    <figure data-testid="underworld-map" data-map={skin} className={cn("v4-map m-0 min-w-0 space-y-2", className)}>
      <div className="flex flex-wrap items-center gap-2">
        {visits && here && (
          <p data-testid="underworld-map-here" className="m-0 text-sm text-[oklch(var(--color-ink))]">
            {t("map.soul.here")} · <span className="font-semibold">{here}</span>
            <span className="ml-2 text-xs text-[oklch(var(--color-ink-muted))]">
              {t("map.soul.behind", { n: String(behind) })} · {t("map.soul.ahead", { n: String(ahead) })}
            </span>
          </p>
        )}
        {visits && arrivals.length > 0 && (
          <button
            type="button"
            data-testid="underworld-map-replay"
            onClick={() => setReplayAt(replayAt === null ? 0 : null)}
            className="inline-flex h-9 items-center border border-[oklch(var(--color-line-strong))] px-3 text-sm text-[oklch(var(--color-ink))] hover:bg-[oklch(var(--color-surface-2))]"
          >
            <span aria-hidden="true" className="mr-1">{replayAt === null ? "▸" : "■"}</span>
            {t(replayAt === null ? "map.replay.start" : "map.replay.stop")}
          </button>
        )}
        <span className="flex-1" />
        <span className="max-md:hidden text-xs text-[oklch(var(--color-ink-muted))]">{t("map.drag_hint")}</span>
        {/* 键盘:焦点在这一组钮上时,方向键平移、+ / − 缩放、0 全景(图框本身不可聚焦 —— 它只是一张图)。 */}
        <div
          role="toolbar"
          aria-label={t("map.drag_hint")}
          onKeyDown={onKeyDown}
          className="flex border border-[oklch(var(--color-line-strong))] bg-[oklch(var(--color-surface-1))] text-[oklch(var(--color-ink))]"
        >
          <button type="button" aria-label={t("workflow.editor.zoom.out")} onClick={() => zoomBy(1 / ZOOM_STEP)} className={BUTTON}>−</button>
          <button type="button" aria-label={t("workflow.editor.zoom.reset")} onClick={() => setView((v) => zoomAt(v, 1, box.width / 2, box.height / 2, box))} className={`${BUTTON} w-14`}>
            {Math.round(view.k * 100)}%
          </button>
          <button type="button" aria-label={t("workflow.editor.zoom.in")} onClick={() => zoomBy(ZOOM_STEP)} className={BUTTON}>＋</button>
          <button type="button" onClick={fit} className={BUTTON}>{t("map.fit")}</button>
        </div>
      </div>

      <div className="relative">
        <div
          ref={host}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onDoubleClick={onDoubleClick}
          className="v4-map-viewport rounded-panel border border-[oklch(var(--color-line))]"
        />
        {step && (
          <button
            type="button"
            data-testid="underworld-map-replay-card"
            onClick={() => setReplayAt(null)}
            className="absolute bottom-3 left-3 right-3 max-w-xs border border-[oklch(var(--color-line-strong))] bg-[oklch(var(--color-surface-1))] px-4 py-3 text-left shadow-overlay"
          >
            <span aria-live="polite" className="block font-title text-md text-[oklch(var(--color-ink))]">
              {step.at ? t("soulmap.replay_line", { date: formatDate(step.at), station: stepStation }) : stepStation}
            </span>
            <span className="mt-2 flex items-center gap-3 text-xs text-[oklch(var(--color-ink-muted))]">
              <span className="font-mono">{t("soulmap.replay_progress", { n: String(replayAt! + 1), total: String(arrivals.length) })}</span>
              <span className="relative h-1 w-16 bg-[oklch(var(--color-line))]">
                <span className="absolute inset-y-0 left-0 bg-[oklch(var(--color-main-ink))]" style={{ width: `${((replayAt! + 1) / arrivals.length) * 100}%` }} />
              </span>
              <span>{t("map.replay.skip")}</span>
            </span>
          </button>
        )}
      </div>

      {(branchInfo.hiddenCount > 0 || branchInfo.onlyCurrent) && (
        <p className="m-0 flex flex-wrap gap-3 text-xs text-[oklch(var(--color-ink-muted))]">
          {branchInfo.onlyCurrent && <span data-testid="underworld-map-branch-only">{t("map.branch_only")}</span>}
          {branchInfo.hiddenCount > 0 && (
            <button type="button" data-testid="underworld-map-branches" onClick={() => setBranchesHidden(false)} className="underline decoration-dotted underline-offset-4">
              {t("map.branches_hidden", { n: String(branchInfo.hiddenCount) })}
            </button>
          )}
        </p>
      )}

      {/* 文字替代:读屏念出每一站与它的状态;按钮把图移到那一站。平时视觉隐藏,键盘进来时显出来。 */}
      <figcaption className="sr-only focus-within:not-sr-only">
        <ol aria-label={label} className="m-0 flex list-none flex-wrap gap-1 p-0">
          {stations.map((s) => (
            <li key={s.key}>
              <button
                type="button"
                aria-current={s.state === "current" ? "step" : undefined}
                onClick={() => focusStation(s.key)}
                className={cn(
                  "inline-flex h-8 items-center border border-[oklch(var(--color-line))] px-2 text-xs",
                  s.state === "current" ? "font-semibold text-[oklch(var(--color-ink))]" : "text-[oklch(var(--color-ink-muted))]",
                )}
              >
                {s.name} · {t(STATE_KEY[s.state])}
              </button>
            </li>
          ))}
        </ol>
      </figcaption>
    </figure>
  );
}
