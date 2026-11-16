/**
 * @jest-environment node
 *
 * 色板 = SoulLedger 规范 v4(Claude Design 第七批 `V4Batch07.dc.html`,2026-11-06)。
 * v1「账簿 × 卷宗」、v2「朱印」、v3 冷中性灰三张表先后整张换掉,这份测试随之换成 v4 的表。
 *
 * The spec ships hex; globals.css stores OKLCH triples. This converts each token
 * back to sRGB and holds it to the spec's hex within one channel step, per theme,
 * so a hand edit to a triple that drifts from the design is red here.
 *
 * Also held, because the spec states them as the reason the palette is what it is:
 * - text tokens ≥ 4.5:1 on canvas, the block line and the focus ring ≥ 3:1;
 * - onMain ≥ 4.5:1 on every solid colour (v4 的 solid 就是给白字配的);
 * - each civilization's text colour (civT) ≥ 4.5:1 on canvas / surface-1 / surface-2, its metal
 *   mark ≥ 3:1 on canvas / surface-1;
 * - the five domain states are five DIFFERENT colours;
 * - civilization colour enters through `[data-civ]` only: each `[data-civ="x"]` block points the
 *   five generic names (`--color-main` / `-main-ink` / `-glow` / `-metal` / `-side`) at its own
 *   `--color-civ-x*` tokens and declares nothing else; no source file reads a civ token directly.
 *   (v3 的规则是「文明只进匾色,五处用」—— 用户 2026-11-06 决定撤销,照 v4 的范围。)
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import {
  FRONTEND_ROOT,
  ROOT_TOKENS,
  THEMES,
  TOKENS_BY_THEME,
  contrastRatio,
  oklchTripleToRgb,
  resolveTriple,
  tokenOver,
  type Rgb,
  type ThemeName,
} from "./support/globalsCssTokens";

/** 规范 v4 的色表(Design 第七批定稿 `V4Batch07.dc.html` 的 `.th-dark` / `.th-light` 与四个
 * `[data-civ]`,2026-11-06)。v3 那张冷中性灰的表整张换掉,名字不动。
 *
 * v4 的 17 个主题角色对到这里的规则写在 globals.css 的色板抬头,摘要:
 *   main/card/card2 → canvas/surface-1/surface-2;ink → ink/block;sub → ink-muted 与 ink-subtle;
 *   faint → line-strong 与 disabled-ink;line(8%)压在 card 上合成 → line;pos/neg → success/danger。
 * 文明(用户 2026-11-06 决定照 v4 的范围):solid → `--color-civ-*`(=匾色 / 主按钮底),civT →
 * `-ink`,metal → `-metal`,side → `-side`,glow 两主题同值不在这张表(只有一个值,没有对错之分可量)。
 * 中性皮是第八批第 5 条给的值(与 App 一致);--color-amber(第八批的 `--warn`,第四十批改名)/ --color-faint-text 是第八批第 4、6 条新增的。warning 与 success-tint 第四十批取 App 那组值;v4 没定义的其余 tint / 长明灯沿用 v3;danger-strong 与 on-danger 是 v4 的 neg / onNeg(用户 2026-11-06,与 App 一致)。 */
