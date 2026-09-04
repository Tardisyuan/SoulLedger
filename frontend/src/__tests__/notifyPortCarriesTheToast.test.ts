/**
 * The `notify` port: that it reaches a real toast on web, and that the seven
 * hooks actually go through it.
 *
 * WHAT THIS IS GUARDING AGAINST, specifically. The redirection is invisible
 * from outside — the same banner appears either way, so every page test stays
 * green whether a hook calls `useToast().showToast` or the port. And the hook
 * suites that DO assert on toasts (useSouls, useSocial, useJudgments…) assert
 * against a `mockShowToast` that is now wired to the port; if a hook slipped
 * back to `useToast`, those files would have to be re-pointed too, and nothing
 * would notice if they were re-pointed the wrong way. So the fact of going
 * through the port needs a check that is not itself a mock of the port.
 *
 * Three layers, because no one of them is enough:
 *   1. the web adapter's `notify` puts a real toast in the real DOM — so the
 *      port is wired to something, not just declared;
 *   2. a hook drives it with a probe adapter installed and no toast module
 *      mocked at all — so the redirection is real at run time;
 *   3. the seven hook files are pinned by name and may not name `useToast` —
 *      so a regression in the six this file does not exercise still fails.
 */
import { renderHook, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  configurePlatform,
  notify,
  platform,
  type NotifyKind,
  type PlatformAdapter,
} from "@soulledger/core/platform";
import { installWebPlatform } from "@/lib/platform/web";
import { dispositionApi } from "@soulledger/core/api";
import { useExecuteDisposition } from "@/src/hooks/useDispositions";

jest.mock("@soulledger/core/api", () => ({
  dispositionApi: { list: jest.fn(), execute: jest.fn() },
}));

jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({ t: (key: string) => key, locale: "en", hydrated: true }),
}));

const mockExecute = dispositionApi.execute as jest.Mock;

/** Deliberately NOT a jest.mock of the port — the adapter is swapped the way a
 *  host swaps it, so the code under test resolves it exactly as it does in the
 *  browser. A `jest.mock` here would be a double that bypasses
 *  `configurePlatform`, i.e. it would prove the mock works. */
function recordingAdapter() {
  const calls: Array<[string, NotifyKind, number | undefined]> = [];
  const adapter: PlatformAdapter = {
    ...platform(),
    notify: (message, kind, durationMs) => void calls.push([message, kind, durationMs]),
  };
  return { adapter, calls };
}

function toastTexts(): string[] {
  return Array.from(document.querySelectorAll('[role="alert"]')).map(
    (el) => el.textContent ?? ""
  );
}

afterEach(() => {
  installWebPlatform();
  document.getElementById("toast-container")?.remove();
  jest.clearAllMocks();
});

describe("the web adapter's notify reaches the browser's toast", () => {
  it("puts the message on screen, and nothing is on screen before it", () => {
    installWebPlatform();
    // The half that fails if a previous test leaked a toast — without it, the
    // assertion below would pass on somebody else's banner.
    expect(toastTexts()).toEqual([]);

    notify("承负已结清", "success");

    expect(toastTexts().some((text) => text.includes("承负已结清"))).toBe(true);
  });

  it("forwards an explicit duration, and omitting one keeps showToast's default", () => {
    jest.useFakeTimers();
    try {
      installWebPlatform();

      notify("short", "info", 1000);
      notify("default", "info");

      // 1000 for the duration, plus the 200ms fade `removeToast` waits out
      // before it detaches the node.
      jest.advanceTimersByTime(1201);
      // The short one is gone; the defaulted one is not. If `notify` dropped
      // `durationMs` on the floor, both would still be here.
      expect(toastTexts().some((t) => t.includes("short"))).toBe(false);
      expect(toastTexts().some((t) => t.includes("default"))).toBe(true);

      // Past showToast's own 5000ms default, fade included.
      jest.advanceTimersByTime(4200);
      expect(toastTexts().some((t) => t.includes("default"))).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  it("does nothing, safely, on a host that installed no adapter", () => {
    // Next renders these modules on the server. The null adapter is what keeps
    // that from throwing, and this is the `notify` half of it.
    configurePlatform({ ...platform(), notify: () => {} });
    expect(() => notify("nobody hears this", "info")).not.toThrow();
  });
});

describe("a hook drives the port, not the context", () => {
  it("useExecuteDisposition's success message arrives at the installed adapter", async () => {
    const { adapter, calls } = recordingAdapter();
    configurePlatform(adapter);
    mockExecute.mockResolvedValue({ data: {} });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const { result } = renderHook(() => useExecuteDisposition(), {
      wrapper: ({ children }: { children: React.ReactNode }) =>
        createElement(QueryClientProvider, { client: queryClient }, children),
    });

    result.current.mutate({ id: "d-1" });

    await waitFor(() => expect(calls.length).toBe(1));
    expect(calls[0]).toEqual(["disposition.execute_success", "success", undefined]);
  });

  it("and its failure message does too, with the error kind", async () => {
    const { adapter, calls } = recordingAdapter();
    configurePlatform(adapter);
    mockExecute.mockRejectedValue(new Error("nope"));

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const { result } = renderHook(() => useExecuteDisposition(), {
      wrapper: ({ children }: { children: React.ReactNode }) =>
        createElement(QueryClientProvider, { client: queryClient }, children),
    });

    result.current.mutate({ id: "d-1" });

    await waitFor(() => expect(calls.length).toBe(1));
    expect(calls[0]).toEqual(["disposition.execute_error", "error", undefined]);
  });
});

describe("all seven hooks, pinned by name", () => {
  // The list, not a scan for offenders: a scan is clean when it scans nothing.
  // These are the seven files commit 750ea1a recorded as blocked on
  // ToastContext, and the set is what step 2 will move into `packages/core`.
  // `useSocialEventBus` is in `frontend/hooks`, NOT `frontend/src/hooks` — a
  // second, older hook tree — which is why these are full paths.
  const HOOKS = [
    "src/hooks/useDispositions.ts",
    "src/hooks/useJudgmentQueue.ts",
    "src/hooks/useJudgments.ts",
    "src/hooks/useReincarnation.ts",
    "src/hooks/useSocial.ts",
    "src/hooks/useSouls.ts",
    "hooks/useSocialEventBus.ts",
  ];
  const ROOT = path.join(__dirname, "..", "..");
  const sources = HOOKS.map((file) => ({
    file,
    // Throws if the path is wrong, rather than testing an empty string — the
    // failure mode this repository keeps recording.
    source: readFileSync(path.join(ROOT, file), "utf8"),
  }));

  it("reads seven real files", () => {
    expect(sources).toHaveLength(7);
    expect(sources.every(({ source }) => source.length > 200)).toBe(true);
  });

  it("none of them imports useToast any more", () => {
    const offenders = sources.filter(({ source }) => source.includes("useToast"));
    expect(offenders.map(({ file }) => file)).toEqual([]);
  });

  it("none of them calls showToast directly", () => {
    // `showToast:` as an object key is allowed — `useSocialEventBus` still fills
    // `EventContext.showToast`, which is the event registry's field name and
    // not a call into the toast module.
    const offenders = sources.filter(({ source }) =>
      /(?<![:\w])showToast\s*\(/.test(source)
    );
    expect(offenders.map(({ file }) => file)).toEqual([]);
  });

  it("every one of them reaches the port instead", () => {
    const missing = sources.filter(
      ({ source }) => !/notify[\s\S]{0,80}from "@soulledger\/core\/platform"/.test(source)
    );
    expect(missing.map(({ file }) => file)).toEqual([]);
  });
});
