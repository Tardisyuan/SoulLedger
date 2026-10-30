"use client";

import type { CSSProperties } from "react";

import { HATCH, type ChartPattern } from "@/lib/chart-colors";

/**
 * The soul page's 寿数 chart — the last chart in the app, drawn with divs (2026-10-30).
 *
 * This file used to hold three recharts components behind `next/dynamic`. Two of them (`LazyBarChart`,
 * `LazySoulLineChart`) had no caller left — the dashboard moved to the 图例账 and CSS realm bars
 * (`dashboard/RealmBars.tsx`, Design A4) — and the third pulled the whole recharts chunk (~146 KB gz) into the
 * soul page for one stacked bar per ledger record. It is now what RealmBars is: boxes with heights. The name is
 * kept so the dozen test mocks that stub it by name keep working; nothing about it is lazy any more.
 *
 * Encoding (unchanged): one column per record, labelled by year. `effective` — the decayed weight, signed
 * (+merit / −demerit) — draws at 85% opacity from the zero line; `decayedAway` (same sign, since decay only shrinks
 * toward zero) stacks beyond it at 25%, so the full height reads as "what the deed originally weighed". Merit is
 * solid, demerit is A5's hollow box with 45° hatching (`HATCH`: 1.5 px lines every 5 px), the zero line 2px ink.
 * No motion to decline: there is no mount animation, so `prefers-reduced-motion` has nothing to stop.
 */

interface LifespanDatum {
  key: string;
  label: string;
  effective: number;
  decayedAway: number;
  color: string;
  pattern?: ChartPattern;
}

/** Inline style for one segment: `hatch` / `outline` / `void` are hollow with a 1.5px edge, the rest solid. */
function segmentStyle(colour: string, pattern: ChartPattern | undefined): CSSProperties {
  const edge = `${HATCH.stroke}px ${pattern === "void" ? "dashed" : "solid"} ${colour}`;
  if (pattern === "hatch") {
    return {
      border: edge,
      backgroundImage: `repeating-linear-gradient(${HATCH.angle}deg, ${colour} 0 ${HATCH.stroke}px, transparent ${HATCH.stroke}px ${HATCH.gap}px)`,
    };
  }
  if (pattern === "outline" || pattern === "void") return { border: edge };
  return { background: colour };
}

const round = (n: number) => Number(n.toFixed(2));

/**
 * `seriesNames` is required: the two series used to print as the raw dataKeys `effective` / `decayedAway` in a
 * zh-Hans tooltip. A caller cannot render this chart without deciding what the two are called.
 */
function LazyLifespanBarChart({
  data,
  height = 140,
  seriesNames,
}: {
  data: LifespanDatum[];
  height?: number;
  seriesNames: { effective: string; decayedAway: string };
}) {
  const totals = data.map((d) => d.effective + d.decayedAway);
  const hi = Math.max(0, ...totals, ...data.map((d) => d.effective));
  const lo = Math.min(0, ...totals, ...data.map((d) => d.effective));
  const range = hi - lo || 1;
  const px = (v: number) => (Math.abs(v) / range) * height;
  const zeroFromTop = `${(hi / range) * 100}%`;
  const zeroFromBottom = `${(-lo / range) * 100}%`;
  const columns = { gridTemplateColumns: `repeat(${Math.max(data.length, 1)}, minmax(0, 1fr))` };

  return (
    <div data-lifespan-chart="" className="flex gap-1">
      {/* The y scale's two ends and its zero, where recharts drew a 30px axis. */}
      <div className="relative w-8 shrink-0 font-mono text-2xs text-[oklch(var(--color-ink-muted))]" style={{ height }} aria-hidden="true">
        <span className="absolute right-0 top-0">{round(hi)}</span>
        {hi !== 0 && lo !== 0 && (
          <span className="absolute right-0 -translate-y-1/2" style={{ top: zeroFromTop }}>
            0
          </span>
        )}
        <span className="absolute bottom-0 right-0">{round(lo)}</span>
      </div>
      <div className="min-w-0 flex-1 overflow-x-auto">
        <div className="relative grid gap-1" style={{ ...columns, height }}>
          <span aria-hidden="true" className="absolute inset-x-0 h-0.5 -translate-y-1/2 bg-[oklch(var(--color-ink))]" style={{ top: zeroFromTop }} />
          {data.map((d) => {
            const up = d.effective + d.decayedAway >= 0;
            // Positive deeds grow up from the zero line, negative ones down; the decayed part sits beyond the solid.
            const anchor = up ? { bottom: zeroFromBottom } : { top: zeroFromTop };
            const style = segmentStyle(d.color, d.pattern);
            return (
              <div
                key={d.key}
                data-lifespan-bar={d.key}
                className="relative min-w-1"
                title={`${d.label} · ${seriesNames.effective} ${round(d.effective)} · ${seriesNames.decayedAway} ${round(d.decayedAway)}`}
              >
                <div className={`absolute inset-x-0 flex ${up ? "flex-col-reverse" : "flex-col"}`} style={anchor}>
                  {/* A zero segment is not drawn: its 1.5px edges alone would show as a sliver. */}
                  {d.effective !== 0 && (
                    <span data-series="effective" className="block" style={{ ...style, opacity: 0.85, height: px(d.effective) }} />
                  )}
                  {d.decayedAway !== 0 && (
                    <span data-series="decayedAway" className="block" style={{ ...style, opacity: 0.25, height: px(d.decayedAway) }} />
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div className="grid gap-1 pt-1 text-center text-2xs text-[oklch(var(--color-ink-muted))]" style={columns}>
          {data.map((d) => (
            <span key={d.key} className="truncate" title={d.label}>
              {d.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export { LazyLifespanBarChart };
