/**
 * Token contract for the shared data-grid's enum badges.
 *
 * Three commits (1d9fac4, c3e8cdb, 3ab941b) flattened every badge fill in the
 * app to a 10% tint of its status token, and 5e580e3 then RE-MEASURED five
 * light-mode `--color-status-*` values against that 10% tint, darkening them
 * until they cleared 4.5:1. Those token values are only correct for a 10%
 * fill: src/components/ui/Toast.tsx records that a 16% tint of the error
 * token measures 4.37:1, under AA.
 *
 * So the tint depth is not a style preference — it is an input to the token
 * values, and raising it silently invalidates them. d5af1e9 (the data-grid
 * extraction, which existed to PREVENT drift) shipped 16% and regressed every
 * badge on /audit and /permissions. This file makes that class of change fail
 * a test instead of a screen reader.
 *
 * Pure functions and a CSS read — no DOM, no browser, no new dependency. The
 * WCAG relative-luminance and contrast formulas are implemented inline below.
 */
import {
  CIV_PREFIXES,
  LIGHT_TOKENS,
  NO_CIV_LIGHT_TOKENS,
  THEMES,
  oklchTripleToRgb,
  readCivAttrRules,
  resolveRampForCiv,
  type ThemeName,
} from "./support/globalsCssTokens";
import { ENUM_TONE_CLASSES } from "@/components/ui/data-grid/columns";

/** The cap the rest of the app already uses. Anything above this invalidates the light-mode token measurements. */
const MAX_TINT_ALPHA = 0.1;
const AA_TEXT_CONTRAST = 4.5;

// ---------------------------------------------------------------------------
// WCAG 2.x relative luminance + contrast ratio (hand-rolled, no dependency)
// ---------------------------------------------------------------------------

type Rgb = [number, number, number];

// The local `hslToRgb` that used to sit here is gone with the tokens it
// parsed. It was the last copy of colour arithmetic in this file — the comment
// under `tokenToRgb` already records that a local COPY OF THE PARSER was
// removed for the same reason — and `oklchTripleToRgb` in ./support is now the
// one implementation, validated against published reference values in
// civilizationColourContract.test.ts.

