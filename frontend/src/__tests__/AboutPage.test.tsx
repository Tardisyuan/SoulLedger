/**
 * 关于 / 致谢页:三节都在,都灵 S 2312 写的是核实过的 CC0(不是草案里的 CC BY 2.0),
 * 并链到 Commons 文件页;专名不经语言包,所以 egy 下也原样出现。
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
  it("lists typefaces, ornament and seal-edge images with their licences", () => {
    renderIn("zh-Hans");
    expect(screen.getByRole("heading", { name: /字体/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /纹样/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /印的残边/ })).toBeInTheDocument();
    for (const font of ["Archivo", "LXGW Seal", "Ma Shan Zheng", "Noto Sans Egyptian Hieroglyphs"]) {
      expect(screen.getByText(font)).toBeInTheDocument();
    }
    expect(screen.getAllByRole("link", { name: "SIL Open Font License 1.1" })).toHaveLength(12);
    expect(screen.getByText("Owen Jones").closest("li")).toHaveTextContent("公有领域");
  });

  it("credits Turin S 2312 as CC0 with a link to its Commons page, and nowhere says CC BY", () => {
    const { container } = renderIn("zh-Hans");
    const turin = screen.getByText("Museo Egizio, Torino").closest("li") as HTMLElement;
    expect(within(turin).getByRole("link", { name: "CC0 1.0" })).toHaveAttribute(
      "href",
      "https://creativecommons.org/publicdomain/zero/1.0/"
    );
    expect(within(turin).getByRole("link", { name: "来源" }).getAttribute("href")).toContain("Turin_S_2312");
    expect(container.textContent).not.toMatch(/CC BY/);
  });

  it("keeps proper names as written in egy", async () => {
    renderIn("egy");
    // egy 是懒加载的包:先等它到,否则量到的是 zh 回退。
    expect(await screen.findByRole("heading", { level: 1, name: "Tepy · Sesen" })).toBeInTheDocument();
    expect(screen.getByText("Museo Egizio, Torino")).toBeInTheDocument();
    expect(screen.getByText("Owen Jones").closest("li")).toHaveTextContent("Sesen Neb");
  });
});
