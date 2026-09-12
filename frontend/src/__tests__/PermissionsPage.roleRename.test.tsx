/**
 * Renaming a role must not turn its column into a "remove everything" diff.
 *
 * WHAT WENT WRONG. `app/permissions/page.tsx` keys the editable `checked` map
 * by role NAME and fills it from `baseline` exactly once (`checked === null`),
 * so that a save landing on one role never clobbers in-progress edits on
 * another. Rename a custom role and the role list comes back with the new
 * name: `baseline` is rebuilt under the new key, `checked` still holds the old
 * one, and `checked[newName]` is `undefined`. `useMatrixSave` reads that as an
 * empty set, so the live diff for the renamed role is "remove all N grants" —
 * tier 3, with the confirmation modal asking the operator to type the role's
 * name. Type it, and the role really is stripped (FL-05). The rename cascade
 * on the backend (`3ecd5af`) made this reachable from the UI.
 *
 * WHY THE PAGE AND NOT THE HOOK. `useMatrixSave` is doing the right thing
 * with what it is given; the defect is in how the page reconciles `checked`
 * against a `baseline` whose keys moved. So the REAL page is rendered with a
 * REAL QueryClient, and the rename arrives the way it does in production: the
 * `["roles"]` query is invalidated and refetches a list carrying the new name.
 *
 * WAITING FOR THE COLUMN, NOT THE TOOLBAR. Between the roles refetch and the
 * renamed role's own permissions query resolving, `matrixReady` is false and
 * the toolbar reads "no changes" for a reason that has nothing to do with the
 * fix. The assertions therefore run only once the renamed column's header is
 * on screen, which is when the false diff would be too.
 */
import { render, screen, waitFor, act, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PermissionsPage from "@/app/permissions/page";
import { permApi, type Permission, type Role } from "@soulledger/core/api";

jest.mock("@soulledger/core/api", () => ({
  permApi: {
    list: jest.fn(),
    roles: { list: jest.fn() },
    rolePermissions: jest.fn(),
    assign: jest.fn(),
  },
}));

jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) =>
      params ? `${key}:${Object.values(params).join(",")}` : key,
    locale: "en",
    hydrated: true,
  }),
}));

jest.mock("@/src/contexts/ToastContext", () => ({
  useToast: () => ({ showToast: jest.fn() }),
}));

const mockTenant = {
  user: { id: 1, username: "admin", role: "ADMIN", tenant: null, permissions: [] },
};
jest.mock("@/src/contexts/TenantContext", () => ({
  useTenant: () => mockTenant,
}));

jest.mock("@/src/components/layout/MenuGloss", () => ({
  MenuGloss: () => null,
}));

const mockList = permApi.list as jest.Mock;
const mockRolesList = permApi.roles.list as jest.Mock;
const mockRolePermissions = permApi.rolePermissions as jest.Mock;

const PERMS: Permission[] = [
  { id: 1, codename: "soul.read", name: "读灵魂", category: "soul" } as Permission,
  { id: 2, codename: "soul.update", name: "改灵魂", category: "soul" } as Permission,
  { id: 3, codename: "menu.read", name: "读菜单", category: "menu" } as Permission,
];

function role(over: Partial<Role>): Role {
  return {
    id: 0,
    name: "",
    display_name: "",
    scope: "GLOBAL",
    organization: null,
    organization_name: null,
    user_count: 0,
    is_builtin: false,
    version: 1,
    ...over,
  } as Role;
}

const JUDGE = role({ id: 1, name: "JUDGE", display_name: "判官", is_builtin: true });
const CLERK = role({ id: 2, name: "CLERK", display_name: "书记" });
const SCRIBE = role({ id: 2, name: "SCRIBE", display_name: "文书", version: 2 });

/** What each role currently holds, by name — the renamed role keeps its grants. */
const GRANTS: Record<string, number[]> = {
  JUDGE: [1, 2],
  CLERK: [1, 2, 3],
  SCRIBE: [1, 2, 3],
};

let queryClient: QueryClient;

function renderPage() {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <PermissionsPage />
    </QueryClientProvider>
  );
}

const cell = (roleName: string, codename: string) =>
  screen.getByRole("checkbox", { name: `${roleName} — ${codename}` });

/** The roles query refetches and comes back with CLERK renamed to SCRIBE. */
async function renameClerkToScribe() {
  mockRolesList.mockResolvedValue({ data: [JUDGE, SCRIBE] });
  await act(async () => {
    await queryClient.invalidateQueries({ queryKey: ["roles"] });
  });
  // The renamed column is on screen, so its permissions have loaded and the
  // matrix is ready — this is the moment the false diff used to appear.
  await screen.findByText("文书");
  await waitFor(() => expect(cell("SCRIBE", "menu.read")).toBeInTheDocument());
}

beforeEach(() => {
  jest.clearAllMocks();
  mockList.mockResolvedValue({ data: PERMS });
  mockRolesList.mockResolvedValue({ data: [JUDGE, CLERK] });
  mockRolePermissions.mockImplementation(async (name: string) => ({
    data: {
      role: name,
      permissions: (GRANTS[name] ?? []).map((id) => PERMS[id - 1].codename),
      details: (GRANTS[name] ?? []).map((id) => PERMS[id - 1]),
    },
  }));
});

describe("a renamed role keeps its grants in the matrix", () => {
  it("shows no pending change after the rename — not 'remove all 3'", async () => {
    renderPage();
    await screen.findByText("permissions.matrix.no_changes");
    await waitFor(() => expect(cell("CLERK", "menu.read")).toHaveAttribute("aria-checked", "true"));

    await renameClerkToScribe();

    // Presence: the renamed column shows the grants it really has.
    expect(cell("SCRIBE", "soul.read")).toHaveAttribute("aria-checked", "true");
    expect(cell("SCRIBE", "menu.read")).toHaveAttribute("aria-checked", "true");
    // Absence: no diff was invented. The exact wrong text is named so the
    // failure reads as the defect and not as a missing key.
    expect(screen.queryByText("permissions.matrix.pending_count:1")).toBeNull();
    expect(screen.getByText("permissions.matrix.no_changes")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "permissions.matrix.save_button" })).toBeDisabled();
    // And the old column is gone rather than lingering beside the new one.
    expect(screen.queryByRole("checkbox", { name: "CLERK — menu.read" })).toBeNull();
  });

  it("keeps an in-progress edit on ANOTHER role across the rename", async () => {
    // The reason `checked` is not simply re-cloned from `baseline`: an
    // operator halfway through editing JUDGE must not lose that to a rename of
    // CLERK. One toggle on JUDGE before the rename, and exactly one pending
    // change after it — JUDGE's, not a second one for the renamed role.
    renderPage();
    await screen.findByText("permissions.matrix.no_changes");
    await waitFor(() => expect(cell("JUDGE", "menu.read")).toHaveAttribute("aria-checked", "false"));

    fireEvent.click(cell("JUDGE", "menu.read"));
    expect(screen.getByText("permissions.matrix.pending_count:1")).toBeInTheDocument();

    await renameClerkToScribe();

    expect(cell("JUDGE", "menu.read")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("permissions.matrix.pending_count:1")).toBeInTheDocument();
    expect(screen.queryByText("permissions.matrix.pending_count:2")).toBeNull();
  });
});
