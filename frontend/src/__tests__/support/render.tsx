/**
 * One QueryClient + provider wrapper for component and page tests.
 *
 * 147 suites each built their own `new QueryClient({ defaultOptions: … })` and
 * a five-line `renderPage()` around it (docs/test-suite-review-2026-11-10.md
 * §3.1). The copies agreed on `retry: false` for queries; about half also said
 * `mutations: { retry: false }`, which is TanStack Query v5's default already,
 * so the two spellings behaved the same. This file says it once.
 *
 * `renderWithProviders` wraps through RTL's `wrapper` option, so `rerender`
 * keeps the providers. It returns the client next to the render result.
 *
 * i18n: the real `I18nProvider` (zh-Hans, hydrated) by default, so a new test
 * reads the words an operator reads. A suite that mocks
 * `@/src/contexts/I18nContext` passes `i18n: false` — its mock answers
 * `useI18n` and a provider would add nothing (or be `undefined`, when the mock
 * does not spread the real module).
 */
import { render, type RenderOptions } from "@testing-library/react";
import { QueryClient, QueryClientProvider, type DefaultOptions } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { I18nProvider, type Locale } from "@/src/contexts/I18nContext";

export interface TestClientOptions {
  /** Query defaults, added to (or overriding) `retry: false`, e.g. `{ staleTime: 30_000 }`. */
  queries?: DefaultOptions["queries"];
  /** Mutation defaults, likewise. */
  mutations?: DefaultOptions["mutations"];
  /**
   * `false` keeps TanStack's own retry defaults (three retries for a query) —
   * for a suite that built `new QueryClient()` or set only mutation options,
   * so its failing queries still retry exactly as they did.
   */
  retryOff?: boolean;
}

/** `retry: false` for queries and mutations unless `retryOff: false`; `queries` / `mutations` add to it. */
export function createTestQueryClient({ queries = {}, mutations = {}, retryOff = true }: TestClientOptions = {}): QueryClient {
  const off = retryOff ? { retry: false } : {};
  return new QueryClient({ defaultOptions: { queries: { ...off, ...queries }, mutations: { ...off, ...mutations } } });
}

export interface ProvidersOptions extends TestClientOptions {
  /** Reuse a client — to seed or inspect its cache, or to render a second time on the same cache. The client options are then ignored. */
  client?: QueryClient;
  /**
   * Real `I18nProvider` at this locale (default "zh-Hans", hydrated from the
   * first frame); `true` for a bare `<I18nProvider>` that reads the locale
   * cookie after mount, as the app does without a server value; `false` for a
   * suite whose I18nContext is mocked.
   */
  i18n?: Locale | boolean;
}

/** `{ client, wrapper }` — the wrapper alone is what `renderHook(…, { wrapper })` wants. */
export function testProviders({ client, i18n = "zh-Hans", ...clientOptions }: ProvidersOptions = {}) {
  const qc = client ?? createTestQueryClient(clientOptions);
  const wrapper = ({ children }: { children: ReactNode }) => {
    const inner = <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    if (i18n === false) return inner;
    return <I18nProvider initialLocale={i18n === true ? undefined : i18n}>{inner}</I18nProvider>;
  };
  return { client: qc, wrapper };
}

export function renderWithProviders(ui: ReactNode, options: ProvidersOptions & Omit<RenderOptions, "wrapper"> = {}) {
  const { client, queries, mutations, retryOff, i18n, ...renderOptions } = options;
  const providers = testProviders({ client, queries, mutations, retryOff, i18n });
  return { ...render(ui, { ...renderOptions, wrapper: providers.wrapper }), client: providers.client };
}
