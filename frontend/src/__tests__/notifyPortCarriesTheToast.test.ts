/**
 * The `notify` port: that a message **key** reaches a real, translated toast on
 * web, and that the seven hooks actually go through it.
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
 *   1. the web adapter's `notify` resolves the key against the bundles and puts
 *      the resulting sentence in the real DOM — so the port is wired to
 *      something, not just declared, and the host really is the translator;
 *   2. a hook drives it with a probe adapter installed and no toast module
 *      mocked at all — so the redirection is real at run time;
 *   3. the seven hook files are pinned by name and may not name `useToast` —
 *      so a regression in the six this file does not exercise still fails.
 */
import { render, renderHook, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  configurePlatform,
  notify,
  platform,
  type NotifyKind,
  type NotifyMessage,
  type PlatformAdapter,
} from "@soulledger/core/platform";
import { installWebPlatform } from "@/lib/platform/web";
import { I18nProvider } from "@/src/contexts/I18nContext";
import { dispositionApi } from "@soulledger/core/api";
import { useExecuteDisposition } from "@soulledger/core/hooks/useDispositions";

jest.mock("@soulledger/core/api", () => ({
  dispositionApi: { list: jest.fn(), execute: jest.fn() },
}));

// NO `jest.mock("@/src/contexts/I18nContext")` HERE, and its absence is the
// point. `useExecuteDisposition` does not import it any more — the key it
// raises is resolved by the adapter, at the far end of the port. A mock of a
// module nothing under test imports reads as coverage and is not any.

const mockExecute = dispositionApi.execute as jest.Mock;

/** Deliberately NOT a jest.mock of the port — the adapter is swapped the way a
 *  host swaps it, so the code under test resolves it exactly as it does in the
 *  browser. A `jest.mock` here would be a double that bypasses
 *  `configurePlatform`, i.e. it would prove the mock works. */
function recordingAdapter() {
  const calls: Array<[NotifyMessage, NotifyKind, number | undefined]> = [];
  const adapter: PlatformAdapter = {
    ...platform(),
    notify: (message, kind, durationMs) => void calls.push([message, kind, durationMs]),
  };
  return { adapter, calls };
}

/**
 * Mount the real `I18nProvider`, which is what publishes `t` to
 * `lib/i18n/activeTranslator` for the adapter to resolve keys through.
 *
 * Deliberately the real provider and the real bundles — a stub `t` here would
 * be a double standing in for the exact machinery under test, and the repo has
 * already shipped one of those (the `DomainEnum` stub, BRIEF §4.6). Testing
 * Library unmounts it after each test, which restores the "nothing published"
 * state the last case below asserts on.
 */
function mountI18n(): void {
  render(createElement(I18nProvider, null, createElement("div")));
}

function toastTexts(): string[] {
  // `.toast`,不是 `[role="alert"]`。toast 的 role 现在按类型分档 ——
  // success / info 用 `status`,只有 error 用 assertive 的 `alert`
  // (76 个 showToast 调用点里 22 个是 success,一条保存成功不该打断读屏)。
  // 按 role 找会漏掉这里要测的那些,而这个套件问的是「文案有没有被翻译」,
  // 和它是哪一档 live region 无关。
  return Array.from(document.querySelectorAll(".toast")).map(
    (el) => el.textContent ?? ""
  );
}

afterEach(() => {
  installWebPlatform();
  document.getElementById("toast-container")?.remove();
  jest.clearAllMocks();
});

