/**
 * The S-and-L balance mark as data, for the cold start to draw (src/coldStart.tsx).
 *
 * SHAPE and the viewBox live in packages/core (`@soulledger/core/config/brandMark`) so the web's
 * BrandMark draws the same outline; they are re-exported here so the app's imports stay put.
 *
 * STROKES are centre lines (mark units) drawn under SHAPE as a clip: thick enough that, fully
 * drawn, the clip shows the whole mark (99.9% of its pixels, measured 2026-10-01), so the edges
 * the eye sees are always the icon's own. They draw all at once, each over the same time.
 */

export { MARK_HEIGHT, MARK_WIDTH, SHAPE, VIEWBOX } from "@soulledger/core/config/brandMark";

/** [centre line, stroke width] */
export const STROKES: readonly (readonly [string, number])[] = [
  ["M730 242H457C364 242 364 339 457 339H515Q584 339 612 376L306 682", 76], // the S, into the beam
  ["M476 424H292L222 604", 70], // left pan: arm, outer leg
  ["M296 440L344 548", 60], // left pan: inner leg, cut by the beam
  ["M234 588A49 49 0 0 0 332 588", 104], // left bowl
  ["M624 424H712L800 604", 70], // right pan: arm, outer leg
  ["M712 440L656 604", 64], // right pan: inner leg
  ["M681 596A48 48 0 0 0 777 596", 104], // right bowl
  ["M512 540V779", 64], // stand
  ["M386 779H638", 60], // base
];

/**
 * Length of a path in the subset STROKES use (absolute M H V L Q C, and A as a half circle).
 * react-native-svg has no pathLength on shapes, so a dash that ends with the stroke needs it.
 */
export function pathLength(d: string): number {
  const t = d.match(/[A-Z]|-?\d*\.?\d+/g) ?? [];
  let i = 0;
  let x = 0;
  let y = 0;
  let len = 0;
  let cmd = "";
  const n = () => Number(t[i++]);
  // Curves by 64 chords: under 0.1 off the browser's getTotalLength for every stroke here.
  const curve = (at: (s: number) => [number, number]) => {
    for (let k = 1; k <= 64; k++) {
      const [px, py] = at(k / 64);
      len += Math.hypot(px - x, py - y);
      x = px;
      y = py;
    }
  };
  while (i < t.length) {
    if (/[A-Z]/.test(t[i])) cmd = t[i++];
    const [x0, y0] = [x, y];
    switch (cmd) {
      case "M":
        x = n();
        y = n();
        break;
      case "H": {
        const nx = n();
        len += Math.abs(nx - x);
        x = nx;
        break;
      }
      case "V": {
        const ny = n();
        len += Math.abs(ny - y);
        y = ny;
        break;
      }
      case "L": {
        const nx = n();
        const ny = n();
        len += Math.hypot(nx - x, ny - y);
        x = nx;
        y = ny;
        break;
      }
      case "Q": {
        const [cx, cy, ex, ey] = [n(), n(), n(), n()];
        curve((s) => [(1 - s) ** 2 * x0 + 2 * (1 - s) * s * cx + s * s * ex, (1 - s) ** 2 * y0 + 2 * (1 - s) * s * cy + s * s * ey]);
        break;
      }
      case "C": {
        const [ax, ay, bx, by, ex, ey] = [n(), n(), n(), n(), n(), n()];
        const b = (s: number, p0: number, p1: number, p2: number, p3: number) =>
          (1 - s) ** 3 * p0 + 3 * (1 - s) ** 2 * s * p1 + 3 * (1 - s) * s * s * p2 + s ** 3 * p3;
        curve((s) => [b(s, x0, ax, bx, ex), b(s, y0, ay, by, ey)]);
        break;
      }
      case "A": {
        const r = n();
        i += 4; // ry, rotation, large-arc, sweep
        const nx = n();
        const ny = n();
        if (Math.abs(Math.hypot(nx - x, ny - y) - 2 * r) > 0.5) throw new Error(`pathLength: only half-circle arcs (${d})`);
        len += Math.PI * r;
        x = nx;
        y = ny;
        break;
      }
      default:
        throw new Error(`pathLength: unsupported command ${cmd} (${d})`);
    }
  }
  return len;
}
