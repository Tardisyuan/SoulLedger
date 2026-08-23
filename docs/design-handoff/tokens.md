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

**Not tabulated here. `frontend/app/globals.css` is the authority.** Read the
`--color-civ-*` declarations in its `:root` and `.light` blocks, and the
`[data-civ]` rules directly beneath them.

The table that used to sit here listed `--color-civ-cn` / `-eu` / `-eg` as full HSL
triples. Those three tokens do not exist. They were not merely stale values, they
were the wrong *shape*: identity is expressed as two token families now, and
neither is substitutable for the other.

- `--color-civ-hue-<prefix>` is a **bare hue degree** (`12`, `232`, `44`, `88`). The
  `[data-civ]` rules feed it into `--civ-hue`, which surface-1..4 interpolate
  (`hsl(var(--civ-hue) 13% 7%)`). A full triple cannot go in that position.
- `--color-civ-mark-<prefix>` is a **full HSL triple**, for the two places a flat
  civilization colour is still drawn: the 3px rule in a mixed-civilization list, and
  the chart legend.

Re-tabulating corrected values here would not have ended the drift, it would have
started a third copy: a table of triples still cannot drive a surface ramp. So the
table is gone and this section is a pointer.

There are **four** civilizations — Chinese, European, Egyptian and Greek. The old
note that "this three-token set is the entire current expression of civilization
identity" was wrong twice over: wrong about the token set, and wrong about the
count.

`frontend/lib/chart-colors.ts` mirrors `--color-civ-mark-*` as literals because
Recharts cannot read CSS custom properties. That mirror is not a second system —
`frontend/src/__tests__/civilizationColourContract.test.ts` parses `globals.css` and
fails if the two disagree in either direction.

---

## Chart colours

Recharts props (`fill`, `stroke`, `tick.fill`) take concrete values and **cannot read
CSS custom properties**, so `lib/chart-colors.ts` mirrors the tokens as literals. These
are the dark-theme values and they do not follow the `.light` override — which is why
charts stay dark-themed in light mode.

The five maps are `STATE_COLORS`, `CIVILIZATION_COLORS`, `REALM_COLORS`,
`CHART_SERIES` and `CHART_CHROME`. **Read their values from the module, not from
here.** A transcription of them used to sit at this spot and every line of it had
drifted — it still listed five lifecycle states after `SETTLED` was added, still gave
`JUDGING` the accent amber it had been moved off, still named `CHART_SERIES.balance`
as `karma`, and still showed three civilizations.

`STATE_COLORS` and `CIVILIZATION_COLORS` are pinned to `globals.css` by
`frontend/src/__tests__/civilizationColourContract.test.ts` and cannot drift again
without a red test. The other three are not pinned yet — treat their values as
unverified until read from source.

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