describe("the web adapter's notify reaches the browser's toast", () => {
  it("translates the key and puts the sentence on screen, not the key", () => {
    installWebPlatform();
    mountI18n();
    // The half that fails if a previous test leaked a toast — without it, the
    // assertion below would pass on somebody else's banner.
    expect(toastTexts()).toEqual([]);

    notify("souls.detail.delete_to_recycle_bin", "success");

    // The zh-Hans value of that key. An adapter that forwarded the key
    // unresolved would put "souls.detail.delete_to_recycle_bin" on screen and
    // this would go red — which is exactly the regression the key form makes
    // possible and nothing else here would see.
    expect(toastTexts().some((text) => text.includes("已移至回收站"))).toBe(true);
    // Absence as well as presence: the raw key must not be sitting next to it.
    expect(
      toastTexts().some((text) => text.includes("souls.detail.delete_to_recycle_bin"))
    ).toBe(false);
  });

  it("interpolates params into the resolved value", () => {
    installWebPlatform();
    mountI18n();
    expect(toastTexts()).toEqual([]);

    notify({ key: "souls.detail.generation", params: { n: "3" } }, "info");

    // zh-Hans: "第 {{n}} 世". A resolver that dropped `params` would leave the
    // placeholder on screen, which the absence assertion below catches.
    expect(toastTexts().some((text) => text.includes("第 3 世"))).toBe(true);
    expect(toastTexts().some((text) => text.includes("{{n}}"))).toBe(false);
  });

  it("passes `{ text }` through without looking for a key", () => {
    installWebPlatform();
    mountI18n();
    expect(toastTexts()).toEqual([]);

    // A string that IS a key, on purpose. An ordinary server sentence
    // ("Cannot react to a post from another tenant.") cannot fail this test:
    // an unresolvable key comes back unchanged, so an adapter that wrongly ran
    // it through `translate` would print exactly the same thing. Verified —
    // mutating `{ text }` to `translate(message.text)` left all 13 tests green
    // until this fixture was a real key.
    //
    // With a colliding one, the two behaviours differ visibly: pass-through
    // shows the dotted path, a lookup shows "删除失败".
    notify({ text: "souls.detail.error_delete" }, "error");

    expect(toastTexts().some((t) => t.includes("souls.detail.error_delete"))).toBe(true);
    expect(toastTexts().some((t) => t.includes("删除失败"))).toBe(false);
  });

  it("forwards an explicit duration, and omitting one keeps showToast's default", () => {
    jest.useFakeTimers();
    try {
      installWebPlatform();

      // Not real keys: an unresolvable key comes back as itself, which is what
      // makes these two usable as markers. What is under test here is the
      // duration, not the lookup.
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

  it("shows the key itself when no provider has published a translator", () => {
    // The documented degradation in `lib/i18n/activeTranslator.ts`, asserted
    // rather than left to be discovered. No `mountI18n()` here — this is the
    // server-render / no-provider state, and it must not throw or blank.
    installWebPlatform();
    expect(toastTexts()).toEqual([]);

    notify("souls.detail.delete_to_recycle_bin", "success");

    expect(
      toastTexts().some((text) => text.includes("souls.detail.delete_to_recycle_bin"))
    ).toBe(true);
    expect(toastTexts().some((text) => text.includes("已移至回收站"))).toBe(false);
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
  // ToastContext.
  //
  // SIX OF THEM ARE NO LONGER IN `frontend/`. Dropping the toast dependency and
  // then `t()` is what let them move to `packages/core/src/hooks`, so the paths
  // are relative to the repository root now rather than to `frontend/`. The
  // seventh, `useSocialEventBus`, stays: it depends on `useTenant`, which is
  // real React state and a genuine view-layer binding. It also lives in
  // `frontend/hooks`, NOT `frontend/src/hooks` — a second, older hook tree.
  const HOOKS = [
    "packages/core/src/hooks/useDispositions.ts",
    "packages/core/src/hooks/useJudgmentQueue.ts",
    "packages/core/src/hooks/useJudgments.ts",
    "packages/core/src/hooks/useReincarnation.ts",
    "packages/core/src/hooks/useSocial.ts",
    "packages/core/src/hooks/useSouls.ts",
    "frontend/hooks/useSocialEventBus.ts",
  ];
  const ROOT = path.join(__dirname, "..", "..", "..");
  const sources = HOOKS.map((file) => ({
    file,
    // Throws if the path is wrong, rather than testing an empty string — the
    // failure mode this repository keeps recording. This is what would have
    // gone red if the move above had left this list pointing at `src/hooks`.
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
    // Two spellings of one import, because the list now straddles the package
    // boundary: the six inside `packages/core` reach the port relatively
    // (`../platform/index`), and `useSocialEventBus`, outside it, by package
    // specifier. Accepting both is not looseness — a hook that imported neither
    // is what this is looking for.
    const missing = sources.filter(
      ({ source }) =>
        !/notify[\s\S]{0,80}from "(?:@soulledger\/core|\.\.)\/platform(?:\/index)?"/.test(source)
    );
    expect(missing.map(({ file }) => file)).toEqual([]);
  });

  it("none of them translates any more — the host does", () => {
    // Step 2's claim, in the same shape as the `useToast` one above. `t()` was
    // the hooks' last binding to the web tree: all 26 `t(` calls in
    // `src/hooks` were `notify` arguments, so removing this import is what
    // makes the six movable at all. `useSocialEventBus` never had it and stays
    // in the list, because a list that drops its passing members stops being a
    // pinned set.
    const offenders = sources.filter(({ source }) => source.includes("useI18n"));
    expect(offenders.map(({ file }) => file)).toEqual([]);
  });

  it("the six that moved import nothing from the web tree", () => {
    // Step 3's claim. `packages/core`'s tsconfig catches a DOM *type*, and
    // `domBoundary.test.ts` catches a DOM *name*; neither says anything about
    // an import of `@/…`, which is the Next path alias and resolves to
    // `frontend/`. Under jest's `moduleNameMapper` such an import would even
    // work, so nothing else here would report it.
    const moved = sources.filter(({ file }) => file.startsWith("packages/core/"));
    expect(moved).toHaveLength(6);
    const offenders = moved.filter(({ source }) => /from "@\//.test(source));
    expect(offenders.map(({ file }) => file)).toEqual([]);
  });
});