/** WCAG relative luminance: linearize each sRGB channel, then weight. */
function relativeLuminance([r, g, b]: Rgb): number {
  const lin = (channel: number) => {
    const v = channel / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Alpha-composite `fg` at `alpha` over opaque `bg`, as a browser would. */
function composite(fg: Rgb, alpha: number, bg: Rgb): Rgb {
  return [0, 1, 2].map((i) => fg[i] * alpha + bg[i] * (1 - alpha)) as Rgb;
}

// ---------------------------------------------------------------------------
// Parsing: globals.css light-mode tokens, and the Tailwind arbitrary values
// ---------------------------------------------------------------------------

/**
 * The `.light` tokens come from `./support/globalsCssTokens`, which merges every
 * `.light { ... }` block in globals.css (there are two — the base override near
 * the top and the re-measured status block further down) into one map, later
 * declarations winning, exactly as the cascade resolves them.
 *
 * This file used to carry its own regex copy of that. Three readers of one
 * stylesheet is the defect the colour contracts exist to close — the support
 * module's own docstring says so — and the copy here would have kept passing
 * against a stale idea of the file after a restructure, because it returned
 * `{}` instead of throwing. `LIGHT_TOKENS` is the RAW `.light` block, which is
 * the right map for this file: it measures the tokens `5e580e3` re-measured,
 * and a tone whose token `.light` never declares should fail here rather than
 * quietly borrow the dark value.
 */

/** `"0.496249 0.108977 156.0004"` -> rgb. Returns null for anything not a
 *  literal OKLCH triple (e.g. a var() indirection). */
function tokenToRgb(value: string | undefined): Rgb | null {
  if (!value) return null;
  if (!/^[\d.]+\s+[\d.]+\s+-?[\d.]+$/.test(value.trim())) return null;
  return oklchTripleToRgb(value) as Rgb;
}

/**
 * `tokenToRgb`, but a failure is a FAILURE.
 *
 * The AA case below used to end its resolution step with `if (!fillRgb ||
 * !inkRgb) return;`. A `return` inside an `it.each` case is not a skip that any
 * runner reports — the case passes, having asserted nothing, and the summary
 * says "4 passed" whether four tones were measured or one was quietly dropped.
 * `neutral` was the one being dropped, and it is the only tone whose fill
 * varies by tenant, i.e. the one that most needed measuring.
 *
 * Every resolution in this file now goes through here or `rampRgb`, so a token
 * that stops resolving names itself instead of disappearing.
 */
function requireRgb(label: string, value: string | undefined): Rgb {
  const rgb = tokenToRgb(value);
  if (rgb === null) {
    throw new Error(
      `${label} did not resolve to a literal \`L C H\` triple — got ` +
        `${JSON.stringify(value ?? null)}. Either the token moved, or it is now ` +
        `an indirection that needs resolving before it can be measured. Fix the ` +
        `resolution; do not skip the measurement.`
    );
  }
  return rgb;
}

/**
 * A token as the named civilization renders it, in the named theme.
 *
 * `resolveRampForCiv` looks up that tenant's own plane token —
 * `--color-civ-surface-3-cn` — exactly as the `:root[data-civ]` rule does,
 * which is what turns a ramp name into something measurable. Literal tokens (the ink,
 * the canvas) pass through it unchanged, so one helper covers every token in a
 * tone's class string rather than two code paths that could disagree.
 */
function rampRgb(theme: ThemeName, prefix: string, token: string): Rgb {
  let triple: string;
  try {
    triple = resolveRampForCiv(theme, prefix, token);
  } catch (cause) {
    throw new Error(
      `\`${token}\` could not be resolved for tenant \`${prefix}\` in ${theme} ` +
        `mode: ${(cause as Error).message}`
    );
  }
  return requireRgb(`\`${token}\` (${theme}, ${prefix})`, triple);
}

interface ToneFill {
  /** e.g. `--color-status-success` */
  token: string;
  /** Fill opacity; 1 when the utility declares none. */
  alpha: number;
}

/** Pulls the `bg-[oklch(var(--token)/alpha)]` fill out of a tone's class string. */
function parseBackground(classes: string): ToneFill | null {
  const m = /bg-\[oklch\(var\((--[\w-]+)\)\s*(?:\/\s*([\d.]+))?\)\]/.exec(classes);
  if (!m) return null;
  return { token: m[1], alpha: m[2] === undefined ? 1 : Number(m[2]) };
}

/** Pulls the `text-[oklch(var(--token))]` ink out of a tone's class string. */
function parseForegroundToken(classes: string): string | null {
  const m = /text-\[oklch\(var\((--[\w-]+)\)\s*(?:\/\s*[\d.]+)?\)\]/.exec(classes);
  return m ? m[1] : null;
}

// Enumerated from the map itself, never hardcoded — a tone added tomorrow is
// held to the same contract without anyone remembering to edit this file.
const TONES = Object.entries(ENUM_TONE_CLASSES);

/**
 * Does this tone's fill resolve to a literal colour, or does it depend on which
 * tenant is rendering?
 *
 * Derived from the token's DECLARATION, never from the tone's name. The status
 * tints are literal OKLCH triples and mean the same thing on every screen; the
 * surface ramp is written `var(--color-civ-surface-3-cn)` and means four
 * different colours. A tone that switches from a status tint to a surface fill
 * tomorrow moves itself into the per-tenant group without anyone editing this file —
 * which is the whole point, because `neutral` is here precisely because a name
 * check is what nobody remembered to write.
 */
function fillIsLiteral([, classes]: [string, string]): boolean {
  const fill = parseBackground(classes);
  return fill !== null && !RETINTED_PLANES.has(fill.token);
}

/**
 * The tokens a `:root[data-civ]` rule redeclares — the five ramp planes.
 *
 * THE TEST FOR "IS THIS PER-TENANT" HAD TO MOVE, AND HERE IS WHY IT COULD NOT
 * STAY. It read `tokenToRgb(LIGHT_TOKENS[token]) !== null`: while the ramp was
 * `[--civ-hue] 55% 94.5%` a plane's own declaration failed to parse as a
 * colour, and that failure WAS the signal. In OKLCH the planes are literals in
 * `:root` / `.light` too — inert ones, overridden for every mapped tenant —
 * so that question now answers "literal" for all five and `PER_TENANT_TONES`
 * silently emptied, taking 40 AA measurements with it. Jest caught it only
 * because this file asserts its own group sizes; the AA cases themselves would
 * have reported a clean pass over nothing examined.
 *
 * Read from the rules instead, which is the same fact stated where it is now
 * true: a plane is per-tenant exactly when a tenant rule repoints it.
 */
const RETINTED_PLANES = new Set(
  Object.values(readCivAttrRules()).flatMap((rule) => Object.keys(rule.ramp))
);

const LITERAL_TONES = TONES.filter(fillIsLiteral);
const PER_TENANT_TONES = TONES.filter((tone) => !fillIsLiteral(tone));

/** tone × theme × tenant, for the tones with no single answer. */
type PerTenantCase = [tone: string, theme: ThemeName, prefix: string, classes: string];

const PER_TENANT_CASES: PerTenantCase[] = PER_TENANT_TONES.flatMap(([tone, classes]) =>
  THEMES.flatMap((theme) =>
    CIV_PREFIXES.map((prefix): PerTenantCase => [tone, theme, prefix, classes])
  )
);

/**
 * Combinations measured below 4.5:1, each recorded with the ratio that was
 * measured and the argument for leaving the token alone.
 *
 * Empty, and asserted as an exact set rather than as "no unexpected failures",
 * so that BOTH directions turn this file red: a combination that starts failing
 * is not in the table, and a combination that gets fixed is one the table still
 * names. Same shape as `ENUM_MAPS_STILL_ON_FEEDBACK_TOKENS` in
 * statusTokenLayering.test.ts, and for the same reason — which combinations are
 * allowed to fail is a decision, and a decision belongs in source with its
 * argument beside it, not in a `toBeGreaterThan` that quietly moved.
 *
 * Keys are `tone/theme/tenant`.
 */
const TONE_COMBINATIONS_BELOW_AA: Record<string, string> = {};

describe("data-grid enum badge token contract", () => {
  it("declares at least one tone (guards against the map being renamed away)", () => {
    expect(TONES.length).toBeGreaterThan(0);
  });

  it("measures every tone in one group or the other, and neither group is empty", () => {
    // The floor under the parametrisation. A check that reports a clean pass
    // over nothing examined is the defect this file was edited to remove, so
    // the counts are asserted rather than assumed: five tones today, four of
    // them literal status tints and one — `neutral` — on the per-tenant surface
    // ramp. If `LITERAL_TONES` silently emptied, every AA case below would pass
    // by not existing.
    expect(TONES.length).toBeGreaterThanOrEqual(5);
    expect(LITERAL_TONES.length + PER_TENANT_TONES.length).toBe(TONES.length);
    expect(LITERAL_TONES.length).toBeGreaterThanOrEqual(4);
    expect(PER_TENANT_TONES.length).toBeGreaterThanOrEqual(1);
  });

  it("produces a per-tenant case for every tone × theme × civilization", () => {
    expect(THEMES.length).toBe(2);
    expect(CIV_PREFIXES.length).toBeGreaterThanOrEqual(4); // cn, eu, eg, gr
    expect(PER_TENANT_CASES.length).toBe(
      PER_TENANT_TONES.length * THEMES.length * CIV_PREFIXES.length
    );
    // Stated as an absolute floor as well, so the identity above cannot go
    // vacuously true by both sides collapsing to zero.
    expect(PER_TENANT_CASES.length).toBeGreaterThanOrEqual(8);
  });

  it.each(TONES)("tone %s fills with a status tint the CSS can resolve", (tone, classes) => {
    const fill = parseBackground(classes);
    expect(fill).not.toBeNull();
    expect(parseForegroundToken(classes)).not.toBeNull();
    // A fully opaque fill must be a surface token, not a status colour used raw.
    if (fill!.alpha === 1) {
      expect(fill!.token).toMatch(/^--color-surface-/);
    }
  });

  it.each(TONES)(
    "tone %s tints at no more than 10%% — the depth the light-mode tokens were measured against",
    (tone, classes) => {
      const fill = parseBackground(classes)!;
      if (fill.token.startsWith("--color-surface-")) {
        // Not a tint, so there is no tint depth to cap — but the case still
        // has to assert something, or it is the same silent pass this file was
        // edited to remove. A surface fill that grew an alpha would be a tint
        // over the canvas that nobody measured.
        expect(fill.alpha).toBe(1);
        return;
      }
      expect(fill.alpha).toBeLessThanOrEqual(MAX_TINT_ALPHA);
    }
  );

  it.each(LITERAL_TONES)(
    "tone %s clears AA in light mode at the tint it actually declares",
    (tone, classes) => {
      const fill = parseBackground(classes)!;
      const inkToken = parseForegroundToken(classes)!;
      const tokens = LIGHT_TOKENS;

      // No `return` anywhere below. These tones were selected for this list
      // BECAUSE their fill resolves; anything that stops resolving — the ink or
      // the canvas included — names itself and reddens the run.
      const fillRgb = requireRgb(`tone \`${tone}\` fill \`${fill.token}\` in .light`, tokens[fill.token]);
      const inkRgb = requireRgb(`tone \`${tone}\` ink \`${inkToken}\` in .light`, tokens[inkToken]);
      // THE UNTINTED BRANCH, NAMED. This read `tokens["--color-canvas"]`, which
      // worked only while `.light` declared a literal white. Stage 13 made the
      // tenant-facing light canvas per-tenant (`[--civ-hue] 100% 96.5%`
      // then, `var(--color-civ-canvas-cn)` since the OKLCH migration), so that
      // lookup became an unresolved `var(` — `requireRgb` throws on it, which
      // is how this line was found rather than left to drift.
      //
      // This case is the LITERAL one: `PER_TENANT_CASES` below already measures
      // every tone on every tenant's own canvas through `rampRgb`. What is left
      // for this block is the screen with no cosmology — logged out, or a
      // tenant this deployment does not map — and that screen's ground is
      // `.light:not([data-civ])`, still white. Reading the tenant branch here
      // would measure a colour this case never renders.
      const canvasRgb = requireRgb(
        "`--color-canvas` in .light:not([data-civ])",
        NO_CIV_LIGHT_TOKENS["--color-canvas"]
      );

      const background = composite(fillRgb, fill.alpha, canvasRgb);
      const ratio = contrastRatio(inkRgb, background);
      expect(ratio).toBeGreaterThanOrEqual(AA_TEXT_CONTRAST);
    }
  );

  it.each(PER_TENANT_CASES)(
    "tone %s clears AA in %s mode for tenant %s",
    (tone, theme, prefix, classes) => {
      const fill = parseBackground(classes)!;
      const inkToken = parseForegroundToken(classes)!;

      const fillRgb = rampRgb(theme, prefix, fill.token);
      const inkRgb = rampRgb(theme, prefix, inkToken);
      const canvasRgb = rampRgb(theme, prefix, "--color-canvas");

      const background = composite(fillRgb, fill.alpha, canvasRgb);
      const ratio = contrastRatio(inkRgb, background);
      const recorded = TONE_COMBINATIONS_BELOW_AA[`${tone}/${theme}/${prefix}`];
      if (recorded !== undefined) {
        // Recorded as an argued exception; still measured, and still has to
        // stay below AA, so fixing the token reddens this instead of drifting.
        expect(ratio).toBeLessThan(AA_TEXT_CONTRAST);
        return;
      }
      expect(ratio).toBeGreaterThanOrEqual(AA_TEXT_CONTRAST);
    }
  );

  it("records no exception that is not a real per-tenant case", () => {
    // The other half of the exact-set assertion. A key left behind after a tone
    // is renamed would otherwise sit in the table forever, silently excusing a
    // combination that no longer exists.
    const known = new Set(PER_TENANT_CASES.map(([tone, theme, prefix]) => `${tone}/${theme}/${prefix}`));
    expect(Object.keys(TONE_COMBINATIONS_BELOW_AA).filter((key) => !known.has(key))).toEqual([]);
  });
});

describe("WCAG helpers", () => {
  it("reproduces the reference black-on-white ratio", () => {
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
  });

  it("returns 1 for a colour against itself", () => {
    expect(contrastRatio([18, 52, 86], [18, 52, 86])).toBeCloseTo(1, 10);
  });

  it("converts OKLCH the way the CSS tokens are written", () => {
    // The same three colours this checked while the tokens were HSL — white,
    // pure red, and `--color-status-alive` in light mode — restated in the
    // coordinates they are now written in. Values, not spellings, are what
    // this pins: the third one is `150 62% 28%` as it used to be spelled.
    expect(tokenToRgb("1 0 0")).toEqual([255, 255, 255]);
    expect(tokenToRgb("0.627955 0.257683 29.2339")).toEqual([255, 0, 0]);
    expect(tokenToRgb("0.496249 0.108977 156.0004")).toEqual([27, 116, 71]);
    // And a var() indirection is still not a colour.
    expect(tokenToRgb("var(--color-civ-surface-1-cn)")).toBeNull();
  });

  it("composites a fill at 0 and 1 alpha to the endpoints", () => {
    expect(composite([255, 0, 0], 0, [255, 255, 255])).toEqual([255, 255, 255]);
    expect(composite([255, 0, 0], 1, [255, 255, 255])).toEqual([255, 0, 0]);
  });
});
