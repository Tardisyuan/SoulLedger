/**
 * app/souls/[id]/page.tsx has to be able to HEAR an invalidation.
 *
 * The soul detail page held `soul`, `ledger`, `records`, `judgments`,
 * `dispositions`, `reincarnations` and `events` in `useState`, filled once by a
 * hand-rolled `loadSoulData()` inside a `useEffect`. Nothing about that is on
 * the query cache, so every invalidation aimed at this soul — the realtime
 * `STATE_CHANGED` push, `useMarkSoulDead`, `useTransitionSoul`,
 * `useAddSoulRecord`, `useUpdateSoul` fired from anywhere else in the tree —
 * arrived at a cache entry no component was reading, and the page went on
 * rendering the copy it took at mount.
 *
 * `eventInvalidationReachesCache.test.ts` did not see this, and cannot: it
 * seeds `soulKeys.detail("s1")` itself and asks the cache whether the entry
 * came back invalidated. That answers "did the push reach the cache", which was
 * always yes. It says nothing about whether the page an operator is looking at
 * is reading from that entry — and the SOUL DETAIL PAGE was not. Its `owner`
 * column even names `packages/core/src/hooks/useSouls.ts` for the "soul detail"
 * row, which was true of `app/judgment/[id]/page.tsx`'s soul panel and false of
 * the soul detail page itself. `owner` is never asserted there, so the
 * misnaming was silent.
 *
 * So this file renders the REAL page with a REAL QueryClient and stubs only the
 * HTTP layer. The hooks under test (`useSoul`, `useSoulLedger`, …) are the real
 * ones from `@soulledger/core/hooks/useSouls` — deliberately NOT mocked, unlike
 * the two sibling SoulDetailPage suites, because a mocked hook is exactly the
 * fixture that would let this defect back in.
 */
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import SoulDetailPage from "@/app/souls/[id]/page";
import { makeTranslateWithFallback } from "@/src/contexts/I18nContext";
import { dispatchEvent, type EventPayload } from "@/lib/events/event_registry";

const SOUL_ID = "soul-1";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
  useParams: () => ({ id: SOUL_ID }),
}));

const mockShowToast = jest.fn();
jest.mock("@/src/contexts/ToastContext", () => ({
  useToast: () => ({ showToast: mockShowToast }),
}));

// Module constants, not fresh values per call. A mock written as
// `useI18n: () => ({ t: (k) => k })` hands back a NEW function every render,
// and anything keyed on `t` — the page's `tf`, and the `loadSoulData`
// useCallback this change removes — then changes identity every render, which
// turns the effect that calls it into a render loop that looks like a hang.
const mockT = (key: string) => key;
const mockFormatDate = (v: unknown) => String(v);
// `tf` is `t` plus a code-level fallback, and it is the REAL helper here
// (`requireActual`, whose spread also keeps every other export of the module
// alive) applied to the key-echoing `mockT` above — not a second copy of its
// logic. A double that re-derives the thing under it is how a broken fallback
// stays green. It moved off this page onto the i18n context; when it was a
// page-local `useCallback` these mocks did not have to supply it.
const mockI18n = {
  t: mockT,
  tf: makeTranslateWithFallback(mockT),
  formatDate: mockFormatDate,
  locale: "zh",
};
jest.mock("@/src/contexts/I18nContext", () => ({
  ...jest.requireActual("@/src/contexts/I18nContext"),
  useI18n: () => mockI18n,
}));

// Same reasoning: one frozen identity. The real permission gates run against an
// ADMIN, so the edit control below is reachable without stubbing
// `RequirePermission` itself (which suiteShape.test.ts forbids anyway).
const mockTenant = {
  user: { id: 1, username: "admin", role: "ADMIN", tenant: null, permissions: [] },
};
jest.mock("@/src/contexts/TenantContext", () => ({
  useTenant: () => mockTenant,
}));

jest.mock("@/src/components/charts/LazyDashboardCharts", () => ({
  LazySoulLineChart: () => null,
  LazyLifespanBarChart: () => null,
}));

// 409 = terminal cosmology, which the page renders as "no panel". Not the
// subject here; kept off the screen so the assertions below are about the soul.
jest.mock("@soulledger/core/api/ledger", () => ({
  ...jest.requireActual("@soulledger/core/api/ledger"),
  ledgerApi: { inheritance: jest.fn().mockRejectedValue({ response: { status: 409 } }) },
}));

const mockSoulsGet = jest.fn();
const mockSoulsKarma = jest.fn();
const mockSoulsUpdate = jest.fn();
jest.mock("@soulledger/core/api", () => ({
  soulsApi: {
    get: (...args: unknown[]) => mockSoulsGet(...args),
    karma: (...args: unknown[]) => mockSoulsKarma(...args),
    // Bare array, not a pagination envelope — see soulsApi.records's own
    // comment in packages/core/src/api/souls.ts.
    records: jest.fn().mockResolvedValue({ data: [] }),
    update: (...args: unknown[]) => mockSoulsUpdate(...args),
  },
  judgmentApi: { list: jest.fn().mockResolvedValue({ data: { results: [] } }) },
  dispositionApi: { list: jest.fn().mockResolvedValue({ data: { results: [] } }) },
  reincarnationApi: { list: jest.fn().mockResolvedValue({ data: { results: [] } }) },
  eventsApi: { list: jest.fn().mockResolvedValue({ data: { results: [] } }) },
}));

const FIRST_NAME = "孟婆亭前的甲";
const SECOND_NAME = "转生之后的乙";

