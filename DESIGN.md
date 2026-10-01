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
| Colour tokens, both themes | `frontend/app/globals.css` | `:root` = dark, `.light` = light. The palette is spec v1 "账簿 × 卷宗" (`a2044b28`, 2026-09-24); `ledgerPaletteContract` holds each token to the spec's hex. |
| Type scale | `frontend/app/globals.css` `@theme` | Eight steps — `text-2xs` 11 · `xs` 12 · `sm` 13 · `md` 15 · `lg` 20 · `xl` 28 · `display` 40 · `display-lg` 56 (px), each with its line-height attached. Which step a heading uses is the next section, not a choice per page. This row is checked against `globals.css` by `designGuardContract` — it said "seven steps, 16 / 22px, a `quote` step" for a month after all three stopped being true. |
| Font families | `frontend/app/fonts.ts` | Three, each with one stated job. |
| Civilization identity | `frontend/app/globals.css`, `[data-civ="…"]` | One colour per civilization, `--color-civ-cn` / `eu` / `eg` / `gr` (spec v3 values), and it enters through **one** declaration: each `[data-civ]` rule sets `--color-main` from its civ token, and `--color-main` paints the plaque, the navigation's current item (a 3px mark and an 8% tint over surface-1 — the nav itself is neutral since v3), the seal, the primary button and the row's "mine" mark. Nothing else reads a civ token — `ledgerPaletteContract` asserts it. The same rule also picks the plaque's band, seal artwork and display face. (v1 removed this layer in `a2044b28`; spec v2 brought it back narrowed to that one route, and v3 kept the route and changed the colours.) |
| Enforcement | `frontend/src/__tests__/` | `ledgerPaletteContract`, `inkOnSurfaceContract`, `cssTokenReferenceContract`, `designGuardContract`, plus the seven `design-system/*` rules in `frontend/eslint.config.mjs:663-671`. These re-derive the claims rather than restating them. (`civilizationColourContract` and `civIdentityInkContract` went with the civ tokens.) |

If a number here would ever contradict one of those files, the file wins and
this document is the bug.

---

## The decisions worth writing down

**Square corners are a decision, not an omission.** The default *shape* radius is `0`
— `--radius` and its seven siblings. Spec v3 (2026-10) added exactly two non-zero
steps, each with a written job: `--radius-control` 4px for inputs and filter chips,
`--radius-panel` 8px for dialogs. **Buttons stay square** — the v3 token table says
"inputs and small controls", the v3 component prototype draws square buttons, and on
2026-10-01 the prototype won; `Button.tsx` says so beside its `size` block. Pills remain
the other exception, for avatars and spinners only, in the files listed in
`ROUND_ALLOW` (`frontend/eslint.config.mjs`). The focus ring went square with
spec v1 (`e78e5d88`), and `--radius-focus` was deleted with it.
`Badge`'s `shape: "square"` variant emits *no class at all*, because `rounded`
would render `border-radius: 0` and read as a choice that had been made when it
had not. Pills exist only where a shape carries meaning.

**Headings: the step follows the role, not the tag.** This is the one table of
values this file keeps, because "which step is a level-two heading" has no single
place in the code to read it from — the answer is spread across the shell, two
guards and a component. It is not hand-maintained: `designGuardContract` reads
every row below and checks the step, size, line-height and weight against
`globals.css`, so a row that drifts is a red build, not a stale paragraph.

| 角色 | 标签 | 写法 | 字号 / 行高 px | 字重 | 字体 | 由谁守 |
|---|---|---|---|---|---|---|
| 页面标题 | `<h1>`,每页一个 | `text-lg` | 20 / 28 | 600 | 界面字体 Archivo + Noto Sans SC | `PageShell.test`「页面标题」 |
| 封面标题(只在首页;md 起 28 / 36) | `<h1>` | `text-lg md:text-xl` | 20 / 28 | 600 | 界面字体 | 同上 |
| 匾题字 · 第一档 | 匾里的 `<Title>` | `text-display` | 40 / 48 | 400 | 文明题字字体 | `plaqueTitleStaysLargeText` |
| 匾题字 · 第二档 | 同上,第一档放不下时 | `text-xl` | 28 / 36 | 400 | 文明题字字体 | 同上 |
| 匾题字 · 第三档 | 同上,第二档还放不下时 | `text-lg` | 20 / 28 | 600 | 界面字体,最多两行 | 同上 |
| 面板标题 | `<h2>` 或 `<h3>` | `text-lg` | 20 / 28 | 600 | 界面字体 | `PageShell.test` h2 / h3 |
| 列表行标题 | `<h2>` 或 `<h3>` | `text-sm font-medium` | 13 / 20 | 500 | 界面字体 | 同上 |
| 区块标签 | `<h2>` 或 `<h3>` | `text-2xs uppercase`,不带 `font-mono` | 11 / 16 | 400 | 界面字体 | 同上 |
| 眉题 | 壳的 `eyebrow`,不是标题 | `text-2xs font-mono uppercase` | 11 / 16 | 400 | IBM Plex Mono | `PageShell.test` |
| 正文 | `<p>` | `text-sm` | 13 / 20 | 400 | 界面字体 | — |
| 展示数字 | 当前判决、本世余额 | `text-display-lg` | 56 / 62 | 600 | 界面字体 | 尚无调用点 |

