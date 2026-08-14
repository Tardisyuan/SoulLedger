/**
 * Tests for src/hooks/useSidebarMenus.ts — the sidebar visibility gates.
 *
 * Five things decide whether a menu row appears: the endpoint chosen by
 * role, the DRF envelope shape, the top-level filter, the `visible` flag,
 * and the recursive prune of children. Each of those fails *silently* —
 * a broken gate shows an extra row or hides a real one, and nothing errors.
 * So every case below asserts on the exact resulting tree, and the
 * exclusion cases assert absence.
 */
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useSidebarMenus, isDirectory, type SidebarMenu } from "@/src/hooks/useSidebarMenus";
import { menusApi } from "@/lib/api";

jest.mock("@/lib/api", () => ({
  menusApi: {
    all: jest.fn(),
    list: jest.fn(),
  },
}));

let mockUser: { id: number; role: string } | null = { id: 1, role: "JUDGE" };

jest.mock("@/src/contexts/TenantContext", () => ({
  useTenant: () => ({ user: mockUser }),
}));

const mockedAll = menusApi.all as jest.Mock;
const mockedList = menusApi.list as jest.Mock;

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return createElement(QueryClientProvider, { client: queryClient }, children);
}

/** Render the hook and wait for the query to settle. */
async function renderMenus() {
  const { result } = renderHook(() => useSidebarMenus(), { wrapper });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  return result;
}

const names = (menus: SidebarMenu[] | undefined) => (menus ?? []).map((m) => m.name);

beforeEach(() => {
  jest.clearAllMocks();
  mockUser = { id: 1, role: "JUDGE" };
});

// ── isDirectory ──────────────────────────────────────────────────────

describe("isDirectory", () => {
  it("treats an explicit DIRECTORY as a directory even when it has a path", () => {
    expect(isDirectory({ menu_type: "DIRECTORY", path: "/somewhere" })).toBe(true);
  });

  it("treats a pathless entry as a directory", () => {
    expect(isDirectory({ menu_type: "MENU", path: "" })).toBe(true);
    // A menu whose `path` key is absent altogether, not merely empty.
    expect(isDirectory({ menu_type: "MENU" } as Parameters<typeof isDirectory>[0])).toBe(true);
  });

  it("does not treat a navigable MENU as a directory", () => {
    expect(isDirectory({ menu_type: "MENU", path: "/souls" })).toBe(false);
  });

  it("does not treat a navigable BUTTON as a directory", () => {
    expect(isDirectory({ menu_type: "BUTTON", path: "/souls/create" })).toBe(false);
  });
});

// ── Endpoint selection ───────────────────────────────────────────────

describe("useSidebarMenus endpoint selection", () => {
  it("uses the unpaginated all() endpoint for ADMIN", async () => {
    mockUser = { id: 1, role: "ADMIN" };
    mockedAll.mockResolvedValue({ data: [{ id: 1, name: "Souls", parent: null }] });

    const result = await renderMenus();

    expect(mockedAll).toHaveBeenCalledTimes(1);
    expect(mockedList).not.toHaveBeenCalled();
    expect(names(result.current.data)).toEqual(["Souls"]);
  });

  it("uses the paginated list() endpoint for a non-ADMIN role", async () => {
    mockUser = { id: 2, role: "CLERK" };
    mockedList.mockResolvedValue({ data: { results: [{ id: 1, name: "Souls", parent: null }] } });

    const result = await renderMenus();

    expect(mockedList).toHaveBeenCalledTimes(1);
    expect(mockedAll).not.toHaveBeenCalled();
    expect(names(result.current.data)).toEqual(["Souls"]);
  });

  it("fetches nothing at all when no user is logged in", () => {
    mockUser = null;

    const { result } = renderHook(() => useSidebarMenus(), { wrapper });

    expect(mockedAll).not.toHaveBeenCalled();
    expect(mockedList).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe("idle");
    expect(result.current.data).toBeUndefined();
  });

  it("refetches through the other endpoint when the role changes", async () => {
    mockUser = { id: 3, role: "CLERK" };
    mockedList.mockResolvedValue({ data: { results: [{ id: 1, name: "Clerk view", parent: null }] } });
    mockedAll.mockResolvedValue({ data: [{ id: 2, name: "Admin view", parent: null }] });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const sharedWrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children);

    const { result, rerender } = renderHook(() => useSidebarMenus(), { wrapper: sharedWrapper });
    await waitFor(() => expect(names(result.current.data)).toEqual(["Clerk view"]));

    mockUser = { id: 3, role: "ADMIN" };
    rerender();

    await waitFor(() => expect(names(result.current.data)).toEqual(["Admin view"]));
    expect(mockedAll).toHaveBeenCalledTimes(1);
  });
});

