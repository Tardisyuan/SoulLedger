/**
 * 印文的圣书字回退(规范 v3 `Seal`):印文是 Noto Serif SC 600(`--font-title`),而埃及的
 * 默认印文 U+13184 不在 Noto Serif SC 里,所以 `.seal-glyphs` 的字体栈在它后面接这一支。
 *
 * v2 的四款印文字体里另外三款 —— 霞鹜篆书(地府)、UnifrakturMaguntia(欧洲)、GFS Didot
 * (希腊)—— 随 v3 描边印撤掉(2026-10-02);霞鹜篆书的 ttf 与 OFL、以及 design-sync
 * 的三款字体声明,2026-10-03 一并删掉。
 *
 * 自托管(next/font/google,构建时下载、从本站发出),`preload: false`:只有
 * `egyptian-hieroglyphs` 一个分片,unicode-range 从 U+13000 起,浏览器只在页面上真有一个
 * 圣书字时才下载 —— 别的文明的官员永远不会下载它。
 */
import { Noto_Sans_Egyptian_Hieroglyphs } from "next/font/google";

const hieroglyphs = Noto_Sans_Egyptian_Hieroglyphs({
  weight: "400",
  subsets: ["egyptian-hieroglyphs"],
  variable: "--font-hieroglyphs",
  display: "swap",
  preload: false,
});

/** 圣书字字族的 CSS 变量类名,挂在 <html> 上。 */
export const plaqueFontVariables = hieroglyphs.variable;
