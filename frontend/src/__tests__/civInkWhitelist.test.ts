/**
 * @jest-environment node
 *
 * 文明色(`--color-main-ink`,v4 civT)只在顶线、印、行程脊、焦点环四处,另有一类例外:落地页与演示首页上
 * 选文明的卡片(Design 第四十六批第二节;规则写在 app/globals.css 的令牌注释里)。
 *
 * 扫 app / src / lib / demo 的 .ts / .tsx / .css(注释先剥掉):
 *   CSS   每条声明里用到 `--color-main-ink` 的规则,记「文件 :: 选择器」(令牌自己的定义 `--color-main-ink: …` 不算)
 *   TS    每个文件里 `main-ink` 出现的次数,记「文件 :: 次数」
 * 结果必须**等于**下面的名单:名单外的一处出现就红;名单里的一处被改掉也红,直到把它从名单里删掉,名单只会变短。
 *
 * 名单里每一格写明它属于哪一类。`PENDING` 那一类不在四处之内,也不是例外,是第四十六批之前就有、Design 还没逐处定的
 * 非文字标记(占比条、导航的当前项标记、图表的本季线);留在名单里是为了让守卫今天就能收住,不是认可它们。
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const WEB = path.join(__dirname, "..", "..");
const DIRS = ["app", "src", "lib", "demo"];

type Kind = "TOPLINE" | "SEAL" | "SPINE" | "FOCUS" | "CIV_PICK_CARD" | "HEAD_WATERMARK" | "PENDING";

/** CSS:「文件 :: 选择器」→ 类。 */
const CSS_ALLOWED: Record<string, Kind> = {
  // 焦点环:有文明时 --color-focus 指到 civT。
  "app/globals.css :: [data-civ]": "FOCUS",
  // 顶线(页头顶线、它的加载态,以及 PageShell 加载占位那条同粗的线)。
  "app/globals.css :: .page-wait-line::after": "TOPLINE",
  "app/globals.css :: .page-head-topline": "TOPLINE",
  'app/globals.css :: :is([data-civ="cn"], [data-civ="eu"], [data-civ="eg"], [data-civ="gr"]) .page-head-topline': "TOPLINE",
  "app/globals.css :: .page-head-topline[data-loading]::after": "TOPLINE",
  "app/globals.css :: .demo-inside-dossier": "TOPLINE",
  "src/components/desk/desk.module.css :: .stack": "TOPLINE",
  // 总簿四栏的顶线:Design 同意的例外,只在管理员总簿里。
  "src/components/desk/desk.module.css :: .col": "TOPLINE",
  // 卷宗头的 G 天体仪水印:用户 2026-11-14 与四处一起留下的(9a2f431eb)。
  "app/globals.css :: .page-head-wm": "HEAD_WATERMARK",
  // 印。
  "app/globals.css :: .seal": "SEAL",
  // 行程脊:路线图、行程块、卷宗脊。
  "app/globals.css :: .route-row": "SPINE",
  "app/globals.css :: .journey-walked": "SPINE",
  "app/globals.css :: .journey-stop-done": "SPINE",
  'app/globals.css :: .journey-seg[data-segment="walked"]': "SPINE",
  'app/globals.css :: .journey-dot[data-station-state="travelled"]': "SPINE",
  'app/globals.css :: .journey-stage-icon[data-step-status="done"]': "SPINE",
  'app/globals.css :: .journey-stage-bar[data-step-status="done"]': "SPINE",
  'app/globals.css :: .journey-stage-bar[data-step-status="current"]': "SPINE",
  "app/globals.css :: .journey-stage-fill": "SPINE",
  "src/components/dossier/dossier.module.css :: .done": "SPINE",
  "src/components/dossier/dossier.module.css :: .solid": "SPINE",
  "src/components/dossier/dossier.module.css :: .hollowCiv": "SPINE",
  // 例外:演示首页选文明的四张卡(特点短语、缩略路线、预览条)。
  "app/globals.css :: .demo-home-feat": "CIV_PICK_CARD",
  "app/globals.css :: .demo-shape-walked, .demo-shape-ahead": "CIV_PICK_CARD",
  "app/globals.css :: .demo-shape-stop": "CIV_PICK_CARD",
  "app/globals.css :: .demo-peek-accent": "CIV_PICK_CARD",
  // 未定(见文件头)。
  "app/globals.css :: .realm-occ": "PENDING",
  "app/globals.css :: .realm-occ-fill": "PENDING",
  "src/components/desk/desk.module.css :: .barFill": "PENDING",
  'src/components/dossier/dossier.module.css :: .tab[aria-current="page"]': "PENDING",
  'src/components/layout/doors.module.css :: .door[aria-current="page"], .door[aria-current="true"]': "PENDING",
  'src/components/layout/doors.module.css :: .me[aria-current="page"]': "PENDING",
  'src/components/layout/doors.module.css :: .tab[aria-current="page"]': "PENDING",
  'src/components/layout/doors.module.css :: .sheetLink[aria-current="page"]': "PENDING",
  'src/components/layout/doors.module.css :: .door[aria-current="page"]::after, .door[aria-current="true"]::after': "PENDING",
};

/** TS / TSX:「文件 :: 次数」→ 类。 */
const TS_ALLOWED: Record<string, Kind> = {
  // 例外:落地页选文明的卡片(入口那行字、魂火读卡自己的 civT)。
  "src/components/landing/Landing.tsx :: 1": "CIV_PICK_CARD",
  "src/components/landing/SoulFire.tsx :: 1": "CIV_PICK_CARD",
  // 行程脊:路线图走过的段与点、演示灵魂端的已行段。
  "src/components/realms/RouteTopology.tsx :: 3": "SPINE",
  "demo/DemoSoulScreens.tsx :: 2": "SPINE",
  // 未定(见文件头):冥界图回放进度条、年报占比条、趋势图本季线。
  "src/components/realms/UnderworldMap.tsx :: 1": "PENDING",
  "src/components/dashboard/AnnualReport.tsx :: 1": "PENDING",
  "lib/chart-colors.ts :: 1": "PENDING",
};