const SPEC: Record<string, Record<ThemeName, string>> = {
  "--color-canvas": { light: "#f8f8f6", dark: "#111113" },
  "--color-surface-1": { light: "#ffffff", dark: "#1a1b1e" },
  "--color-surface-2": { light: "#f1f1ee", dark: "#222327" },
  "--color-line-strong": { light: "#8a8d92", dark: "#7c7f85" },
  "--color-block": { light: "#16171a", dark: "#f3f3f1" },
  "--color-ink": { light: "#16171a", dark: "#f3f3f1" },
  "--color-ink-muted": { light: "#54575c", dark: "#b4b6ba" },
  "--color-ink-subtle": { light: "#54575c", dark: "#b4b6ba" },
  "--color-pillar": { light: "#f1f1ee", dark: "#0c0c0e" },
  "--color-on-main": { light: "#ffffff", dark: "#ffffff" },
  "--color-focus": { light: "#16171a", dark: "#f3f3f1" },
  "--color-success": { light: "#1f6b3f", dark: "#8ad3a1" },
  "--color-danger": { light: "#a81e3c", dark: "#f2849b" },
  "--color-danger-strong": { light: "#a81e3c", dark: "#f2849b" },
  "--color-on-danger": { light: "#ffffff", dark: "#16171a" },
  "--color-danger-tint": { light: "#FFECEF", dark: "#33101A" },
  "--color-danger-on-tint": { light: "#8A0C33", dark: "#FFD3DC" },
  "--color-warning": { light: "#9f4a00", dark: "#ff9a3c" },
  "--color-success-tint": { light: "#EAF6EE", dark: "#16261C" },
  "--color-warning-tint": { light: "#FFF1E2", dark: "#301904" },
  "--color-lamp": { light: "#6A3E00", dark: "#F2CC7A" },
  "--color-lamp-bg": { light: "#FBF1DC", dark: "#241B0C" },
  "--color-disabled-ink": { light: "#8a8d92", dark: "#7c7f85" },
  "--color-disabled-surface": { light: "#f1f1ee", dark: "#222327" },
  // 中性皮:Design 第八批第 5 条(2026-11-06)。glow 两主题同值,只有中性这一格放进表里 —— 它是第八批新给的值。
  "--color-civ-neutral": { light: "#5a606b", dark: "#55575e" },
  "--color-civ-neutral-ink": { light: "#54575c", dark: "#b4b6ba" },
  "--color-civ-neutral-glow": { light: "#8e939c", dark: "#8e939c" },
  "--color-civ-neutral-metal": { light: "#8a6a24", dark: "#ecaa3d" },
  "--color-civ-neutral-side": { light: "#f1f1ef", dark: "#0e0f11" },
  // 第八批新增:琥珀(连接状态的点与线,不当字)、比 sub 更淡的字。
  "--color-amber": { light: "#9a6400", dark: "#e8b45a" },
  "--color-faint-text": { light: "#686b70", dark: "#8e9197" },
  // 不是 Design 给的值:sub 与 faint-text 的 sRGB 中点,给「未记录」(用户 2026-11-08,见 globals.css)。
  "--color-ink-mid": { light: "#5e6166", dark: "#a1a4a8" },
  "--color-civ-cn": { light: "#a64a3b", dark: "#7e362b" },
  // civT / metal / side:设计参照 2026-11-15 §3.1(用户采纳「颜色按建议改」):civT 等明度(深 L .78 / 浅 L .46),
  // 埃及与希腊的印(当时 = metal)拉开。solid 与 glow 不动。门栏底(side)按第五十三批 G3,见下面「door-rail ground」。
  "--color-civ-cn-ink": { light: "#883f2c", dark: "#eba38f" },
  "--color-civ-cn-metal": { light: "#886116", dark: "#d7a85b" },
  "--color-civ-cn-side": { light: "#ffe4df", dark: "#2b110c" },
  "--color-civ-eu": { light: "#7a4f85", dark: "#5a3a63" },
  "--color-civ-eu-ink": { light: "#6d4286", dark: "#cca6e4" },
  "--color-civ-eu-metal": { light: "#5c6878", dark: "#b9c2cf" },
  "--color-civ-eu-side": { light: "#f9e2ff", dark: "#231226" },
  "--color-civ-eg": { light: "#3c69a2", dark: "#2b4e79" },
  "--color-civ-eg-ink": { light: "#175a96", dark: "#89bcf1" },
  // 第五十四批 H4:印不动(还是 11-15 拉开后的那对),金属色改成铜。
  "--color-civ-eg-metal": { light: "#954c28", dark: "#e89772" },
  "--color-civ-eg-seal": { light: "#716400", dark: "#e3cb53" },
  "--color-civ-eg-side": { light: "#dfedff", dark: "#071a2d" },
  "--color-civ-gr": { light: "#37716a", dark: "#28544f" },
  "--color-civ-gr-ink": { light: "#0e6753", dark: "#73cbb0" },
  // 第五十四批 H4:印不动,金属色改成古铜(橄榄)。
  "--color-civ-gr-metal": { light: "#686722", dark: "#b3b36e" },
  "--color-civ-gr-seal": { light: "#86422a", dark: "#cb7a5b" },
  "--color-civ-gr-side": { light: "#c8f7eb", dark: "#011f19" },
};

