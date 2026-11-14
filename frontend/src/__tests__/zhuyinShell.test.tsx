/**
 * 外框:印(规范 v3 描边印)、页头(第三十批「卷宗」的顶线 + 卷宗头,取代 v3 身份带与 v4 标题行)、
 * 立柱横排阈值,以及 `[data-civ]` 规则里不再有 v2 素材(`app/globals.css` → `public/v2/`)。
 *
 * 素材那一组:v2 的实底印(遮罩 + 残边扫描)随 v3 描边印撤掉;v2 的分节纹(CSS 遮罩
 * `--section` + `.section-rule` + public/v2/svg/section-*)随 `SectionTitle` 撤掉(2026-10-03)。
 */
import fs from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";

const mockTenant: { code: string; display_name: string; seal_glyphs?: string[]; hall_names?: Record<string, string> } = { code: "CN_DIYU", display_name: "第五殿" };
const mockI18n = { locale: "zh-Hans" };
jest.mock("@/src/contexts/TenantContext", () => ({
  useTenant: () => ({ user: { id: 1, tenant: mockTenant } }),
}));
jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({
    t: (key: string, p?: Record<string, string>) => (key === "seal.aria" ? `${p?.court}之印` : key),
    locale: mockI18n.locale,
  }),
}));

import { Seal, sealGlyphsFor, DEFAULT_SEAL_GLYPHS } from "@/src/components/plaque/Seal";
import { PageShell } from "@/src/components/ui/PageShell";
import { labelTooLongForVerticalPillar, pillarIsWide } from "@soulledger/core/domain/pillar";

const FRONTEND = path.join(__dirname, "..", "..");

beforeEach(() => {
  mockTenant.code = "CN_DIYU";
  delete mockTenant.seal_glyphs;
  delete mockTenant.hall_names;
  mockI18n.locale = "zh-Hans";
});

describe("印", () => {
  it("读屏读「{殿名}之印」,印文本身不念", () => {
    render(<Seal size={52} />);
    const seal = screen.getByRole("img", { name: "organization.civilizations.CHINESE之印" });
    expect(seal).toHaveAttribute("data-civ", "cn");
    expect(seal.querySelector(".seal-glyphs")).toHaveAttribute("aria-hidden", "true");
  });

  it("租户没配印文时用文明默认;配了就用配的", () => {
    const { rerender } = render(<Seal size={52} />);
    expect(screen.getByRole("img").textContent).toBe("冥");
    mockTenant.seal_glyphs = ["五"];
    rerender(<Seal size={52} />);
    expect(screen.getByRole("img").textContent).toBe("五");
    expect(screen.getByRole("img").textContent).not.toContain("冥");
  });

  it("字号 = 印宽 × 0.44(v3 64 → 28),≤ 32 是 0.5(30 → 15);埃及两字竖排每字 0.34", () => {
    const glyphSize = () => (screen.getByRole("img").querySelector(".seal-glyphs") as HTMLElement).style.fontSize;
    const { rerender } = render(<Seal size={64} />);
    expect(glyphSize()).toBe("28px");
    rerender(<Seal size={30} />);
    expect(glyphSize()).toBe("15px");
    rerender(<Seal size={100} civ="eg" glyphs={["\u{13184}", "\u{131CB}"]} />);
    expect(glyphSize()).toBe("34px");
    expect((screen.getByRole("img").querySelector(".seal-glyphs") as HTMLElement).children).toHaveLength(2);
  });

  it("埃及是拱:64 宽 70 高(v3 `.seal-egypt`);别的文明方的", () => {
    const { rerender } = render(<Seal size={64} civ="eg" />);
    expect(screen.getByRole("img").style).toMatchObject({ width: "64px", height: "70px" });
    rerender(<Seal size={64} civ="gr" />);
    expect(screen.getByRole("img").style).toMatchObject({ width: "64px", height: "64px" });
  });

  it("只有埃及允许两个字;别的文明两个字是坏数据,退回默认而不是截断", () => {
    expect(sealGlyphsFor("eg", ["a", "b"])).toEqual(["a", "b"]);
    expect(sealGlyphsFor("cn", ["五", "六"])).toEqual(DEFAULT_SEAL_GLYPHS.cn);
    expect(sealGlyphsFor("gr", [])).toEqual(["Μ"]);
    expect(sealGlyphsFor("eg", ["a", "b", "c"])).toEqual(DEFAULT_SEAL_GLYPHS.eg);
  });

  it("希腊默认是希腊大写 Μ(U+039C),不是拉丁 M", () => {
    expect(DEFAULT_SEAL_GLYPHS.gr[0].codePointAt(0)).toBe(0x39c);
  });

  it("是描边印:只有印文一个子元素,没有 v2 的实底 / 残边环 / 线层", () => {
    render(<Seal size={32} />);
    const seal = screen.getByRole("img");
    expect(seal).toHaveAttribute("data-small");
    expect([...seal.children].map((c) => c.className)).toEqual(["seal-glyphs"]);
    expect(seal.querySelector(".seal-layer, .seal-body, .seal-ring, .seal-line")).toBeNull();
  });

  it("中性皮(登录前、不认得的租户)没有印", () => {
    mockTenant.code = "XX_UNKNOWN";
    const { container } = render(<Seal size={52} />);
    expect(container).toBeEmptyDOMElement();
  });
});

