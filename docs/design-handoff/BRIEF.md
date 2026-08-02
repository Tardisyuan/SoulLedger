# SoulLedger — UI/UX Design Brief

**For:** Claude Design
**Attached:** 27 full-page screenshots of the live app (`screens/`), design token inventory (`tokens.md`)
**Date:** 2026-08-02

---

## 1. What this product is

SoulLedger is an internal operations system for managing souls through an afterlife
pipeline across three parallel mythologies. It is a real multi-tenant Django/Next.js
application, not a concept piece — every screenshot attached is the current live UI.

A soul moves through a fixed lifecycle:

```
ALIVE ──▶ JUDGING ──▶ DISPOSED ──▶ REINCARNATING ──▶ (ALIVE, next cycle)
                                        └──▶ LOST
```

Four domain objects carry it:

| Stage | Object | What happens |
|---|---|---|
| 1 | **Soul** | Registered, accrues merit (功德) and demerit (罪业); the balance is its *karma* |
| 2 | **Judgment** | A court convenes, a verdict is rendered (PASSED / FAILED / PURGATORY) |
| 3 | **Disposition** | The verdict is turned into a destination realm; may be eternal |
| 4 | **Reincarnation** | The soul is reborn with a new identity, memory optionally reset |

Cross-cutting: **Dispatch** (transferring a soul between civilizations, requires
approval), **Cross-tenant Judgment** (multiple civilizations judging jointly),
**Workflow** (configurable approval chains), **Death Sync** (ingesting death
registrations from external systems), **Karma** (scoring and statistics).

### The three civilizations

Each is a tenant with its own realms, deities, and judgment method. This is the
product's distinguishing idea and the UI currently expresses almost none of it.

| | Chinese 地府 | European Heaven/Hell | Egyptian Duat |
|---|---|---|---|
| Judge | 阎王 / 十殿阎罗 | Saint Peter, Minos | Osiris, 42 Assessors |
| Method | Ledger of merit and demerit | Divine judgment, confession | Weighing of the heart against Ma'at's feather |
| Realms | 十八层地狱, 六道轮回 | Heaven, Purgatory, Limbo, Hell | Field of Reeds, Ammit's devouring |
| Feel | Bureaucratic, ledger-like, ordered | Judicial, solemn, vertical | Ritual, measured, balance-scale |
| Current colour | Amber `38 92% 50%` | Blue `217 91% 52%` | Purple `271 81% 56%` |

Right now the *only* thing distinguishing them in the UI is that one colour dot.
A user switching tenants sees an identical screen with a different accent.

---

## 2. Who uses it — two modes, please design both

The system has role-based access (ADMIN / JUDGE / OPERATOR / VIEWER). Two working
modes matter, and they want different things. **Please treat these as two distinct
design targets rather than one compromise layout.**

### Mode A — the Operator's console

Processes many souls a day. Repetition is their whole job.

Their pain, concretely: judging 20 souls today means 20 × (open list → open soul →
start judgment → open judgment → render verdict → back) ≈ **60 navigations**. There
is no multi-select anywhere in the app, no bulk action, no keyboard path, and no
"next item" affordance after finishing one.

Wants: density, batch operations or a queue/triage flow, keyboard-first movement,
minimal context switching, the next task always one keystroke away.

### Mode B — the Administrator's view

Coordinates across civilizations, approves dispatches, audits, configures workflows,
manages users/roles/menus.

Wants: cross-tenant comparison, approval queues, exception surfacing, an audit trail
that reads as a narrative rather than a log dump, and configuration screens that don't
feel like raw CRUD over database tables.

---

## 3. Screen inventory

34 routes. Attached screenshots, in flow order:

**Main pipeline** — `03-souls-list`, `25-soul-detail`, `04-judgment-list`,
`05-disposition-list`, `06-karma-stats`
**Cross-civilization** — `07-dispatch-list`, `08-dispatch-propose`, `09-cross-judgments`,
`10-workflow`, `11-death-sync`
**Reference data** — `12-realms`, `13-actors`, `14-organizations`, `15-tenants`
**Administration** — `16-users`, `17-permissions`, `18-menus`, `19-menu-buttons`, `20-audit`
**Overview** — `01-dashboard-overview`, `02-dashboard-karma`
**Peripheral** — `21-notifications`, `22-social`, `23-profile`, `24-welcome`, `00-login`
**Theme check** — `26-dashboard-light` (light mode, same screen as `01`)

---

## 4. What is wrong today

Every item below is visible in the attached screenshots. This is not a wishlist; it
is a defect list.

### 4.1 The pipeline is invisible

