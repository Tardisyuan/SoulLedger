/**
 * 关于 / 致谢页:各节都在,不再发布的素材(v2 题字与印文字体、印的残边扫描)不列;
 * 专名不经语言包,所以 egy 下也原样出现。
 */
import { render, screen, within } from "@testing-library/react";
import AboutPage from "@/app/about/page";
import { I18nProvider } from "@/src/contexts/I18nContext";
import type { Locale } from "@soulledger/core/config/locale";

const renderIn = (locale: Locale) =>
  render(
    <I18nProvider initialLocale={locale}>
      <AboutPage />
    </I18nProvider>
  );

describe("AboutPage", () => {
  it("lists typefaces with their licences; no ornament or seal-edge section", () => {
    renderIn("zh-Hans");
    expect(screen.getByRole("heading", { name: /字体/ })).toBeInTheDocument();
    // v2 的匾纹带与分节纹(取自 Owen Jones)已从两端删光(2026-10-03),纹样一节随之撤掉。
    expect(screen.queryByRole("heading", { name: /纹样/ })).toBeNull();
    expect(screen.queryByText("Owen Jones")).toBeNull();
    for (const font of ["Archivo", "Noto Sans Egyptian Hieroglyphs"]) {
      expect(screen.getByText(font)).toBeInTheDocument();
    }
    // v2's plaque faces, and v2 朱印's other three seal faces (2026-10-03), ship nowhere since v3,
    // so they are not credited.
    for (const font of ["Ma Shan Zheng", "Josefin Slab", "Cinzel", "LXGW Seal", "UnifrakturMaguntia", "GFS Didot"]) {
      expect(screen.queryByText(font)).toBeNull();
    }
    expect(screen.getAllByRole("link", { name: "SIL Open Font License 1.1" })).toHaveLength(6);
  });

  it("no seal-edge section: the four museum scans masked only v2's filled seal, which ships nowhere (2026-10-03)", () => {
    const { container } = renderIn("zh-Hans");
    expect(screen.queryByRole("heading", { name: /印的残边/ })).toBeNull();
    for (const museum of ["Museo Egizio, Torino", "The Metropolitan Museum of Art"]) {
      expect(screen.queryByText(museum)).toBeNull();
    }
    expect(screen.queryByRole("link", { name: "CC0 1.0" })).toBeNull();
    expect(container.textContent).not.toMatch(/CC BY/);
  });

  it("groups open-source dependencies by platform, collapsed, each linked to its registry page", () => {
    const { container } = renderIn("zh-Hans");
    expect(screen.getByRole("heading", { name: /开源软件/ })).toBeInTheDocument();
    const groups = [...container.querySelectorAll("details")];
    expect(groups.map((d) => d.querySelector("summary")?.firstChild?.textContent)).toEqual(["服务器", "网页端", "App", "两端共用"]);
    expect(groups.every((d) => !d.open)).toBe(true);
    const django = screen.getByRole("link", { name: "Django" });
    expect(django).toHaveAttribute("href", "https://pypi.org/project/Django/");
    expect(django.closest("li")).toHaveTextContent("BSD-3-Clause");
    expect(screen.getByRole("link", { name: "@xyflow/react" })).toHaveAttribute("href", "https://www.npmjs.com/package/@xyflow/react");
    // 工作区自己的包不是依赖。
    expect(screen.queryByRole("link", { name: "@soulledger/core" })).toBeNull();
  });

  it("lists the corpus texts under their civilization, and the services with defaults marked", () => {
    renderIn("zh-Hans");
    const inferno = screen.getByText("Inferno IV-XXXIV").closest("li") as HTMLElement;
    expect(inferno).toHaveTextContent("Longfellow 1867 translation");
    expect(within(inferno).getByRole("link", { name: "来源" })).toHaveAttribute("href", "https://www.gutenberg.org/ebooks/1001");
    expect(screen.getByRole("heading", { level: 3, name: "中国" })).toBeInTheDocument();
    const primary = screen.getByText("《太微仙君功過格》").closest("li") as HTMLElement;
    expect(primary).not.toHaveTextContent("参照");
    const refs = ["《抱朴子·微旨》", "《太上感應篇》", "《十戒功過格》", "《文昌帝君功過格·凡例》"].map(
      (title) => screen.getByText(title).closest("li") as HTMLElement
    );
    for (const row of refs) expect(row).toHaveTextContent("参照");
    // 底本在前,参照在后。
    for (const row of refs) expect(primary.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    expect(screen.getByText("均按部署配置")).toBeInTheDocument();
    expect(screen.getByText("Anthropic Claude").closest("li")).toHaveTextContent("默认");
    expect(screen.getByText("OpenAI Chat Completions").closest("li")).not.toHaveTextContent("默认");
    expect(screen.getByText("Claude Design").closest("li")).toHaveTextContent("Anthropic");
  });

  it("keeps proper names as written in egy", async () => {
    renderIn("egy");
    // egy 是懒加载的包:先等它到,否则量到的是 zh 回退。
    expect(await screen.findByRole("heading", { level: 1, name: "Tepy Hena Sesen" })).toBeInTheDocument();
    expect(screen.getByText("Noto Sans Egyptian Hieroglyphs")).toBeInTheDocument();
    expect(screen.getByText("Archivo").closest("li")).toHaveTextContent("SIL Open Font License 1.1");
  });
});
