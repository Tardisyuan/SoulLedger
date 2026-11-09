"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useI18n } from "@/src/contexts/I18nContext";
import { collapseRoad } from "@/src/lib/journeyModel";
import type { JEdge, JGraph, JStop } from "@/src/lib/journeyLayout";

/**
 * 行程图(Design 第二十五批 `route` 组件):灵魂详情的行程与工作流实例的节点进度共用。
 *
 *   宽(≥ 520)  SVG,viewBox 700,按容器缩放 —— 不横滚
 *   窄(< 520)  只画本人这一条路,中段折成「已行 N 站」「待行 N 站」胶囊,点开原位展开(§三)
 *
 * 三条线索并用,颜色之外照样分得开:实线 / 虚线 / 点线;实心带勾 / 空心 / 点线小圈;金色名牌。
 * metal 只给「现在」。每站另有 `aria-label`(站名 · 状态)与 `aria-current="step"`。
 * 动效(§四):已行段描出一次,当前站的环 4.2 s 呼吸一次;减少动效时静止 —— 都在 globals.css。
 */

export interface JourneyNarrow {
  /** The soul's road, as stop ids of `graph`, in walking order. */
  road: string[];
  /** Two undecided ends (称心未定), drawn as short tails. */
  tails?: string[];
  /** One line about what the narrow view leaves out (the roads not taken). */
  note?: string | null;
}

export interface JourneyPlate {
  heading: string;
  sub?: string | null;
}

const NARROW_BELOW = 520;

function textWidth(s: string, size: number): number {
  let w = 0;
  for (const c of s) w += (c.charCodeAt(0) > 0x2e7f ? 1 : 0.58) * size;
  return w;
}

function fit(s: string, max: number, size: number): string {
  if (textWidth(s, size) <= max) return s;
  let out = "";
  for (const c of s) {
    if (textWidth(`${out}${c}…`, size) > max) break;
    out += c;
  }
  return `${out}…`;
}

function edgePath(a: JStop, b: JStop, curve?: boolean): string {
  if (!curve || Math.abs(a.y - b.y) < 1) return `M${a.x} ${a.y}L${b.x} ${b.y}`;
  const mx = (a.x + b.x) / 2;
  return `M${a.x} ${a.y}C${mx} ${a.y} ${mx} ${b.y} ${b.x} ${b.y}`;
}

