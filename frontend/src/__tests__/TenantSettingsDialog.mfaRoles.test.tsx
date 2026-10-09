/**
 * 殿设置 › 安全 (A12): one row per role from `/tenants/{code}/mfa-roles/` with
 * 「已开启/总数 · N 人待设置」 and a 要求 / 不要求 switch; ADMIN reads 「始终」 and has no switch;
 * toggling a role and saving sends `mfa_required_roles`; when the rows could not be read the
 * field is NOT sent, so a failed read cannot wipe the hall's list.
 *
 * Written 2026-10-09 and NOT run (user instruction: write, don't run).
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { tenantsApi, type Tenant } from "@soulledger/core/api";
import { TenantSettingsDialog } from "@/src/components/tenants/TenantSettingsDialog";

jest.mock("@soulledger/core/api", () => ({
  ...jest.requireActual("@soulledger/core/api"),
  tenantsApi: { updateSettings: jest.fn(), mfaRoles: jest.fn() },
}));
jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) => (params ? `${key}(${Object.values(params).join(",")})` : key),
    locale: "zh-Hans",
    hydrated: true,
  }),
}));
jest.mock("@/src/contexts/ToastContext", () => ({ useToast: () => ({ showToast: jest.fn() }) }));

const update = tenantsApi.updateSettings as jest.Mock;
const mfaRoles = tenantsApi.mfaRoles as jest.Mock;

const ROWS = [
  { role: "ADMIN", required: true, always: true, total: 2, enabled: 1 },
  { role: "JUDGE", required: true, always: false, total: 5, enabled: 2 },
  { role: "GUARDIAN", required: false, always: false, total: 3, enabled: 0 },
  { role: "scribe", required: false, always: false, total: 1, enabled: 0 },
];
const TENANT: Tenant = { id: 1, code: "CN_DIYU", display_name: "Chinese Diyu", description: "", dispatch_enabled: true, hall_name: "", hall_name_en: "", hall_name_egy: "", settings: { mfa_required_roles: ["JUDGE"] } };

function renderDialog() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <TenantSettingsDialog tenant={TENANT} onClose={jest.fn()} />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  update.mockResolvedValue({ data: TENANT });
  mfaRoles.mockResolvedValue({ data: ROWS });
});

const rowOf = (role: string) => screen.getByTestId("tenant-mfa-roles").querySelector(`[data-role="${role}"]`) as HTMLElement;

describe("TenantSettingsDialog · 安全 · 两步验证", () => {
  it("lists every role with its stat line; ADMIN says 始终 and has no switch", async () => {
    renderDialog();
    await waitFor(() => expect(rowOf("ADMIN")).toBeTruthy());
    expect(within(rowOf("ADMIN")).getByText("mfa.admin.always")).toBeTruthy();
    expect(within(rowOf("ADMIN")).queryByRole("switch")).toBeNull();
    expect(within(rowOf("ADMIN")).getByText("mfa.admin.role_stat(1,2,1)")).toBeTruthy();
    // required JUDGE: 2 of 5 on, 3 pending; not-required GUARDIAN: nobody is "pending"
    expect(within(rowOf("JUDGE")).getByRole("switch").getAttribute("aria-checked")).toBe("true");
    expect(within(rowOf("JUDGE")).getByText("mfa.admin.role_stat(2,5,3)")).toBeTruthy();
    expect(within(rowOf("GUARDIAN")).getByRole("switch").getAttribute("aria-checked")).toBe("false");
    expect(within(rowOf("GUARDIAN")).getByText("mfa.admin.role_stat(0,3,0)")).toBeTruthy();
    // a custom role shows its name as data, built-ins through users.roles.*
    expect(within(rowOf("scribe")).getByText("scribe")).toBeTruthy();
    expect(within(rowOf("JUDGE")).getByText("users.roles.JUDGE")).toBeTruthy();
  });

  it("sits in its own group at the bottom: a rule above it and the group title 「安全」", async () => {
    renderDialog();
    await waitFor(() => expect(rowOf("ADMIN")).toBeTruthy());
    const group = screen.getByTestId("tenant-security");
    expect(group.className).toContain("border-t");
    const title = within(group).getByRole("heading", { level: 3 });
    expect(title.textContent).toBe("tenants.settings.security");
    // the group is the last thing in the form, after the cooldown and dispatch fields
    const form = group.closest("form") as HTMLFormElement;
    expect(form.lastElementChild).toBe(group);
    expect(within(group).getByTestId("tenant-mfa-roles")).toBeTruthy();
  });

  it("toggling a switch and saving sends the sorted mfa_required_roles", async () => {
    renderDialog();
    await waitFor(() => expect(rowOf("GUARDIAN")).toBeTruthy());
    fireEvent.click(within(rowOf("GUARDIAN")).getByRole("switch"));
    expect(within(rowOf("GUARDIAN")).getByRole("switch").getAttribute("aria-checked")).toBe("true");
    fireEvent.click(within(rowOf("JUDGE")).getByRole("switch"));
    fireEvent.click(screen.getByRole("button", { name: "common.save" }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0][1]).toEqual(expect.objectContaining({ mfa_required_roles: ["GUARDIAN"] }));
  });

  it("does not send mfa_required_roles when the rows failed to load", async () => {
    mfaRoles.mockRejectedValue(new Error("boom"));
    renderDialog();
    expect(await screen.findByText("mfa.admin.roles_load_failed")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "common.save" }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(Object.keys(update.mock.calls[0][1])).not.toContain("mfa_required_roles");
  });
});