Three things this table does on purpose:

- **A level-two heading has no single size, and that is the rule, not a gap.**
  The same row title is an `<h2>` on a page with no intermediate panel and an
  `<h3>` inside one; that is outline depth, not how large the words should be.
  Tying the step to the tag would put back the coupling `PageShell.tsx` rule 4
  took apart. So the question "how big is an h2" has three answers, one per role.
- **The section label is 11px and smaller than body text.** It is a label —
  uppercase, 0.1em tracking, subtle ink — that sits *above* a card or chart, not
  a title competing with it. Spec v3 names the 11px step "micro-label".
  Its weight is 400: `--text-2xs` has carried no weight since `16f4e149` (spec v1
  §1.4); the 600 that `PageShell.tsx` used to cite belonged to the old `--text-01`.
- **The plaque title is the one heading that changes step at runtime.** It
  measures its own width and steps down 40 → 28 → 20; every step stays WCAG
  large text, because in the dark theme the Egyptian and Greek plaque colours
  carry white text at only 3.99:1 and 4.16:1.

Font families per civilization for the plaque: neutral → Source Serif 4, 地府 →
Ma Shan Zheng, Europe → UnifrakturMaguntia, Egypt → Josefin Slab, Greece → Cinzel
(`globals.css`, `[data-civ]`). They are display faces for the plaque only.

**Settled 2026-10-01** (each was an open question in the first version of this table):

- **Panel titles are 20px**, following spec v3's "module title". That puts a panel
  title at the same size and weight as the page title. The page title is still
  told apart — it is the first thing on the page, it sits in the shell's header
  band, and there is one of it — but size no longer does that work. Fourteen
  headings moved from `text-md` to `text-lg`, including the home hero's subtitle,
  which is therefore as large as the hero itself on a phone.
- **Section labels are set in the interface face.** It was 24 interface / 11 mono;
  the 11 dropped `font-mono`, and the guard now rejects it on a label. Monospace
  stays with the shell's eyebrow, which is not a heading.
- **The home hero keeps 28px** and is a named role, "cover title", that may appear
  only in `app/page.tsx` — not an exemption waiting for a decision.

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
`text-[oklch(var(--color-ink))]`, never `text-ink`. The bare form silently
generated no CSS after the Tailwind v4 migration — the `@theme` wrapper and the
`:root` triple collided on one name and `@layer base` won, leaving
`color: 0.97 0.0017 247.8`, which is not a colour. 450 call sites shipped that way
with every gate green. `cssTokenReferenceContract.test.ts` now fails the build
if a bare form comes back. The raw triple has to stay raw: it is what makes
`oklch(… / 0.2)` possible, and hundreds of sites need the alpha. The triple is
OKLCH since `7db2c6e` (2026-09-09); wrapping it in `hsl()` the old way clamps
lightness to 100% and paints white, with every gate green.

**Four cosmologies, and they number their own scripture.**
`packages/core/src/config/civilizationSigil.ts` is the idea: an Egyptian article is
`§ 27 / 42` because the Negative Confession is a closed tally; a 功過格 article
is a 卷-numbered 門; an Inferno circle is a roman numeral; a Platonic citation
is a Stephanus page. Numbering is one of two visual differences; the other is
the narrow colour-and-plaque route described in the table above. What v1 removed
in `a2044b28` (a per-tenant surface tint `--civ-hue`, separate mark and ink) has
not come back: surfaces, ink and every status colour are shared by all four.

**Reduced motion collapses to 1ms, not `none`.** Base UI waits for
`transitionend` before unmounting a popup; `none` would strand them mounted
forever. The global block in `globals.css` is written that way on purpose.

---

## Reading this file in the future

Every table of values that used to be here has been deleted rather than
corrected, because correcting it would have recreated the same failure on a
slower clock. If you need a number, read `globals.css`. If you need to know why
a number is what it is, the comment beside it says so.
