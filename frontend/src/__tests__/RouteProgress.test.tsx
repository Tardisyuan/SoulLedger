/**
 * 路由进度条(审计 2026-11-26 B1):等 150 ms 才亮,新页面在那之前到了就不亮;不离开当前地址的 history 调用
 * (同址 replaceState、只换 hash)不点亮 —— 只有「路径或查询变了」那一处会把它收掉,点亮了就一直挂着;
 * 只换查询的 replaceState(筛选、案卷台 J / K)也不点亮。
 */
import { render } from "@testing-library/react";
import NProgress from "nprogress";
import { RouteProgress, ROUTE_PROGRESS_DELAY_MS } from "@/src/components/layout/RouteProgress";

let pathname = "/souls";
let search = "";
jest.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(search),
}));

let start: jest.SpyInstance;
let done: jest.SpyInstance;

beforeEach(() => {
  jest.useFakeTimers();
  window.history.replaceState(null, "", "/souls");
  pathname = "/souls";
  search = "";
  start = jest.spyOn(NProgress, "start").mockImplementation(() => NProgress);
  done = jest.spyOn(NProgress, "done").mockImplementation(() => NProgress);
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it("waits out the delay before showing, and never shows if the route lands first", () => {
  const view = render(<RouteProgress />);
  window.history.pushState(null, "", "/souls/42");
  jest.advanceTimersByTime(ROUTE_PROGRESS_DELAY_MS - 1);
  expect(start).not.toHaveBeenCalled();

  // The route is on screen within the delay: the bar never lit.
  pathname = "/souls/42";
  view.rerender(<RouteProgress />);
  jest.advanceTimersByTime(ROUTE_PROGRESS_DELAY_MS * 4);
  expect(start).not.toHaveBeenCalled();
});

it("shows for a navigation slower than the delay, and the new route ends it", () => {
  const view = render(<RouteProgress />);
  done.mockClear();
  window.history.pushState(null, "", "/souls/42");
  jest.advanceTimersByTime(ROUTE_PROGRESS_DELAY_MS);
  expect(start).toHaveBeenCalledTimes(1);

  pathname = "/souls/42";
  view.rerender(<RouteProgress />);
  expect(done).toHaveBeenCalled();
});

it.each([
  ["same-URL replaceState", () => window.history.replaceState({ x: 1 }, "", "/souls")],
  ["replaceState with no URL", () => window.history.replaceState({ x: 1 }, "")],
  ["query-only replaceState (a filter, J / K)", () => window.history.replaceState(null, "", "/souls?case=7")],
  ["hash-only pushState", () => window.history.pushState(null, "", "/souls#notifications")],
])("does not light for a %s", (_name, call) => {
  render(<RouteProgress />);
  call();
  jest.advanceTimersByTime(ROUTE_PROGRESS_DELAY_MS * 4);
  expect(start).not.toHaveBeenCalled();
});

it("going back over an in-page anchor (hash-only popstate) does not light it", () => {
  render(<RouteProgress />);
  window.history.replaceState(null, "", "/souls#notifications"); // the URL a back would land on
  window.dispatchEvent(new PopStateEvent("popstate"));
  jest.advanceTimersByTime(ROUTE_PROGRESS_DELAY_MS * 4);
  expect(start).not.toHaveBeenCalled();
});
