/**
 * 语料页「插入审判台」(src/components/judgment/CorpusInsertIntoDesk.tsx)的三条路:
 *   1. 记着这个用户最后打开的未结案 → 直达 `/judgment/<id>?cite=<statute>`,不列清单;
 *   2. 没记着 → 列他认领着的未结案(`?group=mine`),每件都是带 `?cite=` 的链接;
 *   3. 一件都没有 → 「你手上没有未结的案件」。
 *   4. 记着的那件已在别处结案 → 点下去先问现状,已结就忘掉它、改开清单,不送去审判台。
 * 记忆按用户分键:别人记着的案子不是我的。
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { judgmentApi } from "@soulledger/core/api";
import { CorpusInsertIntoDesk } from "@/src/components/judgment/CorpusInsertIntoDesk";
import { I18nProvider } from "@/src/contexts/I18nContext";
import { lastOpenCase, rememberOpenCase } from "@/src/lib/lastOpenCase";

jest.mock("@soulledger/core/api", () => ({ judgmentApi: { list: jest.fn(), get: jest.fn() } }));
const mockPush = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock("@/src/contexts/TenantContext", () => ({
  useTenant: () => ({ user: { id: 7, role: "JUDGE", permissions: ["judgment.execute"], tenant: { code: "CN_DIYU" } } }),
}));
const mockedList = judgmentApi.list as jest.Mock;
const mockedGet = judgmentApi.get as jest.Mock;

function renderIt() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <I18nProvider>{children}</I18nProvider>
    </QueryClientProvider>
  );
  return render(<CorpusInsertIntoDesk statuteId="st-9" />, { wrapper: Wrapper });
}

beforeEach(() => {
  localStorage.clear();
  mockedList.mockReset();
  mockedGet.mockReset();
  mockPush.mockReset();
});

it("goes straight to the remembered open case with ?cite=", () => {
  rememberOpenCase(7, { id: "j-42", soul_name: "沈青梧" });
  renderIt();
  const link = screen.getByTestId("corpus-insert");
  expect(link).toHaveAttribute("href", "/judgment/j-42?cite=st-9");
  expect(link).toHaveTextContent("插入审判台");
  expect(link).toHaveTextContent("沈青梧");
  expect(mockedList).not.toHaveBeenCalled();
});

it("ignores another user's remembered case", async () => {
  rememberOpenCase(8, { id: "j-other", soul_name: "别人" });
  mockedList.mockResolvedValue({ data: { count: 0, next: null, previous: null, results: [] } });
  renderIt();
  expect(screen.getByTestId("corpus-insert").tagName).toBe("BUTTON");
  expect(screen.queryByText("别人")).toBeNull();
});

it("without a remembered case, picks from the user's claimed open cases", async () => {
  mockedList.mockResolvedValue({
    data: { count: 2, next: null, previous: null, results: [
      { id: "j-1", soul_name: "甲魂", court: "第一殿" },
      { id: "j-2", soul_name: "乙魂", court: "第五殿" },
    ] },
  });
  renderIt();
  fireEvent.click(screen.getByTestId("corpus-insert"));
  const picker = await screen.findByTestId("corpus-insert-picker");
  await within(picker).findByText("甲魂");
  expect(mockedList).toHaveBeenCalledWith({ group: "mine", ordering: "-created_at" });
  expect(within(picker).getByRole("link", { name: "甲魂" })).toHaveAttribute("href", "/judgment/j-1?cite=st-9");
  expect(within(picker).getByRole("link", { name: "乙魂" })).toHaveAttribute("href", "/judgment/j-2?cite=st-9");
});

it("says so when the user holds no open case", async () => {
  mockedList.mockResolvedValue({ data: { count: 0, next: null, previous: null, results: [] } });
  renderIt();
  fireEvent.click(screen.getByTestId("corpus-insert"));
  expect(await screen.findByText("你手上没有未结的案件")).toBeInTheDocument();
  expect(screen.queryByRole("link")).toBeNull();
});

it("a remembered case still open: the click checks, then goes to the desk with ?cite=", async () => {
  rememberOpenCase(7, { id: "j-42", soul_name: "沈青梧" });
  mockedGet.mockResolvedValue({ data: { id: "j-42", is_final: false } });
  renderIt();
  fireEvent.click(screen.getByTestId("corpus-insert"));
  await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/judgment/j-42?cite=st-9"));
  expect(mockedGet).toHaveBeenCalledWith("j-42");
  expect(lastOpenCase(7)?.id).toBe("j-42");
  expect(screen.queryByTestId("corpus-insert-picker")).toBeNull();
});

it("a remembered case concluded elsewhere: forgotten, and the picker opens instead of the desk", async () => {
  rememberOpenCase(7, { id: "j-42", soul_name: "沈青梧" });
  mockedGet.mockResolvedValue({ data: { id: "j-42", is_final: true } });
  mockedList.mockResolvedValue({ data: { count: 0, next: null, previous: null, results: [] } });
  renderIt();
  fireEvent.click(screen.getByTestId("corpus-insert"));
  expect(await screen.findByText("你手上没有未结的案件")).toBeInTheDocument();
  expect(lastOpenCase(7)).toBeNull();
  expect(mockPush).not.toHaveBeenCalled();
  expect(screen.queryByText(/沈青梧/)).toBeNull();
  expect(mockedList).toHaveBeenCalledWith({ group: "mine", ordering: "-created_at" });
});
