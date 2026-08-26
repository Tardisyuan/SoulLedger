# Design token inventory

Everything below is the **current** state, extracted from `frontend/app/globals.css`
and `frontend/lib/chart-colors.ts`. It is the starting point for the redesign, not a
constraint on it.

> **上次与 `globals.css` 对账:2026-08-26。** 这份文档声明自己是**当前态**,所以它有
> 义务和代码对得上 —— 那次对账发现 31 行表格里 **21 行的值是错的**(不只是过期,
> `surface-1..4` 是**形状**变了:改成插值 `var(--civ-hue)`),外加两个从未登记的 token
> 和五段描述**已解决问题**的说明。全部已修正。
>
> 同目录的 `tokens.html` **不适用这条**:那一页顶部明写自己是「point-in-time snapshot,
> not a reference … Do not build against this page」,是**刻意冻结**的评审材料。
> 它里面的旧值是记录不是错误,不要去「修正」它。两份文件的意图相反,别混着读。

Format is `H S% L%` (bare HSL triplets, consumed as `hsl(var(--token))`), which lets
opacity be applied as `hsl(var(--token) / 0.2)`.

---

## What exists

> **2026-08-26 · 这一节曾经是这份文档的核心请求,现在它描述的状态已经不存在。**
> 原文说「五套 scale 全都没有,请全部提案」,并把「四个标题字号、四种圆角」列为病症。
> 那在 2026-08-23 是真的。Stage 11 之后**四套已经落地**,病症也不复存在 ——
> 若照原文行事,会去设计一套已经建成的系统。原文保留在下方引用里,因为它记录了
> 这些 scale 为什么被提出。

**当前状态**(逐条对照 `frontend/tailwind.config.js` 与 `frontend/app/globals.css`):

| scale | 状态 | 在哪 |
|---|---|---|
| 字号 | **已落地** | `theme.extend.fontSize` 八档 `text-01`…`text-08`,见下节 |
| 字体族 | **已落地** | `fontFamily` 三族,Latin 与 CJK 各自成栈 |
| 圆角 | **已落地** | `borderRadius` 整张表塌成 `0`,只留 `full`(身份物)与 `focus`(2px) |
| 线宽 | **已落地** | `borderWidth` 增开 `3`;四档规则线 1px 行 / 1px 块 / 2px 区 / 3px 文明与钤印 |
| 间距 | **刻意不在 config 里** | Tailwind 默认刻度已够用;六档节奏(1/2/3/4/6/10/16 = 4/8/12/16/24/40/64px)由 `eslint.config.mjs` 的 `spacing-rhythm` 规则施加。`theme.extend` 只能新增不能删除,而节奏是一种**限制** —— 限制在 Tailwind 里没有表达方式,只能由 lint 表达 |
| 层级(elevation) | **仍然没有** | 下方关于「四个 surface 层级几乎无法分辨」的观察依然成立 |
| 动效 | **仍然没有** | 150ms 仍是全系统唯一的时间值,没有缓动 token |

所以还需要提案的是**两套**,不是五套:层级与动效。

<details><summary>原文(2026-08-23,已不成立)</summary>

> **Colour only.** There is no type scale, no spacing scale, no radius scale, no
> elevation scale, and no motion tokens. That absence is why the app has drifted to four
> heading sizes and four border-radius values — nothing ever defined the alternative.
>
> Please propose all five missing scales alongside the colour revision.

</details>

---

## Type scale

三族字体,全部 SIL OFL。Latin 经 `next/font/google` 自托管,CJK 经 fontsource;
两侧在 `frontend/app/fonts.ts` 里合成,该文件也记着为什么不能用 `next/font/local`。

| 用途 | Latin | CJK |
|---|---|---|
| `font-sans` | Archivo | Noto Sans SC |
| `font-serif` | Source Serif 4 | Noto Serif SC |
| `font-mono` | IBM Plex Mono | Noto Sans SC ← 等宽族不含汉字 |

八档。**字号自带行高、字距,其中四档还自带字重** —— 所以迁到 01/06/07/08 时要把
相邻的 `font-bold`/`font-semibold` 一并删掉,否则是把同一件事说两遍;`text-01` 同理
自带 0.10em,再写 `tracking-wide`(0.025em)反而会覆盖掉本档的字距。