The four stages exist as four separate list pages with no connection between them.
Nothing on screen tells a user that judgment follows a soul, or disposition follows
judgment.

`25-soul-detail` is the clearest case: the three lifecycle records (审判记录 / 处置记录 /
轮回记录) render as **three tall empty boxes each saying "暂无记录"**, stacked down the
right half of the page. A soul's history — the single most important thing about it —
is presented as three empty containers rather than a progression. Below them, roughly
40% of the viewport is empty.

**Ask:** design how a soul's journey should read. A timeline, a stepper, a ledger
spread — something where the current stage, what came before, and what comes next are
one glance. And where an empty stage says "not yet" rather than "no data".

### 4.2 No bulk anything

`03-souls-list` — 33 souls, 20 per page, one "查看 →" link per row and nothing else.
No checkbox column, no selection, no bulk bar.

**Decided:** a **queue / triage mode**, not multi-select. Each soul needs individual
consideration — the verdict is a judgement call, not a rubber stamp — so the problem to
solve is the cost of moving *between* items, not the cost of acting on many at once.

**Ask:** design that queue. One soul at a time, everything needed to decide on screen at
once (identity, karma ledger, prior cycles, applicable realm options), verdict controls,
and automatic advance to the next. Cover: how a user enters the queue and how they leave
it, how they skip or defer an item, how they undo a verdict they just gave, how progress
through the queue is shown, and what the keyboard map is. If you think multi-select
should still exist alongside it for genuinely uniform batches, say so and show where.

### 4.3 Dashboard shows nothing worth knowing

`01-dashboard-overview`, with real data:

- 各文明明细 renders **three cards, two of which are completely empty grey boxes** —
  the two tenants with no souls are drawn as blank rectangles.
- 各文明灵魂数 is a bar chart with **one single amber bar** taking the full card.
- 业力分布 is an **empty plot with axes and no data**.
- 地域分布 says 暂无地域数据.
- 最近活动 is **ten identical rows** of "DELETE Role Permission" at the same timestamp —
  no grouping, no dedup, no summarisation.

Four of six panels are empty or degenerate, on a system that does have data. The layout
assumes a mature dataset and collapses without one.

**Ask:** design a dashboard that is informative when data is sparse, uneven, or
concentrated in one tenant. Empty states that carry meaning. And decide what an
operator vs an administrator should actually see first.

### 4.4 The chrome is louder than the content

Header carries, left to right: breadcrumb, a "Connected" websocket pill, a bell, a
**native unstyled `<select>` for language**, a theme toggle, a settings gear, a
greeting string, and a logout link. Eight controls, several purely technical, styled
inconsistently — the language select is visibly a raw browser widget among custom ones.

Sidebar: six collapsed top-level groups occupying the top third, the remaining two
thirds empty, with an odd dark strip at the bottom.

**Ask:** rebuild the shell. What deserves persistent chrome, what belongs in a menu,
what should not be in the UI at all (the websocket status pill is developer
information). Sidebar behaviour when a group is expanded.

### 4.5 Light mode is not a real theme

`26-dashboard-light` vs `01-dashboard-overview`:

- The **sidebar stays dark/amber-tinted** while the rest of the page turns white.
- Chart grid lines, axes and ticks **keep their dark-theme values** — chart colours are
  mirrored as literals in `lib/chart-colors.ts` because Recharts cannot read CSS custom
  properties, so they never follow the `.light` override.
- Pie chart labels **overlap illegibly** ("轮回中 0%" printed on top of "已处置 5%").

**Ask:** a light theme that is genuinely designed, not an inversion. Chart palettes that
work in both. Guidance for label collision at small slice values.

### 4.6 Raw system values leak into the interface

`25-soul-detail` shows a status badge reading **`ALIVE — 存活`** — the raw enum *and* its
translation, side by side. Next to it in the header: **`CHINESE · ? — —`**, a
placeholder string with a literal question mark. 文明 renders as `CHINESE`.

**Ask:** a display convention for domain enums, identifiers, and missing values. When
is a UUID ever shown? What does "not recorded yet" look like versus "zero" versus
"not applicable"? (`03-souls-list` shows a 死亡时间 column that is `—` for every row and
a 业力 column that is `+0` for every row — columns earning no space.)

### 4.7 Deletion lies to the user

Nothing is ever really deleted — the backend flags rows `is_deleted` and filters them out.
The UI says nothing about this. A user presses delete, the row vanishes, and the wording
implies it is gone forever. There is no recycle bin, no restore, and no indication the
record still exists. Recovering anything currently means a direct database query.

