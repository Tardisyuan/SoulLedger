/**
 * 角色抽屉「复制为新角色」:代码或显示名空着就点复制,格下写 field_required、不发请求(审计 2026-11-26 B6:
 * 按钮不再灰着不说原因,放开让提交出校验)。两格都填了才调 copy。
 */
import { screen, fireEvent } from "@testing-library/react";
import type { Role } from "@soulledger/core/api";
import { RolesSection } from "@/src/components/permissions/RolesSection";
import { renderWithProviders } from "./support/render";

jest.mock("@/src/contexts/I18nContext", () =>
  require("./support/mocks").i18nMock({
    actual: true,
    useI18n: () => ({ t: (k: string) => k, tf: (_k: string, f: string) => f, locale: "en", hydrated: true }),
  })
);
jest.mock("@/src/contexts/ToastContext", () => ({ useToast: () => ({ showToast: jest.fn() }) }));

const mockCopy = jest.fn();
jest.mock("@soulledger/core/hooks/usePermissionMatrix", () => ({
  ...jest.requireActual("@soulledger/core/hooks/usePermissionMatrix"),
  useCopyRole: () => ({ mutate: mockCopy, isPending: false }),
  useDeleteRole: () => ({ mutate: jest.fn(), isPending: false }),
}));
// 抽屉里的数据范围与成员两块各自取数,与复制表单无关。
jest.mock("@/src/components/permissions/RoleDataScopeSection", () => ({ RoleDataScopeSection: () => null }));
jest.mock("@/src/components/permissions/RoleMembersSection", () => ({ RoleMembersSection: () => null }));

const ROLE = {
  id: 7,
  name: "CLERK",
  display_name: "书吏",
  description: "",
  is_builtin: false,
  member_count: 2,
  permission_count: 5,
  workflow_template_count: 0,
  update_time: "2026-11-01T00:00:00Z",
} as unknown as Role;

beforeEach(() => mockCopy.mockClear());

function openCopyForm() {
  renderWithProviders(
    <RolesSection roles={[ROLE]} isLoading={false} isError={false} onRetry={jest.fn()} onOpenMatrix={jest.fn()} canManage />,
    { i18n: false }
  );
  fireEvent.click(screen.getByRole("button", { name: /CLERK|书吏|roles\./ }));
  fireEvent.click(screen.getByRole("button", { name: "permissions.roles.more" }));
  fireEvent.click(screen.getByRole("button", { name: "permissions.roles.copy" }));
  const form = screen.getByRole("form", { name: "permissions.roles.copy" });
  const [code, name] = [...form.querySelectorAll("input")];
  const submit = () => fireEvent.submit(form);
  return { code, name, submit };
}

describe("RolesSection 复制角色:空着的必填格", () => {
  it("代码清空后点复制:代码格下写 field_required,不调 copy", () => {
    const { code, name, submit } = openCopyForm();
    fireEvent.change(code, { target: { value: "" } });
    submit();
    expect(code).toHaveAccessibleDescription(/common\.field_required/);
    expect(name).not.toHaveAccessibleDescription(/common\.field_required/);
    expect(screen.getAllByText("common.field_required")).toHaveLength(1);
    expect(mockCopy).not.toHaveBeenCalled();
  });

  it("显示名清空后点复制:显示名格下写 field_required,不调 copy", () => {
    const { code, name, submit } = openCopyForm();
    fireEvent.change(name, { target: { value: "  " } });
    submit();
    expect(name).toHaveAccessibleDescription(/common\.field_required/);
    expect(code).not.toHaveAccessibleDescription(/common\.field_required/);
    expect(mockCopy).not.toHaveBeenCalled();
  });

  it("两格都在:不写 field_required,调 copy", () => {
    const { submit } = openCopyForm();
    submit();
    expect(screen.queryByText("common.field_required")).not.toBeInTheDocument();
    expect(mockCopy).toHaveBeenCalledWith(
      { sourceId: 7, data: { name: "CLERK_COPY", display_name: "书吏" } },
      expect.anything()
    );
  });
});