| 档 | px | line-height | letter-spacing | font-weight | 角色 |
|---|---|---|---|---|---|
| `text-01` | 11 | 1.45 | `0.10em` | **600** | 大写小标签、眉题 |
| `text-02` | 12 | 1.5 | `0.04em` | — | 元信息、说明、等宽数字行 |
| `text-03` | 13 | 1.55 | `0` | — | 密集键值、表格正文(全站表格基准) |
| `text-04` | 15 | 1.6 | `-0.005em` | — | 界面正文 |
| `text-05` | 18 | 1.55 | `-0.01em` | — | **衬线引文** —— 「某人说过的话」 |
| `text-06` | 22 | 1.35 | `-0.015em` | **600** | 区块/面板标题 |
| `text-07` | 32 | 1.2 | `-0.02em` | **600** | 页面标题、头条数值 |
| `text-08` | 56 | 1 | `-0.03em` | **600** | 钤印、单一巨大数字 |

衬线只用于**「某人说过的话」**:典籍条文、告解、判词理由、审议意见。不用于界面文本。

**任意字号是被禁的**:`text-[11px]` 绕开八档,拿到的是同一个「不在这套系统里的字号」。
`eslint.config.mjs` 的 `type-scale` 规则两侧都管 —— 具名旧档(`text-sm`)与任意值
(`text-[11px]`)。注意 `text-[hsl(var(--…))]` 是**颜色**不是字号,不受此限:`text-`
在 Tailwind 里同时管两者,判据是方括号里是长度还是颜色。

---

---

## Surfaces and text

| Token | Dark | Light |
|---|---|---|
| `--color-canvas` | `240 15% 4%` | `0 0% 100%` |
| `--color-surface-1` | `var(--civ-hue) 13% 7%` | `var(--civ-hue) 14% 98%` |
| `--color-surface-2` | `var(--civ-hue) 12% 9%` | `var(--civ-hue) 13% 96%` |
| `--color-surface-3` | `var(--civ-hue) 11% 10%` | `var(--civ-hue) 12% 94%` |
| `--color-surface-4` | `var(--civ-hue) 11% 11%` | `var(--civ-hue) 11% 92%` |
| `--color-hairline` | `220 8% 18%` | `220 10% 90%` |
| `--color-hairline-strong` | `220 7% 22%` | `220 10% 85%` |
| `--color-hairline-tertiary` | `220 6% 26%` | `220 8% 80%` |
| `--color-ink` | `210 11% 96%` | `220 15% 10%` |
| `--color-ink-muted` | `213 15% 80%` | `220 10% 35%` |
| `--color-ink-subtle` | `215 8% 57%` | `220 8% 42%` |
| `--color-ink-tertiary` | `215 6% 54%` ⚠️ | `220 6% 42%` |
| `--color-accent` | `38 92% 50%` | `38 92% 50%` |
| `--color-accent-hover` | `43 96% 58%` | `43 96% 58%` |
| `--color-accent-ink` | `38 92% 50%` | `32 92% 34%` |

⚠️ `ink-tertiary` was `41%`, measuring **3.37:1** on `surface-1` — below the WCAG AA
4.5:1 floor for body text. 现在是 `54%`(本文档此前写「Raised to 50%」,那个数字也过期了)。
**2026-08-26 重测:5.22–5.35:1,通过 AA。** 是一个区间而不是单值,因为暗色 `surface-1`
现在插值 `var(--civ-hue)`(见下),对比度随文明色相浮动;最紧的是希腊(色相 88)。
不要回退。

**表面色现在随文明染色。** `surface-1..4` 的色相位不再是固定的 `240`,而是
`var(--civ-hue)` —— `[data-civ]` 规则把 `--color-civ-hue-<prefix>`(一个裸色相度数:
12/232/44/88)喂进 `--civ-hue`,四层表面再插值它。这是**形状**变化不是值变化:
一个完整 HSL 三元组放不进那个位置。本文档此前把这四行记成固定三元组,是错的。

四个层级仍然只差 4 个亮度点(暗色 7%→11%)与 6 个(浅色 98%→92%),实际几乎无法分辨 ——
真正的层级模型仍然值得提案,这一条没有过时。

The accent is identical in both themes, which is part of why light mode reads as
unfinished.

## Soul lifecycle states

| Token | Dark | Light | Meaning |
|---|---|---|---|
| `--color-status-alive` | `150 62% 46%` | `150 62% 28%` | ALIVE 存活 |
| `--color-status-judging` | `20 88% 58%` | `20 82% 38%` | JUDGING 审判中 |
| `--color-status-disposed` | `285 55% 66%` ⚠️ | `285 52% 44%` | DISPOSED 已处置 |
| `--color-status-reincarnating` | `195 88% 55%` | `195 85% 31%` | REINCARNATING 轮回中 |
| `--color-status-lost` | `225 10% 58%` | `225 10% 42%` | LOST 迷失 |
| `--color-status-settled` | `178 55% 40%` | `178 55% 29%` | SETTLED 已了结 ← **原表漏列** |

