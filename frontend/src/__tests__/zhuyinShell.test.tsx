/**
 * 外框:印(规范 v3 描边印)、身份带(规范 v3,取代 v2 的匾)的题字降档、矮带与滚动收起、
 * 立柱横排阈值,以及 `[data-civ]` 规则里不再有 v2 素材(`app/globals.css` → `public/v2/`)。
 *
 * 素材那一组:v2 的实底印(遮罩 + 残边扫描)随 v3 描边印撤掉;v2 的分节纹(CSS 遮罩
 * `--section` + `.section-rule` + public/v2/svg/section-*)随 `SectionTitle` 撤掉(2026-10-03)。
 */
import fs from "node:fs";
import path from "node:path";
import { act, fireEvent, render, screen } from "@testing-library/react";

const mockTenant: { code: string; display_name: string; seal_glyphs?: string[] } = { code: "CN_DIYU", display_name: "第五殿" };
jest.mock("@/src/contexts/TenantContext", () => ({
  useTenant: () => ({ user: { id: 1, tenant: mockTenant } }),
}));
jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({
    t: (key: string, p?: Record<string, string>) => (key === "seal.aria" ? `${p?.court}之印` : key),
    locale: "zh-Hans",
  }),
}));

import { Seal, sealGlyphsFor, DEFAULT_SEAL_GLYPHS } from "@/src/components/plaque/Seal";
import { fitTier, Plaque, shortBandFor } from "@/src/components/plaque/Plaque";
import { labelTooLongForVerticalPillar, pillarIsWide } from "@soulledger/core/domain/pillar";

const FRONTEND = path.join(__dirname, "..", "..");

beforeEach(() => {
  mockTenant.code = "CN_DIYU";
  delete mockTenant.seal_glyphs;
});

