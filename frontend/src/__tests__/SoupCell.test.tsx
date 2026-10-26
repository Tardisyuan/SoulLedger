/** 候转世名单的孟婆汤格(第五十四批 R-1/R-2):不适用是 MissingValue;未饮登记要先确认;已饮只写时间。 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SoupCell } from "@/src/components/souls/SoupCell";

const mockDrink = jest.fn();
jest.mock("@soulledger/core/api", () => ({
  ...jest.requireActual("@soulledger/core/api"),
  reincarnationApi: { drinkSoup: (id: string) => mockDrink(id) },
}));
jest.mock("@/src/hooks/usePermissions", () => ({
  usePermissions: () => ({ isAdmin: true, hasPermission: () => true, hasAnyPermission: () => true, hasAllPermissions: () => true }),
}));
jest.mock("@/src/contexts/ToastContext", () => ({ useToast: () => ({ showToast: jest.fn() }) }));
jest.mock("@/src/contexts/I18nContext", () => ({
  ...jest.requireActual("@/src/contexts/I18nContext"),
  useI18n: () => ({ t: (k: string, p?: Record<string, string>) => (p ? `${k}|${JSON.stringify(p)}` : k), formatDateTime: (v: unknown) => `at:${String(v)}`, locale: "zh-Hans", hydrated: true }),
}));

const soul = { id: 7, name: "张三", civilization: "CHINESE", current_state: "REINCARNATING", soup_taken_at: null };

test("not applicable outside reincarnating Chinese souls: no register button", () => {
  render(<SoupCell soul={{ ...soul, civilization: "EGYPTIAN" }} onChanged={jest.fn()} />);
  expect(screen.queryByTestId("soup-register")).toBeNull();
  expect(screen.queryByTestId("soup-not-taken")).toBeNull();
});

test("taken shows only the time", () => {
  render(<SoupCell soul={{ ...soul, soup_taken_at: "2026-10-27T01:00:00Z" }} onChanged={jest.fn()} />);
  expect(screen.getByTestId("soup-taken")).toHaveTextContent("at:2026-10-27T01:00:00Z");
  expect(screen.queryByTestId("soup-register")).toBeNull();
});

test("register asks first, then calls drinkSoup and refreshes", async () => {
  mockDrink.mockResolvedValue({});
  const onChanged = jest.fn();
  render(<SoupCell soul={soul} onChanged={onChanged} />);
  fireEvent.click(screen.getByTestId("soup-register"));
  expect(mockDrink).not.toHaveBeenCalled();
  fireEvent.click(screen.getAllByText("mengpoSoup.register")[1]);
  await waitFor(() => expect(mockDrink).toHaveBeenCalledWith("7"));
  await waitFor(() => expect(onChanged).toHaveBeenCalled());
});