`--color-status-settled` 此前从未出现在这份文档里。它不是新加的 token —— `globals.css`
里的注释写明它「不属于 Stage 1 的生命周期表(那张表只点名五个状态),按原样保留而不去
猜」。也就是说这份文档当初记的是那张五态表,而代码里一直是六个。青绿色读作「已了结」
而不借用 REINCARNATING 的蓝或 LOST 的灰,并且**对结果保持中立** —— SETTLED 同时覆盖
Aaru 与 Ammit、天堂与地狱。

⚠️ `status-disposed` 现在是 `285 55% 66%`(本文档此前写「Raised to 62%」并记作蓝色,
两处都过期了)。**2026-08-26 重测:6.13–6.28:1,通过 AA。**

~~Problem worth solving: `disposed` 与 `reincarnating` 相差三度色相,实际是同一种蓝,
两个相邻的生命周期阶段无法区分。~~ **已解决**:`disposed` 已移到紫(285),
`reincarnating` 移到青(195),globals.css 里那行的注释就写着 "was a second blue"。
这段留着是因为它记录了改动的理由 —— 但它描述的**病症已经不存在**,别照它再改一次。

## Karma and verdicts

| Token | Dark | Light |
|---|---|---|
| `--color-karma-merit` | `150 62% 46%` | `150 62% 28%` |
| `--color-karma-demerit` | `0 84% 62%` | `0 78% 44%` |
| `--color-verdict-passed` | `150 62% 46%` ⚠️ | `150 62% 28%` |
| `--color-verdict-failed` | `0 84% 62%` | `0 78% 44%` |
| `--color-verdict-purgatory` | `215 80% 62%` | `215 78% 42%` |
| `--color-verdict-retry` | `330 62% 68%` ⚠️ | `330 60% 42%` |

⚠️ `verdict-passed` was the accent amber, i.e. a PASSED badge rendered in the exact
colour used for buttons and headings — the accent stopped signalling "interactive".
Moved to green, matching `karma-merit`.
⚠️ `verdict-retry` was `55%`, measuring **3.39:1** — below AA. Raised to `68%`
(这个数字仍然准确)。**2026-08-26 重测:6.70–6.87:1,通过 AA。**
`verdict-passed` 同样重测:**7.70–7.90:1**。

~~`verdict-purgatory` 与 `status-reincarnating` 是同一个值,不管有意无意,这意味着
调色板里没有空闲的蓝。~~ **已不成立**:purgatory 现在 `215 80% 62%`,reincarnating
`195 88% 55%`,两者不再相同。

## Generic status

| Token | Dark | Light |
|---|---|---|
| `--color-status-success` | `150 62% 46%` | `150 62% 28%` |
| `--color-status-error` | `0 84% 62%` | `0 78% 44%` |
| `--color-status-warning` | `38 88% 60%` | `32 88% 32%` |
| `--color-status-info` | `215 80% 62%` | `215 78% 42%` |

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
- `--color-civ-mark-<prefix>` is a **full HSL triple**, and it is where civilization
  identity actually lives. An earlier version of this line named "the 3px rule in a
  mixed-civilization list, and the chart legend" as its two consumers; neither
  exists, and searching the history of every commit that touched `--color-civ-mark`
  finds no point at which either did. The mark is drawn at exactly **one** place
  today — the per-civilization swatch in `frontend/app/dashboard/page.tsx`. Grep
  `--color-civ-mark` and `CIVILIZATION_COLORS` before trusting this sentence either.

The surface ramp is deliberately **not** the identity channel, whatever
`BRIEF.md` §4.9 asked for. Measured: at `hsl(h 13% 7%)` the four tenants' surfaces
land within 4/255 of each other, and within 6/255 across the whole ramp in both
themes — 13% saturation at 7% lightness cannot express a hue. The owner's ruling
was to accept the ramp as a near-neutral floor rather than raise it to the ~35-40%
that would repaint every screen. `ADDENDUM.md` §6 carries the measurement and the
decision; `frontend/src/__tests__/civilizationColourContract.test.ts` pins it, so
raising the ramp's saturation turns a test red rather than passing unremarked.

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
  outline: 2px solid hsl(var(--color-focus)) !important;
  outline-offset: 2px;
  border-radius: 2px;
}
input:focus-visible, textarea:focus-visible, select:focus-visible {
  outline-offset: 0;
}
```

150ms is the only timing value in the system and there is no easing token.
