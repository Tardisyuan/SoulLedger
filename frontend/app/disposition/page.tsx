"use client";
import { useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTenant } from "@/src/contexts/TenantContext";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { dispositionApi, PAGE_SIZE, type Disposition } from "@soulledger/core/api";
import { ListSkeleton } from "@/components/ui/skeleton";
import { Pagination } from "@/src/components/ui/Pagination";
import { DomainText } from "@/src/components/ui/DomainValue";
import { PageShell } from "@/src/components/ui/PageShell";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { ConfirmDialog } from "@/src/components/ui/Modal";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { QueryError } from "@/src/components/ui/PageError";
import { RequirePermission } from "@/src/components/rbac/RequirePermission";
import { MenuGloss } from "@/src/components/layout/MenuGloss";

export default function DispositionPage() {
  const { t } = useI18n();
  const { user } = useTenant();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [showExecuteModal, setShowExecuteModal] = useState<string | null>(null);
  // Page in the key and on the wire. `list()` was called with no `page` and
  // nothing offered another one, so everything past the server's twentieth
  // disposition was invisible and unreachable, and nothing said so (FL-09).
  // `app/dispatch/page.tsx` is the sibling this copies; the execute mutation
  // below invalidates `["dispositions"]`, which prefix-matches every page.
  const [page, setPage] = useState(1);

  const { data: dispositionsResponse, isLoading, isError, refetch } = useQuery({
    queryKey: ["dispositions", page],
    queryFn: () => dispositionApi.list({ page: String(page) }).then(r => r.data),
    enabled: !!user,
    placeholderData: (previous) => previous,
  });

  // /disposition/ is a paginated ModelViewSet list, so `results` is always
  // present (an empty array included) and the old `|| dispositionsResponse`
  // fallback could never be reached.
  const dispositions = dispositionsResponse?.results ?? [];

  const executeMutation = useMutation({
    mutationFn: (id: string) => dispositionApi.execute(id),
    onSuccess: () => {
      showToast(t("disposition.executed_success"), "success");
      queryClient.invalidateQueries({ queryKey: ["dispositions"] });
      setShowExecuteModal(null);
    },
    onError: () => showToast(t("disposition.execute_error"), "error"),
  });

  return (
    <PageShell
      variant="page"
      title={
        <>
          {t("disposition.title")}
          <MenuGloss path="/disposition" />
        </>
      }
      subtitle={t("disposition.subtitle")}
      isLoading={isLoading}
      skeleton={<ListSkeleton count={5} />}
      // `isError ||`, not `dispositions.length === 0` alone. A failed request
      // yields `results ?? []`, which is empty, so "the server is down" and
      // "no dispositions have been filed" rendered the same words.
      isEmpty={isError || dispositions.length === 0}
      empty={
        isError ? (
          <QueryError onRetry={() => refetch()} />
        ) : (
          <EmptyState
            title={t("disposition.list")}
            reason={t("disposition.no_dispositions")}
          />
        )
      }
    >
      <div className="space-y-3">
        {dispositions.map((d: Disposition) => (
          <div key={d.id} className="bg-[oklch(var(--color-surface-1))] border border-[oklch(var(--color-hairline))] p-4">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-03 font-medium text-[oklch(var(--color-ink))]">
                  {t("disposition.soul")}:{" "}
                  {/* 静息态就带 `underline`,不是只在 `hover:` 上。这是本仓唯一一个
                      **段落内**链接(周围有文字、同一行),而 WCAG 1.4.1 对这种链接
                      的要求是:非颜色的可辨性,或者和周围文字 3:1。这里两端是
                      `--color-accent-ink` 压 `--color-ink`,亮色 3.049:1 过,
                      **暗色只有 1.954:1** —— 于是在暗色下它曾经只是「一段颜色略有
                      不同的字」。`proseLinkIsNotColourOnly.test.ts` 现在盯着这一对;
                      去掉这里的 `underline`,那条测试会打出上面那个 1.954:1。
                      站着的链接(卡片、面包屑、返回)不在那条规则的范围内,它们
                      周围没有文字可混淆,所以不必跟着改。 */}
                  <Link href={`/souls/${d.soul}`} className="underline text-[oklch(var(--color-accent-ink))]">
                    {d.soul_name || d.soul}
                  </Link>
                </p>
                <p className="text-03 text-[oklch(var(--color-ink-subtle))] mt-1">
                  {t("disposition.realm")}: <DomainText value={d.realm_name || d.destination_realm} />
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {d.is_executed ? (
                  <Badge tone="success">{t("disposition.executed")}</Badge>
                ) : d.is_eternal ? (
                  <Badge tone="info">{t("disposition.eternal")}</Badge>
                ) : (
                  <RequirePermission permissions="disposition.execute">
                    <Button
                      type="button"
                      variant="primary"
                      size="sm"
                      onClick={() => setShowExecuteModal(d.id)}
                    >
                      {t("disposition.execute")}
                    </Button>
                  </RequirePermission>
                )}
              </div>
            </div>
            {d.notes && (
              <p className="mt-2 text-03 text-[oklch(var(--color-ink-muted))]">{d.notes}</p>
            )}
          </div>
        ))}
      </div>
      <Pagination
        page={page}
        totalPages={Math.max(1, Math.ceil((dispositionsResponse?.count ?? 0) / PAGE_SIZE))}
        count={dispositionsResponse?.count ?? 0}
        onPageChange={setPage}
      />

      {/* The second hand-rolled `fixed inset-0` — same missing apparatus as
          `app/recycle-bin`: no `role="dialog"`, no `aria-modal`, no focus
          move, no Escape, no focus trap, no focus return. Executing a
          disposition is what sends a soul to its realm; it is not a dialog to
          leave dismissible by a stray Tab into the page behind it.

          Also note what the old markup did with `z-50` while the rest of the
          app is on the `z-dialog` token — a scrim that can be outranked is a
          scrim that is sometimes not there. */}
      <ConfirmDialog
        isOpen={showExecuteModal !== null}
        title={t("disposition.confirm_execute")}
        message={t("disposition.execute_warning")}
        confirmText={t("disposition.confirm_execute")}
        variant="danger"
        confirmLoading={executeMutation.isPending}
        onCancel={() => setShowExecuteModal(null)}
        onConfirm={() => showExecuteModal && executeMutation.mutate(showExecuteModal)}
      />
    </PageShell>
  );
}
