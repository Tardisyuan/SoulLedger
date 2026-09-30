"use client";

import { useI18n } from "@/src/contexts/I18nContext";
import { Button } from "@/src/components/ui/Button";

/**
 * 规范 v2 补足 C15:出错是内容区里的一段,不换整页 —— 冷玫红「✕ 标题」13 / 600、
 * 旁边一颗次按钮「重试」;说明 12 ink3。冷玫红只给系统出错(判决的 ✕ 是 ink)。
 */
const ERROR_TITLE = "text-sm font-semibold text-[oklch(var(--color-danger))]";

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

  // 500(C15「404 · 500」):「500 · 服务出了问题」一行,trace 等宽 —— 这里是 Next 给的 digest。
  return (
    <div role="alert" data-page-error="" className="border-t border-[oklch(var(--color-line))] py-8">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className={ERROR_TITLE}>
          <span aria-hidden="true">✕ </span>
          {t("error.title")}
        </h2>
        <Button type="button" variant="secondary" size="sm" onClick={reset}>
          {t("error.retry")}
        </Button>
      </div>
      <p className="mt-1 text-xs text-[oklch(var(--color-ink-subtle))]">{error.message || t("error.description")}</p>
      {error.digest && (
        <p className="mt-2 font-mono text-2xs text-[oklch(var(--color-ink-subtle))]">trace {error.digest}</p>
      )}
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
    <div role="alert" data-query-error="" className="border-t border-[oklch(var(--color-line))] py-8">
      <div className="flex flex-wrap items-center gap-3">
        <p className={ERROR_TITLE}>
          <span aria-hidden="true">✕ </span>
          {t("error.title")}
        </p>
        {onRetry && (
          <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
            {t("error.retry")}
          </Button>
        )}
      </div>
      <p className="mt-1 text-xs text-[oklch(var(--color-ink-subtle))]">{detail || t("error.description")}</p>
    </div>
  );
}
