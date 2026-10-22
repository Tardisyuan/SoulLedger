/**
 * app/events/page.tsx —「灵魂事件」(第三十七批 W-13)。
 *
 * 断言的是用户读到的字(`tZh`,真 zh-Hans 包),不是回声的键:事件名、「系统」、细节列都要
 * 是翻译过的词,原样的枚举成员一个都不能出现在格子里。
 */
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import SoulEventsPage from "@/app/events/page";
import { EventTypeFilter } from "@/src/components/events/EventTypeFilter";
import { eventsApi } from "@soulledger/core/api";
import { tZh } from "./support/zhBundle";

jest.mock("@soulledger/core/api", () => ({
  eventsApi: { list: jest.fn(), actors: jest.fn() },
  PAGE_SIZE: 20,
  menusApi: {
    all: jest.fn().mockResolvedValue({ data: [] }),
    list: jest.fn().mockResolvedValue({ data: { results: [] } }),
  },
}));

jest.mock("@/src/contexts/TenantContext", () => ({
  useTenant: () => ({ isAdmin: false, tenantCode: "CN_DIYU", user: { role: "VIEWER", permissions: ["soul.read"] } }),
}));

jest.mock("@/src/contexts/I18nContext", () => {
  const { tZh: t } = jest.requireActual("./support/zhBundle");
  return {
    useI18n: () => ({
      t,
      tf: (key: string, fallback: string) => t(key) === key ? fallback : t(key),
      formatDateTime: (v: string) => `dt(${v})`,
      formatDate: (v: string) => v,
      locale: "zh-Hans",
      hydrated: true,
    }),
  };
});

const mockedList = eventsApi.list as jest.Mock;
const mockedActors = eventsApi.actors as jest.Mock;

function event(over: Record<string, unknown> = {}) {
  return {
    id: "e1",
    soul: "soul-1",
    soul_name: "周阿满",
    event_type: "STATE_CHANGED",
    payload: { old_state: "ALIVE", new_state: "JUDGING", reason: "认领" },
    actor: "cui",
    create_time: "2026-10-17T06:10:00Z",
    ...over,
  };
}

function page(results: unknown[], count = results.length) {
  return { data: { count, next: null, previous: null, results } };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(<SoulEventsPage />, { wrapper: Wrapper });
}

beforeEach(() => {
  localStorage.clear();
  mockedList.mockReset().mockResolvedValue(page([event()]));
  mockedActors.mockReset().mockResolvedValue({ data: ["cui", "meng"] });
});

