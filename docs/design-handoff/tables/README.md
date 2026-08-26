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

`egy` is now Latin transliteration throughout. **No RTL anywhere** —— 2026-08-26 实测:
`messages/egy.json` 的 1275 条里阿拉伯字符 **0 个**。这一条成立,如果你已经为双向文本
画过草图,可以丢掉。

**但「三条带圣书体作装饰」和「区域标签是 `𓋴 Kemet`」这两句已经不成立了**,
`BRIEF.md` §5 里的同一句话也一样。实测:三份 bundle 里 U+13000–U+1342F 区段的字符
**0 个**,区域标签现在是纯文本 `Kemet`(`src/contexts/I18nContext.tsx:25`)。
`𓋴`(U+132F4)在 `7bd1e8c` 被删掉,理由写在该文件的注释里:它需要一个 Windows 与 Linux
默认都不装的字体,在大多数机器上渲染成豆腐块,而它旁边两个区域标签本来就是不带字形的
纯词。**不要为一个不存在的字形留位,也不要指定圣书体字库。**

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

1. **`egy` dates render in English.** 结论仍然成立,但**机制不是本文档此前写的那个**。
   原文说「`egy` 不是合法的 BCP-47 标签,传给 `Intl.DateTimeFormat` 会抛 `RangeError`」——
   两半都是错的。2026-08-26 实测(node 18.20.8 / ICU 74.2 与 22.22.1,
   `DateTimeFormat` 与 `NumberFormat` 都测):

   ```
   Intl.getCanonicalLocales("egy")   →  ["egy"]     合法,三字母语言子标签
   new Intl.DateTimeFormat("egy")    →  不抛
   new Intl.DateTimeFormat("e_gy")   →  才抛 RangeError
   ```

   真实行为比抛错更值得知道:没有 `egy` 的 ICU 数据时,它回退到**观看者的系统默认
   区域**,不是 `en`。`LANG=de-DE` 下 `new Intl.DateTimeFormat("egy")` 解析为 `de-DE`,
   把 1970-01-01 渲染成 `1. Januar 1970`;`zh-CN` 下渲染成 `1970年1月1日`。

   界面之所以稳定显示英文,是因为 `src/contexts/I18nContext.tsx` 里有一张
   `INTL_LOCALE` 表把 `egy` 显式映射到 `en`。那张表不是便利,它是唯一挡住「日期跟着
   用户的操作系统变语言」的东西 —— 而它自己的注释此前也写着同一句错话,已一并更正。

   给设计的结论不变:任何依赖日期与周围文字同script的设计,在 `egy` 下都不成立。

2. **`description` and `resource` are backend strings.** `CREATE Login Log`,
   `loginlog#190` — English and identifiers, in every locale, and they will not be
   translated. Roughly a third of the widest table is untranslatable content.
