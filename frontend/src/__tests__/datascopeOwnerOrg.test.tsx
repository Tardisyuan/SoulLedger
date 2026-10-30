/**
 * 数据范围 B3a 的两处界面:
 * - 「所属机构」(`OwnerOrgField`,灵魂 / 审判详情):不持码只显示、没有「修改」;持码可改,保存发选中的机构 id,
 *   服务端 400(范围外)提示范围那一句。
 * - 机构删除只被名下灵魂 / 审判挡住时(409 `not_empty`,units / people 都是 0)给「转移到…」:先选机构才可点,
 *   选项里没有被删的机构自己;有下级或人员时不给(move_to 不搬它们)。
 */
import type { ComponentProps } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { organizationsApi, type Organization } from "@soulledger/core/api";
import { OwnerOrgField } from "@/src/components/organizations/OwnerOrgField";
import { OrganizationDeleteDialog } from "@/src/components/organizations/OrganizationDialogs";

jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({ t: (key: string) => key, locale: "zh-Hans", hydrated: true }),
}));

const mockShowToast = jest.fn();
jest.mock("@/src/contexts/ToastContext", () => ({ useToast: () => ({ showToast: mockShowToast }) }));

jest.mock("@soulledger/core/api", () => ({
  ...jest.requireActual("@soulledger/core/api"),
  organizationsApi: { all: jest.fn() },
}));

const mockMutateDelete = jest.fn();
jest.mock("@soulledger/core/hooks/useOrganizations", () => ({
  // The real read hook (it calls the `organizationsApi.all` mock above); only the writes are doubled.
  useAllOrganizations: jest.requireActual("@soulledger/core/hooks/useOrganizations").useAllOrganizations,
  useDeleteOrganization: () => ({ mutate: mockMutateDelete, isPending: false }),
  useSaveOrganization: () => ({ mutate: jest.fn(), isPending: false }),
}));

const unit = (id: number, name: string, parent: number | null, tenant = 1) =>
  ({ id, name, code: `U${id}`, category: "CHINESE", parent, level: parent ? 1 : 0, sort: id, tenant }) as Organization;
const root = unit(1, "中国地府", null);
const a = unit(2, "甲司", 1);
const b = unit(3, "乙司", 1);
const elsewhere = unit(9, "别殿司", null, 4);

function renderField(props: Partial<ComponentProps<typeof OwnerOrgField>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onSave = props.onSave ?? jest.fn().mockResolvedValue(undefined);
  render(
    <QueryClientProvider client={qc}>
      <OwnerOrgField orgId={2} orgName="甲司" tenantId={1} canChange onSave={onSave} {...props} />
    </QueryClientProvider>,
  );
  return onSave;
}

beforeEach(() => {
  (organizationsApi.all as jest.Mock).mockResolvedValue([root, a, b, elsewhere]);
  mockShowToast.mockClear();
  mockMutateDelete.mockReset();
});

test("without the code the owning unit is shown but cannot be changed", () => {
  renderField({ canChange: false });
  expect(screen.getByTestId("owner-org")).toHaveTextContent("甲司");
  expect(screen.queryByRole("button", { name: "org.owner_change" })).not.toBeInTheDocument();
});

test("changing the owner saves the picked unit of the same hall", async () => {
  const onSave = renderField();
  fireEvent.click(screen.getByRole("button", { name: "org.owner_change" }));
  fireEvent.click(await screen.findByRole("radio", { name: /乙司/ }));
  expect(screen.queryByRole("radio", { name: /别殿司/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "common.save" }));
  await waitFor(() => expect(onSave).toHaveBeenCalledWith(3));
  expect(mockShowToast).toHaveBeenCalledWith("org.owner_saved", "success");
});

test("a 400 from the server says the unit is outside the data scope", async () => {
  renderField({ onSave: jest.fn().mockRejectedValue({ response: { status: 400 } }) });
  fireEvent.click(screen.getByRole("button", { name: "org.owner_change" }));
  fireEvent.click(await screen.findByRole("radio", { name: /乙司/ }));
  fireEvent.click(screen.getByRole("button", { name: "common.save" }));
  await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith("org.owner_out_of_scope", "error"));
  expect(mockShowToast).not.toHaveBeenCalledWith("org.owner_saved", "success");
});

function refuse(body: Record<string, number>) {
  mockMutateDelete.mockImplementationOnce((_arg, { onError }) =>
    onError({ isAxiosError: true, response: { status: 409, data: { code: "not_empty", ...body } } }),
  );
}

test("a delete blocked only by owned records offers to move them first", () => {
  refuse({ units: 0, people: 0, souls: 3, judgments: 1 });
  render(<OrganizationDeleteDialog org={a} canViewPeople organizations={[root, a, b]} onClose={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "org.delete" }));
  const go = screen.getByRole("button", { name: "org.move_and_delete" });
  expect(go).toBeDisabled();
  expect(screen.queryByRole("radio", { name: /甲司/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("radio", { name: /乙司/ }));
  fireEvent.click(go);
  expect(mockMutateDelete).toHaveBeenLastCalledWith({ id: 2, moveTo: 3 }, expect.anything());
});

test("sub-units or people still block the delete without a move option", () => {
  refuse({ units: 0, people: 2, souls: 3, judgments: 0 });
  render(<OrganizationDeleteDialog org={a} canViewPeople organizations={[root, a, b]} onClose={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "org.delete" }));
  expect(screen.queryByRole("button", { name: "org.move_and_delete" })).not.toBeInTheDocument();
  expect(screen.queryByRole("radio")).not.toBeInTheDocument();
});