function soulNamed(name: string, state = "ALIVE") {
  return {
    id: SOUL_ID,
    name,
    civilization: "CHINESE",
    current_state: state,
    birth_date: null,
    death_date: null,
    birth_name: null,
    origin_location: null,
    date_problems: [],
  };
}

function karmaWith(merit: number) {
  return {
    soul_id: SOUL_ID,
    merit_score: merit,
    demerit_score: 0,
    karmic_balance: merit,
    record_count: 0,
    records: [],
    reading: { kind: "BALANCE" as const, civilization: "CHINESE", balance: merit, merit, demerit: 0 },
  };
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <SoulDetailPage />
    </QueryClientProvider>
  );
  return { queryClient, ...utils };
}

/** The real registry, driven the way WebSocketContext drives it. */
function push(queryClient: QueryClient, payload: EventPayload) {
  act(() => {
    dispatchEvent(payload, { queryClient, showToast: mockShowToast });
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSoulsGet.mockResolvedValue({ data: soulNamed(FIRST_NAME) });
  mockSoulsKarma.mockResolvedValue({ data: karmaWith(10) });
  mockSoulsUpdate.mockResolvedValue({ data: soulNamed(SECOND_NAME) });
});

describe("SoulDetailPage is on the query cache", () => {
  it("renders the soul a realtime STATE_CHANGED push refetched, not the copy it took at mount", async () => {
    const { queryClient } = renderPage();

    await screen.findByText(FIRST_NAME);
    expect(mockSoulsGet).toHaveBeenCalledTimes(1);

    // The soul changed on the server, and the change reaches this client as a
    // push rather than as something this page did.
    mockSoulsGet.mockResolvedValue({ data: soulNamed(SECOND_NAME, "JUDGING") });
    push(queryClient, {
      domain: "soul",
      event: "STATE_CHANGED",
      soul_id: SOUL_ID,
    } as EventPayload);

    await screen.findByText(SECOND_NAME);
    // Absence as well as presence: a page that appended rather than replaced,
    // or that rendered both a stale header and a fresh badge, passes a bare
    // `findByText` on the new name.
    expect(screen.queryByText(FIRST_NAME)).not.toBeInTheDocument();
    // §4.6: the raw enum lives in `title`, so this is where the state badge is
    // checked without going through locale copy.
    expect(document.querySelector('[title="JUDGING"]')).not.toBeNull();
    expect(document.querySelector('[title="ALIVE"]')).toBeNull();
    // Not pinned to an exact number on purpose. `handleSoulStateChanged` fires
    // TWO invalidations — `soulKeys.all` and `soulKeys.detail(id)` — and both
    // prefix-match this query, so the real count today is 3, not 2. That 3 is a
    // fact about how TanStack coalesces two invalidations in one tick, not
    // about this page; pinning it would make a library detail able to fail a
    // test whose subject is the page. The claim being made is "it refetched",
    // and the control case below is what says it does not refetch for nothing.
    expect(mockSoulsGet.mock.calls.length).toBeGreaterThan(1);
  });

  it("refetches the karma ledger on that same push, not only the soul", async () => {
    const { queryClient } = renderPage();

    await screen.findByText(FIRST_NAME);
    expect(mockSoulsKarma).toHaveBeenCalledTimes(1);

    push(queryClient, {
      domain: "soul",
      event: "STATE_CHANGED",
      soul_id: SOUL_ID,
    } as EventPayload);

    await waitFor(() => expect(mockSoulsKarma).toHaveBeenCalledTimes(2));
  });

  it("ignores a push aimed at something else, so the refetch above is the push and not a poll", async () => {
    const { queryClient } = renderPage();

    await screen.findByText(FIRST_NAME);
    expect(mockSoulsGet).toHaveBeenCalledTimes(1);

    mockSoulsGet.mockResolvedValue({ data: soulNamed(SECOND_NAME) });
    push(queryClient, {
      domain: "notification",
      event: "NOTIFICATION_CREATED",
    } as EventPayload);

    // Nothing about a notification touches this soul. If this page refetched
    // here too, the two tests above would be measuring an over-broad
    // invalidation rather than the soul key.
    await waitFor(() => expect(mockSoulsGet).toHaveBeenCalledTimes(1));
    expect(screen.getByText(FIRST_NAME)).toBeInTheDocument();
    expect(screen.queryByText(SECOND_NAME)).not.toBeInTheDocument();
  });

  it("shows the edited name after a real SoulEditModal save, with no page-owned refetch", async () => {
    // The real modal and the real `useUpdateSoul` — this is the path that used
    // to be held together by `handleEditSuccess() { loadSoulData(); }`. The
    // hook invalidates `soulKeys.all`, which prefix-matches
    // `soulKeys.detail(id)`, so the page must come back on its own.
    renderPage();

    await screen.findByText(FIRST_NAME);

    fireEvent.click(screen.getByRole("button", { name: "souls.detail.edit" }));

    const nameInput = await screen.findByLabelText("souls.form.name_label");
    fireEvent.change(nameInput, { target: { value: SECOND_NAME } });
    mockSoulsGet.mockResolvedValue({ data: soulNamed(SECOND_NAME) });
    fireEvent.click(screen.getByRole("button", { name: "common.save" }));

    await waitFor(() => expect(mockSoulsUpdate).toHaveBeenCalledTimes(1));
    expect(mockSoulsUpdate).toHaveBeenCalledWith(
      SOUL_ID,
      expect.objectContaining({ name: SECOND_NAME })
    );

    await screen.findByText(SECOND_NAME);
    expect(screen.queryByText(FIRST_NAME)).not.toBeInTheDocument();
  });
});
