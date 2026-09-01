"use client";

import { useI18n } from "@/src/contexts/I18nContext";
import { resolveEnumDisplay } from "@/src/lib/domainDisplay";
import {
  CIVILIZATION_LABELS,
  CIVILIZATION_SHORT_CODES,
  getCivilizationFromTenantCode,
} from "@/src/config/civilizations";

// ── Which cosmology am I in ─────────────────────────────────────────────
//
// The gap this closes: nothing in the persistent frame said which of the four
// tenants a screen belonged to. Stage 9 tried to answer it with the surface
// ramp and the measurement came back at ≤6/255 of channel difference between
// any two tenants in either theme — a floor, not a signal. The wordmark was
// the remaining candidate and the argument for it is that it was already
// spending the best position in the app on a constant: "SoulLedger" is
// identical in all four tenants, so the top-left of every screen was carrying
// zero bits.
//
// TEXT IS NOT THE DECORATION HERE. Every variant below renders a string, and
// that is a requirement rather than a nicety. Three of the four marks are
// warm; simulated for deuteranopia cn/eg/gr land within a few points of each
// other and only eu stays apart. That is not an argument against 88° — Stage 9
// took it over the geometric optimum because 138° collided with merit green,
// which is worse — it is that four hues on one wheel cannot be the sole
// channel for four categories whatever the four hues are, and a fifth
// cosmology has no hue left to be given. So the ADDENDUM's "the mark and text"
// reads as AND: `tenantSignalContract.test.tsx` renders every variant for
// every civilization and asserts each one is identifiable from its text alone.
//
// WHY THE WORDMARK ITSELF STAYS ACCENT-COLOURED. Tinting it per civilization
// is wrong twice. `--color-accent` is user-configurable through
// `useAccentColor` in the settings drawer, so a preference would silently
// overwrite tenant identity; and accent means *interactive* everywhere else in
// this application, so recolouring it by tenant would merge identity and
// affordance into one channel. The mark is its own element, which is also what
// makes it enumerable.
//
// GLYPHS TAKE `--civ-ink`, THE DOT AND THE CHIP'S FILL TAKE `--civ-mark`.
// Both aliases are stamped per tenant by the same `[data-civ]` rules. The two
// letters are 11px mono, so they are text at 4.5:1, and the unmapped-tenant
// fallback made that plain: `--civ-mark` is declared only in `:root` — the
// dark block — so a logged-out light-mode masthead drew them with a colour
// measured against a near-black canvas, at 3.23:1 in the rail and 2.84:1 in
// the chip. `--civ-ink` is declared in both themes. The 7px dot keeps the
// mark: it is a graphical object at 3:1, and it passes.
//
// The colour comes from `hsl(var(--civ-mark))`, aliased per tenant by the
// `[data-civ]` rules in globals.css exactly as `--civ-hue` is. No variant
// looks up `--color-civ-mark-cn` by name, so none of them enumerates the four
// members, and a fifth civilization needs one stylesheet line rather than
// three component edits.

type Variant =
  /** Sidebar masthead, expanded: mark dot + the localized civilization name. */
  | "line"
  /** Sidebar masthead, collapsed to w-16: the two-letter code, in the mark. */
  | "rail"
  /** Mobile header, left of the breadcrumb: a fixed-width code chip. */
  | "chip";

/**
 * The civilization name in the reader's language.
 *
 * Reads a catalogue rather than `CIVILIZATION_LABELS` so the second line
 * follows the locale switcher; the config map is the fallback for a member the
 * bundles have not caught up with. That fallback is a real case rather than
 * defensive padding — a fifth civilization lands in `civilizations.ts` before
 * it lands in three message bundles, and the one element whose entire job is
 * naming the cosmology is the worst place to render 「无法识别」 instead of a
 * name that is sitting in the config.
 *
 * WHY `tenant.civilizations` AND NOT ONE OF THE FIVE THAT EXISTED. Four of
 * them — workflow, realms, organization, actors — already carry the full name,
 * and that is the problem: they are one fact written four times, and two of the
 * four have drifted (埃及杜阿特 against 埃及冥界; 欧洲天堂与地狱 against
 * 欧洲天堂地狱). Borrowing any one of them would make the masthead read as
 * whichever page's copy someone edited last. The fifth, `souls.civilizations`,
 * is the short form — 「希腊」, "Greek" — which sitting under the wordmark
 * names a language rather than an underworld. So the app's persistent answer to
 * "where am I" gets its own four keys, and `civilizationCopyCoverage` holds
 * them in all three bundles like the other six namespaces.
 *
 * Branching on `state` and not on `label`, which is the whole reason this is a
 * function. `resolveEnumDisplay` returns `label: null` only for an empty raw
 * value; for a member no bundle knows it returns `state: "unrecognized"` with
 * `label` set to translated "unrecognized" copy. So `label ?? CIVILIZATION_
 * LABELS[civ]` reads like a fallback and is not one — the left side is never
 * null in the case the fallback exists for, and the masthead would have shown
 * the placeholder while the real name sat one map away.
 */
