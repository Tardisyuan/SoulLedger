# Real table content in three locales

Requested for Stage 2: the widest tables in the app with genuine content, rendered in
every locale. Captured from the live app, administrator login, 1440px wide, full page.

```
permissions-zh-Hans.png   permissions-en.png   permissions-egy.png
audit-zh-Hans.png         audit-en.png         audit-egy.png
strings.json              headers + first 12 rows, verbatim
```

---

## Correction to the brief

**§5 of BRIEF.md describes `egy` as "a stylised transliterated Ancient Egyptian". That is
only mostly true, and the exception matters for table design.**

41 of the 886 `egy` strings (4.6%) are **Arabic**, not transliteration — and they are
concentrated in the highest-traffic UI strings:

| key | value |
|---|---|
| `common.close` | إغلاق |
| `common.cancel` | إلغاء |
| `common.save` | حفظ |
| `auth.login` | تسجيل الدخول |
| `nav.user_profile` | ملف المستخدم |
| `menus.title` | إدارة القائمة |

The locale's own display label is `𓋴 العربية` — hieroglyph plus the Arabic word for
"Arabic". Three strings also carry hieroglyphic characters.

So `egy` is not one script running long. It is **Latin transliteration, Arabic, and
hieroglyphs in the same bundle**, and Arabic is right-to-left. Whether that is intended
is an open question on our side, but it is what ships today, so the component set has to
survive it.

---

## What the captures show

### permissions — 4 columns

| locale | headers | header chars |
|---|---|---|
| zh-Hans | 代码 \| 名称 \| 分类 \| 操作 | 8 |
| en | Code \| Name \| Category \| Action | 22 |
| egy | الرمز \| الاسم \| الفئة \| Aha Seth | 23 |

Three of the four `egy` headers are Arabic; the fourth is transliteration. The action
cells are Arabic too (`تعديل صلاحية` / `حذف صلاحية`).

**The row data does not translate.** Permission names come from the database, not the
message bundles, so `查看角色` and `创建跨域审判` stay Chinese in all three locales. An
`egy` permissions table therefore renders **Arabic headers over Chinese data with Latin
identifiers in column one** — three scripts and two directions in one grid.

Longest cell per column (characters):

| locale | code | name | category | action |
|---|---|---|---|---|
| zh-Hans | 21 | 6 | 14 | 8 |
| en | 21 | 6 | 14 | **32** |
| egy | 21 | 6 | 14 | 22 |

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
