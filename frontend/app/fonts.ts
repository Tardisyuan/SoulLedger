/**
 * Stage 11 · 三支字族，各带 CJK 对位。
 *
 * 拉丁三支走 next/font/google;CJK 两支走 @fontsource-variable 的分片 CSS。
 *
 * 为什么 CJK 不走 next/font/local ——
 * 设计稿提出用 `next/font/local` 指向
 * `noto-sans-sc-chinese-simplified-wght-normal.woff2`,以便拿到 `size-adjust`。
 * 该文件不存在。@fontsource-variable/noto-sans-sc 实际发布的是 **101 个编号切片**
 * (`noto-sans-sc-{4..104}-wght-normal.woff2` 等),每片由 index.css 里的一条
 * `@font-face` 携带自己的 `unicode-range`;两个包的 files/ 合计 10.4MB。
 * `next/font/local` 的 `src` 数组不接受 per-src 的 unicode-range,所以把它们包成一个
 * local font 会让浏览器无条件取全量——正是分片要避免的事。因此这里 import 包自带的
 * index.css,101 条 @font-face 原样保留,浏览器只取页面真正用到的那几片。
 *
 * 代价:拿不到 next/font 的 `size-adjust` / `adjustFontFallback`,中西文 x-height
 * 对齐是靠字族本身的相近血统(Archivo/Source Serif 4 与 Noto SC 同为 Google 托管的
 * 开源族),不是靠数值收边。若实测混排基线仍有可见抖动,补法是在 globals.css 里为
 * 'Noto Sans SC Variable' 追加一组带 size-adjust 的 @font-face 覆盖——那需要复制 101
 * 条规则,所以只在实测证明有必要时才做,不预先做。
 */
import { Archivo, Source_Serif_4, IBM_Plex_Mono } from "next/font/google";

/** UI · 无衬线。grotesk,末端平切,大写加字距后是档案标签脸。SIL OFL 1.1。 */
export const sans = Archivo({
  subsets: ["latin"],
  variable: "--font-sans-latin",
  display: "swap",
});

/**
 * 引文 · 衬线。带 8–60 光学尺寸轴:条文 18px 与判决主文 32px 同族不同 opsz。
 * SIL OFL 1.1。
 *
 * 用途受一条规则约束(Stage 11 A1):衬线只出现在**有人说过的话**上——
 * 175 条古典语料、忏悔录正文、判决理由、跨文明会审的合议意见。
 * UI 的标签/表格/按钮/数字一律无衬线。所以忏悔录不再需要 italic 加引号提示引文,
 * 换族已经说了;斜体退回它本来的用途(拉丁书名、术语)。
 */
export const serif = Source_Serif_4({
  subsets: ["latin"],
  variable: "--font-serif-latin",
  display: "swap",
});

/** 数字 · ID · 等宽。零带斜杠、1 有衬底,哈希与案号不会误读。SIL OFL 1.1。 */
export const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono-latin",
  display: "swap",
});

/** 三支拉丁字族的 CSS 变量类名,挂在 <html> 上。 */
export const fontVariables = [sans.variable, serif.variable, mono.variable].join(" ");