/**
 * 页头(第三十批「卷宗」第 1 步,Design v4 第三十批第一节第 1 条)取代了 v3 的身份带与 v4 的 96px 标题行
 * (`Plaque`,按实测宽度 28 → 20 → 20 两行降档、滚过 60 收成 44 并把高度写进 `--identity-band`)。
 * 现在只有一个页头:顶线 + 卷宗头,标题就是页面的 `<h1>`,不吸顶、不收起、不降档(长的就换行)。
 */
describe("页头:顶线 + 卷宗头,只有一个标题", () => {
  it("一个 <h1>,门页 24/32(text-head);顶线、光晕、纹样、水印都只是装饰;没有身份带", () => {
    const { container } = render(<PageShell title="名册">body</PageShell>);
    const head = screen.getByTestId("page-head");
    expect(head).toHaveAttribute("data-kind", "gate");
    for (const layer of [".page-head-topline", ".page-head-glow", ".page-head-pat", ".page-head-wm"]) {
      expect(head.querySelector(layer)).toHaveAttribute("aria-hidden", "true");
    }
    const h1s = container.querySelectorAll("h1");
    expect(h1s).toHaveLength(1);
    expect(h1s[0]).toHaveTextContent("名册");
    expect(h1s[0].className).toMatch(/\btext-head\b/);
    // Absence: the band, its second title and its brand / v2 layers are gone.
    expect(screen.queryByTestId("plaque")).toBeNull();
    expect(container.querySelector("[data-tier], .identity-band, .plaque-band, .plaque-tex")).toBeNull();
  });

  it("卷宗页的标题是人名,32/40(text-dossier);水印是此刻所在文明的 G 天体仪", () => {
    render(<PageShell title="赵志强" kind="dossier">body</PageShell>);
    const head = screen.getByTestId("page-head");
    expect(head).toHaveAttribute("data-kind", "dossier");
    expect(head.querySelector("h1")!.className).toMatch(/\btext-dossier\b/);
    expect(head.querySelector("h1")!.className).not.toMatch(/\btext-head\b/);
    expect(head.querySelector(".page-head-wm")).toHaveAttribute("data-civ-mark", "cn");
  });

  // 第四十五批第四节:页头右上的文明记号,墨色、装饰(aria-hidden),记号说的是「哪一家」。
  it("页头记号是此刻所在文明的那一个,读屏跳过", () => {
    render(<PageShell title="名册">body</PageShell>);
    const mark = screen.getByTestId("page-head").querySelector(".page-head-mark");
    expect(mark).toHaveAttribute("data-head-mark", "cn");
    expect(mark).toHaveAttribute("aria-hidden", "true");
  });

  // 用户 2026-11-14:地府的记号是此刻所在殿的殿名(`Tenant.hall_names`),按界面语言;egy 没有退英文;拿不到退回地府 / DIYU。
  // 第四十六批第三节:中文超过 5 字退「地府」,拉丁超过 14 个字符退「DIYU」;4–5 个汉字用小一档(data-head-size="s")。
  const NAMES = { "zh-Hans": "第五殿", en: "Fifth Court", egy: "Yanluo Qedi" };
  it.each([
    ["zh-Hans", NAMES, "第五殿", "han", null],
    ["en", NAMES, "Fifth Court", "latin", null],
    ["egy", NAMES, "Yanluo Qedi", "latin", null],
    // 后端 egy 空着时退回 zh(`Tenant.hall_names`);egy 界面不露汉字殿名,改退英文。
    ["egy", { ...NAMES, egy: "第五殿" }, "Fifth Court", "latin", null],
    ["zh-Hans", { ...NAMES, "zh-Hans": "轉輪王殿" }, "轉輪王殿", "han", "s"],
    ["zh-Hans", { ...NAMES, "zh-Hans": "第五殿閻羅王" }, "地府", "han", null],
    // 14 个字符放得下,15 个不行:0012 迁移的种子英文名「The Fifth Court」正好是 15 个。
    ["en", { ...NAMES, en: "WESEKHET 12345" }, "WESEKHET 12345", "latin", null],
    ["en", { ...NAMES, en: "The Fifth Court" }, "DIYU", "latin", null],
    ["zh-Hans", undefined, "地府", "han", null],
    ["en", undefined, "DIYU", "latin", null],
    ["egy", undefined, "DIYU", "latin", null],
  ])("地府记号 · %s 界面 · 殿名 %j → %s", (locale, names, shown, script, size) => {
    mockI18n.locale = locale;
    if (names) mockTenant.hall_names = names;
    render(<PageShell title="名册">body</PageShell>);
    const mark = screen.getByTestId("page-head").querySelector(".page-head-mark");
    expect(mark).toHaveTextContent(new RegExp(`^${shown}$`));
    expect(mark).toHaveAttribute("data-head-script", script);
    if (size) expect(mark).toHaveAttribute("data-head-size", size);
    else expect(mark).not.toHaveAttribute("data-head-size");
  });

  it("地府记号的字号:3 字 22/26,4–5 字 20/23,拉丁 12/14、字距 .28em(第四十六批第三节)", () => {
    const body = (sel: string) => new RegExp(`\\n {2}${sel.replace(/[[\]"().]/g, "\\$&")} \\{([^}]*)\\}`).exec(css)?.[1] ?? "";
    expect(body('.page-head-mark[data-head-mark="cn"]')).toContain("font: 600 22px/26px var(--font-title);");
    expect(body('.page-head-mark[data-head-mark="cn"][data-head-size="s"]')).toContain("font: 600 20px/23px var(--font-title);");
    const latin = body('.page-head-mark[data-head-mark="cn"][data-head-script="latin"]');
    expect(latin).toContain("font: 600 12px/14px var(--font-title);");
    expect(latin).toContain("letter-spacing: 0.28em;");
    expect(latin).toContain("text-transform: uppercase;");
    expect(css).not.toContain("font: 600 26px/30px var(--font-title);");
  });

  it("中性皮(不认得的租户)的水印只画环,不放任何一个文明的中心物,也没有页头记号", () => {
    mockTenant.code = "UNKNOWN";
    render(<PageShell title="名册">body</PageShell>);
    expect(screen.getByTestId("page-head").querySelector(".page-head-wm")).toHaveAttribute("data-civ-mark", "neutral");
    expect(screen.getByTestId("page-head").querySelector(".page-head-mark")).toBeNull();
  });

  const css = fs.readFileSync(path.join(FRONTEND, "app", "globals.css"), "utf8");
  it("不吸顶、不收起:globals.css 里没有身份带的规则,`--below-band` 只是工具条 + 代看条", () => {
    expect(css).not.toMatch(/\.identity-(band|pattern|watermark|title|court|case)\b/);
    expect(css).not.toContain("--identity-band");
    expect(css).toMatch(/--below-band: calc\(var\(--spacing\) \* 13 \+ var\(--imp-h\)\);/);
    expect(/\.page-head \{[^}]*\}/.exec(css)?.[0] ?? "").not.toMatch(/sticky/);
  });

  it("纸纹只用墨(深 6% / 浅 5%),不用文明色;记号墨 34% / 30%", () => {
    const pat = [...css.matchAll(/\n {2}([^\n{}]*\.page-head-pat) \{([^}]*)\}/g)];
    expect(pat.map((m) => m[1].trim())).toEqual([
      ".page-head-pat",
      '[data-civ="cn"] .page-head-pat',
      '[data-civ="eu"] .page-head-pat',
      '[data-civ="eg"] .page-head-pat',
      '[data-civ="gr"] .page-head-pat',
    ]);
    for (const m of pat) expect(m[2]).not.toMatch(/main-ink|opacity/);
    expect(css).toMatch(/\n {2}\.page-head \{\s*--head-tex: color-mix\(in srgb, oklch\(var\(--color-ink\)\) 6%, transparent\);\s*--head-mark: color-mix\(in srgb, oklch\(var\(--color-ink\)\) 34%, transparent\);/);
    expect(css).toMatch(/\n {2}\.light \.page-head \{\s*--head-tex: color-mix\(in srgb, oklch\(var\(--color-ink\)\) 5%, transparent\);\s*--head-mark: color-mix\(in srgb, oklch\(var\(--color-ink\)\) 30%, transparent\);/);
  });

  it("顶线是 --topline 粗的文明字色;加载中变成进度线,不放转圈", () => {
    const topline = /\n {2}\.page-head-topline \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(topline).toMatch(/height: var\(--topline\);/);
    expect(topline).toMatch(/background: oklch\(var\(--color-main-ink\)\);/);
    render(<PageShell title="名册" isLoading skeleton={<div data-testid="sk" />}>body</PageShell>);
    expect(screen.getByTestId("page-head").querySelector(".page-head-topline")).toHaveAttribute("data-loading", "");
    expect(screen.queryByRole("status")).toBeNull();
  });

  // 第四十五批第一节:文明皮的顶线 3px、四家四种形状(CSS 背景),中性皮仍是上面那条 2px 实线。
  it("文明皮的顶线 3px,欧洲双线、埃及缺口、希腊方齿,地府实线", () => {
    const rule = (sel: string) => new RegExp(`\\n {2}${sel.replace(/[[\]"().]/g, "\\$&")} \\{([^}]*)\\}`).exec(css)?.[1] ?? "";
    expect(css).toMatch(/:is\(\[data-civ="cn"\], \[data-civ="eu"\], \[data-civ="eg"\], \[data-civ="gr"\]\) \.page-head-topline \{\s*--tl: oklch\(var\(--color-main-ink\)\);\s*height: 3px;/);
    expect(rule('[data-civ="eu"] .page-head-topline')).toContain("linear-gradient(var(--tl) 0 1px, transparent 1px 2px, var(--tl) 2px 3px)");
    expect(rule('[data-civ="eg"] .page-head-topline')).toContain("repeating-linear-gradient(90deg, var(--tl) 0 42px, transparent 42px 48px)");
    expect(rule('[data-civ="gr"] .page-head-topline')).toContain("repeating-linear-gradient(90deg, var(--tl) 0 4px, transparent 4px 8px) left top / 100% 2px no-repeat");
    // 地府没有自己的背景规则:实线就是基础那条的 main-ink。
    expect(rule('[data-civ="cn"] .page-head-topline')).toBe("");
    // 加载态写在形状后面,同样重的选择器,底(line)盖过形状。
    expect(css.indexOf('[data-civ="gr"] .page-head-topline {')).toBeLessThan(css.indexOf(".page-head-topline[data-loading] {"));
  });
});

describe("立柱横排阈值(C14)", () => {
  it.each([
    ["灵魂业务", false],
    ["组织与领域", true],
    ["Wedja", false],
    ["Maa Neb", false],
    ["Sesh Nefer Isfet", true],
    ["Djadjat E", true],
  ])("%s → 横排 %s", (label, wide) => {
    expect(labelTooLongForVerticalPillar(label)).toBe(wide);
  });

  it("只要一项超过,整根横排", () => {
    expect(pillarIsWide(["概览", "审判"])).toBe(false);
    expect(pillarIsWide(["概览", "审判", "待交付初始密码"])).toBe(true);
  });
});

describe("文明皮的素材表(globals.css → public/v2)", () => {
  const css = fs.readFileSync(path.join(FRONTEND, "app", "globals.css"), "utf8");

  it.each(["cn", "eu", "eg", "gr"])("%s 有文明色(v4 五个值);v2 的分节纹、印素材、印文字体、匾纹都不该再有", (civ) => {
    const blocks = [...css.matchAll(new RegExp(`\\[data-civ="${civ}"\\]\\s*\\{([^}]*)\\}`, "g"))].map((m) => m[1]).join("\n");
    // 先证明找到了这个文明的块,再断言里面没有 v2 素材。
    expect(blocks).toMatch(/--color-main:\s*\S/);
    expect(blocks).not.toMatch(/--section|--seal-|--font-seal|--band|--font-plaque/);
  });

  it("v2 的分节纹撤掉(2026-10-03):CSS 不再引用 public/v2,也没有 .section-rule", () => {
    expect(css).not.toMatch(/url\("\/v2\//);
    expect(css).not.toMatch(/\.section-rule\b/);
  });

  it("public/v2 整个删掉:分节纹是 v2 最后一批素材,不留没人引用的文件", () => {
    expect(fs.existsSync(path.join(FRONTEND, "public"))).toBe(true);
    expect(fs.existsSync(path.join(FRONTEND, "public", "v2"))).toBe(false);
  });

  it("印是 v3 的描边印:currentColor 描边、不填色,印文 font-title + 圣书字回退;身份带上也是文明字色(v4:带不再是匾色实底)", () => {
    const rule = (sel: string) => new RegExp(`\\n {2}${sel.replace(/[.[\]"=]/g, "\\$&")} \\{([^}]*)\\}`).exec(css)?.[1] ?? "";
    const seal = rule(".seal");
    // v4(2026-11-06):默认印色由匾色改为文明字色 civT —— 深色 v4 solid 对 surface-1 只有约 2:1。
    expect(seal).toMatch(/color: oklch\(var\(--color-main-ink\)\);/);
    expect(seal).toMatch(/border: 2px solid currentColor;/);
    expect(seal).toMatch(/outline: 1px solid currentColor;/);
    expect(seal).not.toMatch(/background/);
    // v4(2026-11-06):身份带是 canvas 上的光、字是 ink,印不再随带上的白字 —— 那条 inherit 规则删掉了;
    // 第三十批起身份带整个撤掉,页头(`.page-head`)的字同样是 ink。
    expect(rule(".identity-band .seal")).toBe("");
    expect(rule(".page-head")).toMatch(/color: oklch\(var\(--color-ink\)\);/);
    expect(rule(".seal-glyphs")).toMatch(/font-family: var\(--font-title\), var\(--font-hieroglyphs\);/);
    expect(rule('.seal[data-civ="eu"]')).toMatch(/border-radius: 50%;/);
    expect(rule('.seal[data-civ="gr"]')).toMatch(/clip-path: polygon\(/);
  });

  it("v2 的三款印文字体不再加载:只剩圣书字那一支", () => {
    const fonts = fs.readFileSync(path.join(FRONTEND, "src", "components", "plaque", "fonts.ts"), "utf8");
    expect(fonts.match(/^import .*$/gm)).toEqual(['import { Noto_Sans_Egyptian_Hieroglyphs } from "next/font/google";']);
  });
});
