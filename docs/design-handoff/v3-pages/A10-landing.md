# A10 · 落地页 `/`(Design 2026-10-03,v3-batch6-landing-reply.md)

取自 Design 项目「SoulLedger v3」:`templates/soulledger-v3-pages/` 的 `Landing`(1440)/ `LandingMobile`(393)。下面照抄 Design 的答复;末尾「我们的答复」是代码这边对待确认问题与字号冲突的决定。

画面用 props 切换状态:`theme = light | dark`、`signedIn`、`mine = cn | eu | eg | gr`。

## 一、版式和天平标

- 和 A9 登录页用同一套骨架:左右边距 72、顶行 44(上边距 40)、内容从 y=216 开始，右栏宽 560(与登录页表单栏同宽)。两页切换时，标、字标、顶行和起始线都不动。
- 自上而下：顶行 → 标题区(左为文字，右为大标)→ 文明体系(四栏)→ 页脚 64。整页 1440×900,一屏放下，不滚动。
- 天平标出现在两处：
  - 顶行左侧 32,和登录页相同。
  - 标题区右侧 240,右端对齐 72 边距。这是全站唯一用大号标的地方。393 不放大标，只在顶栏放 24 号标。
- 标的颜色：浅色底用墨色 `oklch(var(--color-ink))`;深色底用 `--brand-mark` #ECAA3D(`BrandMark tone="gold"`),和 A9 一致。`--brand-ground` 不用在这一页。

| 块 | 组件、令牌、尺寸 |
|---|---|
| 顶行 | `BrandMark` 32;「灵魂簿」用 Noto Serif SC 600,20/28;「SoulLedger」13,ink-muted。右侧依次是：原生 select(44 高，圆角 4,`--color-line-strong`)、`ThemeToggle` 44、「控制台 →」。已登录时最前面多一句「已登录 · {name}」,13,muted |
| 标题 | 「灵魂账本」font-title 600,88/96,字距 0.02em |
| 副题 | 「跨文明灵魂管理系统」font-title 600,24/32 |
| 说明 | 15/26,ink-muted,最宽 30em |
| 文明体系眉题 | 「文明体系 · 四界 · 一本账」11/16,字距 0.1em,ink-subtle,和登录页「今日律条」相同 |
| 四个文明 | 四栏等分，不做卡片。每栏顶边 1px `--color-ink`,栏间距 24。每栏：字形加文明名 font-title 600 22/30;地区 13 muted;特征 15/24 |
| 页脚 | 顶边 1px `--color-line`,高 64。左边「万古轮回皆有录」font-serif 500 15;右边「灵魂账本 v0.1」mono 12 muted |

## 二、四个文明怎么呈现

- 原来的白框卡片去掉，改成一条四栏账目，形式和登录页底部的四文明短引对应。
- 每个文明用墨色字形区分：■ 中国 ● 欧洲 ▲ 埃及 ◆ 希腊。**不用文明色。** 落地页不在 v3 规定的五处之内：身份带、印、primary 按钮、导航当前项、待我处理竖条。
- 「你的冥界」(仅已登录时显示):这一栏的顶线从 1px 加粗到 3px 墨色;栏底加「◉ 你的冥界」,12/600;其余三栏不变。未登录时四栏完全相同。

## 三、「控制台」按钮

- 用 `<a>` 链接，不用 `Button`:它是导航，primary 实心按钮留给动作。
- 高 44,左右内边距 16,1px `--color-ink` 描边，圆角 4,无底色;文字 13/500 墨色。
- 箭头从 ↗ 改成 →:↗ 读起来像外部链接，这里是站内跳转。
- 未登录到 `/login`,已登录到 `/dashboard`。文案相同，只换 href。

## 四、393

- 顶栏 56,底边 1px line:左边 `BrandMark` 24 加「灵魂簿」17/600;右边「控制台 →」44。
- 语言和明暗挪到页脚上方一行(surface-1 底):左边「语言与明暗」,右边 select 44 和 `ThemeToggle` 44。
- 标题区左右内边距 24:「灵魂账本」font-title 48/56;副题 18/26;说明 15/24。已登录时下面加一行「已登录 · {name}」。
- 文明体系改成竖排列表，每项三行：名称 19/28 600、地区 12、特征 14/22。项间 1px `--color-line-strong`;自己的冥界那一项 3px 墨线，加「◉ 你的冥界」。
- 页脚:surface-1 底，那句话和版本号左右分开放。

## 五、新增文案(Design 提出)

| key | 中文 | English |
|---|---|---|
| landing.civs.eyebrowSub | 四界 · 一本账 | Four realms · one ledger |
| landing.signedInAs | 已登录 · {name} | Signed in · {name} |
| landing.mobile.prefs | 语言与明暗 | Language & theme |
| landing.civs.mine | 你的冥界 | Your realm |

## 我们的答复(2026-10-03)

- **另外三个文明的地区和特征**:用现有文案 `home.civ_subtitle.*` / `home.civ_desc.*`,画面里的是示意。
- **「你的冥界」**:已有 `home.your_realm`(中文「你所属的冥府」),沿用，不新增。
- **「四界 · 一本账」**:用户决定保留。key `home.civilizations_eyebrow_sub`;egy「Duat 4 · Medjat Wa」(词表内词)。
- **「已登录 · {name}」**:key `home.signed_in_as`;egy「Em Aq · {{name}}」(沿用 App 里「已登录」的写法)。
- **「语言与明暗」**:沿用欢迎页已有的 `welcome.prefs`(「语言与主题」),不新增。
- **字号**:88 / 24 / 22 不在字级表里。用户定题字取表内最大一档 `display-lg` 56(手机 `xl` 28);副题 `xl` 28(手机 `lg` 20);文明名 `lg` 20。`PageShell.test.tsx` 的 `H1_COVER` 跟着改。
- **72 边距**:用 1296 宽的居中容器给，不用 `px-18`(间距刻度里没有 18)。
