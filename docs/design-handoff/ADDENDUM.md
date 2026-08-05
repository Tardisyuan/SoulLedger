# Addendum to the design brief

`BRIEF.md` and the screenshots in `screens/` were assembled on 2 August 2026.
Everything below landed after that and is not reflected in either. Read the
brief first; this only adds.

Three items. The first two give you material the brief asked you to invent; the
third corrects an assumption the brief invites you to make.

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

## Heads-up, not yet a design task

Permission enforcement is being switched on across the backend. Today the server
permits essentially everything to everyone regardless of role, which is why the
screenshots taken as different roles look so similar. As that lands, **what a
given role sees will genuinely start to differ** — navigation included, since
menu visibility becomes permission-gated.

Nothing to design against yet; the policy per role is still being settled. But
if you are choosing between a navigation design that degrades gracefully when
half its entries are absent and one that assumes a fixed set, choose the former.
