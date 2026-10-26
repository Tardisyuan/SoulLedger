/**
 * 建殿 / 停用(第五十四批 K-2、K-3):文明没有默认值、选好之前不能提交;种子殿代号配错文明的错误挂在文明下;
 * 停用确认写两条后果和「殿不能删除」,确认按钮不是危险色。
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { tenantsApi, type Tenant } from "@soulledger/core/api";
import { CreateHallDialog, DeactivateHallDialog, hallCreateErrors } from "@/src/components/tenants/HallLifecycleDialogs";

jest.mock("@soulledger/core/api", () => ({
  ...jest.requireActual("@soulledger/core/api"),
  tenantsApi: { create: jest.fn(), deactivate: jest.fn(), activate: jest.fn() },
}));
const mockShowToast = jest.fn();
jest.mock("@/src/contexts/ToastContext", () => ({ useToast: () => ({ showToast: mockShowToast }) }));
jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) => (params ? `${key}(${Object.values(params).join(",")})` : key),
    locale: "zh-Hans",
    hydrated: true,
  }),
}));

const t = (key: string, params?: Record<string, string>) => (params ? `${key}(${Object.values(params).join(",")})` : key);
const bad = (data: unknown) => ({ response: { status: 400, data } });

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => jest.clearAllMocks());

describe("hallCreateErrors", () => {
  it("文明配错挂在文明下,用翻译后的文明名", () => {
    expect(hallCreateErrors(bad({ civilization: ["CN_DIYU is a CHINESE hall."] }), "CN_DIYU", t)).toEqual({
      civilization: "halls.civ_mismatch(CN_DIYU,tenant.civilizations.CHINESE)",
    });
  });
  it("代号已占用与格式不对是两句话;不是 400 返回 null", () => {
    expect(hallCreateErrors(bad({ code: ["A hall with this code already exists."] }), "X", t)).toEqual({ code: "halls.code_taken" });
    expect(hallCreateErrors(bad({ code: ["This value does not match the required pattern."] }), "x", t)).toEqual({ code: "halls.code_invalid" });
    expect(hallCreateErrors({ response: { status: 500, data: {} } }, "X", t)).toBeNull();
  });
});

describe("新建殿", () => {
  it("文明没有默认值,没选之前不能提交;选了才发请求,代号转大写", async () => {
    (tenantsApi.create as jest.Mock).mockResolvedValue({ data: { code: "HADES_2", display_name: "冥府第二殿" } });
    const onClose = jest.fn();
    wrap(<CreateHallDialog onClose={onClose} />);
    const submit = screen.getByRole("button", { name: "halls.submit" });
    fireEvent.change(screen.getByLabelText(/halls\.code/), { target: { value: "hades_2" } });
    fireEvent.change(screen.getByLabelText(/halls\.name/), { target: { value: "冥府第二殿" } });
    expect((screen.getByLabelText(/halls\.civilization/) as HTMLSelectElement).value).toBe("");
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/halls\.civilization/), { target: { value: "GREEK" } });
    expect(submit).not.toBeDisabled();
    fireEvent.click(submit);
    await waitFor(() =>
      expect(tenantsApi.create).toHaveBeenCalledWith(expect.objectContaining({ code: "HADES_2", civilization: "GREEK", display_name: "冥府第二殿" }))
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});

describe("停用确认", () => {
  const hall = { id: 3, code: "DIYU_3", display_name: "第三殿", is_active: true } as Tenant;

  it("两条后果分行写、说明殿不能删除;确认按钮是主色不是危险色;确认后停用", async () => {
    (tenantsApi.deactivate as jest.Mock).mockResolvedValue({ data: { ...hall, is_active: false } });
    const onClose = jest.fn();
    wrap(<DeactivateHallDialog tenant={hall} onClose={onClose} />);
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "halls.deactivate_no_souls",
      "halls.deactivate_no_deaths",
    ]);
    expect(screen.getByText("halls.deactivate_reversible")).toBeInTheDocument();
    const confirm = screen.getByTestId("hall-deactivate-confirm");
    expect(confirm.className).not.toMatch(/danger/);
    fireEvent.click(confirm);
    await waitFor(() => expect(tenantsApi.deactivate).toHaveBeenCalledWith("DIYU_3"));
    expect(tenantsApi.activate).not.toHaveBeenCalled();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
