/**
 * A custom role's badge shows the role table's `display_name`.
 *
 * WHAT WENT WRONG. The users table rendered every role through
 * `<DomainEnum namespace="users.roles" value={user.role} />`, which resolves
 * `users.roles.<NAME>` in the bundles. The five built-ins are there; a role an
 * admin created is not and cannot be — its name is data, not UI copy — so its
 * badge fell into `DomainEnum`'s "unrecognized" state: italic, muted, the
 * translated word for "unrecognised" with the raw name in `title`. On the
 * same page the role FILTER already reads the role table and labels a custom
 * role by its `display_name` (`3ecd5af`); the badge is the same decision, one
 * column over, and the user's ruling for this round is that it follows suit.
 *
 * Built-ins keep `DomainEnum`: their labels are translated, and that path is
 * pinned by `domainDisplayContract`. The absence assertion is the one that
 * matters — no badge on the page in the "unrecognized" state.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import UsersPage from "@/app/users/page";
import { usersApi, permApi } from "@soulledger/core/api";

jest.mock("@soulledger/core/api", () => ({
  usersApi: { list: jest.fn(), delete: jest.fn(), activate: jest.fn(), deactivate: jest.fn() },
  permApi: { roles: { list: jest.fn() } },
  PAGE_SIZE: 20,
}));

// `users.roles.ADMIN` translates and everything else echoes, so a built-in
// resolves as "known" while a name with no bundle entry resolves the way it
// does in production — the two states this file tells apart.
const COPY: Record<string, string> = { "users.roles.ADMIN": "管理员" };
jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({
    t: (key: string) => COPY[key] ?? key,
    locale: "zh-Hans",
    hydrated: true,
  }),
}));

const mockTenant = {
  user: { id: 1, username: "yama", role: "ADMIN", tenant: null, permissions: ["user.manage"] },
};
jest.mock("@/src/contexts/TenantContext", () => ({
  useTenant: () => mockTenant,
}));

jest.mock("@/src/components/layout/MenuGloss", () => ({
  MenuGloss: () => null,
}));

const mockUsers = usersApi.list as jest.Mock;
const mockRoles = permApi.roles.list as jest.Mock;

function role(over: Record<string, unknown>) {
  return {
    id: 0,
    name: "",
    display_name: "",
    scope: "GLOBAL",
    organization: null,
    organization_name: null,
    user_count: 1,
    is_builtin: false,
    version: 1,
    ...over,
  };
}

function user(over: Record<string, unknown>) {
  return {
    id: 0,
    username: "",
    email: "x@example.com",
    role: "VIEWER",
    tenant: null,
    is_active: true,
    ...over,
  };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <UsersPage />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRoles.mockResolvedValue({
    data: [
      role({ id: 1, name: "ADMIN", display_name: "Administrator", is_builtin: true }),
      role({ id: 2, name: "CLERK", display_name: "书记" }),
    ],
  });
  mockUsers.mockResolvedValue({
    data: {
      count: 2,
      next: null,
      previous: null,
      results: [
        user({ id: 1, username: "yama", role: "ADMIN" }),
        user({ id: 2, username: "clerk1", role: "CLERK" }),
      ],
    },
  });
});

describe("role badge in the users table", () => {
  it("labels a custom role by the role table's display_name, not as 'unrecognised'", async () => {
    const { container } = renderPage();

    // The row is up (username), and the badge reads the table's display name.
    // Scoped to the table: the role FILTER's `<option>` carries the same
    // display name and is not the badge.
    await screen.findByText("clerk1");
    const table = container.querySelector("table");
    if (!table) throw new Error("users table not rendered");
    expect(await within(table).findByText("书记")).toBeInTheDocument();
    // Absence: the exact state the defect rendered in. Named, because
    // `queryByText("CLERK")` alone would also pass if the raw name were shown
    // in a non-italic span.
    expect(container.querySelectorAll('[data-enum-state="unrecognized"]')).toHaveLength(0);
    expect(screen.queryByText("common.value.unrecognized")).toBeNull();
  });

  it("still translates a built-in role through the bundles", async () => {
    const { container } = renderPage();

    await screen.findByText("yama");
    // By the enum element, not by text: the role FILTER's `<option>` carries
    // the same translated word, and it is not the badge.
    const badge = await waitFor(() => {
      const el = container.querySelector('[data-enum-state="known"][title="ADMIN"]');
      if (!el) throw new Error("ADMIN badge not rendered yet");
      return el;
    });
    expect(badge).toHaveTextContent("管理员");
  });
});
