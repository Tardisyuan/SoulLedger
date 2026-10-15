/**
 * 全局 `?`:只列当前页面登记过的快捷键;没登记就什么都不做;列表里带「单字母快捷键」总开关。
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { ShortcutHelp } from "@/src/components/layout/ShortcutHelp";
import { SINGLE_KEYS_STORAGE_KEY, setSingleKeyShortcuts, useShortcutHelp } from "@/src/lib/hotkeys";
import { tZh } from "./support/zhBundle";

jest.mock("@/src/contexts/I18nContext", () => {
  const { tZh: t } = jest.requireActual("./support/zhBundle");
  return { ...jest.requireActual("@/src/contexts/I18nContext"), useI18n: () => ({ t, locale: "zh-Hans", hydrated: true }) };
});

const ROWS = [{ key: "J / K", label: "shortcuts.move_rows" }] as const;
function Page({ register = true }: { register?: boolean }) {
  useShortcutHelp(ROWS, register);
  return <ShortcutHelp />;
}

afterEach(() => localStorage.removeItem(SINGLE_KEYS_STORAGE_KEY));

it("? opens the list the page registered, with the switch inside; Esc closes it", async () => {
  render(<Page />);
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.keyDown(document.body, { key: "?" });
  const dialog = await screen.findByRole("dialog");
  expect(dialog).toHaveTextContent(tZh("shortcuts.move_rows"));
  const toggle = screen.getByRole("checkbox", { name: new RegExp(tZh("shortcuts.single_keys")) });
  expect(toggle).toBeChecked();
  fireEvent.click(toggle);
  expect(localStorage.getItem(SINGLE_KEYS_STORAGE_KEY)).toBe("off");
  // The way back stays reachable: ? is exempt from the switch.
  fireEvent.keyDown(document.body, { key: "Escape" });
  fireEvent.keyDown(document.body, { key: "?" });
  expect(await screen.findByRole("dialog")).toBeInTheDocument();
});

it("a page that registers nothing gets no dialog on ?", () => {
  render(<Page register={false} />);
  fireEvent.keyDown(document.body, { key: "?" });
  expect(screen.queryByRole("dialog")).toBeNull();
  setSingleKeyShortcuts(true);
});
