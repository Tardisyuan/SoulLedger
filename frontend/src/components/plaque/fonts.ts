/**
 * 匾题字与印文的字体(规范 v2 §三、补足 A4):每个文明一款题字字体、一款印文字体,
 * **只由匾组件和印组件用**,不进界面的三条字体栈。
 *
 * 全部自托管:Google 那几款走 next/font/google(构建时下载、从本站发出),霞鹜篆书
 * 走 next/font/local(素材包里的 ttf,OFL 文本在同目录)。`preload: false` 是「按需」
 * 的全部含义 —— @font-face 声明挂在全站,但浏览器只在某段文字真的用到这个字族时才下载,
 * 所以地府的官员永远不会下载欧洲的花体字。
 *
 * 选哪一款由 `app/globals.css` 的 `[data-civ]` 规则决定(`--font-plaque` / `--font-seal`),
 * 这里只提供五个 CSS 变量。
 */
import localFont from "next/font/local";
import {
  Ma_Shan_Zheng,
  UnifrakturMaguntia,
  Josefin_Slab,
  Cinzel,
  GFS_Didot,
  Noto_Sans_Egyptian_Hieroglyphs,
} from "next/font/google";

/** 地府印文:霞鹜篆书(殿号)。197 KB,不做子集化(决定记录 2026-09-30)。 */
const lxgwSeal = localFont({
  src: "./fonts/LXGWSeal-Regular.ttf",
  variable: "--font-lxgw-seal",
  display: "swap",
  preload: false,
});

/** 地府题字。只有 latin 分片登记在 next 的表里;中文由 Google 的 unicode-range 分片按需取。 */
const maShanZheng = Ma_Shan_Zheng({ weight: "400", variable: "--font-ma-shan-zheng", display: "swap", preload: false });
/** 欧洲题字 + 印文(花体首字母)。 */
const unifraktur = UnifrakturMaguntia({ weight: "400", variable: "--font-unifraktur", display: "swap", preload: false });
/** 埃及题字。 */
const josefinSlab = Josefin_Slab({ weight: ["600", "700"], variable: "--font-josefin-slab", display: "swap", preload: false });
/** 希腊题字。 */
const cinzel = Cinzel({ weight: "600", variable: "--font-cinzel", display: "swap", preload: false });
/** 希腊印文(大写 Μ)。 */
const gfsDidot = GFS_Didot({ weight: "400", subsets: ["greek"], variable: "--font-gfs-didot", display: "swap", preload: false });
/** 埃及印文(圣书字,U+13000 起)。 */
const hieroglyphs = Noto_Sans_Egyptian_Hieroglyphs({
  weight: "400",
  subsets: ["egyptian-hieroglyphs"],
  variable: "--font-hieroglyphs",
  display: "swap",
  preload: false,
});

/** 七个字族的 CSS 变量类名,挂在 <html> 上。 */
export const plaqueFontVariables = [lxgwSeal, maShanZheng, unifraktur, josefinSlab, cinzel, gfsDidot, hieroglyphs]
  .map((f) => f.variable)
  .join(" ");