// ── Normalisation ────────────────────────────────────────────────────

describe("useSidebarMenus normalisation", () => {
  async function withMenus(items: unknown[]) {
    mockUser = { id: 1, role: "ADMIN" };
    mockedAll.mockResolvedValue({ data: items });
    return renderMenus();
  }

  it("drops entries that have a parent, keeping only the top level", async () => {
    const result = await withMenus([
      { id: 1, name: "Souls", parent: null },
      { id: 2, name: "Soul detail", parent: 1 },
    ]);

    expect(names(result.current.data)).toEqual(["Souls"]);
  });

  it("keeps a top-level entry whose parent is undefined rather than null", async () => {
    const result = await withMenus([{ id: 1, name: "Souls" }]);

    expect(names(result.current.data)).toEqual(["Souls"]);
  });

  it("removes entries flagged visible=false", async () => {
    const result = await withMenus([
      { id: 1, name: "Welcome", parent: null, visible: false },
      { id: 2, name: "Souls", parent: null, visible: true },
    ]);

    expect(names(result.current.data)).toEqual(["Souls"]);
  });

  it("keeps entries where visible is simply absent", async () => {
    const result = await withMenus([{ id: 1, name: "Souls", parent: null }]);

    expect(names(result.current.data)).toEqual(["Souls"]);
  });

  it("prunes hidden children out of a visible parent", async () => {
    const result = await withMenus([
      {
        id: 1,
        name: "Admin",
        parent: null,
        children: [
          { id: 2, name: "Users", visible: true },
          { id: 3, name: "Secret", visible: false },
        ],
      },
    ]);

    expect(names(result.current.data?.[0].children)).toEqual(["Users"]);
  });

  it("prunes recursively at the grandchild level", async () => {
    const result = await withMenus([
      {
        id: 1,
        name: "Admin",
        parent: null,
        children: [
          {
            id: 2,
            name: "Users",
            children: [
              { id: 4, name: "Roles", visible: true },
              { id: 5, name: "Hidden role", visible: false },
            ],
          },
        ],
      },
    ]);

    const grandchildren = result.current.data?.[0].children?.[0].children;
    expect(names(grandchildren)).toEqual(["Roles"]);
  });

  it("leaves children undefined when the entry had none", async () => {
    const result = await withMenus([{ id: 1, name: "Souls", parent: null }]);

    expect(result.current.data?.[0].children).toBeUndefined();
  });

  it("normalises an empty children array to an empty array, not to undefined", async () => {
    const result = await withMenus([{ id: 1, name: "Souls", parent: null, children: [] }]);

    expect(result.current.data?.[0].children).toEqual([]);
  });

  it("drops a hidden parent together with its visible children", async () => {
    const result = await withMenus([
      {
        id: 1,
        name: "Hidden group",
        parent: null,
        visible: false,
        children: [{ id: 2, name: "Visible child", visible: true }],
      },
    ]);

    expect(result.current.data).toEqual([]);
  });

  it("returns an empty list when the backend sends nothing", async () => {
    const result = await withMenus([]);

    expect(result.current.data).toEqual([]);
  });

  it("preserves the remaining fields of a kept entry", async () => {
    const result = await withMenus([
      { id: 1, name: "Souls", parent: null, path: "/souls", menu_type: "MENU", icon: "user" },
    ]);

    expect(result.current.data?.[0]).toMatchObject({
      id: 1,
      path: "/souls",
      menu_type: "MENU",
      icon: "user",
    });
  });
});

// ── Failure surfacing ────────────────────────────────────────────────

describe("useSidebarMenus failure", () => {
  it("surfaces a backend failure as an error state instead of an empty sidebar", async () => {
    mockUser = { id: 1, role: "ADMIN" };
    mockedAll.mockRejectedValue(new Error("500"));

    const { result } = renderHook(() => useSidebarMenus(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });
});
