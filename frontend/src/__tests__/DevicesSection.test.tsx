/**
 * 个人中心「登录设备」(Design 第二十八批 W2):一台设备一行,这台在前并带「这台」;这台没有按钮,行末写「在右上角退出」;
 * 退出别台不输密码、立刻调用,行内显示「已退出」3 秒后消失;「退出其他全部」先弹确认,标题带台数,
 * 确认前不调用;只有这一台时没有「退出其他全部」。「30 天内不再询问」是行下的标签。
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DevicesSection, SIGNED_OUT_LINGER_MS } from "@/src/components/profile/DevicesSection";

jest.mock("@soulledger/core/api", () => ({
  sessionsApi: { list: jest.fn(), revoke: jest.fn(), revokeOthers: jest.fn() },
}));

jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) =>
      params ? `${key}:${Object.values(params).join("|")}` : key,
  }),
}));

jest.mock("@/src/components/ui/Toast", () => ({ showToast: jest.fn() }));

const { sessionsApi } = require("@soulledger/core/api");

const ROW = (over: Record<string, unknown>) => ({
  id: "x", label: "L", method: "password", last_seen_at: "2026-10-12T09:14:00", current: false, trusted_until: null, ...over,
});
const THIS = ROW({ id: "a", label: "Windows · Edge", current: true, trusted_until: "2026-11-08T12:00:00" });
const MAC = ROW({ id: "b", label: "macOS · Safari", last_seen_at: "2026-10-12T09:14:00", trusted_until: "2026-10-30T12:00:00" });
const APP = ROW({ id: "c", label: "官员 App · iPhone", last_seen_at: "2026-10-11T22:40:00" });

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <DevicesSection onChangePassword={jest.fn()} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  jest.useFakeTimers();
  Object.values(sessionsApi as Record<string, jest.Mock>).forEach((fn) => fn.mockReset());
  sessionsApi.list.mockResolvedValue({ data: [THIS, MAC, APP] });
});
afterEach(() => jest.useRealTimers());

const rows = () => screen.getAllByTestId("device-row");

it("lists the rows in the order given, marks this device, and gives only the others a button", async () => {
  renderSection();
  await screen.findAllByTestId("device-row");
  expect(rows().map((r) => r.getAttribute("data-current"))).toEqual(["true", "false", "false"]);
  const [mine, mac, app] = rows();
  expect(within(mine).getByText("Windows · Edge")).toBeInTheDocument();
  expect(within(mine).getByText("profile.devices.this")).toBeInTheDocument();
  expect(within(mine).getByText("profile.devices.in_use")).toBeInTheDocument();
  expect(within(mine).getByText("profile.devices.sign_out_here")).toBeInTheDocument();
  expect(within(mine).queryByRole("button")).toBeNull(); // 这台不能在这里退出
  expect(within(mac).getByRole("button", { name: "profile.devices.sign_out" })).toBeInTheDocument();
  expect(within(app).getByRole("button", { name: "profile.devices.sign_out" })).toBeInTheDocument();
  expect(within(mac).queryByText("profile.devices.this")).toBeNull();
  expect(within(mac).getByText("2026-10-12 09:14")).toBeInTheDocument();
  expect(screen.getByText("profile.devices.count:3")).toBeInTheDocument();
});

it("shows the 30-day trust as a tag under the row, only where there is one", async () => {
  renderSection();
  await screen.findAllByTestId("device-row");
  const [mine, mac, app] = rows();
  expect(mine).toHaveTextContent("2026-11-08");
  expect(mac).toHaveTextContent("2026-10-30");
  expect(within(mine).getByText("2026-11-08").className).toContain("font-mono");
  expect(within(app).queryByText(/profile\.devices\.mfa_until/)).toBeNull();
  expect(app.textContent).not.toMatch(/\d{4}-\d{2}-\d{2}(?! \d)/); // 没有标签的行没有任何单独的日期
});

it("signing out one device calls the API at once, says 已退出, then removes the row after 3 seconds", async () => {
  sessionsApi.revoke.mockResolvedValue({ data: undefined });
  renderSection();
  await screen.findAllByTestId("device-row");
  fireEvent.click(within(rows()[1]).getByRole("button", { name: "profile.devices.sign_out" }));
  await act(async () => {});
  expect(sessionsApi.revoke).toHaveBeenCalledWith("b");
  expect(sessionsApi.list).toHaveBeenCalledTimes(1); // 先不重取:这一行要先说「已退出」
  expect(within(rows()[1]).getByText("profile.devices.signed_out")).toBeInTheDocument();
  expect(within(rows()[1]).queryByRole("button")).toBeNull();
  expect(rows()).toHaveLength(3);

  sessionsApi.list.mockResolvedValue({ data: [THIS, APP] });
  await act(async () => {
    jest.advanceTimersByTime(SIGNED_OUT_LINGER_MS - 1);
  });
  expect(rows()).toHaveLength(3);
  await act(async () => {
    jest.advanceTimersByTime(1);
  });
  expect(rows()).toHaveLength(2);
  expect(screen.queryByText("macOS · Safari")).toBeNull();
  expect(screen.queryByText("profile.devices.signed_out")).toBeNull();
});

it("sign out all others asks first with the count, and only the confirm button calls the API", async () => {
  sessionsApi.revokeOthers.mockResolvedValue({ data: { revoked: 2 } });
  renderSection();
  await screen.findAllByTestId("device-row");
  fireEvent.click(screen.getByRole("button", { name: "profile.devices.sign_out_others" }));
  const dialog = await screen.findByRole("alertdialog");
  expect(within(dialog).getByText("profile.devices.confirm_title:2")).toBeInTheDocument();
  expect(within(dialog).getByText("profile.devices.confirm_body")).toBeInTheDocument();
  expect(sessionsApi.revokeOthers).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", { name: "common.cancel" }));
  await act(async () => {});
  expect(sessionsApi.revokeOthers).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "profile.devices.sign_out_others" }));
  sessionsApi.list.mockResolvedValue({ data: [THIS] });
  fireEvent.click(await screen.findByRole("button", { name: "profile.devices.confirm_action:2" }));
  await act(async () => {});
  expect(sessionsApi.revokeOthers).toHaveBeenCalledTimes(1);
  expect(rows()).toHaveLength(1);
  expect(screen.queryByRole("button", { name: "profile.devices.sign_out_others" })).toBeNull();
});

it("a lone device has no 退出其他全部 and no sign-out button at all", async () => {
  sessionsApi.list.mockResolvedValue({ data: [THIS] });
  renderSection();
  await screen.findAllByTestId("device-row");
  expect(screen.queryByRole("button", { name: "profile.devices.sign_out_others" })).toBeNull();
  expect(screen.queryByRole("button", { name: "profile.devices.sign_out" })).toBeNull();
});

it("a failed load says so instead of showing an empty list", async () => {
  sessionsApi.list.mockRejectedValue(new Error("boom"));
  renderSection();
  expect(await screen.findByRole("alert")).toHaveTextContent("profile.devices.load_failed");
  expect(screen.queryByTestId("device-row")).toBeNull();
});

it("the stranger line links to the password section and opens its form, without adding a second 修改密码 button", async () => {
  const onChangePassword = jest.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <DevicesSection onChangePassword={onChangePassword} />
    </QueryClientProvider>,
  );
  await screen.findAllByTestId("device-row");
  const link = screen.getByRole("link", { name: "profile.change_password" });
  expect(link).toHaveAttribute("href", "#password-section");
  fireEvent.click(link);
  expect(onChangePassword).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("button", { name: "profile.change_password" })).toBeNull();
});
