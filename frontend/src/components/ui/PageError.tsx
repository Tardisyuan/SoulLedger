"use client";

import { useI18n } from "@/src/contexts/I18nContext";
import { Button } from "@/src/components/ui/Button";

/**
 * `QueryError`(列表查询失败)仍是规范 v2 补足 C15 的那一段:冷玫红「✕ 标题」13 / 600、
 * 旁边一颗次按钮「重试」;说明 12 ink3。冷玫红只给系统出错(判决的 ✕ 是 ink)。
 * `PageError` 在 2026-10-01 换成了规范 v3 的错误页,见它自己的注释。
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

  // 规范 v3 的错误页(2026-10-01):内容区里一块 s1 底、至少 200px 高、居中的卡片 ——
  // 仍然不换整页(壳与侧栏都在)。从上到下:代码「500」等宽 28 / 500,**冷玫红只给它**
  // (403 / 404 是 ink);标题;一句说明;Next 给的 digest(等宽 trace);一颗次按钮。
  // 标题是 `<h1>`:路由的 error 边界替换掉的正是带 `<h1>` 的那一页,于是它就是这一屏的
  // 页面标题,按 DESIGN.md「Headings」走 `text-lg`、界面字体 —— 原型写的 15px 衬线
  // 不用:衬线只给「人说的话」,而 `PageShell.test` 把壳外每个字面 `<h1>` 钉在 text-lg。
  // 原型的栏距 10px 不在间距节奏里,取 8(gap-2)。
  return (
    <div
      role="alert"
      data-page-error=""
      className="flex min-h-[200px] flex-col items-center justify-center gap-2 bg-[oklch(var(--color-surface-1))] px-4 py-8 text-center"
    >
      <span data-page-error-code="" className="font-mono text-xl font-medium text-[oklch(var(--color-danger))]">
        500
      </span>
      <h1 className="text-lg text-[oklch(var(--color-ink))]">{t("error.title")}</h1>
      <p className="text-xs text-[oklch(var(--color-ink-subtle))]">{error.message || t("error.description")}</p>
      {error.digest && (
        <p className="font-mono text-2xs text-[oklch(var(--color-ink-subtle))]">trace {error.digest}</p>
      )}
      <Button type="button" variant="secondary" size="sm" onClick={reset}>
        {t("error.retry")}
      </Button>
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
