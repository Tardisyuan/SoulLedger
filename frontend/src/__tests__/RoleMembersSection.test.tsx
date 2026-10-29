/**
 * 角色抽屉的「成员」页签(RoleMembersSection,rbac-snowy 2026-10-29)。
 * 真的 zh-Hans 文案;只桩住 API。主角色与兼任分开标、主角色不能在这里移除、选人按殿分组、
 * 已持有的人不可勾、整批被拒时逐人列出原因。
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { permApi, usersApi, type Role } from "@soulledger/core/api";
import { RoleMembersSection } from "@/src/components/permissions/RoleMembersSection";
import { tZh } from "./support/zhBundle";

jest.mock("@soulledger/core/api", () => ({
  permApi: { roles: { members: jest.fn(), changeMembers: jest.fn() } },
  usersApi: { list: jest.fn() },
}));
const mockI18n = { t: tZh, locale: "zh-Hans", hydrated: true };
jest.mock("@/src/contexts/I18nContext", () => ({ useI18n: () => mockI18n }));
const mockShowToast = jest.fn();
jest.mock("@/src/contexts/ToastContext", () => ({ useToast: () => ({ showToast: mockShowToast }) }));

const members = permApi.roles.members as jest.Mock;
const changeMembers = permApi.roles.changeMembers as jest.Mock;
const list = usersApi.list as jest.Mock;

const role = { id: 7, name: "SCRIBE", display_name: "书记", member_count: 1 } as unknown as Role;
const cn = { id: 1, code: "CN_DIYU", display_name: "中国地府" };
const eg = { id: 2, code: "EG_DUAT", display_name: "埃及杜阿特" };
const user = (id: number, username: string, roleName: string, extra: string[] = [], tenant = cn) => ({
  id, username, role: roleName, extra_roles: extra, tenant, organization: null, is_active: true,
});
const page = (results: unknown[]) => ({ data: { count: results.length, next: null, previous: null, results } });

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return render(<RoleMembersSection role={role} />, { wrapper: Wrapper });
}

beforeEach(() => {
  jest.clearAllMocks();
  members.mockResolvedValue(page([user(1, "main_holder", "SCRIBE"), user(2, "extra_holder", "JUDGE", ["SCRIBE"])]));
  changeMembers.mockResolvedValue({ data: { changed: 1, unchanged: 0 } });
});

it("lists main-role and additional holders, labelled apart; only the additional one can be removed here", async () => {
  renderSection();
  await screen.findByText("main_holder");
  const listEl = screen.getByRole("list", { name: tZh("permissions.members.list") });
  const main = within(listEl).getByText("main_holder").closest("li")!;
  const extra = within(listEl).getByText("extra_holder").closest("li")!;
  expect(within(main).getByText(tZh("permissions.members.primary"))).toBeInTheDocument();
  expect(within(main).queryByText(tZh("permissions.members.extra"))).toBeNull();
  expect(within(extra).getByText(tZh("permissions.members.extra"))).toBeInTheDocument();
  expect(within(main).getByRole("button", { name: tZh("permissions.members.remove_label", { name: "main_holder" }) })).toBeDisabled();

  fireEvent.click(within(extra).getByRole("button", { name: tZh("permissions.members.remove_label", { name: "extra_holder" }) }));
  await waitFor(() => expect(changeMembers).toHaveBeenCalledWith(7, { action: "remove", kind: "extra", user_ids: [2] }));
  await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(tZh("permissions.members.removed", { n: "1" }), "success"));
});

it("search goes to the server", async () => {
  renderSection();
  await screen.findByText("main_holder");
  fireEvent.change(screen.getByRole("searchbox", { name: tZh("permissions.members.search") }), { target: { value: "ext" } });
  await waitFor(() => expect(members).toHaveBeenLastCalledWith(7, { search: "ext", page: 1 }));
});

it("the picker groups by hall, cannot re-pick a holder, and grants the picked people as the chosen kind", async () => {
  list.mockResolvedValue(page([user(1, "main_holder", "SCRIBE"), user(3, "cn_new", "VIEWER"), user(4, "eg_new", "JUDGE", [], eg)]));
  renderSection();
  await screen.findByText("main_holder");
  fireEvent.click(screen.getByRole("button", { name: tZh("permissions.members.grant") }));
  const form = await screen.findByRole("form", { name: tZh("permissions.members.grant") });
  const cnGroup = await within(form).findByRole("group", { name: "中国地府" });
  const egGroup = within(form).getByRole("group", { name: "埃及杜阿特" });
  expect(within(egGroup).queryByText("cn_new")).toBeNull();
  expect(within(cnGroup).getByRole("checkbox", { name: /main_holder/ })).toBeDisabled();

  const submit = within(form).getByRole("button", { name: tZh("permissions.members.grant_n", { n: "0" }) });
  expect(submit).toBeDisabled();
  fireEvent.click(within(cnGroup).getByRole("checkbox", { name: /cn_new/ }));
  fireEvent.click(within(egGroup).getByRole("checkbox", { name: /eg_new/ }));
  fireEvent.click(within(form).getByRole("radio", { name: tZh("permissions.members.primary") }));
  expect(within(form).getByText(tZh("permissions.members.primary_hint"))).toBeInTheDocument();
  fireEvent.click(within(form).getByRole("button", { name: tZh("permissions.members.grant_n", { n: "2" }) }));
  await waitFor(() => expect(changeMembers).toHaveBeenCalledWith(7, { action: "add", kind: "primary", user_ids: [3, 4] }));
});

it("a refused batch lists each refused person and says nothing changed", async () => {
  list.mockResolvedValue(page([user(3, "cn_new", "VIEWER")]));
  changeMembers.mockRejectedValue(
    Object.assign(new Error("HTTP 403"), {
      response: { status: 403, data: { code: "refused", refusals: [{ user_id: 3, username: "cn_new", code: "forbidden", error: "x" }] } },
    })
  );
  renderSection();
  await screen.findByText("main_holder");
  fireEvent.click(screen.getByRole("button", { name: tZh("permissions.members.grant") }));
  const form = await screen.findByRole("form", { name: tZh("permissions.members.grant") });
  fireEvent.click(await within(form).findByRole("checkbox", { name: /cn_new/ }));
  fireEvent.click(within(form).getByRole("button", { name: tZh("permissions.members.grant_n", { n: "1" }) }));
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent(tZh("permissions.members.refused_title"));
  expect(alert).toHaveTextContent(`cn_new · ${tZh("permissions.members.refused.forbidden")}`);
  expect(mockShowToast).not.toHaveBeenCalledWith(expect.anything(), "success");
});
