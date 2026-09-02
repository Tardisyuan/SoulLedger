# SoulLedger Design System

**`frontend/app/globals.css` is the authority for every number. This file is not.**

That sentence is the whole point of this rewrite. The previous version of this
document was a 259-line hand-maintained mirror of the token system, and by
2026-09-02 it disagreed with the code in six of its nine sections — it
prescribed **Inter** and **JetBrains Mono** (the app ships Archivo, Source
Serif 4 and IBM Plex Mono), **8px and 12px border radii** (every radius token
in the app is `0`), a **14px body** (the scale has no 14px step), a 1280px
container (it is 1200px), and "no shadows, never" (nine `shadow-*` classes
ship). It also said nothing about the four-cosmology hue system, which is the
most distinctive design idea in the product.

None of that was caught by anything, because a document cannot fail a test. Any
agent or contributor told "read DESIGN.md first" would have dutifully
reintroduced Inter, rounded corners and a body size that does not exist. That
is not a stale doc; it is a live instruction to undo deliberate work.

So this file no longer carries values. It carries the reasoning that is **not**
recoverable from the code, and it points at the code for everything else.

---

## Where the real system lives

| What | Where | Notes |
|---|---|---|
| Colour tokens, both themes | `frontend/app/globals.css` | `:root` = dark, `.light` = light. Each block is commented with the measurement behind it. |
| Type scale | `frontend/app/globals.css` `@theme` | `--text-01` … `--text-08`, eight steps, with line-height / tracking / weight attached to each. |
| Font families | `frontend/app/fonts.ts` | Three, each with one stated job. |
| Civilization identity | `frontend/app/globals.css` | `--color-civ-hue-*`, `--color-civ-mark-*`, `--color-civ-ink-*` plus the `[data-civ]` rules. |
| Enforcement | `frontend/src/__tests__/` | `civilizationColourContract`, `inkOnSurfaceContract`, `civIdentityInkContract`, `cssTokenReferenceContract`, `designGuardContract`. These re-derive the claims rather than restating them. |

If a number here would ever contradict one of those files, the file wins and
this document is the bug.

---

## The decisions worth writing down

**Square corners are a decision, not an omission.** Every *shape* radius is `0`
— `--radius` and its eight siblings. The two exceptions are deliberate and
named: `--radius-focus` (2px, the focus ring) and `--radius-full` (a pill,
where the shape carries meaning).
`Badge`'s `shape: "square"` variant emits *no class at all*, because `rounded`
would render `border-radius: 0` and read as a choice that had been made when it
had not. Pills exist only where a shape carries meaning.

**Depth comes from hairlines, not from the surface ladder.** Measured
2026-09-02: adjacent steps of `--color-surface-1..4` differ by 1.02–1.05:1, and
the whole ramp spans 1.14:1 (dark) / 1.22:1 (light), while the hairline against
surface-1 is 1.37:1. The ladder is a near-neutral floor; the 1px rule does the
layering. This is currently a limitation rather than a stance — separating the
ramp was tried and broke 23 pinned ink-on-surface combinations, because the ink
ramp is tuned tightly against the flat surfaces. Making the ladder real means
re-deriving both ramps together, not editing four numbers.

**Three families, one job each** (`frontend/app/fonts.ts`):
Archivo carries the interface, IBM Plex Mono carries identifiers and figures,
and Source Serif 4 carries **things a person said** — the statute corpus, a
soul's confession, the grounds of a judgment. The serif is not decoration; it
marks quoted speech. Do not spend it anywhere else.

**One spelling for a colour token, and it is the bracketed one.**
`text-[hsl(var(--color-ink))]`, never `text-ink`. The bare form silently
generated no CSS after the Tailwind v4 migration — the `@theme` wrapper and the
`:root` triple collided on one name and `@layer base` won, leaving
`color: 210 11% 96%`, which is not a colour. 450 call sites shipped that way
with every gate green. `cssTokenReferenceContract.test.ts` now fails the build
if a bare form comes back. The raw triple has to stay raw: it is what makes
`hsl(… / 0.2)` possible, and hundreds of sites need the alpha.

**Four cosmologies, and they number their own scripture.**
`frontend/src/config/civilizationSigil.ts` is the idea: an Egyptian article is
`§ 27 / 42` because the Negative Confession is a closed tally; a 功過格 article
is a 卷-numbered 門; an Inferno circle is a roman numeral; a Platonic citation
is a Stephanus page. Each tenant also tints its own surface ramp
(`--civ-hue`) and owns a mark (graphics) and an ink (text) — see the long
comment above the civilization block in `globals.css` for why those are two
tokens and not one.

**Reduced motion collapses to 1ms, not `none`.** Base UI waits for
`transitionend` before unmounting a popup; `none` would strand them mounted
forever. The global block in `globals.css` is written that way on purpose.

---

## Reading this file in the future

Every table of values that used to be here has been deleted rather than
corrected, because correcting it would have recreated the same failure on a
slower clock. If you need a number, read `globals.css`. If you need to know why
a number is what it is, the comment beside it says so.