export function JourneyMap({
  graph,
  label,
  plate,
  narrow,
  stopAttrs,
}: {
  graph: JGraph;
  label: string;
  plate?: JourneyPlate | null;
  narrow: JourneyNarrow;
  stopAttrs?: (s: JStop) => Record<string, string | undefined>;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [small, setSmall] = useState(false);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(([entry]) => setSmall(entry.contentRect.width < NARROW_BELOW));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  // 700 宽放得下约 12 站;再多就按窄屏的规则折叠。
  const folded = small || narrow.road.length > 12;
  return (
    <div ref={box} className="journey min-w-0 max-w-full" data-journey-mode={folded ? "narrow" : "wide"}>
      {folded ? (
        <NarrowJourney graph={graph} label={label} narrow={narrow} stopAttrs={stopAttrs} />
      ) : (
        <WideJourney graph={graph} label={label} plate={plate} stopAttrs={stopAttrs} />
      )}
    </div>
  );
}

function useStateText() {
  const { t } = useI18n();
  return (s: JStop) => (s.route === "off" ? t("realms.journey.off_route") : t(`realms.topology.state_${s.state}`));
}

function WideJourney({
  graph,
  label,
  plate,
  stopAttrs,
}: {
  graph: JGraph;
  label: string;
  plate?: JourneyPlate | null;
  stopAttrs?: (s: JStop) => Record<string, string | undefined>;
}) {
  const stateText = useStateText();
  const byId = new Map(graph.stops.map((s) => [s.id, s]));
  const current = graph.stops.find((s) => s.state === "current" && !s.spur) ?? null;
  let walkedIndex = 0;

  const room = (s: JStop): number => {
    if (s.labelAt === "right" || s.labelAt === "left") return 150;
    let gap = 160;
    for (const o of graph.stops) if (o !== s && !o.spur && Math.abs(o.y - s.y) < 4) gap = Math.min(gap, Math.abs(o.x - s.x));
    return gap - 6;
  };

  return (
    <svg
      role="list"
      aria-label={label}
      viewBox={`0 0 ${graph.w} ${graph.h}`}
      className="journey-svg block w-full h-auto"
      data-backdrop={graph.backdrop}
    >
      {graph.backdrop === "funnel" && <FunnelBackdrop />}
      <g aria-hidden="true">
        {graph.edges.map((e: JEdge) => {
          const a = byId.get(e.from);
          const b = byId.get(e.to);
          if (!a || !b) return null;
          const d = edgePath(a, b, e.curve);
          if (e.kind !== "walked") return <path key={e.id} d={d} data-edge={e.id} data-segment={e.kind} className={`journey-${e.kind}`} />;
          const i = walkedIndex++;
          return (
            <g key={e.id}>
              <path d={d} className="journey-glow" />
              <path d={d} data-edge={e.id} data-segment="walked" pathLength={1} className="journey-walked" style={{ "--i": i } as CSSProperties} />
            </g>
          );
        })}
      </g>
      {graph.stops.map((s) => {
        if (s.spur) return <circle key={s.id} aria-hidden="true" cx={s.x} cy={s.y} r={4.5} className="journey-stop-off" />;
        const named = s.labelAt !== "none" && !(s === current && plate);
        const size = s.route === "off" ? 11 : 12;
        const lx = s.labelAt === "right" ? s.x + 14 : s.labelAt === "left" ? s.x - 14 : s.x;
        const ly = s.labelAt === "above" ? s.y - 16 : s.labelAt === "below" ? s.y + 26 : s.y + 4;
        const anchor = s.labelAt === "right" ? "start" : s.labelAt === "left" ? "end" : "middle";
        return (
          <g
            key={s.id}
            role="listitem"
            aria-label={`${s.label} · ${stateText(s)}`}
            aria-current={s.state === "current" ? "step" : undefined}
            data-station-state={s.state}
            data-route={s.route}
            data-terminal={s.terminal ? "dashed" : undefined}
            {...stopAttrs?.(s)}
          >
            <StopMark s={s} />
            {named && (
              <text x={lx} y={ly} textAnchor={anchor} className="journey-label" data-station-state={s.state} data-route={s.route}>
                {fit(s.label, room(s), size)}
              </text>
            )}
            {s.num && (
              <text x={s.x} y={s.y + 40} textAnchor="middle" className="journey-num">
                {s.num}
              </text>
            )}
          </g>
        );
      })}
      <g aria-hidden="true">
        {graph.captions.map((c, i) => (
          <text key={i} x={c.x} y={c.y} textAnchor={c.anchor} className={c.tone === "neg" ? "journey-caption journey-caption-neg" : "journey-caption"}>
            {c.text}
          </text>
        ))}
      </g>
      {current && plate && <Plate s={current} graph={graph} plate={plate} label={current.label} />}
    </svg>
  );
}

function StopMark({ s }: { s: JStop }) {
  if (s.terminal)
    return (
      <g aria-hidden="true">
        {s.state === "current" && <circle cx={s.x} cy={s.y} r={14} className="journey-pulse" />}
        <rect x={s.x - 8} y={s.y - 8} width={16} height={16} rx={3} className="journey-terminal" />
        <path d={`M${s.x - 4} ${s.y - 4}L${s.x + 4} ${s.y + 4}M${s.x + 4} ${s.y - 4}L${s.x - 4} ${s.y + 4}`} className="journey-terminal-x" />
      </g>
    );
  if (s.route === "off") return <circle aria-hidden="true" cx={s.x} cy={s.y} r={4.5} className="journey-stop-off" />;
  if (s.state === "current")
    return (
      <g aria-hidden="true">
        <circle cx={s.x} cy={s.y} r={17} className="journey-now-glow" />
        <circle cx={s.x} cy={s.y} r={12} className="journey-pulse" />
        <circle cx={s.x} cy={s.y} r={9} className="journey-now" />
      </g>
    );
  if (s.state === "travelled")
    return (
      <g aria-hidden="true">
        <circle cx={s.x} cy={s.y} r={7} className="journey-stop-done" />
        <path d={`M${s.x - 3} ${s.y}L${s.x - 0.8} ${s.y + 2.3}L${s.x + 3.2} ${s.y - 2.4}`} className="journey-check" />
      </g>
    );
  return <circle aria-hidden="true" cx={s.x} cy={s.y} r={6} className="journey-stop-ahead" />;
}

/** 「现在」名牌:默认在站上方;漏斗靠底的站放右侧;右边要分岔的站把名牌往左靠(§一.3)。 */
function Plate({ s, graph, plate, label }: { s: JStop; graph: JGraph; plate: JourneyPlate; label: string }) {
  const w = Math.min(240, Math.max(textWidth(plate.heading, 10.5), textWidth(label, 13), plate.sub ? textWidth(plate.sub, 11) : 0) + 22);
  const h = plate.sub ? 56 : 42;
  const forksRight = graph.edges.some((e) => e.from === s.id && e.curve);
  const side = graph.backdrop === "funnel" && s.y > graph.h * 0.55;
  let x: number;
  let y: number;
  let tip: string;
  if (side) {
    const left = s.x + 22 + w > graph.w - 4;
    x = left ? s.x - 22 - w : s.x + 22;
    y = Math.max(2, s.y - h / 2);
    tip = left ? `M${x + w} ${s.y - 5}L${x + w + 6} ${s.y}L${x + w} ${s.y + 5}` : `M${x} ${s.y - 5}L${x - 6} ${s.y}L${x} ${s.y + 5}`;
  } else {
    x = forksRight ? s.x + 30 - w : s.x - w / 2;
    x = Math.min(Math.max(4, x), graph.w - 4 - w);
    y = Math.max(2, s.y - 22 - h);
    tip = `M${s.x - 5} ${y + h}L${s.x} ${y + h + 6}L${s.x + 5} ${y + h}`;
  }
  return (
    <g aria-hidden="true" data-plate="">
      <rect x={x} y={y} width={w} height={h} rx={8} className="journey-plate" />
      <path d={tip} className="journey-plate-tip" />
      <text x={x + 11} y={y + 15} className="journey-plate-head">{plate.heading}</text>
      <text x={x + 11} y={y + 33} className="journey-plate-name">{fit(label, w - 22, 13)}</text>
      {plate.sub && <text x={x + 11} y={y + 48} className="journey-plate-sub">{fit(plate.sub, w - 22, 11)}</text>}
    </g>
  );
}

/** 漏斗的两个体积:左边往下收的地狱(九道横纹),右边往上收的炼狱山台阶,山顶上天堂三圈。 */
function FunnelBackdrop() {
  const stripes = Array.from({ length: 9 }, (_, k) => {
    const y = 50 + (k + 1) * 21;
    const t = (y - 50) / 212;
    return <line key={k} x1={60 + t * 210} y1={y} x2={380 - t * 60} y2={y} className="journey-backdrop-line" />;
  });
  return (
    <g aria-hidden="true">
      <polygon points="60,50 380,50 320,262 270,262" className="journey-backdrop" />
      {stripes}
      <path d="M396 262L664 262L640 214L612 214L600 178L578 178L566 142L548 142L536 106L520 106Z" className="journey-backdrop" />
      {[16, 28, 40].map((r) => (
        <circle key={r} cx={630} cy={52} r={r} className="journey-backdrop-ring" />
      ))}
    </g>
  );
}

function NarrowJourney({
  graph,
  label,
  narrow,
  stopAttrs,
}: {
  graph: JGraph;
  label: string;
  narrow: JourneyNarrow;
  stopAttrs?: (s: JStop) => Record<string, string | undefined>;
}) {
  const { t } = useI18n();
  const stateText = useStateText();
  const [open, setOpen] = useState<Set<number>>(new Set());
  const byId = new Map(graph.stops.map((s) => [s.id, s]));
  const road = narrow.road.map((id) => byId.get(id)).filter((s): s is JStop => !!s);
  const tails = (narrow.tails ?? []).map((id) => byId.get(id)).filter((s): s is JStop => !!s);
  const seg = (i: number): JEdge["kind"] | null => {
    if (i <= 0 || i >= road.length) return null;
    const a = road[i - 1];
    const b = road[i];
    return a.route === "off" || b.route === "off" ? "off" : a.state !== "pending" && b.state !== "pending" ? "walked" : "ahead";
  };
  const line = (kind: JEdge["kind"] | null) =>
    kind ? <span aria-hidden="true" data-segment={kind} className="journey-seg flex-1" /> : <span aria-hidden="true" className="flex-1" />;

  const station = (s: JStop, into: JEdge["kind"] | null, out: JEdge["kind"] | null) => (
    <li
      key={s.id}
      aria-label={`${s.label} · ${stateText(s)}`}
      aria-current={s.state === "current" ? "step" : undefined}
      data-station-state={s.state}
      data-route={s.route}
      className="flex-1 min-w-0 flex flex-col items-center"
      {...stopAttrs?.(s)}
    >
      <span aria-hidden="true" className="journey-now-word text-2xs h-4">
        {s.state === "current" ? t("realms.journey.now") : ""}
      </span>
      <span className="flex items-center w-full h-6">
        {line(into)}
        <span aria-hidden="true" className="journey-dot" data-station-state={s.state} data-route={s.route} data-terminal={s.terminal ? "dashed" : undefined} />
        {line(out)}
      </span>
      <span aria-hidden="true" className={`block max-w-full truncate px-1 text-2xs journey-text ${s.state === "current" ? "font-semibold" : ""}`} data-station-state={s.state}>
        {s.label}
      </span>
    </li>
  );

  return (
    <div className="relative min-w-0">
      <ol aria-label={label} className="flex flex-wrap items-start min-w-0">
        {collapseRoad(road.map((s) => s.state)).map((item, k) => {
          if (item.kind === "stop") return station(road[item.index], seg(item.index), seg(item.index + 1));
          const count = item.to - item.from + 1;
          const expanded = open.has(item.from);
          const toggle = () =>
            setOpen((was) => {
              const next = new Set(was);
              if (expanded) next.delete(item.from);
              else next.add(item.from);
              return next;
            });
          return (
            <li key={`fold-${k}`} data-fold={item.state} className={`${expanded ? "basis-full" : "flex-1"} min-w-0 flex flex-col items-center`}>
              <span aria-hidden="true" className="h-4" />
              <span className="flex items-center w-full h-6">
                {line(seg(item.from))}
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={toggle}
                  className="journey-pill shrink-0 border border-[oklch(var(--color-line))] bg-[oklch(var(--color-surface-2))] px-2 text-2xs text-[oklch(var(--color-ink-muted))]"
                >
                  {t(item.state === "travelled" ? "realms.journey.walked_n" : "realms.journey.ahead_n", { n: String(count) })}
                </button>
                {line(seg(item.to + 1))}
              </span>
              {expanded && (
                <ol className="mt-1 w-full">
                  {road.slice(item.from, item.to + 1).map((s) => (
                    <li key={s.id} data-station-state={s.state} data-route={s.route} aria-label={`${s.label} · ${stateText(s)}`} className="flex items-center gap-2 min-h-6 text-2xs journey-text">
                      <span aria-hidden="true" className="journey-dot" data-station-state={s.state} data-route={s.route} />
                      <span className="truncate">{s.label}</span>
                    </li>
                  ))}
                </ol>
              )}
            </li>
          );
        })}
        {tails.length > 0 && (
          <li className="flex flex-col justify-center gap-2 pl-1 min-w-0" data-tails="">
            {tails.map((s) => (
              <span key={s.id} aria-label={`${s.label} · ${stateText(s)}`} data-station-state={s.state} className="flex items-center gap-1 text-2xs journey-text min-w-0">
                <span aria-hidden="true" data-segment="ahead" className="journey-seg w-4" />
                <span aria-hidden="true" className="journey-dot" data-station-state={s.state} data-route={s.route} data-terminal={s.terminal ? "dashed" : undefined} />
                <span className="truncate">{s.label}</span>
                {s.terminal && <span className="journey-neg shrink-0">{t("realms.journey.not_a_place")}</span>}
              </span>
            ))}
          </li>
        )}
      </ol>
      {narrow.note && <p className="mt-2 text-2xs text-[oklch(var(--color-ink-subtle))]">{narrow.note}</p>}
    </div>
  );
}
