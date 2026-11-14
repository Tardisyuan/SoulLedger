/**
 * 系统状况页(2026-11-14):三块各带来源标签;目标表与 docs/SLO.md 逐行相同;探测只是静态徽章加链接,
 * 页面上没有任何向 GitHub 取东西的 <img>(CSP 那一半在 proxyAuthGate.test.ts)。
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { render, screen, waitFor, within } from "@testing-library/react";
import AboutSystemPage from "@/app/about/system/page";
import { I18nProvider } from "@/src/contexts/I18nContext";

const REPO = path.join(__dirname, "..", "..", "..");

const renderIn = (locale: "zh-Hans" | "en") =>
  render(
    <I18nProvider initialLocale={locale}>
      <AboutSystemPage />
    </I18nProvider>,
  );

/** `| A1 | 旅程 | SLI | 99.5% |` 这样的行:编号与最后一格的目标。 */
function documentedTargets(): [string, string][] {
  return readFileSync(path.join(REPO, "docs", "SLO.md"), "utf8")
    .split("\n")
    .map((line) => /^\|\s*([A-E]\d)\s*\|.*\|\s*([\d.]+%)\s*\|\s*$/.exec(line))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => [m[1], m[2]]);
}

describe("AboutSystemPage", () => {
  const realPO = (globalThis as { PerformanceObserver?: unknown }).PerformanceObserver;
  afterEach(() => {
    (globalThis as { PerformanceObserver?: unknown }).PerformanceObserver = realPO;
  });

  it("has the three blocks, each with its own source label", () => {
    renderIn("zh-Hans");
    for (const [id, title, source] of [
      ["measured", "此刻 · 实测", "来源:你的浏览器(PerformanceObserver)"],
      ["slo", "服务目标", "来源:docs/SLO.md · 目标,不是读数"],
      ["probe", "线上探测", "来源:GitHub Actions · 本页不读取结果"],
    ]) {
      const block = screen.getByTestId(`system-${id}`);
      expect(within(block).getByRole("heading", { level: 2 })).toHaveTextContent(title);
      expect(within(block).getByTestId(`system-${id}-source`)).toHaveTextContent(source);
    }
  });

  it("shows no reading where the browser has no PerformanceObserver, never a made-up number", () => {
    delete (globalThis as { PerformanceObserver?: unknown }).PerformanceObserver;
    renderIn("zh-Hans");
    for (const name of ["LCP", "INP", "CLS"]) {
      const cell = screen.getByTestId(`vital-${name}`);
      expect(cell).toHaveTextContent("还没有读数");
      expect(cell.textContent).not.toMatch(/\d/);
    }
  });

  it("rates a reading against Google's thresholds, in words as well as numbers", () => {
    class FakeObserver {
      static supportedEntryTypes = ["largest-contentful-paint", "layout-shift"];
      cb: (_list: { getEntries: () => unknown[] }) => void;
      constructor(cb: FakeObserver["cb"]) {
        this.cb = cb;
      }
      observe({ type }: { type: string }) {
        const entries = type === "largest-contentful-paint" ? [{ startTime: 3000 }] : [{ value: 0.05, hadRecentInput: false }, { value: 9, hadRecentInput: true }];
        this.cb({ getEntries: () => entries });
      }
      disconnect() {}
    }
    (globalThis as { PerformanceObserver?: unknown }).PerformanceObserver = FakeObserver;
    renderIn("zh-Hans");
    expect(screen.getByTestId("vital-LCP")).toHaveTextContent("3000 ms");
    expect(screen.getByTestId("vital-LCP")).toHaveTextContent("待改进");
    // The shift right after input is not counted.
    expect(screen.getByTestId("vital-CLS")).toHaveTextContent("0.050");
    expect(screen.getByTestId("vital-CLS")).toHaveTextContent("好");
    // "event" is not supported by this fake: INP stays empty.
    expect(screen.getByTestId("vital-INP")).toHaveTextContent("还没有读数");
  });

  it("lists exactly the targets docs/SLO.md documents, in its order", () => {
    renderIn("zh-Hans");
    const shown = screen.getAllByTestId("slo-row").map((row) => {
      const cells = row.querySelectorAll("td");
      return [cells[0].textContent, cells[cells.length - 1].textContent];
    });
    const documented = documentedTargets();
    expect(documented.length).toBe(11); // the parser found the table
    expect(shown).toEqual(documented);
    expect(screen.getAllByTestId("slo-row")[1]).toHaveTextContent("≤ 400 ms");
  });

  it("the probe is a static badge and a link to the workflow that exists; nothing is fetched from GitHub", async () => {
    const { container } = renderIn("en");
    const probe = screen.getByTestId("system-probe");
    // The en bundle is a lazy chunk (I18nContext's LAZY_BUNDLES): the first frame is zh-Hans until it lands.
    await waitFor(() => expect(within(probe).getByTestId("probe-badge")).toHaveTextContent("demo probe"));
    const link = within(probe).getByRole("link", { name: "See the probe runs" });
    expect(link.getAttribute("href")).toMatch(/^https:\/\/github\.com\/[^/]+\/[^/]+\/actions\/workflows\/demo-probe\.yml$/);
    expect(existsSync(path.join(REPO, ".github", "workflows", "demo-probe.yml"))).toBe(true);
    expect(container.querySelectorAll("img")).toHaveLength(0);
    expect(container.innerHTML).not.toMatch(/api\.github\.com/);
    // Absence: no red/green status is claimed.
    expect(probe.textContent).not.toMatch(/passing|failing|通过|失败/);
  });
});
