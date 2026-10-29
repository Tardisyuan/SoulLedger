/**
 * 数据范围 B1:每殿只有一个根机构(后端 org/0010),接口不建根 —— 新建 / 移动必须选上级,根自己改名不受限;
 * 删除被名下的灵魂 / 审判挡住时(409 `not_empty` 带 souls / judgments)说出这两个数,而不是「0 名人员」。
 */
import { render, screen, fireEvent } from "@testing-library/react";
import type { Organization } from "@soulledger/core/api";
import { OrganizationDeleteDialog, OrganizationFormDialog } from "@/src/components/organizations/OrganizationDialogs";

jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) => (params ? `${key} ${JSON.stringify(params)}` : key),
    locale: "zh-Hans",
    hydrated: true,
  }),
}));

const mockMutateDelete = jest.fn();
jest.mock("@soulledger/core/hooks/useOrganizations", () => ({
  useDeleteOrganization: () => ({ mutate: mockMutateDelete, isPending: false }),
  useSaveOrganization: () => ({ mutate: jest.fn(), isPending: false }),
}));

const root: Organization = { id: 1, name: "中国地府", code: "ROOT_CN_DIYU", category: "CHINESE", parent: null, level: 0, sort: 0 } as Organization;
const hall: Organization = { id: 2, name: "第一殿", code: "D1", category: "CHINESE", parent: 1, level: 1, sort: 0 } as Organization;

function saveButton() {
  return screen.getByRole("button", { name: "org.form.save" });
}

function fillNameAndCode() {
  fireEvent.change(screen.getByLabelText(/org.form.name/), { target: { value: "新机构" } });
  fireEvent.change(screen.getByLabelText(/tenants.code/), { target: { value: "NEW" } });
}

test("creating a unit without a parent cannot be saved; picking one enables save", () => {
  render(<OrganizationFormDialog mode={{ kind: "create", parent: null }} organizations={[root, hall]} onClose={() => {}} />);
  fillNameAndCode();
  expect(saveButton()).toBeDisabled();
  fireEvent.click(screen.getByRole("radio", { name: /第一殿/ }));
  expect(saveButton()).not.toBeDisabled();
});

test("moving a non-root unit to the top is refused; the root itself can still be edited", () => {
  const { unmount } = render(
    <OrganizationFormDialog mode={{ kind: "move", org: hall }} organizations={[root, hall]} onClose={() => {}} />,
  );
  expect(saveButton()).not.toBeDisabled();
  fireEvent.click(screen.getByRole("radio", { name: "organization.root" }));
  expect(saveButton()).toBeDisabled();
  unmount();

  render(<OrganizationFormDialog mode={{ kind: "edit", org: root }} organizations={[root, hall]} onClose={() => {}} />);
  expect(saveButton()).not.toBeDisabled();
});

test("a delete refused for owned souls and judgments names those counts, not people", () => {
  mockMutateDelete.mockImplementation((_id, { onError }) =>
    onError({
      isAxiosError: true,
      response: { status: 409, data: { code: "not_empty", units: 0, people: 0, souls: 3, judgments: 2 } },
    }),
  );
  render(<OrganizationDeleteDialog org={hall} canViewPeople onClose={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "org.delete" }));
  expect(screen.getByText('org.delete_blocked_body.records {"souls":"3","judgments":"2"}')).toBeInTheDocument();
  expect(screen.queryByText(/org.delete_blocked_body.people/)).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "org.delete_blocked_people" })).not.toBeInTheDocument();
});
