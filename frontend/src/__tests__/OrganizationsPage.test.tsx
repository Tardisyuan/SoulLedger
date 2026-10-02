/**
 * /organizations 按规范 v2 补齐:每个文明一节 = 面板标题 <h2>,折叠钮在 <h2> 里
 * (不是 <h2> 进 <button>),加载是静态的表格骨架。
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import OrganizationsPage from "@/app/organizations/page";
import { api } from "@soulledger/core/api";

jest.mock("@soulledger/core/api", () => ({ api: { get: jest.fn() } }));
jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) => (params ? `${key}:${Object.values(params).join(",")}` : key),
  }),
}));
jest.mock("@/src/contexts/TenantContext", () => ({
  useTenant: () => ({ user: { id: 1, role: "VIEWER", permissions: ["org.read"] } }),
}));
jest.mock("@/src/components/layout/MenuGloss", () => ({ MenuGloss: () => null }));

const mockGet = api.get as jest.Mock;

const org = (id: number, name: string, category: string) => ({
  id, name, code: `C${id}`, category, level: 0, parent: null, sort: id,
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <OrganizationsPage />
    </QueryClientProvider>
  );
}

beforeEach(() => jest.clearAllMocks());

it("gives each civilization a section heading whose toggle lives inside the <h2>", async () => {
  mockGet.mockResolvedValue({ data: { results: [org(1, "第五殿", "CHINESE"), org(2, "Limbo", "EUROPEAN")], next: null } });
  renderPage();
  const heading = await screen.findByRole("heading", { level: 2, name: /organization\.civilizations\.CHINESE/ });
  const toggle = within(heading).getByRole("button");
  expect(toggle).toHaveAttribute("aria-expanded", "true");
  // Absence: no heading nested inside a button anywhere on the page.
  expect(document.querySelector("button h2, button h3")).toBeNull();
  expect(screen.getByText("第五殿")).toBeInTheDocument();
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  // 收起的契约:先 inert,动画结束再 hidden。
  const body = document.getElementById(toggle.getAttribute("aria-controls")!)!;
  expect(screen.getByText("第五殿").closest("[inert]")).toBe(body);
  fireEvent.animationEnd(body);
  expect(screen.getByText("第五殿")).not.toBeVisible();
  expect(screen.getByText("Limbo")).toBeVisible();
  expect(screen.getByText("Limbo").closest("[inert]")).toBeNull();
});

it("shows a static table skeleton while loading, not pulsing cards", () => {
  mockGet.mockReturnValue(new Promise(() => {}));
  renderPage();
  const skeleton = screen.getByTestId("organizations-skeleton");
  expect(skeleton).toHaveAttribute("aria-busy", "true");
  expect(skeleton.innerHTML).not.toMatch(/animate-pulse/);
});