const stripCss = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "");
const stripTs = (s: string) => stripCss(s).replace(/(^|[^:])\/\/.*$/gm, "$1");

/** 一份 CSS 里用到 civT 的规则的选择器(最内层的 `sel { body }`,@media 里的也算)。 */
function civInkSelectors(css: string): string[] {
  return [...stripCss(css).matchAll(/([^{}]*)\{([^{}]*)\}/g)]
    .filter((m) => /main-ink/.test(m[2].replace(/--color-main-ink\s*:[^;]*;/g, "")))
    .map((m) => m[1].split(/\s+/).filter(Boolean).join(" "));
}

function civInkCount(ts: string): number {
  return (stripTs(ts).match(/main-ink/g) ?? []).length;
}

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "__tests__" || e.name === "node_modules" ? [] : files(full);
    return /\.(tsx?|css)$/.test(e.name) ? [full] : [];
  });
}

const SOURCES = DIRS.flatMap((d) => files(path.join(WEB, d))).map((f) => ({
  rel: path.relative(WEB, f).split(path.sep).join("/"),
  code: readFileSync(f, "utf8"),
}));

const found = { css: [] as string[], ts: [] as string[] };
for (const { rel, code } of SOURCES) {
  if (rel.endsWith(".css")) for (const sel of civInkSelectors(code)) found.css.push(`${rel} :: ${sel}`);
  else {
    const n = civInkCount(code);
    if (n) found.ts.push(`${rel} :: ${n}`);
  }
}

describe("文明色只在名单上(Design 第四十六批第二节)", () => {
  it("扫到了源码(空扫描会让一切放行)", () => {
    expect(SOURCES.length).toBeGreaterThan(300);
    expect(SOURCES.map((s) => s.rel)).toEqual(expect.arrayContaining(["app/globals.css", "src/components/desk/desk.module.css", "demo/DemoHome.tsx"]));
    expect(found.css.length).toBeGreaterThan(20);
  });

  it("CSS 里用到 civT 的规则恰好是名单上的这些", () => {
    // 多出来的:改成墨(`--color-ink` / `--color-faint-text`),或者它确实是四处之一 / 选文明的卡片,写进名单并注明类。
    // 少了的:那一处已经不用 civT,把它从名单里删掉。
    expect([...found.css].sort()).toEqual(Object.keys(CSS_ALLOWED).sort());
  });

  it("TS / TSX 里用到 civT 的文件与次数恰好是名单上的这些", () => {
    expect([...found.ts].sort()).toEqual(Object.keys(TS_ALLOWED).sort());
  });

  it("第四十六批改墨的六处不在名单上", () => {
    const all = [...Object.keys(CSS_ALLOWED), ...Object.keys(TS_ALLOWED)].join("\n");
    for (const gone of [".empty-mark", ".goodbye-line", ".goodbye-timer", ".diyu-card", ".colName", "HallOverview.tsx"]) expect(all).not.toContain(gone);
    // 名单不含它们还不够(规则删掉也会让上面变绿):逐条看它们现在读的是墨。
    const rule = (rel: string, sel: string) => {
      const css = stripCss(SOURCES.find((s) => s.rel === rel)!.code);
      const esc = sel.replace(/[.*+?^${}()|[\]\\>]/g, "\\$&");
      return new RegExp(`(?:^|\\})\\s*${esc}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? "";
    };
    const g = "app/globals.css";
    expect(rule(g, ".empty-mark")).toMatch(/color: oklch\(var\(--color-ink\)\);\s*opacity: 0\.1;/);
    expect(rule(g, ".goodbye-line")).toContain("color: oklch(var(--color-ink));");
    expect(rule(g, ".goodbye-timer > span")).toContain("background: oklch(var(--color-ink));");
    expect(rule(g, ".diyu-card--passed")).toMatch(/background: oklch\(var\(--color-ink\) \/ 0\.18\);\s*color: oklch\(var\(--color-ink\)\);/);
    expect(rule("src/components/desk/desk.module.css", ".colName")).toContain("color: oklch(var(--color-faint-text));");
  });
});

describe("扫描抓得到它要抓的写法", () => {
  it("CSS:声明里用到就记选择器;只定义令牌、只写在注释里的不记", () => {
    const css = `
      :root { --color-main-ink: 1 0 0; }
      [data-civ="cn"] { --color-main-ink: var(--color-civ-cn-ink); }
      [data-civ] { --color-focus: var(--color-main-ink); }
      /* .commented { color: oklch(var(--color-main-ink)); } */
      .a,
      .b { color: oklch(var(--color-main-ink) / 0.5); }
      @media (min-width: 48rem) { .c::after { border-top: 2px solid oklch(var(--color-main-ink)); } }
      .d { color: oklch(var(--color-ink)); }`;
    expect(civInkSelectors(css)).toEqual(["[data-civ]", ".a, .b", ".c::after"]);
  });

  it("TS:Tailwind 任意值类与字符串都数,注释不数", () => {
    const ts = `
      // text-[oklch(var(--color-main-ink))] 在注释里
      /* bg-[oklch(var(--color-main-ink))] */
      const a = "text-[oklch(var(--color-main-ink))]";
      const b = { current: "--color-main-ink" };
      const url = "https://example.test/x";`;
    expect(civInkCount(ts)).toBe(2);
  });
});
