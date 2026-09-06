/**
 * The cross-judgment detail page fetches once. A language switch now costs
 * nothing.
 *
 * ── WHAT CHANGED, AND WHY THE NUMBERS WENT DOWN ───────────────────────────
 *
 * This page used to fetch by hand: a `useCallback` feeding a `useEffect` that
 * listed it as a dependency. That is the shape where an unstable identity does
 * not fail — it just re-fetches forever while the page still renders
 * correctly — and `react-hooks/exhaustive-deps` had put `t` in those deps, so
 * the honest question was "how many requests does that cost". The measured
 * answer was zh-Hans 1 · en 2 · en + one switch 3, and this file pinned it.
 *
 * The page is on `useQuery` now, keyed `["cross-judgments", "detail", id]`.
 * `t` is read at render and is nowhere near the fetch, so every one of those
 * numbers is 1. The budget did not get looser, it got tighter, and the third
 * case below is now the strongest of the three: a language switch used to be
 * a request and is now provably not one.
 *
 * THIS FILE IS STILL WORTH ITS KEEP. The defect class did not go away with the
 * mechanism — it moved into the query key. Anything that puts a locale, a `t`,
 * or a fresh object into that key re-fetches on every context change, silently
 * and correctly-rendering, exactly as before. These three cases are what would
 * notice.
 *
 * WHY THE REAL `I18nProvider`. `t` is memoised on `[locale, loadedBundles]`
 * (see I18nContext), so its identity moves when a lazy message bundle lands —
 * once, for a non-default locale. A stubbed `useI18n` returning a stable `t`
 * would make every number here a 1 and the file would be measuring the stub.
 * The provider is real; only the router, the tenant and the API are doubles.
 *
 * WHY `mockTenantCtx` IS A MODULE CONSTANT. It was not, first time round, and
 * `useTenant: () => ({ user: {...} })` handed back a new object per call — so
 * the effect's `user` dependency moved every render and the page fetched in a
 * loop. zh-Hans measured 3 and climbing. That was the double behaving like the
 * defect, not the page having it; the real TenantContext holds `user` in
 * state. Recorded because a reader arriving at this fixture would otherwise
 * reasonably "simplify" it back.
 *
 * PROVEN BY MUTATION, and the first attempt is worth recording because it is
 * the mistake a reader would make. Putting `t` itself into the query key does
 * NOT break these tests — React Query hashes keys through `JSON.stringify`,
 * which drops functions, so `[..., t]` and `[..., someOtherT]` hash to the
 * same string and nothing re-fetches. A key that looks like it varies and does
 * not is worse than no key at all. The mutation that does go red is a
 * locale-varying *value*: `t("crossJudgments.title")` in the key turns the
 * lazy-bundle case and the language-switch case red, which is exactly the
 * defect class this file is for.
 *
 * WHY EACH TEST BUILDS ITS OWN `QueryClient`. A shared one would serve the
 * second and third cases from the first case's cache and every count would be
 * a 1 for a reason that has nothing to do with the page. `retry: false` so a
 * failure is one call and not four.
 *
 * MEASURED (2026-09-06, after the useQuery migration): zh-Hans 1 · en 1 ·
 * en + one switch 1. Previously (2026-09-04, hand-rolled fetch): 1 · 2 · 3.
 */
import { render, screen, waitFor, act, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider, useI18n } from "@/src/contexts/I18nContext";

jest.mock("next/navigation", () => ({
  useParams: () => ({ id: "cj-1" }),
  useRouter: () => ({ back: jest.fn(), push: jest.fn() }),
}));

const mockTenantCtx = { user: { id: 1, username: "u" }, tenant: { slug: "t" } };
jest.mock("@/src/contexts/TenantContext", () => ({
  useTenant: () => mockTenantCtx,
}));

jest.mock("@soulledger/core/api", () => ({
  crossTenantJudgmentsApi: {
    get: jest.fn().mockResolvedValue({
      data: {
        id: "cj-1",
        title: "T",
        status: "ACTIVE",
        initiating_tenant: "a",
        participants: [],
        opinions: [],
      },
    }),
  },
}));

import Page from "@/app/cross-judgments/[id]/page";

const { crossTenantJudgmentsApi } = require("@soulledger/core/api");

/** Lets a case drive `setLocale` from inside the provider. */
function Switcher() {
  const { setLocale, locale } = useI18n();
  return (
    <button data-testid="switch" onClick={() => setLocale(locale === "en" ? "zh-Hans" : "en")}>
      switch
    </button>
  );
}

/** A cache of its own per case — see the header. */
function withProviders(locale: "en" | "zh-Hans", children: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <QueryClientProvider client={client}>
      <I18nProvider initialLocale={locale}>{children}</I18nProvider>
    </QueryClientProvider>
  );
}

/** Long enough for the lazy bundle's dynamic import and any effect it wakes. */
async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50));
  });
}

describe("cross-judgment detail — request budget", () => {
  beforeEach(() => crossTenantJudgmentsApi.get.mockClear());

  it("fetches exactly once on the default locale", async () => {
    render(withProviders("zh-Hans", <Page />));
    await waitFor(() => expect(crossTenantJudgmentsApi.get).toHaveBeenCalled());
    await settle();
    // Exactly, not "at least": a `>= 1` here is the assertion that cannot fail
    // for the case this file exists to catch.
    expect(crossTenantJudgmentsApi.get).toHaveBeenCalledTimes(1);
  });

  it("costs nothing extra on a locale whose bundle is lazy", async () => {
    render(withProviders("en", <Page />));
    await waitFor(() => expect(crossTenantJudgmentsApi.get).toHaveBeenCalled());
    await settle();
    // Was 2: mount, then the `en` bundle landing moved `t` and re-ran the
    // effect. `t` is not in the query key, so the bundle landing is now free.
    expect(crossTenantJudgmentsApi.get).toHaveBeenCalledTimes(1);
  });

  it("costs nothing per language switch", async () => {
    render(
      withProviders(
        "en",
        <>
          <Switcher />
          <Page />
        </>
      )
    );
    await waitFor(() => expect(crossTenantJudgmentsApi.get).toHaveBeenCalled());
    await settle();
    expect(crossTenantJudgmentsApi.get).toHaveBeenCalledTimes(1);

    // The load-bearing one. Switching language moves `locale`, `t`, and every
    // bundle behind them; the query key holds none of those, so the answer
    // already on the cache is still the answer. This was 3.
    fireEvent.click(screen.getByTestId("switch"));
    await settle();
    expect(crossTenantJudgmentsApi.get).toHaveBeenCalledTimes(1);
  });
});
