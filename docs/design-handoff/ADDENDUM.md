# Addendum to the design brief

`BRIEF.md` and the screenshots in `screens/` were assembled on 2 August 2026.
Everything below landed after that and is not reflected in either. Read the
brief first; this only adds.

Four items. The first two give you material the brief asked you to invent; the
third corrects an assumption the brief invites you to make; the fourth is new
scope — the brief's `17-permissions`/`18-menus`/`19-menu-buttons` screens,
which this section grounds in the system as it now actually behaves.

---

## 1. The three civilizations now differ in the data, not just the theme

`BRIEF.md` §4.9 says the three cosmologies look identical and asks you to fix
that. When it was written there was nothing underneath to work with — the same
karma number was rendered three ways with different colours.

That is no longer true. `backend/apps/ledger/readings.py` gives each cosmology
its own reading, and the three are **structurally different quantities**, not
one number in three costumes:

| civilization | what the ledger says | shape |
|---|---|---|
| China | A cumulative account. Merit and demerit offset each other; the running total *is* the answer. | one signed number, meaningful over time |
| Egypt | A threshold test. The heart weighed against a fixed counterweight — it passes or it does not. | binary, with a distance-from-threshold |
| Europe | Two unrelated numbers. Guilt and penalty are separate facts here; neither reduces the other. | two independent quantities, side by side |

Design implication, and it is the point of §4.9: **these need three different
presentations, not one component with a variant prop.** A running balance wants
a trend. A threshold wants a pass/fail with proximity. Two independent numbers
want to stay visually independent — the moment they are stacked in one bar or
netted into a total, the European model has been silently converted into the
Chinese one.

The screenshots in `screens/` predate this and still show the single-number
treatment everywhere.

---

## 2. Souls now carry date warnings — no screenshot shows this

`backend/apps/souls/dates.py` validates each soul's dates against its records
and produces problems at two severities, **error** and **warning** (for example
a death date preceding a birth date, or a karma record dated outside the life it
belongs to). These surface on both the soul list and the soul detail page.

Nothing in `screens/` shows any of it, because none of it existed when the
captures were taken. What needs designing:

- the two severity levels, distinguishable without relying on colour alone (see
  the accessibility baseline in `BRIEF.md` §5)
- a soul carrying **several** problems at once — the common case for imported
  historical records
- how a flagged soul reads in the **list**, where there is one row and no space,
  versus the **detail** page, where there is room to explain
- what an operator can actually do about it, if anything — a warning with no
  available action is just decoration

---

## 3. The main navigation is database content, not translated copy

`BRIEF.md` §5 says "All copy is translated at runtime." That is true of the
interface, and **not true of the navigation**.

Menus come from the backend `Menu` model (`backend/apps/menus/models.py`), so
menu labels are rows in a database, not entries in a locale bundle. §5 does
mention that database content stays Chinese in every locale, but it illustrates
that with table rows, which reads as a detail about data grids. It is bigger
than that.

See `tables/audit-en.png`, already in this package: locale is English, the page
title reads "Audit Log", the column headers are English — and the entire left
sidebar is still 概览 / 灵魂业务 / 流程协作 / 组织与领域 / 社交 / 系统设置.

**Design for a permanently mixed-language chrome**: Chinese navigation wrapped
around a localized interface, in every non-Chinese locale. Do not assume a page
can be uniformly one language, and do not size the sidebar from English or `egy`
strings — those labels will always be the Chinese ones, which are the narrowest
of the three (see `tables/README.md` for measured widths).

---

## 4. Permission enforcement is now real — design `17-permissions`, `18-menus`, `19-menu-buttons` against the actual system

The previous version of this section said "nothing to design against yet;
policy is still being settled." That is no longer true. Enforcement shipped
across seven apps including `menus` this week, and the model below is what
production actually checks — not a proposal.

**The shape.** Three tables: `Role` (name, display_name, an optional `parent`
for hierarchy, a `scope` of GLOBAL or ORG, and — for ORG-scoped roles — an
`organization`), `Permission` (a dotted `codename` like `menu.read`, a `name`,
a `category` used only for grouping), `RolePermission` (the grant, joining the
two). **40 codenames across 16 categories** exist today:
`actors, audit, cross_judgment, dashboard, dispatch, disposition, judgment,
ledger, menu, notification, realms, reincarnation, soul, system, user,
workflow`. `17-permissions` is the screen that manages this join table
directly — think a two-pane matrix (roles × codenames), not a form.

**Five roles, and they are not a simple ladder.** ADMIN, MODERATOR, JUDGE,
GUARDIAN, VIEWER. MODERATOR is a late addition — a "realm lead" scoped to one
tenant/civilization rather than global, which is why `Role.scope` and
`Role.organization` exist. It sits ABOVE JUDGE on operational codenames
(`workflow.escalate`, `dispatch.approve`) but deliberately below it on nothing
— design the role list as five peers with different territories, not a strict
vertical hierarchy with ADMIN on top and VIEWER on the bottom rung of one
ladder.

