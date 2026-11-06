/**
 * 规范 v4 的字体(用户 2026-11-06 决定:全换稿子的 7 套)。
 *
 *   Geist                          界面拉丁        next/font/google,本文件
 *   Geist Mono                     编号 · 数字     next/font/google,本文件
 *   EB Garamond                    文书拉丁标题、引文拉丁   next/font/google,本文件
 *   GFS Didot                      文书希腊标题、引文希腊   next/font/google,本文件
 *   Noto Sans SC                   界面中文        @fontsource-variable 分片(layout.tsx)
 *   Noto Serif SC                  标题 · 中文衬线  @fontsource-variable 分片(layout.tsx)
 *   Noto Sans Egyptian Hieroglyphs 圣书字          next/font/google,`src/components/plaque/fonts.ts`
 *
 * 全部自托管:next/font/google 在**构建时**下载字体文件,从本站发出,运行时不连 Google,
 * CSP 的 font-src 'self' 不用改。
 *
 * 为什么 CJK 两支不走 next/font ——
 * @fontsource-variable/noto-sans-sc 发布的是 **101 个编号切片**(`noto-sans-sc-{4..104}-wght-normal.woff2`),
 * 每片由 index.css 里的一条 `@font-face` 携带自己的 `unicode-range`。next/font/google 对 Noto Sans SC /
 * Noto Serif SC 只认 latin / latin-ext / cyrillic / vietnamese 四个子集(Next 16.3 的 font-data.json),
 * 拿不到中文分片;`next/font/local` 的 `src` 数组又不接受逐条 unicode-range。所以照旧 import 包自带的
 * index.css,浏览器只取页面真正用到的那几片。
 *
 * 代价:拿不到 next/font 的 `size-adjust`,中西文 x-height 对齐靠字族本身。Geist 与 Noto Sans SC
 * 在 v4 稿里本来就是这样并排的(`font: 14px/22px Geist, "Noto Sans SC"`),稿子就是按这个效果画的。
 *
 * v3 的用途规则「衬线只出现在**有人说过的话**上」(Stage 11 A1)**已撤销** —— 用户 2026-11-06 决定
 * 衬线标题照 v4:页面标题、分节标题、展示数字都用 Noto Serif SC 600(`--font-title`)。`--font-serif`
 * 仍是引文与文书正文的那一支,拉丁换成 EB Garamond、希腊换成 GFS Didot。
 */
import { Geist, Geist_Mono, EB_Garamond, GFS_Didot } from "next/font/google";

/** 界面 · 无衬线。可变字重,v4 只用 400 / 500 / 600。SIL OFL 1.1。 */
export const sans = Geist({
  subsets: ["latin", "latin-ext"],
  variable: "--font-sans-latin",
  display: "swap",
});

/** 数字 · ID · 等宽。v4 用 400 / 500,配 `tabular-nums`。SIL OFL 1.1。 */
export const mono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono-latin",
  display: "swap",
});

/**
 * 文书拉丁标题(SENTENTIA)与引文里的拉丁字。v4 用 400 / 500 与 400 斜体。
 * `preload: false`:只有文书、语料这类页面用到,别的页面不预取。SIL OFL 1.1。
 */
export const serif = EB_Garamond({
  subsets: ["latin", "latin-ext"],
  style: ["normal", "italic"],
  variable: "--font-serif-latin",
  display: "swap",
  preload: false,
});

/**
 * 文书希腊标题(ΚΡΙΣΙΣ)与引文里的希腊字。只取希腊两个子集(古典语料是多调号,要 greek-ext),
 * 拉丁字由前面的 EB Garamond 出。只有 400。`preload: false`,理由同上。SIL OFL 1.1。
 */
export const greek = GFS_Didot({
  weight: "400",
  subsets: ["greek", "greek-ext"],
  variable: "--font-serif-greek",
  display: "swap",
  preload: false,
});

/** 四支 next/font 字族的 CSS 变量类名,挂在 <html> 上。 */
export const fontVariables = [sans.variable, mono.variable, serif.variable, greek.variable].join(" ");