**Decided:** build the recycle bin.

**Ask:** design it. Where restore lives (a global bin, or a per-list "show deleted"
toggle, or both), how a deleted row reads when shown, what the delete confirmation should
say now that it is reversible, whether deletions expire, and whether a hard delete exists
at all for administrators. Note deletion applies across most entity types — souls,
judgments, users, roles, menus, organizations — so this needs to be a pattern, not one
screen.

### 4.8 Visual system has drifted

Four different heading sizes, four different border-radius values, two different
action-column treatments across tables, inconsistent card padding, inconsistent empty
states. Some of this was cleaned up recently; the underlying scale was never defined.

**Ask:** a type scale, a spacing scale, a radius scale, elevation rules, and a table
specification (density, alignment, how numbers and status and actions are treated) —
tight enough to be implemented as tokens.

### 4.9 The three civilizations look identical

Covered in §1. Currently one accent colour each and nothing more.

**Ask — this is the highest-value item.** Give each civilization a visual identity that
goes beyond hue: typography treatment, ornament, iconography, how a judgment is
depicted (a ledger vs a courtroom vs a balance scale), how the realm hierarchy is
drawn. It must remain the same product — shared layout, shared components, one
codebase — while feeling like you have entered a different jurisdiction. Please state
explicitly which layer carries the identity (accent only? surfaces? borders?
iconography? illustration?) so it can be built as a theme layer rather than three
separate UIs.

---

## 5. Constraints

**Tech.** Next.js 16 App Router, React, TypeScript, Tailwind CSS, Recharts for charts,
`@xyflow/react` for the workflow node editor, `@headlessui/react` for modals. Server-
rendered pages, no heavy client-side animation budget.

**Tokens.** The app already uses HSL CSS custom properties as semantic tokens (full list
in `tokens.md`). Please express the proposal in the same shape — semantic names, HSL
triplets, light/dark pairs — so it maps directly onto `app/globals.css`. If you need new
token *categories*, name them; don't hand back raw hex scattered through mockups.
Note Recharts cannot read CSS variables, so any chart palette must also be expressible
as literal values.

**Internationalisation.** Three locales: Simplified Chinese (primary, and the language
in every screenshot), English, and `egy` — a stylised transliterated Ancient Egyptian
used for the Egyptian civilization's theming. 886 keys per bundle. All copy is
translated at runtime, so **no text may be baked into layout assumptions** — Chinese
strings are typically 40–60% the width of their English equivalents, and `egy` strings
run longer than both. Some `egy` strings include hieroglyphic characters (𓋴𓂀𓍯) and the
locale label mixes scripts.

**Accessibility.** A baseline was just established and must not regress: every form
control has an accessible name, validation errors are announced via `role="alert"`
with `aria-describedby`, there is a global `:focus-visible` accent ring, and all text
colours meet WCAG AA against their surfaces (several tokens were lightened
specifically to clear 4.5:1 — see the comments in `tokens.md`). Please keep contrast
ratios in the proposal and don't rely on colour alone to convey state.

**Data reality.** Tenants are unevenly populated — one civilization may hold every soul
while others hold none. Tables paginate at 20 server-side. Some endpoints return empty
or 404 in the current environment. Designs must hold up at n=0, n=1 and n=10,000.

---

## 6. What we would like back

1. **Design system foundation** — type scale, spacing, radius, elevation, border and
   surface rules, as named tokens with light/dark values.
2. **Component specifications** — table/data grid (the single most used component),
   status badge, card, modal, form field, empty state, pagination, filter bar, chart
   family.
3. **The shell** — sidebar and header redesigned, both modes.
4. **Mode A screens** — the souls list, and the judgment queue (§4.2) with its entry,
   skip, undo and progress states.
5. **Mode B screens** — dashboard, an approval/dispatch queue, and the audit view.
6. **The soul lifecycle view** — §4.1, the piece that makes the product legible.
7. **Deletion and restore** — §4.7, as a reusable pattern across entity types.
8. **The three civilization themes** — applied to at least the souls list, a soul
   detail, and the judgment queue, so the difference is demonstrable.
9. **Rationale** — where you departed from the current design and why. Push back on
   anything in this brief you think is wrong.

---

## 7. Reading the screenshots

Captured at 1440×900, 2× density, full-page, logged in as an administrator (so every
permission-gated control is visible), Simplified Chinese, dark theme except
`26-dashboard-light`. The data is a development dataset: names like "Debug Soul" and
"Trace Soul 5" are test fixtures, and the repetitive audit entries in `01` are real
output, not a rendering fault.
