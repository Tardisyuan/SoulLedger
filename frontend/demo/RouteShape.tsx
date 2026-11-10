import type { ReactNode } from "react";
import type { ShapeKind } from "@/src/lib/routeTopology";

/**
 * The 96 × 30 shape thumbnail on a civilization card (Design 第二十七批 §一.3): walked = solid, now = the metal dot,
 * ahead = dashed — the journey block's three cues, one shape per underworld (line / funnel / two ways / three ways).
 * Colours come from the card's own `data-civ` (globals.css `.demo-shape-*`).
 */
const SHAPES: Record<ShapeKind, ReactNode> = {
  line: (
    <>
      <path className="demo-shape-walked" d="M4 15H64" />
      {[4, 16, 28, 40, 52].map((x) => (
        <circle key={x} className="demo-shape-stop" cx={x} cy={15} r={2} />
      ))}
      <path className="demo-shape-ahead" d="M64 15H90" />
      <circle className="demo-shape-end" cx={91} cy={15} r={2.5} />
      <circle className="demo-shape-now" cx={64} cy={15} r={3.5} />
    </>
  ),
  funnel: (
    <>
      <path className="demo-shape-walked" d="M6 4H34L20 26Z" />
      <path className="demo-shape-ahead" d="M44 26L66 4" />
      <circle className="demo-shape-now" cx={20} cy={26} r={3} />
    </>
  ),
  fork_two: (
    <>
      <path className="demo-shape-walked" d="M4 15H40" />
      <path className="demo-shape-ahead" d="M40 15C60 15 64 6 86 6" />
      <path className="demo-shape-ahead" d="M40 15C60 15 64 24 84 24" />
      <circle className="demo-shape-end" cx={89} cy={6} r={2.5} />
      <rect className="demo-shape-end demo-shape-ahead" x={85} y={21} width={6} height={6} />
      <circle className="demo-shape-now" cx={40} cy={15} r={3.5} />
    </>
  ),
  fork: (
    <>
      <path className="demo-shape-walked" d="M4 15H40" />
      <path className="demo-shape-ahead" d="M40 15C60 15 66 5 92 5" />
      <path className="demo-shape-ahead" d="M40 15H92" />
      <path className="demo-shape-ahead" d="M40 15C60 15 66 25 92 25" />
      <circle className="demo-shape-now" cx={40} cy={15} r={3.5} />
    </>
  ),
};

export function RouteShape({ shape, className }: { shape: ShapeKind; className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 96 30" width={96} height={30} className={className} data-shape={shape}>
      {SHAPES[shape]}
    </svg>
  );
}
