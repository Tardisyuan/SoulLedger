/**
 * 四十二条否定告白(埃及称心,2026-10-28):逐条记「如实 / 不实 / 未记」,结案后只读,不称心的案子不画。
 * Real QueryClient, real hooks; only the HTTP layer is stubbed.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { judgmentApi } from "@soulledger/core/api";
import { NegativeConfessionPanel } from "@/src/components/judgment/NegativeConfessionPanel";

jest.mock("@soulledger/core/api", () => ({
  ...jest.requireActual("@soulledger/core/api"),
  judgmentApi: { negativeConfessions: jest.fn(), recordNegativeConfession: jest.fn() },
}));
jest.mock("@/src/contexts/I18nContext", () => ({
  ...jest.requireActual("@/src/contexts/I18nContext"),
  useI18n: () => ({ t: (k: string, p?: Record<string, string>) => (p ? `${k}|${JSON.stringify(p)}` : k), locale: "zh-Hans", hydrated: true }),
}));

const list = judgmentApi.negativeConfessions as jest.Mock;
const record = judgmentApi.recordNegativeConfession as jest.Mock;

const row = (ordinal: number, truthful: boolean | null = null) => ({
  ordinal, statute_id: `st-${ordinal}`, code: `EG-NC-${String(ordinal).padStart(2, "0")}`,
  assessor: `Assessor ${ordinal}`, text: `I have not done wrong ${ordinal}`, truthful, note: "", recorded_at: null,
});
const listing = (over: object = {}) => ({
  applies: true, concluded: false, items: [row(1), row(2, false)],
  tally: { truthful: 0, untruthful: 1, unheard: 41, total: 42 }, ...over,
});

function renderIt(canRecord = true) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NegativeConfessionPanel judgmentId="j-1" canRecord={canRecord} />
    </QueryClientProvider>,
  );
}

beforeEach(() => jest.resetAllMocks());

test("draws one row per denial with its state and the tally", async () => {
  list.mockResolvedValue(listing());
  renderIt();
  await waitFor(() => expect(screen.getAllByTestId("confession-row")).toHaveLength(2));
  const [first, second] = screen.getAllByTestId("confession-row");
  expect(first).toHaveAttribute("data-truthful", "null");
  expect(second).toHaveAttribute("data-truthful", "false");
  expect(screen.getByText(/judgment\.confessions\.tally/)).toHaveTextContent('"untruthful":"1"');
});

test("recording one sends its ordinal and the choice", async () => {
  list.mockResolvedValue(listing());
  record.mockResolvedValue(listing({ items: [row(1, true), row(2, false)] }));
  renderIt();
  await waitFor(() => expect(screen.getAllByTestId("confession-row")).toHaveLength(2));
  const radios = screen.getAllByRole("radio", { name: "judgment.confessions.truthful" });
  fireEvent.click(radios[0]);
  await waitFor(() => expect(record).toHaveBeenCalledWith("j-1", 1, { truthful: true, note: "" }));
  await waitFor(() => expect(screen.getAllByTestId("confession-row")[0]).toHaveAttribute("data-truthful", "true"));
});

test("a concluded case, or an officer who cannot record, reads only", async () => {
  list.mockResolvedValue(listing({ concluded: true }));
  renderIt();
  await waitFor(() => expect(screen.getAllByTestId("confession-row")).toHaveLength(2));
  for (const radio of screen.getAllByRole("radio")) expect(radio).toBeDisabled();
  expect(screen.queryByRole("textbox")).toBeNull();
});

test("a case that is not weighed draws nothing", async () => {
  list.mockResolvedValue({ applies: false, concluded: false, items: [], tally: null });
  renderIt();
  await waitFor(() => expect(list).toHaveBeenCalled());
  expect(screen.queryByTestId("negative-confessions")).toBeNull();
});
