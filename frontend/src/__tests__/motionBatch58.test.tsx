/**
 * Design v4 batch 58 (motion) on the web: M8 (a refresh with data on screen runs the page head's top line once; the
 * four refresh icons stop spinning) and M9 (load-more in progress draws two skeleton rows, no spinner, no greying).
 * M5 / M7 / M10 / M13 / M6 are in sealMotionTokens, motionTokens, Button, connectionRecovery and Skeleton tests.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { act, fireEvent, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { runTopLine } from "@/lib/topLine";
import { PageShell } from "@/src/components/ui/PageShell";

const read = (p: string) => readFileSync(path.join(__dirname, "..", "..", p), "utf8");
const CSS = read("app/globals.css");

describe("M8 / 第六十批 P2: the top line runs once for a refresh someone waits on, never for a poll or a push", () => {
  const topline = (c: HTMLElement) => c.querySelector(".page-head-topline") as HTMLElement;
  const setup = () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(
      <QueryClientProvider client={client}>
        <PageShell title="T">body</PageShell>
      </QueryClientProvider>
    );
    let finish = (_v: number) => {};
    const fetchAgain = () =>
      act(() => {
        void client.fetchQuery({ queryKey: ["x"], queryFn: () => new Promise<number>((r) => (finish = r)) });
      });
    return { client, view, fetchAgain, finish: (v: number) => act(async () => finish(v)) };
  };

  it("runTopLine (a manual refresh, a reconnect) sets data-refresh; animationend clears it", () => {
    const { view } = setup();
    expect(topline(view.container)).not.toHaveAttribute("data-refresh");
    act(() => runTopLine());
    expect(topline(view.container)).toHaveAttribute("data-refresh");
    expect(topline(view.container)).not.toHaveAttribute("data-loading");
    // One whole pass, then gone.
    fireEvent.animationEnd(topline(view.container));
    expect(topline(view.container)).not.toHaveAttribute("data-refresh");
  });

  it("a background refetch of data on screen (a poll, a push's invalidation) does not run it", async () => {
    const { client, view, fetchAgain, finish } = setup();
    client.setQueryData(["x"], 1);
    fetchAgain();
    expect(client.isFetching()).toBe(1);
    expect(topline(view.container)).not.toHaveAttribute("data-refresh");
    await finish(2);
    expect(topline(view.container)).not.toHaveAttribute("data-refresh");
  });

  it("a polled query (refetchInterval) ticking does not run it", async () => {
    jest.useFakeTimers();
    try {
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      let calls = 0;
      function Polled() {
        useQuery({ queryKey: ["polled"], queryFn: async () => ++calls, refetchInterval: 1000 });
        return null;
      }
      const view = render(
        <QueryClientProvider client={client}>
          <PageShell title="T">
            <Polled />
          </PageShell>
        </QueryClientProvider>
      );
      await act(async () => {
        await jest.advanceTimersByTimeAsync(3500);
      });
      expect(calls).toBeGreaterThan(2);
      expect(topline(view.container)).not.toHaveAttribute("data-refresh");
    } finally {
      jest.useRealTimers();
    }
  });

  it("without a QueryClient nothing breaks and nothing runs", () => {
    const { container } = render(<PageShell title="T">body</PageShell>);
    expect(topline(container)).not.toHaveAttribute("data-refresh");
  });

  it.each([
    "app/rebirth-applications/page.tsx",
    "app/scheduler/page.tsx",
    "app/soul-credentials/page.tsx",
    "app/soul-inbox/page.tsx",
    "src/components/soul-accounts/CooldownShorteningsContent.tsx",
  ])("%s: the manual refresh button runs the line", (file) => {
    expect(read(file)).toMatch(/onClick=\{\(\) => \{ runTopLine\(\); void queryClient\.invalidateQueries\(/);
  });

  it("CSS: the refresh pass is the loading line, one iteration", () => {
    expect(CSS).toMatch(/\.page-head-topline:is\(\[data-loading\], \[data-refresh\]\)::after \{[^}]*animation: page-head-progress var\(--transition-duration-loading-line\)/);
    expect(CSS).toMatch(/\.page-head-topline\[data-refresh\]::after \{\s*animation-iteration-count: 1;\s*\}/);
  });

  it.each([
    "app/rebirth-applications/page.tsx",
    "app/scheduler/page.tsx",
    "app/soul-credentials/page.tsx",
    "src/components/soul-accounts/CooldownShorteningsContent.tsx",
  ])("%s: the refresh icon no longer spins", (file) => {
    const src = read(file);
    expect(src).toMatch(/<RefreshCw aria-hidden="true" className="w-4 h-4 mr-1 inline" \/>/);
    expect(src).not.toMatch(/animate-spin/);
  });
});

describe("loose durations folded into the four steps / named values", () => {
  it.each([
    // Batch 60 P3: the per-segment step is the 40 stagger, capped at the fifth segment (motionBatch60.test.ts).
    [".route-row .route-walked", /animation: route-draw var\(--transition-duration-slow\)[^;]*;\s*animation-delay: calc\(min\(var\(--i, 0\), 4\) \* var\(--transition-duration-stagger\) \+ var\(--transition-duration-fast\)\);/],
    [".soul-head-emblem", /animation: soul-head-emblem-in var\(--transition-duration-count\) [^;]* var\(--transition-duration-fast\) backwards;/],
    [".kpi-fill", /animation: route-draw var\(--transition-duration-count\) [^;]* var\(--transition-duration-fast\) backwards;/],
  ])("%s", (sel, re) => {
    const body = new RegExp(`\\n${sel.replace(/[.]/g, "\\.")} \\{([^}]*)\\}`).exec(CSS)?.[1] ?? "";
    expect(body).toMatch(re);
    expect(body).not.toMatch(/\d+(\.\d+)?m?s\b/);
  });
});

describe("M9: load-more in progress draws two skeleton rows; the button neither spins nor greys", () => {
  it("the soul timeline", () => {
    const src = read("src/components/souls/detail/SoulTimelineColumn.tsx");
    expect(src).toMatch(/hasMore && onLoadMore && loadingMore \? <LoadMoreSkeleton \/> : null/);
    expect(src).toMatch(/onClick=\{loadingMore \? undefined : onLoadMore\}/);
    expect(src).not.toMatch(/loading=\{loadingMore\}/);
  });

  it("my claimed cases", () => {
    const src = read("src/components/judgment/QueueMinePanel.tsx");
    expect(src).toMatch(/query\.isFetchingNextPage \? <LoadMoreSkeleton \/> : null/);
    expect(src).toMatch(/if \(!query\.isFetchingNextPage\) void query\.fetchNextPage\(\);/);
    expect(src).not.toMatch(/disabled=\{query\.isFetchingNextPage\}|disabled:text-/);
  });
});
