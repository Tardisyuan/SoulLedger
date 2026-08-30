"use client";

import { useI18n } from "@/src/contexts/I18nContext";

interface PageErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

// NOTE on the two `t(...) || "fallback"` expressions that used to be here:
// `I18nContext.t` returns the key itself when it cannot resolve one, and a key
// is a non-empty string, so the right-hand side was unreachable. The screen
// would show `error.title`, not "Something went wrong", and everyone reading
// this file believed there was an English fallback. There are ~150 more of
// these across the frontend; these two are removed because this file is being
// edited anyway. See tests/... — the keys are asserted to exist.
export function PageError({ error, reset }: PageErrorProps) {
  const { t } = useI18n();

  return (
    <div className="flex items-center justify-center h-64">
      <div className="text-center">
        <div className="text-08 text-[hsl(var(--color-status-error))] mb-4">!</div>
        <h2 className="text-06 text-[hsl(var(--color-ink))] mb-2">
          {t("error.title")}
        </h2>
        <p className="text-[hsl(var(--color-ink-muted))] mb-4 text-04">
          {error.message || t("error.description")}
        </p>
        <button
          onClick={reset}
          className="px-4 py-2 bg-[hsl(var(--color-accent))] text-black rounded-lg text-03 font-medium hover:opacity-90 transition-opacity"
        >
          {t("error.retry")}
        </button>
      </div>
    </div>
  );
}


interface QueryErrorProps {
  /** Re-run the query. Omit only if there is genuinely nothing to retry. */
  onRetry?: () => void;
  /** Optional detail, e.g. a status code. The message itself is generic. */
  detail?: string;
}

/**
 * The failed state of a list query.
 *
 * Nine pages had no error branch at all -- `tenants`, `cross-judgments`,
 * `notifications`, `social`, `social/follows`, `death-sync`, `organizations`,
 * `realms`, `actors`. A failed request produced an empty array, which fell
 * through to the empty state, so **"the server is down" and "there is nothing
 * here" rendered the same words**. Measured 2026-08-29 by running each page
 * twice against the same fixture, once returning 500 and once returning an
 * empty list: the page text was identical, character for character.
 *
 * Three of those nine destructured `error` from `useQuery` and never used it.
 * `organizations` was worse still: no empty state either, so a failure
 * rendered a heading and nothing else.
 *
 * `DataTable` already does this correctly for the pages that use it. This is
 * the same statement for the pages that render their own lists.
 */
export function QueryError({ onRetry, detail }: QueryErrorProps) {
  const { t } = useI18n();

  return (
    <div
      role="alert"
      data-query-error=""
      className="flex flex-col items-center justify-center py-10 text-center"
    >
      <p className="text-05 text-[hsl(var(--color-ink))] mb-1">
        {t("error.title")}
      </p>
      <p className="text-03 text-[hsl(var(--color-ink-muted))] mb-4">
        {detail || t("error.description")}
      </p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="px-4 py-2 border border-[hsl(var(--color-hairline))] text-03 text-[hsl(var(--color-ink))] hover:bg-[hsl(var(--color-surface-2))] transition-colors"
        >
          {t("error.retry")}
        </button>
      )}
    </div>
  );
}
