/**
 * The cross-judgment detail page fetches once, and a language switch costs one
 * more — not a stream.
 *
 * WHY A BUDGET AND NOT A BEHAVIOUR TEST. `loadData` is a `useCallback` feeding
 * a `useEffect` that lists it as a dependency, which is the shape where an
 * unstable identity does not fail — it just re-fetches forever while the page
 * still renders correctly. Enabling `react-hooks/exhaustive-deps` added `t` to
 * that callback's deps, and the honest question about that change is "how many
 * requests does it cost", which is a number, so this counts them.
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
 * MEASURED (2026-09-04, after the deps fix): zh-Hans 1 · en 2 · en + one
 * switch 3.
 */
import { render, screen, waitFor, act, fireEvent } from "@testing-library/react";
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

/** Long enough for the lazy bundle's dynamic import and any effect it wakes. */
async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50));
  });
}

describe("cross-judgment detail — request budget", () => {
  beforeEach(() => crossTenantJudgmentsApi.get.mockClear());

  it("fetches exactly once on the default locale", async () => {
    render(
      <I18nProvider initialLocale="zh-Hans">
        <Page />
      </I18nProvider>
    );
    await waitFor(() => expect(crossTenantJudgmentsApi.get).toHaveBeenCalled());
    await settle();
    // Exactly, not "at least": a `>= 1` here is the assertion that cannot fail
    // for the case this file exists to catch.
    expect(crossTenantJudgmentsApi.get).toHaveBeenCalledTimes(1);
  });

  it("costs one extra fetch on a locale whose bundle is lazy, and no more", async () => {
    render(
      <I18nProvider initialLocale="en">
        <Page />
      </I18nProvider>
    );
    await waitFor(() => expect(crossTenantJudgmentsApi.get).toHaveBeenCalled());
    await settle();
    // Mount, then the `en` bundle landing moves `t` once. That is the whole
    // price of listing `t` in loadData's dependencies.
    expect(crossTenantJudgmentsApi.get).toHaveBeenCalledTimes(2);
  });

  it("costs one more per language switch, and no more", async () => {
    render(
      <I18nProvider initialLocale="en">
        <Switcher />
        <Page />
      </I18nProvider>
    );
    await waitFor(() => expect(crossTenantJudgmentsApi.get).toHaveBeenCalled());
    await settle();
    expect(crossTenantJudgmentsApi.get).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByTestId("switch"));
    await settle();
    expect(crossTenantJudgmentsApi.get).toHaveBeenCalledTimes(3);
  });
});
