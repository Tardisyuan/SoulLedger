# Real table content in three locales

Requested for Stage 2: the widest tables in the app with genuine content, rendered in
every locale. Captured from the live app, administrator login, 1440px wide, full page.

```
permissions-zh-Hans.png   permissions-en.png   permissions-egy.png
audit-zh-Hans.png         audit-en.png         audit-egy.png
strings.json              headers + first 12 rows, verbatim
```

---

## Note on a bidi problem that no longer exists

An earlier version of this file reported that 41 of the 886 `egy` strings were **Arabic**
— right-to-left — sitting in the highest-traffic UI slots (`common.close`,
`common.cancel`, `common.save`, `auth.login`, `nav.user_profile`, `menus.title`), and
that the locale's own label read `𓋴 العربية`, literally "Arabic". The conclusion at the
time was that the component set would have to survive right-to-left runs inside a
left-to-right grid.

**That has been fixed rather than designed around.** Arabic reached Egypt roughly 1400
years after the period this locale evokes, so it was simply wrong. All 41 strings are now
transliterated Egyptian consistent with the rest of the bundle, and the locale label is
`𓋴 Kemet` — what ancient Egypt called itself.

`egy` is now what §5 of the brief always claimed: Latin transliteration throughout, with
three strings carrying hieroglyphs as ornament. **No RTL anywhere.** The captures in this
directory are post-fix. If you already sketched around bidirectional text, you can drop
it.

---

## What the captures show

### permissions — 4 columns

| locale | headers | header chars |
|---|---|---|
| zh-Hans | 代码 \| 名称 \| 分类 \| 操作 | 8 |
| en | Code \| Name \| Category \| Action | 22 |
| egy | Medu \| Ren \| Rekhet \| Aha Seth | 21 |

**The row data does not translate.** Permission names come from the database, not the
message bundles, so `查看角色` and `创建跨域审判` stay Chinese in all three locales. An
`egy` permissions table therefore renders **transliterated headers over Chinese data with
Latin identifiers in column one** — still two scripts in one grid, just one direction now.

Longest cell per column (characters):

| locale | code | name | category | action |
|---|---|---|---|---|
| zh-Hans | 21 | 6 | 14 | 8 |
| en | 21 | 6 | 14 | **32** |
| egy | 21 | 6 | 14 | 25 |

Note columns one to three are identical across all three locales — they are database
content and identifiers. Only the action column moves, and it quadruples.

### audit — 6 columns, the widest table in the app

| locale | headers | header chars |
|---|---|---|
| zh-Hans | 时间 \| 用户 \| 操作 \| 资源 \| 描述 \| IP | 12 |
| en | Timestamp \| User \| Action \| Resource \| Description \| IP | 40 |
| egy | Seped Sethet \| Netjer \| Aha Seth \| Sethet Wu \| Medu Seth \| IP | 46 |

**Headers run 3.3× (en) and 3.8× (egy) the Chinese width.** This is the failure mode to
design against: a header row laid out to fit Chinese has no room in the other two.

Timestamps also change width with locale, because they now go through `Intl`:

| locale | rendered |
|---|---|
| zh-Hans | `2026年8月2日 21:10:45` (18) |
| en | `Aug 2, 2026, 9:10:45 PM` (23) |
| egy | `Aug 2, 2026, 9:10:45 PM` (23) — falls back to `en`, see below |

Longest cell per column (characters):

| locale | time | user | action | resource | description | ip |
|---|---|---|---|---|---|---|
| zh-Hans | 18 | 6 | 2 | 20 | 24 | 13 |
| en | 23 | 6 | 7 | 20 | 24 | 13 |
| egy | 23 | 6 | 10 | 20 | 24 | 13 |

Note the action column: 2 characters in Chinese (`创建`), 10 in egy (`Kheme Seth`). A
five-fold swing in the narrowest column.

---

## Two things that will not localise

1. **`egy` dates fall back to English.** `egy` is not a valid BCP-47 tag — passing it to
   `Intl.DateTimeFormat` throws `RangeError` — so date and number formatting maps it to
   `en`. Anything you design that depends on the date matching the surrounding script
   will not hold in `egy`.

2. **`description` and `resource` are backend strings.** `CREATE Login Log`,
   `loginlog#190` — English and identifiers, in every locale, and they will not be
   translated. Roughly a third of the widest table is untranslatable content.