function civilizationName(
  t: (key: string, params?: Record<string, string>) => string,
  civilization: string
): string {
  const display = resolveEnumDisplay(t, "tenant.civilizations", civilization);
  if (display.state === "known" && display.label) return display.label;
  return CIVILIZATION_LABELS[civilization] ?? civilization;
}

export function TenantSignal({
  tenantCode,
  variant,
}: {
  /** `user.tenant.code`, e.g. `GR_HADES`. Null when logged out. */
  tenantCode: string | null;
  variant: Variant;
}) {
  const { t } = useI18n();

  // No tenant, no claim. An unmapped or absent tenant renders nothing at all
  // rather than a grey disc or a placeholder dash — the same choice
  // TenantContext makes when it deletes `[data-civ]` instead of guessing a
  // civilization. A signal that appears blank is worse than one that is
  // absent: blank reads as "this tenant has no name", absent reads as "you are
  // not signed into one".
  if (!tenantCode) return null;
  const civilization = getCivilizationFromTenantCode(tenantCode);
  const shortCode = CIVILIZATION_SHORT_CODES[civilization];
  if (!shortCode) return null;

  const name = civilizationName(t, civilization);

  // `title` carries the raw member and `aria-label` carries the name, which is
  // the split §4.6 asks for and the one `EnumBadge`'s callers already use
  // (`label: resolveEnumDisplay(…).label` beside `title: soul.civilization`).
  // Putting the translated name in `title` is the shape that rule exists to
  // stop: it looks like the member is recoverable, reads fine in review, and
  // leaves nothing on screen that names the enum this row actually holds.
  // The two code-only variants need `aria-label` because "gr" read aloud is
  // not an answer to "which cosmology am I in"; the line does not, because its
  // own text is already the name.
  const dot = (
    <span
      aria-hidden="true"
      data-tenant-mark={shortCode}
      className="rounded-full shrink-0"
      style={{ width: 7, height: 7, background: "hsl(var(--civ-mark))" }}
    />
  );

  if (variant === "line") {
    return (
      // `min-w-0` on the flex child and `truncate` on the name: the sidebar is
      // a fixed 224px and 欧洲天堂地狱 is the longest of the four, so a locale
      // with a longer word must shorten the name rather than push the scale
      // icon out of the masthead.
      <span
        data-tenant-signal="line"
        className="flex items-center gap-1.5 min-w-0"
        title={civilization}
      >
        {dot}
        <span className="text-02 leading-tight text-[hsl(var(--color-ink-muted))] truncate">
          {name}
        </span>
      </span>
    );
  }

  if (variant === "rail") {
    // Collapsed drops the name, so it must not drop to colour alone. The
    // two-letter prefix is the same key the `[data-civ]` rules use, is not a
    // translation, and is therefore locale-stable in a 64px rail — the reason
    // the full name cannot go here is the reason the code can.
    return (
      <span
        data-tenant-signal="rail"
        title={civilization}
        aria-label={name}
        className="font-mono text-01 leading-none uppercase"
        style={{ color: "hsl(var(--civ-ink))" }}
      >
        {shortCode}
      </span>
    );
  }

  // chip — mobile only.
  //
  // It goes left of the breadcrumb, inside the flex-1 region, and NOT in the
  // header's right cluster. That cluster's `shrink-0 whitespace-nowrap` carries
  // a comment recording that when it wrapped it grew past the 64px header and,
  // the header being `sticky z-40`, the overflow landed on the page and
  // swallowed clicks — the 创建灵魂 button on /souls was unreachable at 393px
  // for exactly that. A variable-width chip there re-runs that bug.
  //
  // Fixed width for the same reason the locale <select> is dropped below `sm`:
  // nothing in this row may be able to grow. Two letters at 11px mono plus the
  // dot is the same box for every tenant and every locale, so the breadcrumb
  // beside it keeps the whole remainder to truncate into.
  return (
    <span
      data-tenant-signal="chip"
      title={civilization}
      aria-label={name}
      className="shrink-0 inline-flex items-center justify-center gap-1 rounded-full border px-2 py-0.5"
      style={{
        width: 52,
        borderColor: "hsl(var(--civ-mark) / 0.4)",
        background: "hsl(var(--civ-mark) / 0.13)",
      }}
    >
      {dot}
      <span
        className="font-mono text-01 leading-none uppercase"
        style={{ color: "hsl(var(--civ-ink))" }}
      >
        {shortCode}
      </span>
    </span>
  );
}
