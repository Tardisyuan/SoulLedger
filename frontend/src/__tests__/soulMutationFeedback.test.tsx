/**
 * One create, one toast, and a cache that actually knows it happened.
 *
 * TWO DEFECTS, ONE OWNERSHIP QUESTION. `SoulCreateModal` called
 * `soulsApi.create` directly instead of `useCreateSoul`, so **no query was
 * invalidated on create**. The souls list appeared to update only because
 * `onCreated` calls `refetch()` on the calling page's exact query; every other
 * cached souls list — each filter, sort and page — stayed stale for its full
 * 30s staleTime. `app/souls/page.tsx` even declared `useCreateSoul()` and
 * never called it.
 *
 * The mirror image on the edit path: `useUpdateSoul` toasts on success and on
 * error, and `SoulEditModal` passed per-mutate callbacks that toasted the same
 * outcome again, so every soul edit raised two identical banners.
 *
 * Both come from the same unsettled question — does the hook own user feedback
 * and cache invalidation, or does the caller? The answer this codebase takes
 * is THE HOOK, and these are the assertions that hold it.
 *
 * The cache assertion is behavioural, not a spy on `invalidateQueries`: a real
 * QueryClient is seeded at `soulKeys.list()` and asked afterwards whether the
 * entry came back invalidated. A spy would pass on an invalidation aimed at a
 * key nothing uses — the exact failure that hid six dead realtime handlers
 * (see eventInvalidationReachesCache.test.ts).
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { SoulCreateModal } from "@/src/components/ui/Modal";
import { SoulEditModal } from "@/src/components/souls/SoulEditModal";
import { soulKeys } from "@/lib/query_keys";
import { soulsApi } from "@/lib/api";

const mockShowToast = jest.fn();

jest.mock("@/lib/api", () => ({
  soulsApi: {
    create: jest.fn().mockResolvedValue({ data: { id: "s-new" } }),
    update: jest.fn().mockResolvedValue({ data: { id: "s-1" } }),
  },
}));

jest.mock("@/src/contexts/ToastContext", () => ({
  useToast: () => ({ showToast: mockShowToast }),
}));

jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({ t: (key: string) => key, locale: "en", hydrated: true }),
}));

const mockedCreate = soulsApi.create as jest.Mock;
const mockedUpdate = soulsApi.update as jest.Mock;

function renderModal() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  // The entry a second, differently-filtered souls list would hold. `refetch()`
  // on the calling page cannot reach it; only an invalidation can.
  queryClient.setQueryData(soulKeys.list({ page: 2, civilization: "GREEK" }), {
    results: [],
    count: 0,
  });
  const onCreated = jest.fn();
  const onClose = jest.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <SoulCreateModal isOpen onClose={onClose} onCreated={onCreated} />
    </QueryClientProvider>
  );
  return { queryClient, onCreated, onClose };
}

function submitWithName(name: string) {
  const nameInput = screen.getByLabelText(/souls\.form\.name/i);
  fireEvent.change(nameInput, { target: { value: name } });
  fireEvent.submit(nameInput.closest("form")!);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedCreate.mockResolvedValue({ data: { id: "s-new" } });
  mockedUpdate.mockResolvedValue({ data: { id: "s-1" } });
});

describe("creating a soul", () => {
  it("invalidates a souls list the calling page never refetches", async () => {
    const { queryClient } = renderModal();
    const otherList = soulKeys.list({ page: 2, civilization: "GREEK" });
    expect(queryClient.getQueryState(otherList)?.isInvalidated).toBe(false);

    submitWithName("孟婆");

    await waitFor(() =>
      expect(queryClient.getQueryState(otherList)?.isInvalidated).toBe(true)
    );
  });

  it("raises exactly one toast", async () => {
    renderModal();

    submitWithName("孟婆");

    await waitFor(() => expect(mockedCreate).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledTimes(1));
    expect(mockShowToast.mock.calls[0][1]).toBe("success");
  });

  it("raises exactly one toast on failure, and does not close", async () => {
    mockedCreate.mockRejectedValue(new Error("500"));
    const { onCreated, onClose } = renderModal();

    submitWithName("孟婆");

    await waitFor(() => expect(mockShowToast).toHaveBeenCalledTimes(1));
    expect(mockShowToast.mock.calls[0][1]).toBe("error");
    // Leaving the modal open IS the recovery — the operator's typing survives.
    expect(onCreated).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("editing a soul", () => {
  /**
   * `useUpdateSoul` is deliberately NOT mocked here.
   *
   * `SoulEditModal.test.tsx` stubs it as `() => ({ mutate: mockMutate })`, and
   * a stub's `mutate` never runs the hook's own `onSuccess` — so the second
   * toast, which is the whole defect, is invisible from that file no matter
   * what the component does. Counting banners requires the real hook and the
   * real component in one render.
   */
  const soul = {
    id: "s-1",
    name: "孟婆",
    civilization: "CHINESE",
    current_state: "ALIVE",
    birth_date: null,
    origin_location: null,
  } as unknown as Parameters<typeof SoulEditModal>[0]["soul"];

  it("raises exactly one toast for one edit", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const onUpdated = jest.fn();
    render(
      <QueryClientProvider client={queryClient}>
        <SoulEditModal isOpen onClose={jest.fn()} soul={soul} onUpdated={onUpdated} />
      </QueryClientProvider>
    );

    const nameInput = screen.getByLabelText(/souls\.form\.name/i);
    fireEvent.change(nameInput, { target: { value: "孟婆汤" } });
    fireEvent.submit(nameInput.closest("form")!);

    await waitFor(() => expect(mockedUpdate).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onUpdated).toHaveBeenCalledTimes(1));
    // Two identical success banners for one edit is what this pins.
    expect(mockShowToast).toHaveBeenCalledTimes(1);
  });
});
