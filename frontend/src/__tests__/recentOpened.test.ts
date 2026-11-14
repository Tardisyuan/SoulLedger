/**
 * D5 「最近打开」records every way in (`src/lib/recentOpened.ts`): newest first, one row per item, ten at most,
 * per user, and the detail-page hook records only once the data is there.
 */
import { renderHook } from "@testing-library/react";
import { RECENT_LIMIT, pushRecent, readRecent, useRecordOpened, type RecentItem } from "@/src/lib/recentOpened";

const soul = (n: number): RecentItem => ({ kind: "soul", id: `s${n}`, href: `/souls/s${n}`, title: `Soul ${n}` });

describe("recentOpened", () => {
  it("keeps ten, newest first, without repeats", () => {
    expect(RECENT_LIMIT).toBe(10);
    for (let n = 1; n <= 12; n++) pushRecent(7, soul(n));
    pushRecent(7, soul(5)); // opened again: moves to the top, not a second row
    const ids = readRecent(7).map((r) => r.id);
    expect(ids).toHaveLength(10);
    expect(ids[0]).toBe("s5");
    expect(ids.filter((id) => id === "s5")).toHaveLength(1);
    expect(ids).not.toContain("s1");
    expect(ids).not.toContain("s2");
  });

  it("is per user", () => {
    pushRecent(7, soul(1));
    expect(readRecent(8)).toEqual([]);
  });

  it("the same id in another kind is another row", () => {
    pushRecent(7, soul(1));
    pushRecent(7, { kind: "judgment", id: "s1", href: "/judgment/s1", title: "CN-2026-0001" });
    expect(readRecent(7)).toHaveLength(2);
  });

  it("a detail page records itself once its data has arrived, and not before", () => {
    const { rerender } = renderHook(({ item }: { item: RecentItem | null }) => useRecordOpened(7, item), {
      initialProps: { item: null as RecentItem | null },
    });
    expect(readRecent(7)).toEqual([]);
    rerender({ item: { kind: "judgment", id: "j1", href: "/judgment/j1", title: "CN-2026-0042", sub: "张三 · 秦广殿" } });
    expect(readRecent(7)).toEqual([{ kind: "judgment", id: "j1", href: "/judgment/j1", title: "CN-2026-0042", sub: "张三 · 秦广殿" }]);
  });

  it("records nothing without a signed-in user", () => {
    renderHook(() => useRecordOpened(undefined, soul(1)));
    expect(readRecent(undefined)).toEqual([]);
  });
});
