# Design token inventory

Everything below is the **current** state, extracted from `frontend/app/globals.css`
and `frontend/lib/chart-colors.ts`. It is the starting point for the redesign, not a
constraint on it.

Format is `H S% L%` (bare HSL triplets, consumed as `hsl(var(--token))`), which lets
opacity be applied as `hsl(var(--token) / 0.2)`.

---

## What exists

**Colour only.** There is no type scale, no spacing scale, no radius scale, no
elevation scale, and no motion tokens. That absence is why the app has drifted to four
heading sizes and four border-radius values — nothing ever defined the alternative.

Please propose all five missing scales alongside the colour revision.

---

## Surfaces and text

| Token | Dark | Light |
|---|---|---|
| `--color-canvas` | `240 15% 4%` | `0 0% 100%` |
| `--color-surface-1` | `240 13% 7%` | `0 0% 98%` |
| `--color-surface-2` | `240 12% 9%` | `0 0% 96%` |
| `--color-surface-3` | `240 11% 10%` | `0 0% 94%` |
| `--color-surface-4` | `240 11% 11%` | `0 0% 92%` |
| `--color-hairline` | `220 8% 18%` | `220 10% 90%` |
| `--color-hairline-strong` | `220 7% 22%` | `220 10% 85%` |
| `--color-hairline-tertiary` | `220 6% 26%` | `220 8% 80%` |
| `--color-ink` | `210 11% 96%` | `220 15% 10%` |
| `--color-ink-muted` | `213 15% 80%` | `220 10% 35%` |
| `--color-ink-subtle` | `215 8% 57%` | `220 8% 50%` |
| `--color-ink-tertiary` | `215 6% 50%` ⚠️ | `220 6% 60%` |
| `--color-accent` | `38 92% 50%` | `38 92% 50%` |
| `--color-accent-hover` | `43 96% 58%` | `43 96% 58%` |

⚠️ `ink-tertiary` was `41%`, measuring **3.37:1** on `surface-1` — below the WCAG AA
4.5:1 floor for body text. Raised to `50%` (~4.6:1). Do not regress it.

Note the four surface levels sit within 4 lightness points of each other in dark mode
(7%→11%) and 6 in light (98%→92%). They are nearly indistinguishable in practice — a
real elevation model is worth proposing.

The accent is identical in both themes, which is part of why light mode reads as
unfinished.

## Soul lifecycle states

| Token | Dark | Light | Meaning |
|---|---|---|---|
| `--color-status-alive` | `160 84% 39%` | `160 84% 30%` | ALIVE 存活 |
| `--color-status-judging` | `38 92% 50%` | `38 92% 40%` | JUDGING 审判中 |
| `--color-status-disposed` | `220 80% 62%` ⚠️ | `220 80% 45%` | DISPOSED 已处置 |
| `--color-status-reincarnating` | `217 91% 60%` | `217 91% 50%` | REINCARNATING 轮回中 |
| `--color-status-lost` | `0 0% 50%` | `0 0% 40%` | LOST 迷失 |

⚠️ `status-disposed` was `55%`, measuring **4.09:1** — below AA. Raised to `62%`.

Problem worth solving: `disposed` (`220 80% 62%`) and `reincarnating` (`217 91% 60%`)
are three degrees of hue apart and effectively the same blue. Two adjacent lifecycle
stages are not visually distinguishable.

## Karma and verdicts

| Token | Dark | Light |
|---|---|---|
| `--color-karma-merit` | `142 76% 36%` | `142 76% 28%` |
| `--color-karma-demerit` | `0 84% 60%` | `0 84% 50%` |
| `--color-verdict-passed` | `142 76% 36%` ⚠️ | `142 76% 28%` |
| `--color-verdict-failed` | `0 84% 60%` | `0 84% 50%` |
| `--color-verdict-purgatory` | `217 91% 60%` | `217 91% 50%` |
| `--color-verdict-retry` | `270 76% 68%` ⚠️ | `270 76% 45%` |

