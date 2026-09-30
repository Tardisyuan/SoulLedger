/**
 * 租户印字编辑(规范 v2 补足 A6):PATCH /tenants/{code}/seal-glyphs/,400 原样显示,
 * 改的是自己租户时把新印字写回 TenantContext —— 页头的印读的就是那里。
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { tenantsApi, type Tenant } from "@soulledger/core/api";
import { SealGlyphsDialog, parseSealGlyphs, sealGlyphsError } from "@/src/components/tenants/SealGlyphsDialog";

jest.mock("@soulledger/core/api", () => ({ tenantsApi: { updateSealGlyphs: jest.fn() } }));

const mockSetUser = jest.fn();
const mockUser = {
  id: 1,
  username: "yama",
  display_name: "阎罗",
  email: "",
  role: "ADMIN",
  permissions: [],
  tenant: { code: "CN_DIYU", display_name: "第五殿", seal_glyphs: [] as string[] },
};
jest.mock("@/src/contexts/TenantContext", () => ({
  useTenant: () => ({ user: mockUser, setUser: mockSetUser }),
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

const tenant = (over: Partial<Tenant> = {}): Tenant => ({ id: 1, code: "CN_DIYU", display_name: "第五殿", seal_glyphs: [], ...over });

function renderDialog(tn: Tenant, onClose = jest.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <SealGlyphsDialog tenant={tn} onClose={onClose} />
    </QueryClientProvider>
  );
  return onClose;
}

beforeEach(() => jest.clearAllMocks());

describe("parseSealGlyphs / sealGlyphsError", () => {
  it("splits by code point (hieroglyphs are astral) and drops whitespace, without truncating", () => {
    expect(parseSealGlyphs(" 五 ")).toEqual(["五"]);
    expect(parseSealGlyphs("\u{13184}\u{13000}")).toEqual(["\u{13184}", "\u{13000}"]);
    expect(parseSealGlyphs("一二三")).toHaveLength(3);
  });

  it("flattens DRF's per-index errors, and says nothing for a non-400", () => {
    expect(sealGlyphsError({ response: { status: 400, data: { seal_glyphs: { 0: ["不是汉字"] } } } })).toBe("不是汉字");
    expect(sealGlyphsError({ response: { status: 400, data: { seal_glyphs: ["最多 1 个字。"] } } })).toBe("最多 1 个字。");
    expect(sealGlyphsError({ response: { status: 500, data: {} } })).toBeNull();
  });
});

describe("SealGlyphsDialog", () => {
  it("shows the civilization default in the hint and previews the typed glyph", () => {
    renderDialog(tenant());
    expect(screen.getByText("tenants.seal.hint_one(冥)")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("tenants.seal.column"), { target: { value: "五" } });
    expect(screen.getByTestId("seal-preview")).toHaveTextContent("五");
  });

  it("shows the server's 400 under the field and keeps the dialog open", async () => {
    (tenantsApi.updateSealGlyphs as jest.Mock).mockRejectedValue({
      response: { status: 400, data: { seal_glyphs: ["CN 最多 1 个字。"] } },
    });
    const onClose = renderDialog(tenant());
    fireEvent.change(screen.getByLabelText("tenants.seal.column"), { target: { value: "五殿" } });
    fireEvent.click(screen.getByRole("button", { name: "common.save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("CN 最多 1 个字。");
    expect(tenantsApi.updateSealGlyphs).toHaveBeenCalledWith("CN_DIYU", ["五", "殿"]);
    expect(onClose).not.toHaveBeenCalled();
    expect(mockSetUser).not.toHaveBeenCalled();
  });

  it("writes the saved glyphs back into the session when it is the user's own tenant", async () => {
    (tenantsApi.updateSealGlyphs as jest.Mock).mockResolvedValue({ data: tenant({ seal_glyphs: ["五"] }) });
    const onClose = renderDialog(tenant());
    fireEvent.change(screen.getByLabelText("tenants.seal.column"), { target: { value: "五" } });
    fireEvent.click(screen.getByRole("button", { name: "common.save" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mockSetUser).toHaveBeenCalledWith(
      expect.objectContaining({ tenant: expect.objectContaining({ code: "CN_DIYU", seal_glyphs: ["五"] }) })
    );
    expect(mockShowToast).toHaveBeenCalledWith("tenants.seal.saved", "success");
  });

  it("leaves the session alone when another tenant is edited", async () => {
    (tenantsApi.updateSealGlyphs as jest.Mock).mockResolvedValue({ data: tenant({ code: "GR_HADES", seal_glyphs: [] }) });
    const onClose = renderDialog(tenant({ code: "GR_HADES", display_name: "Hades" }));
    fireEvent.click(screen.getByRole("button", { name: "common.save" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(tenantsApi.updateSealGlyphs).toHaveBeenCalledWith("GR_HADES", []);
    expect(mockSetUser).not.toHaveBeenCalled();
  });
});