const CIVS = ["neutral", "cn", "eu", "eg", "gr"] as const;

const hexRgb = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as unknown as Rgb;
const rgbOf = (theme: ThemeName, name: string): Rgb => oklchTripleToRgb(resolveTriple(TOKENS_BY_THEME[theme], name));
/** `--color-line` 是 `L C H / α`:叠在给定底上之后的颜色(浏览器画出来的那一个)。不带 alpha 就当不透明。 */
const lineOn = (theme: ThemeName, bg: string): Rgb => tokenOver(TOKENS_BY_THEME[theme]["--color-line"], rgbOf(theme, bg));
const CSS = readFileSync(path.join(FRONTEND_ROOT, "app", "globals.css"), "utf8");

describe("palette (规范 v4)", () => {
  const rows = THEMES.flatMap((theme) => Object.keys(SPEC).map((name) => [theme, name] as const));

  it("covers every spec token in both themes (a short list checks nothing)", () => {
    expect(rows).toHaveLength(2 * 50);
  });

  it.each(rows)("%s %s is the spec's colour", (theme, name) => {
    const got = rgbOf(theme, name);
    const want = hexRgb(SPEC[name][theme]);
    got.forEach((v, i) => expect(Math.abs(v - want[i])).toBeLessThanOrEqual(1));
  });

  const TEXT = [
    "--color-ink",
    "--color-ink-muted",
    "--color-ink-subtle",
    "--color-accent",
    "--color-danger",
    "--color-success",
    "--color-warning",
    "--color-lamp",
    "--color-faint-text",
    "--color-ink-mid",
  ];
  it.each(THEMES.flatMap((theme) => TEXT.map((name) => [theme, name] as const)))("%s %s reads ≥ 4.5:1 on canvas", (theme, name) => {
    expect(contrastRatio(rgbOf(theme, name), rgbOf(theme, "--color-canvas"))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(THEMES.flatMap((theme) => ["--color-block", "--color-focus"].map((name) => [theme, name] as const)))(
    "%s %s reads ≥ 3:1 on canvas",
    (theme, name) => {
      expect(contrastRatio(rgbOf(theme, name), rgbOf(theme, "--color-canvas"))).toBeGreaterThanOrEqual(3);
    }
  );

  it.each(
    THEMES.flatMap((theme) =>
      ["--color-faint-text", "--color-ink-mid"].flatMap((name) => ["--color-surface-1", "--color-surface-2"].map((bg) => [theme, name, bg] as const))
    )
  )(
    "%s %s reads ≥ 4.5:1 on %s too (第八批:三种底上都达标;ink-mid 同为缺值字)",
    (theme, name, bg) => {
      expect(contrastRatio(rgbOf(theme, name), rgbOf(theme, bg))).toBeGreaterThanOrEqual(4.5);
    }
  );

  it.each(THEMES)("%s --color-amber (a dot and a 2px line, never text) is ≥ 3:1 on canvas", (theme) => {
    expect(contrastRatio(rgbOf(theme, "--color-amber"), rgbOf(theme, "--color-canvas"))).toBeGreaterThanOrEqual(3);
  });

  it.each(THEMES)("%s: the five soul states are five different colours", (theme) => {
    const states = ["alive", "judging", "disposed", "reincarnating", "lost"].map((s) => rgbOf(theme, `--color-status-${s}`).join(","));
    expect(new Set(states).size).toBe(5);
  });
});

describe("the paired texts the spec measures", () => {
  /* v3 的深色埃及 / 希腊匾色托不住白字(3.99 / 4.16:1,v3 自己标「仅 ≥15px 粗体」),这里曾有一张
   * 大号文字例外表。v4 的 solid 是专门给白字配的深色(白字 5.62–9.46:1),例外表随之删掉 ——
   * 十格(含中性)一律按正文门槛。 */
  it.each(THEMES.flatMap((theme) => CIVS.map((civ) => [theme, civ] as const)))("%s onMain on the %s solid ≥ 4.5:1", (theme, civ) => {
    expect(contrastRatio(rgbOf(theme, "--color-on-main"), rgbOf(theme, `--color-civ-${civ}`))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(THEMES.flatMap((theme) => CIVS.flatMap((civ) => ["--color-canvas", "--color-surface-1", "--color-surface-2"].map((bg) => [theme, civ, bg] as const))))(
    "%s %s text colour (civT) on %s ≥ 4.5:1",
    (theme, civ, bg) => {
      expect(contrastRatio(rgbOf(theme, `--color-civ-${civ}-ink`), rgbOf(theme, bg))).toBeGreaterThanOrEqual(4.5);
    }
  );

  it.each(THEMES.flatMap((theme) => CIVS.flatMap((civ) => ["--color-canvas", "--color-surface-1"].map((bg) => [theme, civ, bg] as const))))(
    "%s %s metal mark on %s ≥ 3:1",
    (theme, civ, bg) => {
      expect(contrastRatio(rgbOf(theme, `--color-civ-${civ}-metal`), rgbOf(theme, bg))).toBeGreaterThanOrEqual(3);
    }
  );

  it.each(THEMES.flatMap((theme) => CIVS.map((civ) => [theme, civ] as const)))("%s ink and ink-muted on the %s side ≥ 4.5:1", (theme, civ) => {
    for (const fg of ["--color-ink", "--color-ink-muted"]) {
      expect(contrastRatio(rgbOf(theme, fg), rgbOf(theme, `--color-civ-${civ}-side`))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("solid 托不住文明色的字、也托不住 3px 标:深色 solid 对 surface-1 不到 3:1 —— 字用 civT、标用 metal 是承重的", () => {
    for (const civ of ["cn", "eu", "eg", "gr"]) {
      expect(contrastRatio(rgbOf("dark", `--color-civ-${civ}`), rgbOf("dark", "--color-surface-1"))).toBeLessThan(3);
    }
  });

  it.each(THEMES)("%s neg.onBg on neg.bg ≥ 4.5:1, and on-danger on neg.strong ≥ 4.5:1", (theme) => {
    expect(contrastRatio(rgbOf(theme, "--color-danger-on-tint"), rgbOf(theme, "--color-danger-tint"))).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(rgbOf(theme, "--color-on-danger"), rgbOf(theme, "--color-danger-strong"))).toBeGreaterThanOrEqual(4.5);
  });

  // v4(用户 2026-11-06):深色失败实底是浅红,白字在上面只有约 2.5:1 —— on-danger 在深色是深字,这条是承重的。
  it("dark: white on the neg.strong fill would fail, so the text colour is not hard-coded white", () => {
    expect(contrastRatio([255, 255, 255], rgbOf("dark", "--color-danger-strong"))).toBeLessThan(4.5);
  });

  it.each(THEMES)("%s input border (faint) on s1 ≥ 3:1 — the line token would not be", (theme) => {
    expect(contrastRatio(rgbOf(theme, "--color-line-strong"), rgbOf(theme, "--color-surface-1"))).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(lineOn(theme, "--color-surface-1"), rgbOf(theme, "--color-surface-1"))).toBeLessThan(3);
  });
});

/* 门栏底(Design 第五十三批 G3,用户取 Design 的建议):浅色 L .94,各家取这个明度下 sRGB 画得出的最高彩度
 * (地府 .030、埃及 .029、欧洲 .046、希腊 .050 —— 四家浓淡不齐是色域使然);深色 L .215、彩度 .045,希腊在这个明度上限约 .039。
 * 上面的 hex 表钉住值;这里钉住规则,免得照「浅 .050 一律」再改回去 —— 出域的值会被浏览器压回来,看起来一样,数却是错的。
 * 变异:把浅色地府的 side 改回 #FFDCCE(L .92)→ 明度这条红。 */
describe("door-rail ground (Design batch 53 G3)", () => {
  const lch = (theme: ThemeName, civ: string) => resolveTriple(TOKENS_BY_THEME[theme], `--color-civ-${civ}-side`).trim().split(/\s+/).map(Number);
  const LIGHT_CHROMA = { cn: 0.03, eg: 0.029, eu: 0.046, gr: 0.05 } as const;
  it.each(Object.entries(LIGHT_CHROMA))("light %s: L .94 at its gamut's chroma", (civ, c) => {
    const [L, C] = lch("light", civ);
    expect(Math.abs(L - 0.94)).toBeLessThanOrEqual(0.002);
    expect(Math.abs(C - c)).toBeLessThanOrEqual(0.0015);
  });
  it.each(["cn", "eu", "eg", "gr"])("dark %s: L .215 at chroma .045 (Greek at its .039 ceiling)", (civ) => {
    const [L, C] = lch("dark", civ);
    expect(Math.abs(L - 0.215)).toBeLessThanOrEqual(0.002);
    expect(Math.abs(C - (civ === "gr" ? 0.039 : 0.045))).toBeLessThanOrEqual(0.001);
  });
});

/* theme-color(设计参照 2026-11-15 §9):layout.tsx 的 viewport.themeColor 是 meta,读不到 CSS 变量,只能写真值 —— 这里对账。
 * 变异:把 layout.tsx 浅色那条改成 rgb(255, 255, 255) → 红。 */
it.each(THEMES)("%s theme-color meta is the canvas", (theme) => {
  const layout = readFileSync(path.join(FRONTEND_ROOT, "app", "layout.tsx"), "utf8");
  const m = new RegExp(`prefers-color-scheme: ${theme}\\)", color: "rgb\\((\\d+), (\\d+), (\\d+)\\)"`).exec(layout);
  expect(m).not.toBeNull();
  const want = rgbOf(theme, "--color-canvas");
  m!.slice(1).map(Number).forEach((v, i) => expect(Math.abs(v - want[i])).toBeLessThanOrEqual(1));
});

/* 发丝线(设计参照 2026-11-15 §5,用户采纳):`--color-line` 是半透明的墨(浅 黑 12% / 深 白 12%),不再与 surface-3 同值。
 * 不透明的灰画在文明门栏底上只有 1.00–1.01:1(浅色)—— 那条线不存在。半透明的叠在什么底上都看得见。
 * 变异:把 .light 的 line 改回 `0.940070 0 0`(#EBEBEB)→ 第一条(不是三元组带 alpha)与第三条(门栏上 1.00:1)都红。 */
describe("the hairline is translucent ink (设计参照 2026-11-15 §5)", () => {
  it.each(THEMES)("%s --color-line is ink at 12%", (theme) => {
    expect(TOKENS_BY_THEME[theme]["--color-line"]).toBe(theme === "light" ? "0 0 0 / 0.12" : "1 0 0 / 0.12");
  });

  it.each(THEMES)("%s line over canvas lands on the measured colour", (theme) => {
    const want = hexRgb(theme === "light" ? "#dadad8" : "#2e2e2f");
    lineOn(theme, "--color-canvas").forEach((v, i) => expect(Math.abs(v - want[i])).toBeLessThanOrEqual(1));
  });

  it.each(THEMES.flatMap((theme) => [...CIVS.map((c) => `--color-civ-${c}-side`), "--color-canvas", "--color-surface-1", "--color-surface-3"].map((bg) => [theme, bg] as const)))(
    "%s line is visible on %s (≥ 1.25:1)",
    (theme, bg) => {
      expect(contrastRatio(lineOn(theme, bg), rgbOf(theme, bg))).toBeGreaterThanOrEqual(1.25);
    }
  );
});

/* 文明色等明度、印分开(设计参照 2026-11-15 §3.1)。上面的 SPEC 钉 hex;这里钉 hex 背后的理由,改值时理由不能悄悄丢掉。
 * 变异:把深色 eu civT 改回 #A883AE(L .66)→ 等明度那条红;把浅色 gr seal 改成 #8F5B36 → 印分开那条红(ΔE 4.9)。 */
describe("civilization text colours share one lightness, and the Egyptian and Greek seals stay apart", () => {
  const CIV4 = ["cn", "eu", "eg", "gr"] as const;
  const L = (theme: ThemeName, name: string) => Number(resolveTriple(TOKENS_BY_THEME[theme], name).split(/\s+/)[0]);
  const lab = (theme: ThemeName, name: string): [number, number, number] => {
    const [l, c, h] = resolveTriple(TOKENS_BY_THEME[theme], name).split(/\s+/).map(Number);
    return [l, c * Math.cos((h * Math.PI) / 180), c * Math.sin((h * Math.PI) / 180)];
  };

  it.each(THEMES)("%s civT lightness is one value (深 .78 / 浅 .46, ±.01)", (theme) => {
    const target = theme === "dark" ? 0.78 : 0.46;
    for (const civ of CIV4) expect({ civ, L: Math.abs(L(theme, `--color-civ-${civ}-ink`) - target) <= 0.01 }).toEqual({ civ, L: true });
  });

  it.each(THEMES)("%s eg seal and gr seal differ by ΔE(OKLab×100) ≥ 10", (theme) => {
    const [a, b] = [lab(theme, "--color-civ-eg-seal"), lab(theme, "--color-civ-gr-seal")];
    expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) * 100).toBeGreaterThanOrEqual(10);
  });
});

/* 第五十四批 H4:埃及、希腊的印不动,金属色(行程脊的当前点、角饰)改成铜 / 古铜,和印一眼分得开。
 * 理由是两条:色相差(Design 量的是约 41° / 54°,对着它的印值;这里对着代码里的印量,不低于 30°),对 canvas 的对比
 * 不低于 Design 报的数(埃及 8.17 / 5.91,希腊 8.61 / 5.56,深 / 浅)。
 * 变异:把深色 eg metal 改回 #E3CB53(= 印)→ 色相那条红。 */
describe("the Egyptian and Greek metals stand apart from their seals (batch 54 H4)", () => {
  const hue = (theme: ThemeName, name: string) => Number(resolveTriple(TOKENS_BY_THEME[theme], name).split(/\s+/)[2]);
  const QUOTED = { eg: { dark: 8.17, light: 5.91 }, gr: { dark: 8.61, light: 5.56 } } as const;
  it.each(THEMES.flatMap((theme) => (["eg", "gr"] as const).map((civ) => [theme, civ] as const)))("%s %s: metal and seal differ in hue by ≥ 30°", (theme, civ) => {
    const d = Math.abs(hue(theme, `--color-civ-${civ}-metal`) - hue(theme, `--color-civ-${civ}-seal`)) % 360;
    expect(Math.min(d, 360 - d)).toBeGreaterThanOrEqual(30);
  });
  it.each(THEMES.flatMap((theme) => (["eg", "gr"] as const).map((civ) => [theme, civ] as const)))("%s %s: metal on canvas ≥ the contrast Design quoted", (theme, civ) => {
    expect(contrastRatio(rgbOf(theme, `--color-civ-${civ}-metal`), rgbOf(theme, "--color-canvas"))).toBeGreaterThanOrEqual(QUOTED[civ][theme] - 0.005);
  });
});

/* 第五十四批 H3 / H4 的两处数值:回读层三行落在 4px 格上(判决仍最大),阴影是 Design 的 `shadow-card` / `shadow-overlay`。
 * 变异:把 component.tokens.json 的回读判决改回 20/26(并重新生成)→ 第一条红。 */
describe("read-back type and the two shadows (batch 54)", () => {
  it("read-back: name 20/28, case 16/24, verdict 24/32", () => {
    expect([ROOT_TOKENS["--readback-name"], ROOT_TOKENS["--readback-case"], ROOT_TOKENS["--readback-verdict"]]).toEqual([
      "600 20px/28px var(--font-title)",
      "400 16px/24px var(--font-mono)",
      "600 24px/32px var(--font-title)",
    ]);
  });
  it.each([
    ["dark", "--shadow-card", "none"],
    ["light", "--shadow-card", "0 1px 2px rgb(0 0 0 / 0.06), 0 2px 8px rgb(0 0 0 / 0.04)"],
    ["dark", "--elevation-overlay", "0 0 0 1px rgb(255 255 255 / 0.1), 0 2px 4px rgb(0 0 0 / 0.4), 0 16px 40px rgb(0 0 0 / 0.55)"],
    ["light", "--elevation-overlay", "0 1px 2px rgb(0 0 0 / 0.06), 0 12px 32px rgb(0 0 0 / 0.14)"],
  ] as const)("%s %s is Design's", (theme, name, want) => {
    expect(TOKENS_BY_THEME[theme][name]).toBe(want);
  });
});

/* 第五十五批:三端同一张遮罩;大面(回读层、演示预览卡)圆角 --radius-sheet 12,撤回条回到 --radius-panel 6。
 * 变异:把 desk.module.css 的撤回条改回 8px → 第三条红。 */
describe("scrim and the sheet radius (batch 55)", () => {
  const css = (rel: string) => readFileSync(path.join(FRONTEND_ROOT, rel), "utf8");
  const radiusOf = (src: string, selector: string) => src.split(`${selector} {`)[1]?.split("}")[0].match(/border-radius:\s*([^;]+);/)?.[1];
  it.each([
    ["dark", "0 0 0", "0.62"],
    ["light", "0.204832 0.006141 271.1072", "0.42"],
  ] as const)("%s scrim is %s at %s", (theme, triple, alpha) => {
    expect([TOKENS_BY_THEME[theme]["--color-scrim"], TOKENS_BY_THEME[theme]["--scrim-alpha"]]).toEqual([triple, alpha]);
  });
  it("--radius-sheet is 12 and the old one-off radii are gone", () => {
    // --radius-panel sits in the @theme block, not a :root one.
    expect([ROOT_TOKENS["--radius-sheet"], CSS.match(/--radius-panel:\s*([^;]+);/)?.[1]]).toEqual(["12px", "6px"]);
    expect([ROOT_TOKENS["--undo-radius"], ROOT_TOKENS["--readback-radius"]]).toEqual([undefined, undefined]);
  });
  it("undo strip → panel; read-back layer and demo preview card → sheet", () => {
    expect(radiusOf(css("src/components/desk/desk.module.css"), ".undo")).toBe("var(--radius-panel)");
    expect(radiusOf(css("src/components/judgment/sealReadback.module.css"), ".panel")).toBe("var(--radius-sheet)");
    expect(radiusOf(CSS, ".demo-preview-card")).toBe("var(--radius-sheet)");
  });
  it("batch 56: what you tap is 4, large surfaces 12; no 14 / 8 left on the demo site", () => {
    expect(radiusOf(CSS, ".demo-home-card")).toBe("var(--radius-sheet)");
    expect(radiusOf(CSS, ".demo-peek")).toBe("var(--radius-sheet)");
    expect(radiusOf(CSS, ".demo-home-enter")).toBe("var(--radius-control)");
    expect(radiusOf(CSS, ".demo-peek-sheet,\n.demo-peek-phone")).toBe("var(--radius-sheet)");
    // The phone's own block (after the shared one) no longer overrides it with a literal.
    expect(CSS.split(".demo-peek-phone {")[2]?.split("}")[0]).not.toMatch(/border-radius/);
    const demo = CSS.split("\n").filter((l) => /^\s*border-radius:\s*(14|8)px;/.test(l));
    expect(demo).toEqual([]);
  });
});

/** 文明皮的六个通用名(v4 五个 + 第三十批的印),`[data-civ="x"]` 把它们各自指到 `--color-civ-x` 加这个后缀。 */
const CIV_SLOTS: Record<string, string> = {
  "--color-main": "",
  "--color-main-ink": "-ink",
  "--color-glow": "-glow",
  "--color-metal": "-metal",
  "--color-side": "-side",
  // 第三十批「卷宗」的印(`--seal`):第六个槽。地府朱色,欧洲 civT,埃及、希腊取各自的 metal(第 3 步)。
  "--color-seal": "-seal",
};

/** `[data-civ="x"] { … }` 的声明(注释已剥掉);`.seal[data-civ="eu"]` 这类形状规则不带自定义属性,不计。 */
function civBlocks(): Map<string, Record<string, string>> {
  const out = new Map<string, Record<string, string>>();
  for (const b of CSS.matchAll(/(?<![\w.-])\[data-civ="(\w+)"\]\s*\{([^}]*)\}/g)) {
    const decls: Record<string, string> = { ...(out.get(b[1]) ?? {}) };
    for (const d of b[2].replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) decls[d[1]] = d[2].trim();
    out.set(b[1], decls);
  }
  return out;
}

describe("civilization colour enters through [data-civ] only (规范 v4,用户 2026-11-06)", () => {
  it("no [data-civ] (before login) is the neutral skin, slot by slot", () => {
    for (const [slot, suffix] of Object.entries(CIV_SLOTS)) expect(ROOT_TOKENS[slot]).toBe(`var(--color-civ-neutral${suffix})`);
  });

  it("each [data-civ] block points the five slots at its own civilization and sets nothing else", () => {
    const blocks = civBlocks();
    expect([...blocks.keys()].sort()).toEqual(["cn", "eg", "eu", "gr"]);
    for (const [civ, decls] of blocks) {
      const want = Object.fromEntries(Object.entries(CIV_SLOTS).map(([slot, suffix]) => [slot, `var(--color-civ-${civ}${suffix})`]));
      expect({ civ, decls }).toEqual({ civ, decls: want });
    }
  });

  // 用户 2026-11-14:文明色只上四个记号(页顶 2px 线、印、行程脊、焦点环)和两处氛围(门栏底、卷宗页头的光晕与水印)。
  // 强调与链接在任何殿下都是墨 —— 只有焦点环跟 civT。旧 CSS 的 `[data-civ] { --color-accent: var(--color-main-ink); … }`
  // 在第一条 toEqual 上多出两个键而红,第二条也红(那一块就声明了 accent)。
  it("only focus follows the civilization's text colour; accent and accent-ink stay ink under every [data-civ]", () => {
    const civRules = [...CSS.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/((?:[^{}]*?)\[data-civ(?:="\w+")?\][^{}]*)\{([^}]*)\}/g)];
    // `[data-civ]` 单独成块的有三处:焦点环这一块、base 层 `:root, [data-civ]` 的 `--main-fill`、以及印色。取声明了 focus 的那一块。
    const generic = civRules.filter((b) => /(?<![\w.\]-])\[data-civ\]\s*$/.test(b[1]) && /--color-focus\s*:/.test(b[2]));
    expect(generic).toHaveLength(1);
    const decls = Object.fromEntries([...generic[0][2].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((d) => [d[1], d[2].trim()]));
    expect(decls).toEqual({ "--color-focus": "var(--color-main-ink)" });
    const accentUnderCiv = civRules.filter((b) => /--color-accent(?:-ink)?\s*:/.test(b[2])).map((b) => b[1].trim());
    expect(accentUnderCiv).toEqual([]);
  });

  it("no source file reads a civ token directly — they go through the five slots", () => {
    const skip = new Set(["src/__tests__", "app/globals.css"]);
    const hits: string[] = [];
    const walk = (rel: string): void => {
      for (const e of readdirSync(path.join(FRONTEND_ROOT, rel), { withFileTypes: true })) {
        const child = `${rel}/${e.name}`;
        if (skip.has(child)) continue;
        if (e.isDirectory()) walk(child);
        else if (/var\(--(color-)?civ-/.test(readFileSync(path.join(FRONTEND_ROOT, child), "utf8"))) hits.push(child);
      }
    };
    for (const dir of ["app", "src", "components", "lib"]) walk(dir);
    expect(hits).toEqual([]);
  });
});