⚠️ `verdict-passed` was the accent amber, i.e. a PASSED badge rendered in the exact
colour used for buttons and headings — the accent stopped signalling "interactive".
Moved to green, matching `karma-merit`.
⚠️ `verdict-retry` was `55%`, measuring **3.39:1** — below AA. Raised to `68%`.

`verdict-purgatory` and `status-reincarnating` are the same value. Intentional or not,
it means the palette currently has no free blue.

## Generic status

| Token | Dark | Light |
|---|---|---|
| `--color-status-success` | `142 76% 36%` | `142 76% 28%` |
| `--color-status-error` | `0 84% 60%` | `0 84% 50%` |
| `--color-status-warning` | `38 92% 50%` | `38 92% 40%` |
| `--color-status-info` | `217 91% 60%` | `217 91% 50%` |

These duplicate the verdict palette exactly. Whether semantic status and domain verdict
should share a palette is a real question — right now a system error and a failed
judgment are the same red.

## Civilization identity

| Token | Dark | Light | Civilization |
|---|---|---|---|
| `--color-civ-cn` | `38 92% 50%` | `38 92% 40%` | Chinese 地府 |
| `--color-civ-eu` | `217 91% 52%` | `217 91% 45%` | European Heaven/Hell |
| `--color-civ-eg` | `271 81% 56%` | `271 81% 48%` | Egyptian Duat |

Previously every page picked its own — the dashboard drew Chinese in red while
organizations drew it in amber, so one screen showed the same civilization in two
colours. Unified to amber/blue/purple to keep hues far apart.

**`--color-civ-cn` is identical to `--color-accent`.** The Chinese civilization is
therefore indistinguishable from the app's primary interactive colour, which is a
problem given Chinese is the default tenant.

This three-token set is the entire current expression of civilization identity. See
§4.9 of the brief.

---

## Chart colours

Recharts props (`fill`, `stroke`, `tick.fill`) take concrete values and **cannot read
CSS custom properties**, so `lib/chart-colors.ts` mirrors the tokens as literals. These
are the dark-theme values and they do not follow the `.light` override — which is why
charts stay dark-themed in light mode.

```ts
STATE_COLORS        ALIVE hsl(160 84% 39%) · JUDGING hsl(38 92% 50%)
                    DISPOSED hsl(220 80% 62%) · REINCARNATING hsl(217 91% 60%)
                    LOST hsl(0 0% 50%)

CIVILIZATION_COLORS CN_DIYU hsl(38 92% 50%) · EU_HEAVEN_HELL hsl(217 91% 52%)
                    EG_DUAT hsl(271 81% 56%)

REALM_COLORS        HELL hsl(0 84% 60%) · PURGATORY hsl(217 91% 60%)
                    BLISS hsl(142 76% 36%) · NEUTRAL hsl(0 0% 50%)

CHART_SERIES        karma hsl(271 81% 56%) · realm hsl(217 91% 60%)
                    neutral hsl(220 6% 55%)

CHART_CHROME        accent hsl(38 92% 50%) · grid hsl(220 8% 18%)
                    axis hsl(220 8% 18%) · tick hsl(215 8% 57%)
                    tooltipBg hsl(240 13% 7%) · tooltipBorder hsl(220 8% 18%)
```

Any chart palette you propose needs a light variant and must be expressible as literal
values, not variable references.

---

## Base element rules

The only global styling currently in `@layer base`:

- `body` — `bg-canvas`, `text-ink`
- `*` — `border-color: hsl(var(--color-hairline))`
- `a` — `text-ink-muted`, hover to accent, 150ms colour transition
- `button` — 150ms colour transition
- `input, select, textarea` — `bg-surface-1`, `border-hairline`, `text-ink`,
  `placeholder-ink-subtle`

Plus a global focus ring that must be preserved:

```css
:focus-visible {
  outline: 2px solid hsl(var(--color-accent)) !important;
  outline-offset: 2px;
  border-radius: 2px;
}
input:focus-visible, textarea:focus-visible, select:focus-visible {
  outline-offset: 0;
}
```

150ms is the only timing value in the system and there is no easing token.
