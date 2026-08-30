"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { dispatchApi, type DispatchRecord } from "@/lib/api";
import { useTenant } from "@/src/contexts/TenantContext";
import { useI18n } from "@/src/contexts/I18nContext";
import { ListSkeleton } from "@/components/ui/skeleton";
import { PageSection } from "@/components/ui/page-section";
import { MenuGloss } from "@/src/components/layout/MenuGloss";
import { DomainEnum, MissingValue } from "@/src/components/ui/DomainValue";
import { PageShell } from "@/src/components/ui/PageShell";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { buttonVariants } from "@/src/components/ui/Button";
import { badgeVariants, type BadgeTone } from "@/src/components/ui/Badge";

/**
 * Dispatch state → badge tone, for the two lists on this page.
 *
 * The detail route keeps a `--color-status-*` map instead, because that one is
 * registered by name in `src/__tests__/statusTokenLayering.test.ts` and moving
 * it would delete a record rather than settle it. This map is new, so it takes
 * the route the tone table exists for. The two render the same colours: a tone
 * is the same token at the same 10% fill, plus the border the detail page's
 * pairs never named.
 */
const STATUS_TONES: Record<string, BadgeTone> = {
  PROPOSED: "warning",
  APPROVED: "success",
  REJECTED: "error",
  EXECUTED: "info",
  CANCELLED: "neutral",
};

export default function DispatchPage() {
  const { t } = useI18n();
  const { user } = useTenant();

  const { data: proposed = [], isLoading: loadingProposed } = useQuery({
    queryKey: ["dispatch", "proposed"],
    queryFn: () => dispatchApi.proposed().then(r => r.data.results),
    enabled: !!user,
  });

  const { data: history = [], isLoading: loadingHistory } = useQuery({
    queryKey: ["dispatch", "history"],
    queryFn: () => dispatchApi.history().then(r => r.data.results),
    enabled: !!user,
  });

  return (
    <PageShell
      variant="full"
      title={
        <>
          {t("dispatch.title")}
          <MenuGloss path="/dispatch" />
        </>
      }
      subtitle={t("dispatch.subtitle")}
      actions={
        /* `buttonVariants` and not `<Button>`: this navigates, so it has to be
           an anchor. The skin is shared; the element is not. */
        <Link href="/dispatch/propose" className={buttonVariants({ variant: "primary" })}>
          {t("dispatch.propose")}
        </Link>
      }
    >
      {/* Pending Proposals - skeleton while loading */}
      <PageSection title={t("dispatch.pending")} isLoading={loadingProposed} className="mb-6">
        {loadingProposed ? (
          <ListSkeleton count={3} />
        ) : proposed.length === 0 ? (
          <EmptyState title={t("dispatch.no_pending")} />
        ) : (
          <div className="space-y-3">
            {proposed.map((d: DispatchRecord) => (
              <DispatchCard key={d.id} dispatch={d} />
            ))}
          </div>
        )}
      </PageSection>

      {/* History - skeleton while loading */}
      <PageSection title={t("dispatch.history")} isLoading={loadingHistory}>
        {loadingHistory ? (
          <ListSkeleton count={5} />
        ) : history.length === 0 ? (
          <EmptyState title={t("dispatch.no_history")} />
        ) : (
          <div className="space-y-3">
            {history.map((d: DispatchRecord) => (
              <DispatchCard key={d.id} dispatch={d} />
            ))}
          </div>
        )}
      </PageSection>
    </PageShell>
  );
}

function DispatchCard({ dispatch }: { dispatch: DispatchRecord }) {
  const { t } = useI18n();

  return (
    <Link href={`/dispatch/${dispatch.id}`} className="block">
      <div className="bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] p-4 hover:border-[hsl(var(--color-accent))] transition-colors cursor-pointer">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-04 font-medium text-[hsl(var(--color-ink))]">{t("dispatch.soul_prefix")}
              {/* `soul_name` is in the same response and was going unread;
                  the card printed the primary key instead. */}
              {dispatch.soul_name || <MissingValue kind="unrecorded" />}</p>
            <p className="text-03 text-[hsl(var(--color-ink-subtle))]">
              {dispatch.source_tenant_code} → {dispatch.target_tenant_code}
            </p>
          </div>
          {/* <DomainEnum> renders exactly one span, so passing the badge
              classes to it makes the badge itself the enum — no wrapper, and
              the raw member reaches `title` for free (BRIEF §4.6). */}
          <DomainEnum
            namespace="dispatch.states"
            value={dispatch.status}
            className={badgeVariants({ tone: STATUS_TONES[dispatch.status] ?? "neutral" })}
          />
        </div>
        {dispatch.reason && (
          <p className="mt-2 text-03 text-[hsl(var(--color-ink-muted))]">{dispatch.reason}</p>
        )}
      </div>
    </Link>
  );
}
