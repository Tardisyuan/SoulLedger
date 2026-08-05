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
