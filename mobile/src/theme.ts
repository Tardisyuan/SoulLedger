/**
 * The civilization ink layer, for React Native.
 *
 * SOURCE: `frontend/app/globals.css` — the dark `:root` / light `.light` blocks,
 * the per-tenant `--color-civ-*` tokens, and the `:not([data-civ])` neutral
 * ground used before a tenant is known. The triples below are copied verbatim
 * as OKLCH (the numbers the web measured its contrast table against) and
 * converted to hex here, because React Native has no `oklch()`.
 *
 * `__tests__/theme.test.ts` re-reads globals.css and fails if any triple here
 * differs from the declaration it was copied from. That test is what makes the
 * word "copied" true; without it this table is a second palette.
 */
import { CIVILIZATION_SHORT_CODES } from "@soulledger/core/config/civilizations";

export type ColorScheme = "dark" | "light";
export type CivCode = "cn" | "eu" | "eg" | "gr";

type Ground = { canvas: string; surface1: string; surface2: string; accent: string; mark: string };
type Shared = { ink: string; inkMuted: string; inkSubtle: string; hairline: string; error: string; success: string };

export const OKLCH: Record<ColorScheme, { shared: Shared; neutral: Ground } & Record<CivCode, Ground>> = {
  dark: {
    shared: {
      ink: "0.969671 0.001713 247.8393",
      inkMuted: "0.839386 0.014711 254.6188",
      inkSubtle: "0.650852 0.016974 257.2209",
      hairline: "0.296183 0.010017 260.7091",
      error: "0.647001 0.198706 24.6009",
      success: "0.710064 0.160036 155.6214",
    },
    neutral: {
      canvas: "0.141283 0.006557 285.5305",
      surface1: "0.174911 0.008207 285.5205",
      surface2: "0.194053 0.012017 285.226",
      accent: "0.650852 0.016974 257.2209",
      mark: "0.650852 0.016974 257.2209",
    },
    cn: {
      canvas: "0.138985 0.030107 40.9464",
      surface1: "0.176443 0.024099 37.9695",
      surface2: "0.198535 0.023308 37.8241",
      accent: "0.713075 0.097585 34.7247",
      mark: "0.649703 0.124151 35.2992",
    },
    eu: {
      canvas: "0.115779 0.038134 269.1643",
      surface1: "0.159487 0.030135 273.2797",
      surface2: "0.182236 0.029186 273.9396",
      accent: "0.712756 0.079313 277.6585",
      mark: "0.642606 0.10097 276.6787",
    },
    eg: {
      canvas: "0.166011 0.027969 91.255",
      surface1: "0.200946 0.024254 92.912",
      surface2: "0.222683 0.023972 92.9651",
      accent: "0.733236 0.098927 89.8359",
      mark: "0.727725 0.100218 89.3545",
    },
    gr: {
      canvas: "0.172756 0.038306 128.1128",
      surface1: "0.204329 0.033529 129.5686",
      surface2: "0.226829 0.032427 127.0651",
      accent: "0.721756 0.13753 130.0922",
      mark: "0.721756 0.13753 130.0922",
    },
  },
  light: {
    shared: {
      ink: "0.209123 0.010375 268.1867",
      inkMuted: "0.452257 0.021051 264.3395",
      inkSubtle: "0.517183 0.019895 267.6262",
      hairline: "0.921227 0.0046 258.3254",
      error: "0.531966 0.205532 27.9789",
      success: "0.496252 0.108981 156.0004",
    },
    neutral: {
      canvas: "1 0 0",
      surface1: "0.982679 0.002642 286.3511",
      surface2: "0.965001 0.003983 286.3249",
      accent: "0.528745 0.017896 257.2359",
      mark: "0.650852 0.016974 257.2209",
    },
    cn: {
      canvas: "0.970313 0.02052 67.5827",
      surface1: "0.983157 0.010038 58.2203",
      surface2: "0.964841 0.018598 62.4573",
      accent: "0.461515 0.100217 45.869",
      mark: "0.509043 0.112189 45.2466",
    },
    eu: {
      canvas: "0.957251 0.020359 276.9584",
      surface1: "0.974963 0.01201 281.0864",
      surface2: "0.951383 0.017557 279.0574",
      accent: "0.451923 0.141689 273.0637",
      mark: "0.451923 0.141689 273.0637",
    },
    eg: {
      canvas: "0.985447 0.017905 89.3544",
      surface1: "0.991447 0.009763 87.4695",
      surface2: "0.97623 0.015128 90.2333",
      accent: "0.461034 0.074993 89.3085",
      mark: "0.541259 0.089289 88.9271",
    },
    gr: {
      canvas: "0.989183 0.025026 126.531",
      surface1: "0.993514 0.014115 128.6196",
      surface2: "0.978766 0.021043 127.3776",
      accent: "0.442665 0.091429 130.0839",
      mark: "0.525615 0.111121 130.5085",
    },
  },
};

/** OKLCH (Björn Ottosson's matrices) → sRGB hex, clamped to gamut. */
export function oklchToHex(triple: string): string {
  const [L, C, h] = triple.split(/\s+/).map(Number);
  const rad = (h * Math.PI) / 180;
  const a = C * Math.cos(rad);
  const b = C * Math.sin(rad);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return (
    "#" +
    linear
      .map((x) => (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055))
      .map((x) => Math.round(Math.min(1, Math.max(0, x)) * 255).toString(16).padStart(2, "0"))
      .join("")
  );
}

export interface Palette {
  civ: CivCode | null;
  canvas: string;
  surface1: string;
  surface2: string;
  accent: string;
  mark: string;
  ink: string;
  inkMuted: string;
  inkSubtle: string;
  hairline: string;
  error: string;
  success: string;
}

export function civCodeOf(civilization: string | null | undefined): CivCode | null {
  const code = civilization ? CIVILIZATION_SHORT_CODES[civilization] : undefined;
  return code === "cn" || code === "eu" || code === "eg" || code === "gr" ? code : null;
}

/**
 * A soul's palette. An unknown or absent civilization gets the neutral ground —
 * the same thing `:root:not([data-civ])` gives the web before a tenant is known —
 * rather than borrowing some other civilization's colours.
 */
export function paletteFor(civilization: string | null | undefined, scheme: ColorScheme): Palette {
  const civ = civCodeOf(civilization);
  const table = OKLCH[scheme];
  const ground = civ ? table[civ] : table.neutral;
  const hex = <T extends Record<string, string>>(o: T) =>
    Object.fromEntries(Object.entries(o).map(([k, v]) => [k, oklchToHex(v)])) as T;
  return { civ, ...hex(ground), ...hex(table.shared) };
}
