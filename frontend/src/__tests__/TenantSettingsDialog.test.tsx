/**
 * 殿的设置(ADMIN):PATCH /tenants/{code}/settings/ 只发已知字段 —— 没有整份 `settings` JSON,
 * 所以助手管理页写的 `assistant_enabled` 不会被这张表单冲掉(后端那半由
 * backend/tests/test_tenant_settings_api.py 守)。400 的字段信息原样显示在各自字段下。
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { tenantsApi, type Tenant } from "@soulledger/core/api";
import { TenantSettingsDialog, parseCooldownDays, parseQuotaLimit, tenantSettingsErrors } from "@/src/components/tenants/TenantSettingsDialog";

jest.mock("@soulledger/core/api", () => ({
  ...jest.requireActual("@soulledger/core/api"),
  tenantsApi: { updateSettings: jest.fn(), mfaRoles: jest.fn().mockResolvedValue({ data: [] }) },
}));
jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) => (params ? `${key}(${Object.values(params).join(",")})` : key),
    locale: "zh-Hans",
    hydrated: true,
  }),
}));
const mockShowToast = jest.fn();
jest.mock("@/src/contexts/ToastContext", () => ({ useToast: () => ({ showToast: mockShowToast }) }));

const update = tenantsApi.updateSettings as jest.Mock;

const tenant = (over: Partial<Tenant> = {}): Tenant => ({
  id: 1,
  code: "CN_DIYU",
  display_name: "Chinese Diyu",
  description: "旧说明",
  dispatch_enabled: true,
  hall_name: "第五殿",
  hall_name_en: "The Fifth Court",
  hall_name_egy: "",
  settings: { assistant_enabled: true, soul_rebirth_cooldown_days: 45 },
  ...over,
});

function renderDialog(tn: Tenant, onClose = jest.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidate = jest.spyOn(qc, "invalidateQueries");
  render(
    <QueryClientProvider client={qc}>
      <TenantSettingsDialog tenant={tn} onClose={onClose} />
    </QueryClientProvider>
  );
  return { onClose, invalidate };
}

const save = () => fireEvent.click(screen.getByRole("button", { name: "common.save" }));

beforeEach(() => jest.clearAllMocks());

describe("parseCooldownDays / tenantSettingsErrors", () => {
  it("empty means null (back to the default), digits are a number, anything else is refused client-side", () => {
    expect(parseCooldownDays("")).toBeNull();
    expect(parseCooldownDays("  ")).toBeNull();
    expect(parseCooldownDays("0")).toBe(0);
    expect(parseCooldownDays(" 45 ")).toBe(45);
    expect(parseCooldownDays("-1")).toBeUndefined();
    expect(parseCooldownDays("1.5")).toBeUndefined();
    expect(parseCooldownDays("soon")).toBeUndefined();
  });

  it("keeps only the known fields of a DRF 400 and nothing of any other status", () => {
    expect(
      tenantSettingsErrors({
        response: { status: 400, data: { hall_name: ["太长"], soul_rebirth_cooldown_days: ["不能小于 0"], settings: ["x"] } },
      })
    ).toEqual({ hall_name: "太长", soul_rebirth_cooldown_days: "不能小于 0" });
    expect(tenantSettingsErrors({ response: { status: 500, data: { hall_name: ["x"] } } })).toEqual({});
  });
});

describe("TenantSettingsDialog", () => {
  it("starts from the tenant's current values, including the cooldown read out of settings", () => {
    renderDialog(tenant());
    expect(screen.getByLabelText("tenants.settings.hall_name")).toHaveValue("第五殿");
    expect(screen.getByLabelText("tenants.settings.hall_name_en")).toHaveValue("The Fifth Court");
    expect(screen.getByLabelText("tenants.settings.description")).toHaveValue("旧说明");
    expect(screen.getByLabelText("tenants.settings.cooldown_days")).toHaveValue("45");
    expect(screen.getByLabelText("tenants.settings.dispatch_enabled")).toBeChecked();
  });

  it("sends exactly the known fields — never the settings blob — so other settings keys survive", async () => {
    update.mockResolvedValue({ data: tenant() });
    const { onClose, invalidate } = renderDialog(tenant());
    fireEvent.change(screen.getByLabelText("tenants.settings.hall_name_egy"), { target: { value: " Yanluo Wesekhet " } });
    fireEvent.change(screen.getByLabelText("tenants.settings.cooldown_days"), { target: { value: "7" } });
    fireEvent.click(screen.getByLabelText("tenants.settings.dispatch_enabled"));
    save();

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    const [code, patch] = update.mock.calls[0];
    expect(code).toBe("CN_DIYU");
    expect(patch).toEqual({
      hall_name: "第五殿",
      hall_name_en: "The Fifth Court",
      hall_name_egy: "Yanluo Wesekhet",
      description: "旧说明",
      dispatch_enabled: false,
      soul_rebirth_cooldown_days: 7,
      visit_address: "",
      visit_hours: "",
      visit_phone: "",
      soul_contact_email_self_service: true,
    });
    // 断言「没有」:整份 settings 不出门,assistant_enabled 不在请求里。
    expect(patch).not.toHaveProperty("settings");
    expect(patch).not.toHaveProperty("assistant_enabled");
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mockShowToast).toHaveBeenCalledWith("tenants.settings.saved", "success");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["tenants"] });
  });

  it("an emptied cooldown goes out as null (remove the key), not as 0 or omitted", async () => {
    update.mockResolvedValue({ data: tenant() });
    renderDialog(tenant());
    fireEvent.change(screen.getByLabelText("tenants.settings.cooldown_days"), { target: { value: "" } });
    save();
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0][1]).toMatchObject({ soul_rebirth_cooldown_days: null });
  });

  it("365 is the most the form sends; 366 never reaches the API", async () => {
    expect(parseCooldownDays("365")).toBe(365);
    expect(parseCooldownDays("366")).toBeUndefined();
    renderDialog(tenant());
    fireEvent.change(screen.getByLabelText("tenants.settings.cooldown_days"), { target: { value: "366" } });
    save();
    expect(await screen.findByRole("alert")).toHaveTextContent("tenants.settings.cooldown_invalid");
    expect(update).not.toHaveBeenCalled();

    update.mockResolvedValue({ data: tenant() });
    fireEvent.change(screen.getByLabelText("tenants.settings.cooldown_days"), { target: { value: "365" } });
    save();
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0][1]).toMatchObject({ soul_rebirth_cooldown_days: 365 });
  });

  it("a non-integer cooldown never reaches the API and is named under its own field", async () => {
    renderDialog(tenant());
    fireEvent.change(screen.getByLabelText("tenants.settings.cooldown_days"), { target: { value: "-3" } });
    save();
    expect(await screen.findByRole("alert")).toHaveTextContent("tenants.settings.cooldown_invalid");
    expect(update).not.toHaveBeenCalled();
  });

  it("shows the backend's per-field 400 under the field, and a toast for anything else", async () => {
    update.mockRejectedValueOnce({ response: { status: 400, data: { hall_name: ["Ensure this field has no more than 60 characters."] } } });
    const { onClose } = renderDialog(tenant());
    save();
    expect(await screen.findByRole("alert")).toHaveTextContent("Ensure this field has no more than 60 characters.");
    expect(onClose).not.toHaveBeenCalled();
    expect(mockShowToast).not.toHaveBeenCalled();

    update.mockRejectedValueOnce({ response: { status: 500, data: {} } });
    save();
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith("tenants.settings.save_failed", "error"));
  });
});

describe("到殿办理 / 灵魂账号 (第四十一批 H-a)", () => {
  it("fills the three visit lines from settings and sends them trimmed", async () => {
    update.mockResolvedValue({ data: tenant() });
    renderDialog(tenant({ settings: { visit_address: "正门" } }));
    const address = screen.getByLabelText(/hall_settings\.visit\.address/);
    expect(address).toHaveValue("正门");
    expect(address).toHaveAttribute("maxlength", "80");
    expect(screen.getByLabelText(/hall_settings\.visit\.hours/)).toHaveAttribute("maxlength", "40");
    expect(screen.getByLabelText(/hall_settings\.visit\.phone/)).toHaveAttribute("maxlength", "40");
    fireEvent.change(address, { target: { value: "  东门  " } });
    save();
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0][1]).toMatchObject({ visit_address: "东门", visit_hours: "", visit_phone: "" });
  });

  it("shows the letters_on line only when letters are on", () => {
    renderDialog(tenant({ letters_on: true }));
    expect(screen.getByText("hall_settings.visit.letters_on")).toBeInTheDocument();
  });

  it("has no letters_on line when letters are off", () => {
    renderDialog(tenant({ letters_on: false }));
    expect(screen.queryByText("hall_settings.visit.letters_on")).toBeNull();
  });

  it("the email switch defaults on, only an explicit false turns it off, and both explanation lines always show", async () => {
    update.mockResolvedValue({ data: tenant() });
    renderDialog(tenant({ settings: { soul_contact_email_self_service: false } }));
    const box = screen.getByLabelText("hall_settings.soul_email_self");
    expect(box).not.toBeChecked();
    expect(screen.getByText("hall_settings.soul_email_on")).toBeInTheDocument();
    expect(screen.getByText("hall_settings.soul_email_off")).toBeInTheDocument();
    fireEvent.click(box);
    save();
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0][1]).toMatchObject({ soul_contact_email_self_service: true });
  });

  it("a tenant with no such key starts with the switch on", () => {
    renderDialog(tenant());
    expect(screen.getByLabelText("hall_settings.soul_email_self")).toBeChecked();
  });
});

describe("转世配额 (第五十一批 Q-1)", () => {
  const limitBox = (form: string) => screen.getByLabelText(`reincarnation.forms.${form} · tenants.settings.rebirth_quota_limit_col`);

  it("seven rows — the six paths, then 未归类 — seeded from the hall's stored limits, blank = no limit", () => {
    renderDialog(tenant({ settings: { rebirth_monthly_quota: { DIVINE: 20, HELL_BEING: 0 } } }));
    const rows = [...document.querySelectorAll("[data-quota-form]")].map((r) => r.getAttribute("data-quota-form"));
    expect(rows).toEqual(["DIVINE", "HUMAN", "ASURA", "ANIMAL", "HUNGRY_GHOST", "HELL_BEING", "OTHER"]);
    expect(limitBox("DIVINE")).toHaveValue("20");
    expect(limitBox("HUMAN")).toHaveValue("");
    expect(limitBox("HUMAN")).toHaveAttribute("placeholder", "tenants.settings.rebirth_quota_unlimited");
    // 0 是「本月不办这一道」:说一句,不当错误。
    expect(screen.getByText("tenants.settings.rebirth_quota_zero")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("sends only the paths that changed: a number, or null for a cleared one", async () => {
    update.mockResolvedValue({ data: tenant() });
    renderDialog(tenant({ settings: { rebirth_monthly_quota: { DIVINE: 20, ASURA: 5 } } }));
    fireEvent.change(limitBox("DIVINE"), { target: { value: "" } });
    fireEvent.change(limitBox("OTHER"), { target: { value: "0" } });
    save();
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0][1].rebirth_monthly_quota).toEqual({ DIVINE: null, OTHER: 0 });
  });

  it("nothing touched: the field is not in the request at all", async () => {
    update.mockResolvedValue({ data: tenant() });
    renderDialog(tenant({ settings: { rebirth_monthly_quota: { DIVINE: 20 } } }));
    save();
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0][1]).not.toHaveProperty("rebirth_monthly_quota");
  });

  it("a negative or fractional limit never reaches the API", async () => {
    expect(parseQuotaLimit("-3")).toBeUndefined();
    expect(parseQuotaLimit("1.5")).toBeUndefined();
    expect(parseQuotaLimit("0")).toBe(0);
    expect(parseQuotaLimit(" ")).toBeNull();
    renderDialog(tenant());
    fireEvent.change(limitBox("HUNGRY_GHOST"), { target: { value: "-3" } });
    save();
    expect(await screen.findByRole("alert")).toHaveTextContent("tenants.settings.rebirth_quota_invalid");
    expect(update).not.toHaveBeenCalled();
  });

  it("the Egyptian hall has no rebirth, so no quota section", () => {
    renderDialog(tenant({ code: "EG_DUAT", civilization: "EGYPTIAN" }));
    expect(screen.queryByTestId("tenant-rebirth-quota")).toBeNull();
  });
});
