/**
 * 文明色只在名单上 —— 两个 App 的那一份(Design 第四十八批第三节;网页那份是 frontend/src/__tests__/civInkWhitelist.test.ts,
 * 同一句规则):文明色只用在顶线、印、行程脊、焦点环四处;例外是选文明的卡片与「一条系列一个文明」的图(App 里今天都没有)。
 *
 * App 里的文明色是主题的三个槽:`plaque`(v4 civT)、`plaqueFill`(v4 solid)、`glow`。扫 "mobile" 与 "mobile-officer" 的 src
 * (注释先剥掉;theme.ts / theme.generated.ts 定义这些槽，不算;官员端经 shared.ts 引用的 mobile/src 文件已在 mobile/src 里):
 *   `x.plaque` / `x?.glow` / `useTheme().plaqueFill` / `x["glow"]`,以及从主题解构出来的 `const { glow } = useTheme()`。
 * 记「文件 :: 槽」→ 次数。结果必须**等于**名单:名单外多一处就红;名单上的一处改掉了也红，直到从名单删掉 —— 名单只会变短。
 * 名单每一格是一个数组，逐处写明属于哪一类，数组长度就是次数。
 *
 * 两条 App 专属的放行(第四十八批):
 *   GLOW_TOP_HEAD   页头晕光 GlowTop,归入「印」;只铺页头，浓度不超过网页页头晕光(下面另有一条核对 --glowA)。
 *   TOPLINE_LOADER  画在页头顶线位置的加载线，算顶线。其余加载条一律用墨。
 *
 * 变异(主会话验):把 chrome.tsx 底栏当前短线的 `t.ink` 改回 `t.plaque` → 「恰好是名单上的这些」红(chrome.tsx :: plaque 变 2);
 * 把 life.tsx 的 `<OutlineSeal … color={t.plaque}` 改成 `t.ink` → 同一条红(life.tsx :: plaque 变 2);
 * 把 emblems.tsx 的 GLOW_ALPHA.light 改回 0.24 → 「不超过网页」那条红。
 */
import { readFileSync, readdirSync } from "fs";
import path from "path";

import { TEXTURE_ALPHA } from "../civHead";
import { GLOW_ALPHA, STAGE_MOTIF_OPACITY } from "../emblems";

const REPO = path.join(__dirname, "..", "..", "..");
const DIRS = [path.join("mobile", "src"), path.join("mobile-officer", "src")];

type Kind = "TOPLINE" | "SEAL" | "SPINE" | "FOCUS" | "GLOW_TOP_HEAD" | "TOPLINE_LOADER" | "PENDING";

/** 「文件 :: 槽」→ 每一处的类(数组长度 = 次数)。 */
const ALLOWED: Record<string, Kind[]> = {
  // 顶线四形(两个 App 页头都用它)。
  "mobile/src/civHead.tsx :: plaque": ["TOPLINE"],
  // 灵魂端页头:晕光 + 殿印(38)。
  "mobile/src/chrome.tsx :: glow": ["GLOW_TOP_HEAD"],
  "mobile/src/chrome.tsx :: plaque": ["SEAL"],
  // 「此生」:页头晕光;大印，行程上「已走过」的点与线。
  "mobile/src/screens/life.tsx :: glow": ["GLOW_TOP_HEAD"],
  "mobile/src/screens/life.tsx :: plaque": ["SEAL", "SPINE", "SPINE"],
  // 官员端:页头晕光;页头顶线位置的加载线。
  "mobile-officer/src/kit.tsx :: glow": ["GLOW_TOP_HEAD"],
  "mobile-officer/src/kit.tsx :: plaque": ["TOPLINE_LOADER"],
  // 待定(第四十八批问 Design 时漏列的两处，等用户 / Design 定):
  //   锁屏实时活动(iOS Live Activity / 安卓常驻通知)的记号、标签底与进度条的色;在 App 之外，深浅随系统。
  "mobile/src/liveProgress.ts :: glow": ["PENDING"],
  //   登录后进入文明的欢迎层:那一家的 G 徽记(96)。像卷宗头水印(网页归「印」),也像空态徽记(已改墨)。
  "mobile/src/welcome.tsx :: plaque": ["PENDING"],
};

