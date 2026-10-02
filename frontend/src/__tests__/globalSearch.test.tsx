/**
 * 全局搜索(规范 v3 A8,docs/design-handoff/v3-pages/A8-search.md)。
 *
 * - 四类顺序写死:案件 → 灵魂 → 律条 → 页面;
 * - 某类 403 整类不出现、也不提示;其它失败只这一类显示「! 加载失败 · 其余几类不受影响 · 重试」,别的照常;
 * - 完整案号那一条排第一、标「案号完全一致」并默认选中 —— 不自动跳;
 * - ↑↓ 跨类连续移动、到头不循环;↵ 打开,⌘↵ 新标签页;Esc 关闭、焦点回到入口;
 * - 没输入时列最近打开的(按用户存在本地);没有记录只有提示行;
 * - 防抖 200ms;每类各自返回各自显示(慢的那类还是骨架,快的已经出结果);
 * - 命中字 600 + 下划线,不用颜色。
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { GlobalSearch } from "@/src/components/layout/GlobalSearch";
import type { SidebarMenu } from "@/src/hooks/useSidebarMenus";
import { tZh } from "./support/zhBundle";

jest.mock("@soulledger/core/api", () => ({
  judgmentApi: { list: jest.fn(), statutes: jest.fn() },
  soulsApi: { list: jest.fn() },
}));
const { judgmentApi, soulsApi } = jest.requireMock("@soulledger/core/api") as Record<string, Record<string, jest.Mock>>;

const mockPush = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: mockPush }) }));
let mockUser: { id: number } | null = { id: 7 };
jest.mock("@/src/contexts/TenantContext", () => ({ useTenant: () => ({ user: mockUser }) }));
jest.mock("@/src/contexts/I18nContext", () => ({
  ...jest.requireActual("@/src/contexts/I18nContext"),
  useI18n: () => ({ t: tZh, locale: "zh-Hans", formatDate: String, formatDateTime: String, hydrated: true }),
}));

const page = <T,>(results: T[], count = results.length) => ({ data: { count, next: null, previous: null, results } });
const judgment = (id: string, caseNumber: string, soulName: string) => ({
  id, case_number: caseNumber, soul: `s-${id}`, soul_name: soulName, civilization: "CHINESE", court: "第五殿", verdict: null,
});
const soul = (id: string, name: string) => ({
  id, name, civilization: "CHINESE", current_state: "ALIVE", birth_date: null, death_date: null, date_problems: [], is_eval_identity: false,
});
const statute = (id: string, title: string, text: string) => ({
  id, code: `CN-${id}`, civilization: "CHINESE", corpus: "YULI", ordinal: 1, polarity: "DEMERIT", payload_json: {},
  display_title: title, display_text: text,
});
const MENUS = [
  { id: 1, name: "灵魂业务", path: "", menu_type: "DIRECTORY", children: [{ id: 2, name: "灵魂管理", path: "/souls", menu_type: "MENU" }] },
  { id: 3, name: "审计日志", path: "/audit", menu_type: "MENU" },
] as unknown as SidebarMenu[];

const forbidden = () => Promise.reject({ response: { status: 403 } });
const broken = () => Promise.reject({ response: { status: 500 } });

function deferred<T>() {
  let resolve!: (_value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

function renderSearch() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = () => (
    <QueryClientProvider client={client}>
      <GlobalSearch menus={MENUS} />
    </QueryClientProvider>
  );
  const view = render(tree());
  return { ...view, rerender: () => view.rerender(tree()) };
}

const input = () => screen.getByRole("combobox");
const groups = () => Array.from(document.querySelectorAll("[data-search-group]")).map((g) => g.getAttribute("data-search-group"));
const options = () => screen.queryAllByRole("option");
const selected = () => options().find((o) => o.getAttribute("aria-selected") === "true");

async function open() {
  fireEvent.click(screen.getByTestId("global-search-entry"));
  await screen.findByRole("combobox");
}
async function search(text: string) {
  fireEvent.change(input(), { target: { value: text } });
}

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  mockUser = { id: 7 };
  judgmentApi.list.mockImplementation(async () => page([judgment("j1", "CN-2026-0001", "沈魂")]));
  soulsApi.list.mockImplementation(async () => page([soul("s1", "沈魂")]));
  judgmentApi.statutes.mockImplementation(async () => page([statute("t1", "魂之律", "凡魂过奈何桥者,先饮孟婆汤。")]));
});

describe("全局搜索", () => {
  it("四类按 案件 → 灵魂 → 律条 → 页面 的固定顺序出现;每类走自己列表接口的 ?search=", async () => {
    renderSearch();
    await open();
    await search("魂");
    await waitFor(() => expect(options()).toHaveLength(4));
    expect(groups()).toEqual(["judgment", "soul", "statute", "page"]);
    expect(options().map((o) => o.getAttribute("data-option-key"))).toEqual(["judgment:j1", "soul:s1", "statute:t1", "page:2"]);
    expect(judgmentApi.list).toHaveBeenCalledWith({ search: "魂" });
    expect(soulsApi.list).toHaveBeenCalledWith({ search: "魂" });
    expect(judgmentApi.statutes).toHaveBeenCalledWith({ search: "魂" });
    // 页面从菜单里筛:目录本身不是页面,不出现;不匹配的「审计日志」也不出现。
    const pages = (document.querySelector('[data-search-group="page"]') as HTMLElement).textContent;
    expect(pages).toContain("灵魂管理 · /souls");
    expect(pages).not.toContain("灵魂业务");
    expect(pages).not.toContain("/audit");
  });

  it("某类 403:整类不出现,也没有失败行", async () => {
    soulsApi.list.mockImplementation(forbidden);
    renderSearch();
    await open();
    await search("魂");
    await waitFor(() => expect(groups()).toEqual(["judgment", "statute", "page"]));
    expect(screen.queryByTestId("search-group-error")).toBeNull();
    expect(screen.queryByText(tZh("search.group_souls"))).toBeNull();
  });

  it("某类失败:只这一类显示「! 加载失败」与重试,其余几类照常;重试成功后换成结果", async () => {
    judgmentApi.statutes.mockImplementationOnce(broken);
    renderSearch();
    await open();
    await search("魂");
    const failed = await screen.findByTestId("search-group-error");
    expect(failed.closest("[data-search-group]")?.getAttribute("data-search-group")).toBe("statute");
    expect(within(failed).getByText(`! ${tZh("search.load_failed")}`)).toBeTruthy();
    expect(within(failed).getByText(tZh("search.others_unaffected"))).toBeTruthy();
    expect(groups()).toEqual(["judgment", "soul", "statute", "page"]);
    expect(options().map((o) => o.getAttribute("data-option-key"))).toEqual(["judgment:j1", "soul:s1", "page:2"]);

    fireEvent.click(within(failed).getByRole("button", { name: tZh("common.retry") }));
    await waitFor(() => expect(screen.queryByTestId("search-group-error")).toBeNull());
    expect(judgmentApi.statutes).toHaveBeenCalledTimes(2);
    expect(options().map((o) => o.getAttribute("data-option-key"))).toContain("statute:t1");
  });

  it("完整案号:那一条排第一、标「案号完全一致」并默认选中,不自动跳", async () => {
    judgmentApi.list.mockImplementation(async () =>
      page([judgment("j9", "CN-2026-0099", "CN-2026-0042 的同名者"), judgment("j42", "CN-2026-0042", "陆晚晴")])
    );
    renderSearch();
    await open();
    await search("cn-2026-0042");
    await waitFor(() => expect(selected()?.getAttribute("data-option-key")).toBe("judgment:j42"));
    expect(options()[0].getAttribute("data-option-key")).toBe("judgment:j42");
    expect(within(options()[0]).getByTestId("search-exact-case").textContent).toBe(tZh("search.exact_case"));
    // 只有那一条带标;另一条没有。
    expect(screen.getAllByTestId("search-exact-case")).toHaveLength(1);
    expect(input().getAttribute("aria-activedescendant")).toBe(options()[0].id);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("键盘:第一条默认选中;↑↓ 跨类连续移动、到头不循环;↵ 打开;⌘↵ / Ctrl↵ 新标签页", async () => {
    const openSpy = jest.spyOn(window, "open").mockImplementation(() => null);
    renderSearch();
    await open();
    await search("魂");
    await waitFor(() => expect(options()).toHaveLength(4));
    const keys = () => selected()?.getAttribute("data-option-key");
    expect(keys()).toBe("judgment:j1");
    fireEvent.keyDown(input(), { key: "ArrowUp" });
    expect(keys()).toBe("judgment:j1");
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    expect(keys()).toBe("soul:s1");
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    expect(keys()).toBe("page:2");
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    expect(keys()).toBe("page:2");
    fireEvent.keyDown(input(), { key: "ArrowUp" });
    expect(keys()).toBe("statute:t1");

    fireEvent.keyDown(input(), { key: "Enter", metaKey: true });
    expect(openSpy).toHaveBeenCalledWith("/corpus?article=t1", "_blank", "noopener,noreferrer");
    expect(mockPush).not.toHaveBeenCalled();
    fireEvent.keyDown(input(), { key: "Enter", ctrlKey: true });
    expect(openSpy).toHaveBeenCalledTimes(2);

    fireEvent.keyDown(input(), { key: "ArrowUp" });
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(mockPush).toHaveBeenCalledWith("/souls/s1");
    openSpy.mockRestore();
  });

  it("最近打开:没输入时列出(按用户存),带类型;没有记录只显示提示行", async () => {
    const view = renderSearch();
    await open();
    expect(options()).toHaveLength(0);
    expect(screen.getByText(tZh("search.hint", { example: "CN-2026-0042" }))).toBeTruthy();
    expect(screen.queryByText(tZh("search.group_recent"))).toBeNull();

    await search("魂");
    await waitFor(() => expect(options()).toHaveLength(4));
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(mockPush).toHaveBeenCalledWith("/souls/s1");
    await waitFor(() => expect(screen.queryByRole("combobox")).toBeNull());

    await open();
    expect(screen.getByText(tZh("search.group_recent"))).toBeTruthy();
    expect(options().map((o) => o.getAttribute("data-option-key"))).toEqual(["recent:soul:s1"]);
    expect(within(options()[0]).getByText(tZh("search.group_souls"))).toBeTruthy();
    expect(screen.getByText(tZh("search.hint", { example: "CN-2026-0042" }))).toBeTruthy();
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(mockPush).toHaveBeenLastCalledWith("/souls/s1");

    // 别的用户看不到这一条。
    await waitFor(() => expect(screen.queryByRole("combobox")).toBeNull());
    mockUser = { id: 8 };
    view.rerender();
    await open();
    expect(options()).toHaveLength(0);
  });

  it("防抖 200ms;每类各自返回各自显示 —— 慢的那类还是骨架,快的已经出结果", async () => {
    jest.useFakeTimers();
    try {
      const slowSouls = deferred<ReturnType<typeof page>>();
      soulsApi.list.mockImplementation(() => slowSouls.promise);
      renderSearch();
      await open();
      await search("魂");
      act(() => { jest.advanceTimersByTime(199); });
      expect(judgmentApi.list).not.toHaveBeenCalled();
      act(() => { jest.advanceTimersByTime(1); });
      await waitFor(() => expect(options().map((o) => o.getAttribute("data-option-key"))).toContain("judgment:j1"));
      expect(judgmentApi.list).toHaveBeenCalledTimes(1);
      const soulGroup = document.querySelector('[data-search-group="soul"]') as HTMLElement;
      expect(within(soulGroup).getAllByTestId("search-skeleton")).toHaveLength(3);
      expect(within(document.querySelector('[data-search-group="judgment"]') as HTMLElement).queryByTestId("search-skeleton")).toBeNull();

      await act(async () => { slowSouls.resolve(page([soul("s1", "沈魂")])); });
      await waitFor(() => expect(screen.queryAllByTestId("search-skeleton")).toHaveLength(0));
      expect(options().map((o) => o.getAttribute("data-option-key"))).toContain("soul:s1");
    } finally {
      jest.useRealTimers();
    }
  });

  it("之后的搜索保留上一次的结果,只出 2px 进度条,不回到骨架", async () => {
    renderSearch();
    await open();
    await search("魂");
    await waitFor(() => expect(options()).toHaveLength(4));
    const slow = deferred<ReturnType<typeof page>>();
    judgmentApi.list.mockImplementation(() => slow.promise);
    await search("沈魂");
    // 防抖之后、请求还在路上的那一段 —— 不是防抖期间。
    await waitFor(() => expect(judgmentApi.list).toHaveBeenCalledWith({ search: "沈魂" }));
    expect(screen.getByTestId("search-progress")).toBeTruthy();
    expect(options().map((o) => o.getAttribute("data-option-key"))).toContain("judgment:j1");
    expect(screen.queryAllByTestId("search-skeleton")).toHaveLength(0);
    await act(async () => { slow.resolve(page([judgment("j1", "CN-2026-0001", "沈魂")])); });
    await waitFor(() => expect(screen.queryByTestId("search-progress")).toBeNull());
  });

  it("Esc 关闭,焦点回到入口按钮;⌘K 打开且焦点在输入框", async () => {
    renderSearch();
    const entry = screen.getByTestId("global-search-entry");
    fireEvent.click(entry);
    await waitFor(() => expect(document.activeElement).toBe(input()));
    fireEvent.keyDown(input(), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("combobox")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(entry));

    fireEvent.keyDown(window, { key: "k", metaKey: true });
    await waitFor(() => expect(document.activeElement).toBe(input()));
  });

  it("命中字:600 + 下划线,不用颜色", async () => {
    renderSearch();
    await open();
    await search("魂");
    await waitFor(() => expect(options()).toHaveLength(4));
    const hits = Array.from(document.querySelectorAll("[data-search-hit]"));
    expect(hits.length).toBeGreaterThan(3);
    for (const hit of hits) {
      expect(hit.textContent).toBe("魂");
      expect(hit.classList).toContain("font-semibold");
      expect(hit.classList).toContain("underline");
      expect(Array.from(hit.classList).filter((c) => /^(text|bg|decoration)-\[|^(text|bg)-(accent|danger|ink|status)/.test(c))).toEqual([]);
      expect(hit.tagName).not.toBe("MARK");
    }
  });

  it("没有结果:衬线标题「没有找到「…」」和一行说明;读屏播报各类条数", async () => {
    judgmentApi.list.mockImplementation(async () => page([]));
    soulsApi.list.mockImplementation(async () => page([]));
    judgmentApi.statutes.mockImplementation(async () => page([]));
    renderSearch();
    await open();
    await search("无此人");
    const empty = await screen.findByTestId("search-no-results");
    expect(within(empty).getByText(tZh("search.no_results_title", { q: "无此人" })).className).toContain("font-title");
    expect(screen.getByRole("status").textContent).toBe(
      ["search.group_judgments", "search.group_souls", "search.group_statutes", "search.group_pages"]
        .map((g) => tZh("search.announce_group", { group: tZh(g), n: "0" }))
        .join(" · ")
    );
  });

  it("超过 5 条:只列 5 条,组尾「查看全部 N 个灵魂 →」带 ?q= 跳列表页", async () => {
    soulsApi.list.mockImplementation(async () => page(Array.from({ length: 5 }, (_, i) => soul(`s${i}`, `魂${i}`)), 12));
    renderSearch();
    await open();
    await search("魂");
    const viewAll = await screen.findByText(tZh("search.view_all_souls", { n: "12" }));
    const soulGroup = within(document.querySelector('[data-search-group="soul"]') as HTMLElement);
    expect(soulGroup.getAllByRole("option")).toHaveLength(6);
    expect(soulGroup.getByText(tZh("search.count_more", { shown: "5", n: "12" }))).toBeTruthy();
    fireEvent.mouseDown(viewAll.closest('[role="option"]') as HTMLElement, { button: 0 });
    expect(mockPush).toHaveBeenCalledWith("/souls?q=%E9%AD%82");
    // 「查看全部」不进最近打开。
    expect(window.localStorage.getItem("soulledger.search.recent.7")).toBeNull();
  });
});
