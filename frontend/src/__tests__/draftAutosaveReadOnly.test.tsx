/**
 * 代看 / 进殿查看是只读(rbac-web M-4):审判台的判词自动保存不发 PATCH —— 服务端会拒
 * (`impersonation_read_only`),而编辑一下就发一次只会换来一串 403。不在看时照常保存。
 */
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const mutate = jest.fn();
jest.mock("@soulledger/core/hooks/useJudgments", () => ({
  useSaveJudgmentDraft: () => ({ mutate, isPending: false }),
}));
jest.mock("@/src/components/impersonation/useImpersonation", () => ({
  ...jest.requireActual("@/src/components/impersonation/useImpersonation"),
  useImpersonation: jest.fn(() => null),
}));

import { AUTOSAVE_DEBOUNCE_MS, useDraftAutosave } from "@/src/components/judgment/JudgmentDraftAutosave";
import { useImpersonation } from "@/src/components/impersonation/useImpersonation";

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
);

function editOnce() {
  const { result } = renderHook(
    () =>
      useDraftAutosave({
        judgmentId: "j1",
        notes: "判词",
        verdict: "",
        placement: { destination: "", term: "", eternal: false } as never,
        enabled: true,
      }),
    { wrapper }
  );
  act(() => result.current.markEdited());
  act(() => jest.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS + 10));
}

beforeEach(() => {
  jest.useFakeTimers();
  mutate.mockReset();
});
afterEach(() => {
  jest.useRealTimers();
  (useImpersonation as jest.Mock).mockReturnValue(null);
});

it("saves the draft after an edit when nobody is viewing", () => {
  editOnce();
  expect(mutate).toHaveBeenCalledTimes(1);
});

it("does not send the PATCH while viewing as someone else", () => {
  (useImpersonation as jest.Mock).mockReturnValue({ id: 1, target: { id: 2, name: "x", role: "JUDGE", hall: null } });
  editOnce();
  expect(mutate).not.toHaveBeenCalled();
});

it("does not send the PATCH during a hall view", () => {
  (useImpersonation as jest.Mock).mockReturnValue({ id: 1, target: { id: 0, name: "", role: "ADMIN", hall: {} }, hallView: { code: "CN_DIYU" } });
  editOnce();
  expect(mutate).not.toHaveBeenCalled();
});
