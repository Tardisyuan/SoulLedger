"use client";

import { useEffect, type ReactNode } from "react";
import { useI18n } from "@/src/contexts/I18nContext";
import { Button } from "@/src/components/ui/Button";
import { requestIdOf } from "@soulledger/core/api/requestStamp";
import { responseStatus } from "@soulledger/core/api/client";
import { PermissionDenied } from "@/src/components/rbac/PermissionDenied";

/**
 * `QueryError`(列表查询失败)仍是规范 v2 补足 C15 的那一段:冷玫红「✕ 标题」13 / 600、
 * 旁边一颗次按钮「重试」;说明 12 ink3。冷玫红只给系统出错(判决的 ✕ 是 ink)。
 * `PageError` 在 2026-10-01 换成了规范 v3 的错误页 —— 与 403 / 404 共用下面的 `StatusCard`。
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
  // `error.message` is for whoever debugs it, not for the reader: an axios or runtime message is English and
  // says nothing they can act on. It goes to the console, and to Sentry when the build has a DSN.
  useEffect(() => {
    console.error(error);
    if (process.env.NEXT_PUBLIC_SENTRY_DSN) void import("@sentry/nextjs").then((sentry) => sentry.captureException(error));
  }, [error]);
  return (
    <StatusCard
      code="500"
      title={t("error.title")}
      message={t("error.description")}
      // A failed API call carries the server's X-Request-ID: its first 8 characters find the request in the logs.
      detail={error.digest ? <>trace {error.digest}</> : requestIdOf(error) && <>request {requestIdOf(error)}</>}
      action={
        <Button type="button" variant="secondary" size="sm" onClick={reset}>
          {t("error.retry")}
        </Button>
      }
    />
  );
}

interface StatusCardProps {
  code: "403" | "404" | "500";
  title: ReactNode;
  message: ReactNode;
  /** 等宽的一行:500 的 trace digest、404 没找到的路径、403 缺的权限码。 */
  detail?: ReactNode;
  detailTestId?: string;
  /** 一颗次按钮(`size="sm"`)。 */
  action: ReactNode;
  testId?: string;
}

/**
 * 状态页(403 / 404 / 500 是同一块,用户 2026-10-01 拍板;第三十批「卷宗」第 1 步第 5 条重画):
 * 内容区里至少 200px 高、居中的一块,直接在 canvas 上 —— 不换整页(壳与侧栏都在)。
 * 从上到下:**等宽小码**(12 / 500,字距 `tracking-meta`,faint);**宋体一句**(标题);**说明**(13);等宽的细节行;
 * **一个出口**。v3 的 28px 大号代码与 s1 底卡随这一批撤掉。
 *
 * **冷玫红只给 500 的代码** —— 冷玫红只表系统出错,而 403 / 404 不是系统出错,它们的代码是 ink。
 * 标题是 `<h1>`:500 的 error 边界、404 的 not-found、403 的 `RequirePermission` fallback
 * 替换掉的都是带 `<h1>` 的那一页,于是它就是这一屏的页面标题,按 DESIGN.md「Headings」走
 * `text-lg`、界面字体 —— 原型写的 15px 衬线不用:衬线只给「人说的话」,而 `PageShell.test`
 * 把壳外每个字面 `<h1>` 钉在 text-lg。原型的栏距 10px 不在间距节奏里,取 8(gap-2)。
 * 500 是 `role="alert"`(出错了);403 / 404 是 `role="status"`(一个事实,不是故障)。
 */
export function StatusCard({ code, title, message, detail, detailTestId, action, testId }: StatusCardProps) {
  const isFault = code === "500";
  return (
    <div
      role={isFault ? "alert" : "status"}
      data-page-error=""
      data-testid={testId}
      className="flex min-h-[200px] flex-col items-center justify-center gap-3 px-4 py-12 text-center"
    >
      <span
        data-page-error-code=""
        className={`font-mono text-xs font-medium tracking-meta ${
          isFault ? "text-[oklch(var(--color-danger))]" : "text-[oklch(var(--color-faint-text))]"
        }`}
      >
        {code}
      </span>
      <h1 className="font-title text-lg text-[oklch(var(--color-ink))]">{title}</h1>
      <p className="max-w-prose text-sm text-[oklch(var(--color-ink-subtle))]">{message}</p>
      {detail && (
        <p data-testid={detailTestId} className="font-mono text-2xs text-[oklch(var(--color-ink-subtle))]">
          {detail}
        </p>
      )}
      <div className="mt-3">{action}</div>
    </div>
  );
}

/**
 * 一屏多个查询时交给 `QueryError` 的那一个:第一个出错的查询的 error。
 * 查询的顺序就是页面上读的顺序;都没出错时是 `null`。
 */
export function firstError(...queries: ReadonlyArray<{ error: unknown } | undefined>): unknown {
  return queries.find((q) => q?.error)?.error ?? null;
}

interface QueryErrorProps {
  /** Re-run the query. Omit only if there is genuinely nothing to retry. */
  onRetry?: () => void;
  /** Optional detail, e.g. a status code. The message itself is generic. */
  detail?: string;
  /** The query's error. A 403 renders the permission card: 无权不是系统出错,重试也不会变。 */
  error?: unknown;
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
export function QueryError({ onRetry, detail, error }: QueryErrorProps) {
  const { t } = useI18n();
  if (responseStatus(error) === 403) return <PermissionDenied />;

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
