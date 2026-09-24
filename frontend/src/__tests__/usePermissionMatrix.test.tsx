/**
 * The permission-matrix hooks: what a per-cell save invalidates, how the
 * response is summarised for 「已存 N 项，失败 M 项」, and how a delete refusal
 * is read.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  matrixCellKey,
  roleDeleteRefusal,
  summarizeMatrixSave,
  useApplyMatrixChanges,
  useCopyRole,
  useDeleteRole,
  useMatrixImpact,
  useRoles,
} from "@soulledger/core/hooks/usePermissionMatrix";
import { permKeys } from "@soulledger/core/query_keys";

jest.mock("@soulledger/core/api", () => ({
  permApi: {
    applyChanges: jest.fn(),
    impact: jest.fn(),
    roles: { list: jest.fn(), copy: jest.fn(), delete: jest.fn() },
  },
}));

const { permApi } = jest.requireMock("@soulledger/core/api") as {
  permApi: {
    applyChanges: jest.Mock;
    impact: jest.Mock;
    roles: Record<"list" | "copy" | "delete", jest.Mock>;
  };
};

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

function wrapperFor(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
}

const result = (index: number, role: string, permission_id: number, status: string, code: string | null = null) => ({
  index, role, permission_id, codename: null, action: "grant", status, code, detail: null,
});

const mixed = {
  saved: 2,
  unchanged: 1,
  refused: 1,
  failed: 1,
  results: [
    result(0, "JUDGE", 1, "saved"),
    result(1, "JUDGE", 2, "failed", "database_error"),
    result(2, "SCRIBE", 3, "saved"),
    result(3, "VIEWER", 4, "refused", "version_conflict"),
    result(4, "VIEWER", 5, "unchanged"),
  ],
  versions: { JUDGE: 4, SCRIBE: 2, VIEWER: 9 },
};

beforeEach(() => jest.clearAllMocks());

describe("summarizeMatrixSave", () => {
  it("counts and locates the cells that did not reach the table", () => {
    const summary = summarizeMatrixSave(mixed as never);
    expect([summary.saved, summary.failed, summary.refused, summary.unchanged]).toEqual([2, 1, 1, 1]);
    expect([...summary.notSaved].sort()).toEqual([matrixCellKey("JUDGE", 2), matrixCellKey("VIEWER", 4)]);
    // Absence too: a saved or unchanged cell is not flagged.
    expect(summary.notSaved.has(matrixCellKey("JUDGE", 1))).toBe(false);
    expect(summary.notSaved.has(matrixCellKey("VIEWER", 5))).toBe(false);
    expect(summary.rolesChanged).toEqual(["JUDGE", "SCRIBE"]);
  });
});

describe("useApplyMatrixChanges", () => {
  it("sends the versions and invalidates only roles that had a saved cell", async () => {
    permApi.applyChanges.mockResolvedValue({ data: mixed });
    const client = newClient();
    const spy = jest.spyOn(client, "invalidateQueries");
    const { result: hook } = renderHook(() => useApplyMatrixChanges(), { wrapper: wrapperFor(client) });
    const changes = [{ role: "JUDGE", permission_id: 1, action: "grant" as const }];
    await act(() => hook.current.mutateAsync({ changes, expectedVersions: { JUDGE: 3 } }));
    expect(permApi.applyChanges).toHaveBeenCalledWith(changes, { JUDGE: 3 });
    const keys = spy.mock.calls.map(([arg]) => JSON.stringify(arg?.queryKey));
    expect(keys).toEqual(
      expect.arrayContaining([
        JSON.stringify(permKeys.roles),
        JSON.stringify(permKeys.rolePermissions("JUDGE")),
        JSON.stringify(permKeys.rolePermissions("SCRIBE")),
      ]),
    );
    expect(keys).not.toContain(JSON.stringify(permKeys.rolePermissions("VIEWER")));
  });

  it("invalidates nothing when no cell was saved", async () => {
    permApi.applyChanges.mockResolvedValue({
      data: { ...mixed, saved: 0, results: [result(0, "VIEWER", 4, "refused", "role_not_found")] },
    });
    const client = newClient();
    const spy = jest.spyOn(client, "invalidateQueries");
    const { result: hook } = renderHook(() => useApplyMatrixChanges(), { wrapper: wrapperFor(client) });
    await act(() => hook.current.mutateAsync({ changes: [] }));
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("the other permission hooks", () => {
  it("useRoles reads the role list under the page's own key", async () => {
    permApi.roles.list.mockResolvedValue({ data: [{ id: 1, name: "JUDGE" }] });
    const client = newClient();
    const { result: hook } = renderHook(() => useRoles(), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(hook.current.isSuccess).toBe(true));
    expect(client.getQueryData(["roles"])).toEqual([{ id: 1, name: "JUDGE" }]);
  });

  it("useMatrixImpact returns the conflicts", async () => {
    permApi.impact.mockResolvedValue({ data: { required_codenames: ["workflow.approve"], conflicts: [] } });
    const { result: hook } = renderHook(() => useMatrixImpact(), { wrapper: wrapperFor(newClient()) });
    const data = await act(() => hook.current.mutateAsync([]));
    expect(data.required_codenames).toEqual(["workflow.approve"]);
  });

  it("useCopyRole and useDeleteRole refresh the role list", async () => {
    permApi.roles.copy.mockResolvedValue({ data: { id: 9, name: "CLERK" } });
    permApi.roles.delete.mockResolvedValue({ data: undefined });
    const client = newClient();
    const spy = jest.spyOn(client, "invalidateQueries");
    const copy = renderHook(() => useCopyRole(), { wrapper: wrapperFor(client) }).result;
    const del = renderHook(() => useDeleteRole(), { wrapper: wrapperFor(client) }).result;
    await act(() => copy.current.mutateAsync({ sourceId: 2, data: { name: "CLERK", display_name: "书吏" } }));
    await act(() => del.current.mutateAsync(9));
    expect(permApi.roles.copy).toHaveBeenCalledWith(2, { name: "CLERK", display_name: "书吏" });
    expect(permApi.roles.delete).toHaveBeenCalledWith(9);
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe("roleDeleteRefusal", () => {
  it("reads a 400 with a code, and nothing else", () => {
    const refusal = { error: "x", code: "role_referenced_by_workflow_templates", templates: [] };
    expect(roleDeleteRefusal({ response: { status: 400, data: refusal } })).toEqual(refusal);
    expect(roleDeleteRefusal({ response: { status: 400, data: { name: ["bad"] } } })).toBeNull();
    expect(roleDeleteRefusal({ response: { status: 404, data: { error: "Role not found" } } })).toBeNull();
    expect(roleDeleteRefusal(new Error("network"))).toBeNull();
    expect(roleDeleteRefusal(null)).toBeNull();
  });
});