**Menus, specifically.** `menu.read` is held by all five roles (see it or the
app has no navigation); `menu.manage` — create/update/delete a menu entry or
button — is ADMIN-only, no exceptions. So `18-menus` and `19-menu-buttons` are
asymmetric by design: every role can see the tree, only one can edit it. Two
`Menu` fields matter beyond the name: `icon` is free-text, blank-defaulting,
and not unique per parent — in `en`/`egy` locales it is the only reliably
readable channel once the label itself is Chinese (§3 above), so a blank icon
is currently an unidentifiable nav item and worth a required-field treatment
in the edit form even though the database doesn't enforce it. `roles` is a
field on `Menu` controlling which roles see an entry at all — that's a second,
coarser gate above the `menu.read`/`menu.manage` codename split, and the admin
editor needs a control for it distinct from the codename picker.

**One finding for the `17-permissions` bulk-assign flow specifically.** The
assign endpoint (`POST /perm/role-permissions/assign/`) is a full REPLACE, not
a diff — submitting an empty selection for a role wipes every permission it
holds, in one call, with no confirmation step today. Whatever `17-permissions`
designs for "edit this role's grants" should treat an empty-or-shrinking
selection as a destructive action requiring confirmation, the same category as
a delete, not as an ordinary form save.

Not yet decided on our side, so don't design a final answer, but worth
building room for: `cross_judgment.*` was reassigned this week from GUARDIAN
to JUDGE (cross-tenant judgment is a judgment activity), which is the kind of
per-codename reassignment `17-permissions` will need to make routine rather
than exceptional — expect this table to keep changing shape as policy
settles, not just as data changes.

---

## 5. There is a fourth civilization, and its reading is a fourth shape

§1 above says "the three civilizations" and gives a three-row table. That is now
out of date, and not by a theme — by a structural kind.

Greek was split out of European (`Civilization.GREEK`). It had been hiding
inside it: seven of the eleven European actors were Greek, three of them judges,
which is why `EUROPEAN_GREEK` templates and Plato's meadow kept sitting oddly in
a Dante-shaped model. `backend/apps/ledger/readings.py::_greek_reading` now
gives it its own reading, and §1's table needs a fourth row:

| civilization | what the ledger says | shape |
|---|---|---|
| Greece | **A term served.** Every wrong is repaid tenfold, reckoned in circuits of a thousand years (Plato, *Republic* X 615a-b). Not a balance, not a threshold — elapsed time against a debt of time. | a quantity owed, and a quantity served |

### The hard part: the number that matters cannot be shown

`elapsed_years` is `null`, and it is not null because a query has not been
written. The ledger records **when a deed happened**, never when a sentence
began or how much of it has run. Deriving a start from the death date was
considered and refused — it would invent the beginning of a term this system has
never actually started counting.

So this is a reading whose *deciding* quantity is structurally absent. Europe
has an absence too (`poena`), and they are not the same absence, which is the
design question:

- **Europe's** missing quantity has no rule. Penance owed after absolution is a
  fact the ledger has no concept of.
- **Greece's** missing quantity has a rule and no clock. We know exactly what
  would be measured; nothing is measuring it.

### What is on screen today, and why

Rather than invent a form, the panel currently borrows §1's European grammar —
a dashed rule, an em-dash where a number would go, and no shared axis between
the two halves, so the absence can never read as a zero that offsets the debt.
That reuse was deliberate, not a default, and it is exactly the decision worth a
second opinion.

Current copy (`souls.detail.reading.*`, all three locales):

```
Term owed        4
                 recorded wrongs · repaid 10-fold
Requited         2
                 recorded benefactions · repaid 10-fold
                 Reckoned in circuits of 1000 years — the unit of
                 repayment, not the length of either road.
- - - - - - - - - - - - - - - - - - - - - - - - -
Served           —
                 Not recorded in this ledger
                   · When the term began
                   · How much of it has been served
```

**The panel now carries two roads, and this changed after the Stage 8 brief
went out.** `_greek_reading` modelled only the punished road; Republic X 615b
sends the just up the right-hand road repaid by the same measure, so the payload
gained `benefactions` beside `wrongs`. Both are counts of deeds, not sums.

Three things follow for the design, and they are constraints rather than
suggestions:

- **The two roads never combine.** No difference, no sum, no ratio, nothing
  derived from both. They are parallel repayments; a figure computed from the
  pair converts Greece into the Chinese netting model, which is the one thing
  this reading exists to avoid.