describe("印", () => {
  it("读屏读「{殿名}之印」,印文本身不念", () => {
    render(<Seal size={52} />);
    const seal = screen.getByRole("img", { name: "第五殿之印" });
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

describe("身份带题字按实测宽度降档(C14)", () => {
  /** jsdom 不排版;给一个按档位报宽度的元素:40 档 300、28 档 `at28`、20 档 50,容器 100。 */
  function measured(at28: number) {
    const el = document.createElement("div");
    Object.defineProperty(el, "clientWidth", { value: 100 });
    Object.defineProperty(el, "scrollWidth", {
      get: () => (el.className.includes("text-display") ? 300 : el.className.includes("text-xl") ? at28 : 50),
    });
    return el;
  }

  it("40 放不下、28 放得下 → 28", () => {
    const el = measured(90);
    expect(fitTier(el)).toBe(1);
    expect(el.className).toContain("text-xl");
  });

  it("28 也放不下 → 20,两行,仍是标题字体", () => {
    const el = measured(140);
    expect(fitTier(el)).toBe(2);
    expect(el.className).toContain("line-clamp-2");
    expect(el.className).toContain("font-title");
  });

  it("40 放得下就是 40", () => {
    const el = document.createElement("div");
    expect(fitTier(el)).toBe(0);
    expect(el.className).toContain("text-display");
  });

  it("≤ 768 从 28 起:放得下 40 也不用 40", () => {
    const el = document.createElement("div");
    expect(fitTier(el, 1)).toBe(1);
    expect(el.className).not.toContain("text-display");
  });
});

describe("矮带(审判队列、灵魂详情)", () => {
  it.each([
    ["/judgment/queue", true],
    ["/souls/42", true],
    ["/souls/3f9a0c1e-0000-4000-8000-000000000000", true],
    ["/souls", false],
    ["/judgment", false],
    ["/judgment/42", false],
    ["/judgment/queue/x", false],
    ["/souls/42/x", false],
  ])("%s → 矮带 %s", (path, short) => {
    expect(shortBandFor(path)).toBe(short);
  });

  it("矮带标 data-short、题字从 28 起(放得下 40 也不用 40);印仍是 64", () => {
    render(<Plaque title="审判队列" collapsible short />);
    const band = screen.getByTestId("plaque");
    expect(band).toHaveAttribute("data-short");
    expect(band.querySelector("[data-tier]")).toHaveAttribute("data-tier", "1");
    expect(screen.getByRole("img").style.width).toBe("64px");
  });

  it("不是矮带的不标,放得下就是 40", () => {
    render(<Plaque title="审判台" collapsible />);
    const band = screen.getByTestId("plaque");
    expect(band).not.toHaveAttribute("data-short");
    expect(band.querySelector("[data-tier]")).toHaveAttribute("data-tier", "0");
  });

  it("从 20 起(≤ 768 的矮带)", () => {
    const el = document.createElement("div");
    expect(fitTier(el, 2)).toBe(2);
    expect(el.className).toContain("line-clamp-2");
  });

  const css = fs.readFileSync(path.join(FRONTEND, "app", "globals.css"), "utf8");
  it("矮带 116 高,写在收起之前(收起的 48 赢)", () => {
    const short = css.indexOf(".identity-band[data-short] {");
    const compact = css.indexOf(".identity-band[data-compact] {");
    expect(/\.identity-band\[data-short\] \{\s*height: 116px;/.test(css)).toBe(true);
    expect(short).toBeGreaterThan(-1);
    expect(short).toBeLessThan(compact);
  });
});

describe("身份带(规范 v3)", () => {
  it("品牌小字、殿名、题字;纹样只是装饰;没有 v2 的回纹带", () => {
    render(<Plaque title="审判台" />);
    const band = screen.getByTestId("plaque");
    expect(band).toHaveClass("identity-band");
    expect(band.querySelector(".identity-pattern")).toHaveAttribute("aria-hidden", "true");
    expect(band.querySelector(".identity-brand")).toHaveTextContent("SOULLEDGER nav.title");
    // No hall given: the civilization's realm name, not the tenant's stored display name —
    // on the 115 box that name is English ("Chinese Afterlife") under a Chinese UI.
    expect(band.querySelector(".identity-court")).toHaveTextContent("plaque.realm.cn");
    expect(band.querySelector(".identity-court")).not.toHaveTextContent("第五殿");
    expect(band.querySelector("[data-tier]")).toHaveTextContent("审判台");
    expect(band.querySelector(".plaque-band, .plaque-tex")).toBeNull();
  });

  describe("滚动收起", () => {
    let scrollY = 0;
    let scrollHeight = 3000;
    beforeEach(() => {
      scrollY = 0;
      scrollHeight = 3000;
      Object.defineProperty(window, "scrollY", { configurable: true, get: () => scrollY });
      Object.defineProperty(document.documentElement, "scrollHeight", { configurable: true, get: () => scrollHeight });
    });
    const scrollTo = (y: number) =>
      act(() => {
        scrollY = y;
        fireEvent.scroll(window);
      });

    it("滚过 60 收起,印缩到 30;回到顶才展开", () => {
      render(<Plaque title="审判台" collapsible />);
      const band = screen.getByTestId("plaque");
      scrollTo(60);
      expect(band).not.toHaveAttribute("data-compact");
      scrollTo(61);
      expect(band).toHaveAttribute("data-compact");
      expect(screen.getByRole("img").style.width).toBe("30px");
      scrollTo(10);
      expect(band).toHaveAttribute("data-compact");
      scrollTo(0);
      expect(band).not.toHaveAttribute("data-compact");
      expect(screen.getByRole("img").style.width).toBe("64px");
    });

    it("页面不够长就不收:收了会把滚动位置夹回顶、又展开,在页底来回跳", () => {
      // 展开 156、收起 48:收起让文档短 108。可滚的余量只有 150,收了只剩 42 —— 不收。
      scrollHeight = window.innerHeight + 150;
      const offset = jest.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(156);
      try {
        render(<Plaque title="审判台" collapsible />);
        scrollTo(100);
        expect(screen.getByTestId("plaque")).not.toHaveAttribute("data-compact");
        // 同一个页面再长 100 就收得下了 —— 判据是余量,不是一律不收。
        scrollHeight = window.innerHeight + 250;
        scrollTo(101);
        expect(screen.getByTestId("plaque")).toHaveAttribute("data-compact");
      } finally {
        offset.mockRestore();
      }
    });

    it("吸顶的那条把自己的实际高度写到 <html> 的 --identity-band(筛选栏据此吸顶);卸载时擦掉", () => {
      const offset = jest.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(156);
      try {
        const { unmount } = render(<Plaque title="审判台" collapsible />);
        expect(document.documentElement.style.getPropertyValue("--identity-band")).toBe("156px");
        unmount();
        expect(document.documentElement.style.getPropertyValue("--identity-band")).toBe("");
        render(<Plaque title="灵魂账本" heading />);
        expect(document.documentElement.style.getPropertyValue("--identity-band")).toBe("");
      } finally {
        offset.mockRestore();
      }
    });

    it("不是 collapsible 的(登录页)不收", () => {
      render(<Plaque title="灵魂账本" heading />);
      scrollTo(500);
      expect(screen.getByTestId("plaque")).not.toHaveAttribute("data-compact");
    });
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

  it.each(["cn", "eu", "eg", "gr"])("%s 只有匾色;v2 的分节纹、印素材、印文字体、匾纹都不该再有", (civ) => {
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

  it("印是 v3 的描边印:currentColor 描边、不填色,印文 font-title + 圣书字回退;身份带上随带上的白字", () => {
    const rule = (sel: string) => new RegExp(`\\n {2}${sel.replace(/[.[\]"=]/g, "\\$&")} \\{([^}]*)\\}`).exec(css)?.[1] ?? "";
    const seal = rule(".seal");
    expect(seal).toMatch(/color: oklch\(var\(--color-main\)\);/);
    expect(seal).toMatch(/border: 2px solid currentColor;/);
    expect(seal).toMatch(/outline: 1px solid currentColor;/);
    expect(seal).not.toMatch(/background/);
    expect(rule(".identity-band .seal")).toMatch(/color: inherit;/);
    expect(rule(".seal-glyphs")).toMatch(/font-family: var\(--font-title\), var\(--font-hieroglyphs\);/);
    expect(rule('.seal[data-civ="eu"]')).toMatch(/border-radius: 50%;/);
    expect(rule('.seal[data-civ="gr"]')).toMatch(/clip-path: polygon\(/);
  });

  it("v2 的三款印文字体不再加载:只剩圣书字那一支", () => {
    const fonts = fs.readFileSync(path.join(FRONTEND, "src", "components", "plaque", "fonts.ts"), "utf8");
    expect(fonts.match(/^import .*$/gm)).toEqual(['import { Noto_Sans_Egyptian_Hieroglyphs } from "next/font/google";']);
  });
});