describe("SoulEventsPage", () => {
  it("asks for the last 7 days without system events by default", async () => {
    renderPage();
    await waitFor(() => expect(mockedList).toHaveBeenCalled());
    const params = mockedList.mock.calls[0][0];
    expect(params.exclude_system).toBe("1");
    expect(params.start_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(params).not.toHaveProperty("ordering");
  });

  it("drops exclude_system once 含系统事件 is ticked", async () => {
    renderPage();
    await waitFor(() => expect(mockedList).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("checkbox", { name: tZh("events.include_system") }));
    await waitFor(() => expect(mockedList.mock.calls.at(-1)[0]).not.toHaveProperty("exclude_system"));
  });

  it("links only the soul, to its lifecycle timeline", async () => {
    renderPage();
    const link = await screen.findByRole("link", { name: "周阿满" });
    expect(link.getAttribute("href")).toBe("/souls/soul-1#lifecycle");
    const row = link.closest("tr")!;
    expect(within(row).getAllByRole("link")).toHaveLength(1);
    // 操作人是纯文本。
    expect(within(row).getByText("cui").closest("a")).toBeNull();
  });

  it("names the event and the states in words, never the raw members", async () => {
    renderPage();
    const row = (await screen.findByRole("link", { name: "周阿满" })).closest("tr")!;
    expect(within(row).getByText(tZh("souls.events.STATE_CHANGED"))).toBeInTheDocument();
    expect(within(row).getByText(`${tZh("souls.states.ALIVE")} → ${tZh("souls.states.JUDGING")} · 认领`)).toBeInTheDocument();
    expect(row.textContent).not.toContain("STATE_CHANGED");
    expect(row.textContent).not.toContain("JUDGING");
  });

  it("writes 系统 for a system actor", async () => {
    mockedList.mockResolvedValue(page([event({ actor: "system", event_type: "DEATH_SYNC_RECEIVED", payload: {} })]));
    renderPage();
    const row = (await screen.findByRole("link", { name: "周阿满" })).closest("tr")!;
    expect(within(row).getByText(tZh("events.actor_system"))).toBeInTheDocument();
    expect(row.textContent).not.toContain("system");
  });

  it("folds same soul + same event into one ×N row, and keeps other souls apart", async () => {
    mockedList.mockResolvedValue(
      page([
        event({ id: "a", event_type: "KARMA_RECALCULATED", payload: { delta: 12, demerit_delta: -4 }, create_time: "2026-10-17T03:48:00Z" }),
        event({ id: "b", event_type: "KARMA_RECALCULATED", payload: { delta: 1 }, create_time: "2026-10-17T03:40:00Z" }),
        event({ id: "c", soul: "soul-2", soul_name: "王二", event_type: "KARMA_RECALCULATED", create_time: "2026-10-17T03:30:00Z" }),
      ])
    );
    renderPage();
    const first = (await screen.findByRole("link", { name: "周阿满" })).closest("tr")!;
    expect(first.textContent).toContain("×2");
    // 细节取最近一条。
    expect(first.textContent).toContain("功 +12 · 过 −4");
    const second = screen.getByRole("link", { name: "王二" }).closest("tr")!;
    expect(second.textContent).not.toContain("×");
    expect(screen.getAllByRole("link", { name: "周阿满" })).toHaveLength(1);
  });

  it("filters by actor through the server", async () => {
    renderPage();
    await waitFor(() => expect(mockedActors).toHaveBeenCalled());
    const select = screen.getByRole("combobox", { name: tZh("events.col_actor") });
    await waitFor(() => expect(within(select).getByRole("option", { name: "meng" })).toBeInTheDocument());
    fireEvent.change(select, { target: { value: "meng" } });
    await waitFor(() => expect(mockedList.mock.calls.at(-1)[0]).toMatchObject({ actor: "meng", page: "1" }));
  });

  it("searches souls on the server after the user stops typing", async () => {
    renderPage();
    await waitFor(() => expect(mockedList).toHaveBeenCalled());
    fireEvent.change(screen.getByRole("searchbox", { name: tZh("events.search_soul") }), { target: { value: "阿满" } });
    await waitFor(() => expect(mockedList.mock.calls.at(-1)[0]).toMatchObject({ search: "阿满" }), { timeout: 2000 });
  });

  it("says the list failed in its own words", async () => {
    mockedList.mockRejectedValue(new Error("boom"));
    renderPage();
    expect(await screen.findByText(tZh("events.failed"))).toBeInTheDocument();
  });
});

describe("EventTypeFilter", () => {
  it("lists the six groups as unselectable headings and filters by the search box", async () => {
    const onChange = jest.fn();
    render(<EventTypeFilter value="" onChange={onChange} />);
    fireEvent.click(screen.getByRole("combobox", { name: tZh("events.col_event") }));
    expect(await screen.findByText(tZh("events.groups.lifecycle"))).toBeInTheDocument();
    expect(screen.getByText(tZh("events.groups.punishment"))).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: tZh("events.groups.lifecycle") })).toBeNull();

    fireEvent.change(screen.getByPlaceholderText(tZh("events.search_type")), { target: { value: tZh("souls.events.WORKFLOW_CREATED") } });
    await waitFor(() => expect(screen.queryByRole("option", { name: tZh("souls.events.STATE_CHANGED") })).toBeNull());
    fireEvent.click(screen.getByRole("option", { name: tZh("souls.events.WORKFLOW_CREATED") }));
    expect(onChange).toHaveBeenCalledWith("WORKFLOW_CREATED");
  });
});

describe("SoulEventsPage remembered filters (2026-10-23)", () => {
  const KEY = "soulledger.events.filters";

  it("stored filters come back on mount and reach the query; 全部 is remembered as all", async () => {
    localStorage.setItem(KEY, JSON.stringify({ actor: "meng", datePreset: "all", includeSystem: "1" }));
    renderPage();
    await waitFor(() => expect(mockedList.mock.calls.at(-1)[0].actor).toBe("meng"));
    const params = mockedList.mock.calls.at(-1)[0];
    expect(params).not.toHaveProperty("start_date");
    expect(params).not.toHaveProperty("exclude_system");
    expect((screen.getByRole("checkbox", { name: tZh("events.include_system") }) as HTMLInputElement).checked).toBe(true);
  });

  it("ticking 含系统事件 is stored; the soul search is not", async () => {
    renderPage();
    await waitFor(() => expect(mockedList).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("checkbox", { name: tZh("events.include_system") }));
    fireEvent.change(screen.getByRole("searchbox", { name: tZh("events.search_soul") }), { target: { value: "周" } });
    await waitFor(() => expect(JSON.parse(localStorage.getItem(KEY) ?? "{}").includeSystem).toBe("1"));
    expect(localStorage.getItem(KEY)).not.toContain("周");
  });

  it("offers the column menu, with the soul column pinned", async () => {
    renderPage();
    await waitFor(() => expect(mockedList).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: tZh("list.columns.button", { shown: "5", total: "5" }) }));
    expect(await screen.findByText(tZh("list.columns.pinned"))).toBeInTheDocument();
  });
});
