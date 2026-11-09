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

/** `retry: false` for queries and mutations; `queries` adds to (or overrides) the query defaults, e.g. `{ staleTime: 30_000 }`. */
export function createTestQueryClient(queries: DefaultOptions["queries"] = {}): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, ...queries }, mutations: { retry: false } } });
}

export interface ProvidersOptions {
  /** Reuse a client (to seed or inspect its cache before rendering). */
  client?: QueryClient;
  /** Extra query defaults for a client built here. Ignored when `client` is given. */
  queries?: DefaultOptions["queries"];
  /** Real `I18nProvider` at this locale (default "zh-Hans"); `false` for a suite whose I18nContext is mocked. */
  i18n?: Locale | false;
}

/** `{ client, wrapper }` — the wrapper alone is what `renderHook(…, { wrapper })` wants. */
export function testProviders({ client, queries, i18n = "zh-Hans" }: ProvidersOptions = {}) {
  const qc = client ?? createTestQueryClient(queries);
  const wrapper = ({ children }: { children: ReactNode }) => {
    const inner = <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    return i18n === false ? inner : <I18nProvider initialLocale={i18n}>{inner}</I18nProvider>;
  };
  return { client: qc, wrapper };
}

export function renderWithProviders(ui: ReactNode, options: ProvidersOptions & Omit<RenderOptions, "wrapper"> = {}) {
  const { client, queries, i18n, ...renderOptions } = options;
  const providers = testProviders({ client, queries, i18n });
  return { ...render(ui, { ...renderOptions, wrapper: providers.wrapper }), client: providers.client };
}
