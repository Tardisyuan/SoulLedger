/**
 * 殿列表的停用 / 启用按钮(分殿 1A):后端是 `IsHallLessAdminPermission` + 按 `scope_to_tenant(field="pk")` 取殿 ——
 * SYSTEM_ADMIN 每一殿,文明 ADMIN 本文明各殿(别的文明 404),绑殿 ADMIN 403。按钮照这条规则画:
 * 有的地方要有,没有的地方要没有。新建的殿(不在四个种子殿里)按行上的 `civilization` 判。
 */
import { screen, within } from "@testing-library/react";
import { tenantsApi, type Tenant } from "@soulledger/core/api";
import TenantsPage from "@/app/tenants/page";
import { useTenant } from "@/src/contexts/TenantContext";
import { renderWithProviders } from "./support/render";

jest.mock("@/src/contexts/TenantContext", () => ({
  ...jest.requireActual("@/src/contexts/TenantContext"),
  useTenant: jest.fn(),
}));
jest.mock("@/src/components/impersonation/useImpersonation", () => ({
  ...jest.requireActual("@/src/components/impersonation/useImpersonation"),
  useImpersonation: jest.fn(() => null),
}));
jest.mock("@soulledger/core/api", () => ({
  ...jest.requireActual("@soulledger/core/api"),
  tenantsApi: { list: jest.fn() },
}));
jest.mock("@/src/components/layout/MenuGloss", () => ({ MenuGloss: () => null }));
jest.mock("@/src/components/plaque/Plaque", () => ({
  ...jest.requireActual("@/src/components/plaque/Plaque"),
  usePlaque: () => undefined,
}));

const hall = (code: string, civilization: string, id: number): Tenant =>
  ({ id, code, display_name: `name of ${code}`, is_active: true, civilization, seal_glyphs: [] }) as unknown as Tenant;
const HALLS = [
  hall("CN_DIYU", "CHINESE", 1),
  hall("CN_NEW_2", "CHINESE", 2), // a hall an administrator made: not one of the four seeded codes
  hall("EG_DUAT", "EGYPTIAN", 3),
  hall("ODD_HALL", "UNKNOWN", 4),
];

function asUser(role: string, tenant: { code: string } | null, civilization: string | null = null) {
  (useTenant as jest.Mock).mockReturnValue({
    user: { id: 1, username: "u", display_name: "U", email: "", role, permissions: [], tenant, civilization },
    tenantCode: tenant?.code ?? null, setUser: jest.fn(), logout: jest.fn(), permissionsReady: true,
  });
}

async function togglesShown() {
  (tenantsApi.list as jest.Mock).mockResolvedValue({ data: { count: HALLS.length, results: HALLS } });
  renderWithProviders(<TenantsPage />);
  await screen.findByText("EG_DUAT", { selector: "td" });
  return Object.fromEntries(
    HALLS.map((h) => {
      const row = screen.getByText(h.code, { selector: "td" }).closest("tr") as HTMLElement;
      return [h.code, within(row).queryByTestId("hall-deactivate-open") !== null];
    }),
  );
}

describe("殿列表:停用 / 启用给谁画", () => {
  it("SYSTEM_ADMIN:每一殿,认不出文明的也有", async () => {
    asUser("SYSTEM_ADMIN", null);
    expect(await togglesShown()).toEqual({ CN_DIYU: true, CN_NEW_2: true, EG_DUAT: true, ODD_HALL: true });
  });

  it("中国的文明 ADMIN:本文明两殿(含新建的),埃及与认不出的没有", async () => {
    asUser("ADMIN", null, "CHINESE");
    expect(await togglesShown()).toEqual({ CN_DIYU: true, CN_NEW_2: true, EG_DUAT: false, ODD_HALL: false });
  });

  it("没有文明的无殿 ADMIN:哪一殿都没有(后端什么都不给它)", async () => {
    asUser("ADMIN", null, null);
    expect(await togglesShown()).toEqual({ CN_DIYU: false, CN_NEW_2: false, EG_DUAT: false, ODD_HALL: false });
  });

  it("绑殿 ADMIN:连自己那一殿也没有(后端 403)", async () => {
    asUser("ADMIN", { code: "CN_DIYU" });
    expect(await togglesShown()).toEqual({ CN_DIYU: false, CN_NEW_2: false, EG_DUAT: false, ODD_HALL: false });
  });
});
