/**
 * The S-and-L balance mark as data, for the cold start to draw (src/coldStart.tsx).
 *
 * SHAPE is assets/brand/soulledger-mark.svg's outline, copied (zhuyin.test.tsx holds it to
 * the file). The right pan's triangle is a mask in the SVG; here it is folded into the right
 * pan's path and cut by clipRule="evenodd" — it lies wholly inside that pan.
 *
 * STROKES are centre lines (mark units) drawn under SHAPE as a clip: thick enough that, fully
 * drawn, the clip shows the whole mark (99.9% of its pixels, measured 2026-10-01), so the edges
 * the eye sees are always the icon's own. They draw all at once, each over the same time.
 */

export const VIEWBOX = "200 216 624 591";
export const MARK_WIDTH = 624;
export const MARK_HEIGHT = 591;

export const SHAPE: readonly string[] = [
  "M562.09 381.623C538.344 363.262 518.646 363.85 490.896 363.843L451.755 363.901C423.256 363.934 402.151 362.492 380.973 339.728C370.565 328.598 363.994 314.427 362.225 299.292C359.744 279.972 365.205 260.473 377.359 245.253C389.261 229.906 406.759 219.9 426.021 217.426C435.968 216.24 453.706 216.741 464.337 216.751L530.082 216.806L651.75 216.803C673.646 216.803 696.441 216.479 718.272 216.954C703.499 233.044 685.153 250.82 669.663 266.536L504.575 266.567L456.831 266.563C444.849 266.565 427.129 264.299 418.185 273.099C413.514 277.625 410.873 283.847 410.862 290.351C410.862 296.747 413.469 302.866 418.083 307.295C426.806 315.715 438.718 314.34 449.995 314.296L491.722 314.278C503.986 314.256 515.331 314.017 527.577 315.349C570.41 320.009 607.448 347.23 630.78 382.78C612.549 401.864 590.92 422.076 571.96 440.834L457.856 554.523L390.097 622.047C380.446 631.688 359.744 653.424 349.803 660.366C334.375 671.169 316.076 677.127 297.246 677.479C272.143 678.04 247.872 668.472 229.905 650.933C213.571 635.161 204.474 616.361 200.679 594.151C228.359 528.507 258.861 463.129 286.214 397.555L469.639 397.532C453.569 415.279 433.232 432.832 416.12 450.026L328.47 450.11L358.952 521.048C347.193 533.183 331.589 547.503 320.692 559.561C312.936 541.797 303.674 516.323 295.38 499.821C289.893 511.757 283.708 528.239 278.625 540.847C272.733 555.461 263.634 574.384 258.704 588.829C258.757 588.825 258.812 588.832 258.862 588.818C266.677 586.572 290.484 587.808 300.278 587.82C318.576 587.842 336.884 587.645 355.179 587.863C367.129 576.665 379.362 564.118 391.023 552.523L453.198 490.545L525.372 418.347C537.383 406.333 550.344 393.798 562.09 381.623Z",
  "M678.348 397.746C697.574 397.328 718.364 397.465 737.621 397.614L823.282 594.325C820.052 611.355 815.434 624.465 804.885 638.425C781.474 669.405 747.372 682.015 709.62 675.819C695.169 672.472 683.48 667.613 671.591 658.515C651.048 642.744 637.579 619.486 634.124 593.819L695.684 450.203L625.078 450.078C630.526 444.891 675.382 398.473 678.348 397.746Z M728.062 499.629C740.257 528.481 753.414 558.467 764.943 587.454C766.254 589.978 767.498 593.366 768.579 596.076L716.939 596.187C707.707 596.214 697.115 596.65 688.106 596.323C689.453 593.882 690.949 590.216 692.114 587.567C702.145 561.286 714.173 535.524 724.159 509.19C725.297 506.188 726.674 502.489 728.062 499.629Z",
  "M538.894 535.992C539.839 537.921 539.392 733.329 539.385 752.144L598.954 752.179C611.71 752.182 625.453 751.939 638.139 752.42C638.329 770.036 638.082 788.087 638.039 805.737C587.837 806.596 535.115 805.843 484.75 805.777L386.267 805.829C386.02 788.196 386.229 770.009 386.215 752.322C396.957 751.775 410.301 752.219 421.246 752.223L484.567 752.08L484.673 590.609C490.407 584.383 497.638 577.502 503.715 571.409L538.894 535.992Z",
];

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
