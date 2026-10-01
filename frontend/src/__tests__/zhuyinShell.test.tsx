/**
 * 外框:印、身份带(规范 v3,取代 v2 的匾)的题字降档与滚动收起、立柱横排阈值,以及把印
 * 接到素材上的那张 CSS 表(`app/globals.css` 的 `[data-civ]` 规则 → `public/v2/`)。
 *
 * 素材那一组是这份文件存在的主要理由:印全是 CSS 遮罩,url 写错一个字母,
 * 浏览器只会安静地画出一块实心匾色(遮罩图取不到 = 不遮),tsc、eslint、jest、
 * next build 全绿。所以直接对账「每个文明的每一层都有、指向的文件都在」。
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
import { fitTier, Plaque } from "@/src/components/plaque/Plaque";
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

  it("字号 = 印尺寸 × 文明系数;埃及两字竖排每字 0.46", () => {
    const { rerender } = render(<Seal size={100} />);
    expect((screen.getByRole("img").querySelector(".seal-glyphs") as HTMLElement).style.fontSize).toBe("54px");
    rerender(<Seal size={100} civ="eg" glyphs={["\u{13184}", "\u{131CB}"]} />);
    const glyphs = screen.getByRole("img").querySelector(".seal-glyphs") as HTMLElement;
    expect(glyphs.style.fontSize).toBe("46px");
    expect(glyphs.children).toHaveLength(2);
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

  it("≤ 32 只留外形、粗框、印文:没有残边环,线层换 line-small", () => {
    render(<Seal size={32} />);
    const seal = screen.getByRole("img");
    expect(seal).toHaveAttribute("data-small");
    expect(seal.querySelector(".seal-ring")).toBeNull();
    expect(seal.querySelector(".seal-body")).not.toBeNull();
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

describe("身份带(规范 v3)", () => {
  it("品牌小字、殿名、题字;纹样只是装饰;没有 v2 的回纹带", () => {
    render(<Plaque title="审判台" />);
    const band = screen.getByTestId("plaque");
    expect(band).toHaveClass("identity-band");
    expect(band.querySelector(".identity-pattern")).toHaveAttribute("aria-hidden", "true");
    expect(band.querySelector(".identity-brand")).toHaveTextContent("SOULLEDGER nav.title");
    expect(band.querySelector(".identity-court")).toHaveTextContent("第五殿");
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
  const LAYERS = ["--seal-body", "--seal-ring", "--seal-line", "--seal-line-small", "--seal-scan", "--section"];

  it.each(["cn", "eu", "eg", "gr"])("%s 的每一层都有声明", (civ) => {
    const blocks = [...css.matchAll(new RegExp(`\\[data-civ="${civ}"\\]\\s*\\{([^}]*)\\}`, "g"))].map((m) => m[1]).join("\n");
    for (const layer of LAYERS) expect(blocks).toMatch(new RegExp(`${layer}:\\s*\\S`));
    // 印文字体变量也在;v2 的匾纹、质感、题字字体随 v3 身份带撤掉了,不该再有。
    expect(blocks).toMatch(/--font-seal:\s*var\(--font-/);
    expect(blocks).not.toMatch(/--band|--font-plaque/);
  });

  it("引用的每一个素材文件都在 public/ 里", () => {
    const urls = [...css.matchAll(/url\("(\/v2\/[^"]+)"\)/g)].map((m) => m[1]);
    expect(urls.length).toBeGreaterThanOrEqual(4 * 7); // 4 文明 × (印 4 + 扫描 2 + 分节 1)
    const missing = urls.filter((u) => !fs.existsSync(path.join(FRONTEND, "public", u)));
    expect(missing).toEqual([]);
  });

  it("入库的 SVG 剥掉了 c2pa 元数据,且都是单色 currentColor", () => {
    const dir = path.join(FRONTEND, "public", "v2", "svg");
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".svg"));
    expect(files).toHaveLength(20); // 4 文明 × (印 4 + 分节 1);v2 的 8 张匾纹随身份带删掉
    for (const f of files) {
      const svg = fs.readFileSync(path.join(dir, f), "utf8");
      expect(svg).not.toMatch(/c2pa|<metadata/);
      expect(svg).toContain("currentColor");
    }
  });

  it("没配文明的素材不入库(bronze / wax / inkseal / 裁切前原图)", () => {
    const tex = fs.readdirSync(path.join(FRONTEND, "public", "v2", "textures"));
    expect(tex.filter((f) => /bronze|^wax|inkseal|source/.test(f))).toEqual([]);
  });
});