- **One rule, one clock, shown once.** There is a single `repayment_multiple`
  and a single `circuit_years` — 615b says *the same measure* — and a single
  elapsed absence. Both roads leave the same judgment and meet on the same
  meadow after the same thousand years. Drawing a second multiple, a second
  circuit or a second em-dash would assert facts the source does not have.
- **An empty road is `0`, not `—`.** A soul with no benefactions has a known
  quantity of them. The em-dash is reserved for the clock, which is the one
  thing the ledger genuinely does not know.

The ledger heading for this cosmology is **Sentence to be Served** /
偿还刑期 / Renpet Wehem, beside China's 功过格 and Egypt's 称心.

### What needs designing

- **Does a term-served want Europe's form at all?** Two absences with different
  causes are currently drawn identically. If they should differ, the difference
  has to be legible without a caption.
- **A count of events, not a weight.** Greece counts *how many wrongs*, not how
  heavy — the system's severity scale is deliberately not used here. Every other
  cosmology's headline number is a magnitude. A count that looks like a magnitude
  invites the wrong comparison.
- **The thousand years is a unit, not a length.** The obvious rendering —
  "sentenced to 1000 years", a progress bar, a percentage — is wrong three times
  over: the term's length is unknown, the elapsed portion is unknown, and the
  circuit is the measure rather than the sentence. There is no denominator.
- **Never multiply.** `wrongs × 10` is not computed anywhere on purpose. Tenfold
  repayment is a rule; a product reads as a balance, which is the Chinese model
  again.
- **The em-dash is `aria-hidden`, and the sentence under it does the talking.**
  It shipped with an `aria-label` set to the same catalogue key as that
  sentence, so a screen reader announced the explanation twice — once as the
  value, once as itself. Raised in review and corrected. Whatever replaces the
  glyph must leave that sentence in the reading order and must not re-acquire a
  name of its own; the position must never read as *zero* (see `BRIEF.md` §5).
- **§1's warning now applies four ways.** Four structurally different readings
  are not one component with a variant prop — and the fourth is the one whose
  main number is missing, which is the case a shared component will quietly get
  wrong.

Nothing in `screens/` shows any of this; the captures predate all four readings.

---

## 6. Greek has no colour, and the colour docs describe tokens that no longer exist

Two findings from the Stage 8 review, both back to you because both are colour
decisions. Neither is fixed in code; this section is the whole record.

### Greek is live and renders in the default hue

`app/globals.css` drives per-tenant surfaces from `--civ-hue`, switched by a
`[data-civ]` rule:

```css
[data-civ="cn"] { --civ-hue: var(--color-civ-hue-cn); }   /* 12  */
[data-civ="eu"] { --civ-hue: var(--color-civ-hue-eu); }   /* 232 */
[data-civ="eg"] { --civ-hue: var(--color-civ-hue-eg); }   /* 44  */
```

There is no `gr`. A Greek tenant falls through to the base `--civ-hue: 240`,
which sits **eight degrees from European's 232** — so the two cosmologies render
as very nearly the same application. Nothing errors; they are simply alike, and
the rule §1 of this addendum was written to enforce ("keep hues far apart") is
being broken by omission rather than by choice.

`lib/chart-colors.ts::CIVILIZATION_COLORS` is keyed by tenant code —
`CN_DIYU`, `EU_HEAVEN_HELL`, `EG_DUAT` — and has no `GR_HADES`, so any chart
that colours by civilization hands Greek an `undefined`.

**What is needed:** one hue for Greece, far from 12, 44 and 232, plus the
matching `--color-civ-mark-gr` triple and a `CIVILIZATION_COLORS` entry. The
constraint is the existing one and there is now one more hue competing for
space.

### The colour documentation mirrors a token set that was deleted

`tokens.md` §Civilization identity documents `--color-civ-cn` / `-eu` / `-eg`
with the values `38 92% 50%`, `217 91% 52%`, `271 81% 56%`, and closes with
"This three-token set is the entire current expression of civilization
identity."

Grepping the frontend for those three names returns nothing. `globals.css`
carries `--color-civ-hue-*` and `--color-civ-mark-*` instead, and the values
disagree as well — amber/blue/purple in the document, `12 / 232 / 44` in the
stylesheet. `CIVILIZATION_COLORS` still carries the document's values and its
comment still says "mirrors `--color-civ-*`", naming tokens that are not there.

So there are two colour systems: the live one in `globals.css`, and a second one
described identically in `tokens.md` and `chart-colors.ts` that nothing checks
against it. Which is authoritative is a question for you — the stylesheet is
what ships, but the chart palette is what a reader of `tokens.md` would build
against, and neither knows about the other.

**What is needed:** a decision on which set is real, and — whichever way it
goes — the other updated to match, so the fourth civilization is added once
rather than to two systems that will drift again.