const SLOTS = ["plaque", "plaqueFill", "glow"] as const;

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/** 一份源码里三个槽各出现几次。`styles.plaque` 这类样式名不算。 */
function slotUses(code: string): Record<string, number> {
  const src = strip(code);
  const n: Record<string, number> = {};
  const add = (k: string) => (n[k] = (n[k] ?? 0) + 1);
  for (const m of src.matchAll(/(?:(?<![\w$])(?!styles\.)[A-Za-z_$][\w$]*|\))\??(?:\.(plaqueFill|plaque|glow)(?![\w$])|\[["'`](plaqueFill|plaque|glow)["'`]\])/g))
    add(m[1] ?? m[2]);
  for (const m of src.matchAll(/\{([^{}]*)\}\s*=\s*(?:useTheme\(\)|(?:theme|t)\b)/g))
    for (const part of m[1].split(",")) {
      const key = part.trim().split(/[\s:=]/)[0];
      if ((SLOTS as readonly string[]).includes(key)) add(key);
    }
  return n;
}

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "__tests__" || e.name === "node_modules" ? [] : files(full);
    return /\.tsx?$/.test(e.name) ? [full] : [];
  });
}

const SOURCES = DIRS.flatMap((d) => files(path.join(REPO, d)))
  .map((f) => ({ rel: path.relative(REPO, f).split(path.sep).join("/"), code: readFileSync(f, "utf8") }))
  .filter((s) => !/\/theme(\.generated)?\.ts$/.test(s.rel));

const found: Record<string, number> = {};
for (const { rel, code } of SOURCES) for (const [slot, n] of Object.entries(slotUses(code))) found[`${rel} :: ${slot}`] = n;

describe("App 的文明色只在名单上(Design 第四十八批第三节)", () => {
  it("扫到了两个 App 的源码(空扫描会让一切放行)", () => {
    expect(SOURCES.length).toBeGreaterThan(80);
    expect(SOURCES.map((s) => s.rel)).toEqual(expect.arrayContaining(["mobile/src/chrome.tsx", "mobile/src/screens/life.tsx", "mobile-officer/src/kit.tsx", "mobile-officer/src/screens/swipe.tsx"]));
  });

  it("用到 plaque / plaqueFill / glow 的位置恰好是名单上的这些", () => {
    // 多出来的:改成墨(t.ink;实心按钮的字用 t.s0,同 ui.tsx 的主按钮),或者它确实是四处之一 / 两条 App 放行，写进名单并注明类。
    // 少了的:那一处已经不用文明色，把它从名单里删掉。
    const want = Object.fromEntries(Object.entries(ALLOWED).map(([k, kinds]) => [k, kinds.length]));
    expect(found).toEqual(want);
  });

  it("待定一类只有那两处，不再增加", () => {
    expect(Object.entries(ALLOWED).filter(([, k]) => k.includes("PENDING")).map(([f]) => f).sort()).toEqual([
      "mobile/src/liveProgress.ts :: glow",
      "mobile/src/welcome.tsx :: plaque",
    ]);
  });

  it("plaqueFill(实心的文明色底)一处都没有了:实心按钮一律墨底", () => {
    expect(Object.keys(found).filter((k) => k.endsWith(":: plaqueFill"))).toEqual([]);
  });

  it("GlowTop 只在页头:每一处都画在 PlaqueFrame / 「此生」身份带 / 官员端身份带里", () => {
    const glowTops = SOURCES.flatMap(({ rel, code }) => [...strip(code).matchAll(/<GlowTop\b[^>]*testID=\{?[`"]([^`"]+)[`"]/g)].map((m) => `${rel} :: ${m[1]}`));
    expect(glowTops.sort()).toEqual(["mobile-officer/src/kit.tsx :: identity-band-glow", "mobile/src/chrome.tsx :: ${testID}-glow", "mobile/src/screens/life.tsx :: band-glow"]);
  });

  it("页头晕光不超过网页的页头晕光(globals.css 的 --glowA:深 / .light)", () => {
    const css = strip(readFileSync(path.join(REPO, "frontend", "app", "globals.css"), "utf8"));
    const dark = Number(/:root\s*\{[^}]*--glowA:\s*([\d.]+)/.exec(css)?.[1]);
    const light = Number(/\.light\s*\{[^}]*--glowA:\s*([\d.]+)/.exec(css)?.[1]);
    expect([dark, light].every((v) => v > 0)).toBe(true);
    expect(GLOW_ALPHA.dark).toBeLessThanOrEqual(dark);
    expect(GLOW_ALPHA.light).toBeLessThanOrEqual(light);
  });

  it("「此生」当前段的纹样(A7)与纸纹同浓度", () => {
    expect(STAGE_MOTIF_OPACITY).toEqual(TEXTURE_ALPHA);
  });
});

describe("扫描抓得到它要抓的写法", () => {
  it("属性、可选链、调用结果、方括号、从主题解构都数;样式名、注释、别的对象的解构不数", () => {
    const code = `
      // t.plaque 在注释里
      /* theme.glow */
      const a = t.plaque;
      const b = theme?.plaqueFill;
      const c = useTheme().glow;
      const d = t["plaque"];
      const { glow, ink } = useTheme();
      const { plaqueFill: fill } = t;
      const s = styles.plaque;
      const { content, glow: tint } = latest.current;
      const e = t.plaqueText;`;
    expect(slotUses(code)).toEqual({ plaque: 2, plaqueFill: 2, glow: 2 });
  });
});
