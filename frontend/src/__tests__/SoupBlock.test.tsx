/**
 * 孟婆汤(第五十四批 R-3 ~ R-5):未饮写「未饮」+ 登记按钮,已饮只写时间;登记要先确认;被拒时同一块里有那句话。
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SoupBlock } from "@/src/components/souls/detail/SoupBlock";

jest.mock("@/src/components/rbac/RequirePermission", () => ({ RequirePermission: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
jest.mock("@/src/contexts/I18nContext", () => ({
  ...jest.requireActual("@/src/contexts/I18nContext"),
  useI18n: () => ({ t: (k: string, p?: Record<string, string>) => (p ? `${k}|${JSON.stringify(p)}` : k), formatDateTime: (v: unknown) => `at:${String(v)}`, locale: "zh-Hans", hydrated: true }),
}));

test("not taken: the badge and the register button, and nothing is sent before the confirm", async () => {
  const onRegister = jest.fn().mockResolvedValue(undefined);
  render(<SoupBlock name="张三" takenAt={null} refused={false} onRegister={onRegister} />);
  expect(screen.getByTestId("soup-not-taken")).toBeInTheDocument();
  fireEvent.click(screen.getByTestId("soup-register"));
  expect(onRegister).not.toHaveBeenCalled();
  fireEvent.click(await screen.findByRole("button", { name: "mengpoSoup.register" }, { timeout: 2000 }).catch(() => screen.getAllByText("mengpoSoup.register")[1]));
  await waitFor(() => expect(onRegister).toHaveBeenCalledTimes(1));
});

test("taken: only the time, no register button; the refusal line only shows while not taken", () => {
  const { rerender } = render(<SoupBlock name="张三" takenAt="2026-10-27T01:00:00Z" refused onRegister={jest.fn()} />);
  expect(screen.getByTestId("soup-taken")).toHaveTextContent("at:2026-10-27T01:00:00Z");
  expect(screen.queryByTestId("soup-register")).toBeNull();
  expect(screen.queryByTestId("soup-refused")).toBeNull();
  rerender(<SoupBlock name="张三" takenAt={null} refused onRegister={jest.fn()} />);
  expect(screen.getByTestId("soup-refused")).toHaveTextContent("reincarnation.error.soup_not_taken");
});
