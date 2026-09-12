/**
 * A refetch must not overwrite the notes the judge is typing.
 *
 * WHAT WENT WRONG. `app/judgment/[id]/page.tsx` seeded the notes textarea
 * from the server in an effect keyed on `judgment` — every time the query
 * produced a new object. That is not only first load: a window refocus, a
 * network recovery, or any invalidation that reaches `judgmentKeys.detail`
 * (the realtime layer invalidates `judgmentKeys.all` on every judgment push)
 * refetches, and the effect wrote the server's `notes` over whatever the
 * operator had typed. On the page where a verdict is being composed (FL-06).
 *
 * THE RULE. The server is the source until the operator touches the field;
 * after that the field is the operator's until the judgment is concluded.
 * Both halves are asserted: the untouched field still follows a refetch
 * (that is the pre-existing behaviour and it is right), and the touched one
 * does not.
 *
 * The real page, a real QueryClient, and only the HTTP layer stubbed, so the
 * refetch is a real refetch and the effect under test is the real effect.
 */
import { render, screen, act, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const ID = "j-1";

/**
 * `React.use` shim — the same one, for the same reason, as
 * `dispatchApproveConfirms.test.tsx`: jest resolves `react@18`, where `use`
 * does not exist, while the app runs on the React Next bundles. It unwraps the
 * one already-resolved params promise these tests hand in and proves nothing
 * about suspense. Read the note over there before widening it.
 */
jest.mock("react", () => {
  const actual = jest.requireActual("react");
  return {
    ...actual,
    use: <T,>(value: Promise<T> | T): T => {
      if (value && typeof (value as { then?: unknown }).then === "function") {
        return { id: ID } as unknown as T;
      }
      return value as T;
    },
  };
});

import JudgmentDetailPage from "@/app/judgment/[id]/page";
import { judgmentApi, soulsApi } from "@soulledger/core/api";
import { judgmentKeys } from "@soulledger/core/query_keys";

jest.mock("@soulledger/core/api", () => ({
  judgmentApi: { get: jest.fn(), conclude: jest.fn() },
  soulsApi: { get: jest.fn() },
}));

const mockI18n = {
  t: (key: string) => key,
  formatDate: (v: unknown) => String(v),
  formatDateTime: (v: unknown) => String(v),
  locale: "zh-Hans",
  hydrated: true,
};
jest.mock("@/src/contexts/I18nContext", () => ({
  ...jest.requireActual("@/src/contexts/I18nContext"),
  useI18n: () => mockI18n,
}));

jest.mock("@/src/contexts/ToastContext", () => ({
  useToast: () => ({ showToast: jest.fn() }),
}));

const mockTenant = {
  user: { id: 1, username: "yama", role: "ADMIN", tenant: null, permissions: [] },
};
jest.mock("@/src/contexts/TenantContext", () => ({
  useTenant: () => mockTenant,
}));

const mockGet = judgmentApi.get as jest.Mock;
const mockSoulGet = soulsApi.get as jest.Mock;

function judgment(notes: string, confession = "") {
  return {
    id: ID,
    soul: "s-1",
    soul_name: "李四",
    civilization: "CHINESE",
    judge: "u-1",
    judge_name: "Yama",
    court: "第一殿",
    evidence_json: {},
    confession,
    verdict: null,
    notes,
    citations: [],
    is_final: false,
    created_at: "2026-09-12T00:00:00Z",
    concluded_at: null,
  };
}

let queryClient: QueryClient;

function renderPage() {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <JudgmentDetailPage params={Promise.resolve({ id: ID })} />
    </QueryClientProvider>
  );
}

const notesBox = () => screen.getByLabelText("judgment.detail.notes") as HTMLTextAreaElement;

/**
 * The server now says `notes`; make the page refetch and wait for it to LAND.
 *
 * "Landed" is observed through a different field of the same payload — the
 * confession paragraph — not through `mockGet` having been called, which is
 * true the moment the fetch starts and before anything has reached the
 * effect. The first draft of this waited on the call count and passed against
 * the unfixed page; that pass measured the fetch, not the defect.
 */
const LANDED = "confession from the refetched payload";
async function refetchWith(notes: string) {
  mockGet.mockResolvedValue({ data: judgment(notes, LANDED) });
  await act(async () => {
    await queryClient.invalidateQueries({ queryKey: judgmentKeys.detail(ID) });
  });
  await screen.findByText(LANDED);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSoulGet.mockResolvedValue({ data: { id: "s-1", name: "李四" } });
  mockGet.mockResolvedValue({ data: judgment("server draft") });
});

describe("the notes draft survives a refetch", () => {
  it("keeps what the operator typed when the server answers again", async () => {
    renderPage();
    await waitFor(() => expect(notesBox().value).toBe("server draft"));

    fireEvent.change(notesBox(), { target: { value: "my own reasoning" } });
    expect(notesBox().value).toBe("my own reasoning");

    await refetchWith("server draft, revised elsewhere");

    // Presence and absence: the draft is still there, and the server's later
    // text did not land on top of it.
    expect(notesBox().value).toBe("my own reasoning");
    expect(notesBox().value).not.toContain("revised elsewhere");
  });

  it("still follows the server while the field is untouched", async () => {
    // The other half of the rule, so that "never overwrite" cannot be the
    // accidental implementation: an operator who has not typed should see the
    // record as it now is.
    renderPage();
    await waitFor(() => expect(notesBox().value).toBe("server draft"));

    await refetchWith("server draft, revised elsewhere");

    await waitFor(() => expect(notesBox().value).toBe("server draft, revised elsewhere"));
  });
});
