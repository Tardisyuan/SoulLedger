"use client";

import { useState, type MouseEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { judgmentApi } from "@soulledger/core/api";
import { judgmentKeys } from "@soulledger/core/query_keys";
import { useI18n } from "@/src/contexts/I18nContext";
import { useTenant } from "@/src/contexts/TenantContext";
import { Button } from "@/src/components/ui/Button";
import { DomainText } from "@/src/components/ui/DomainValue";
import { forgetOpenCase, lastOpenCase } from "@/src/lib/lastOpenCase";

const deskHref = (judgmentId: string, statuteId: string) =>
  `/judgment/${judgmentId}?cite=${encodeURIComponent(statuteId)}`;

/**
 * 语料页右栏「插入审判台」。
 *
 * 有记着的未结案(这个用户在审判台最后打开的那件,`src/lib/lastOpenCase.ts`)就直达它,
 * 带 `?cite=`;审判台先问「引用〔…〕到 <魂> 的审判？」再引用(`CiteFromCorpus`)。
 * 没有记着的,就列出他认领着的未结案(`?group=mine`,隐含未结)供挑一件;一件都没有,
 * 就直说「你手上没有未结的案件」。只给持 `judgment.execute` 的人 —— 引用是对案子的动作。
 *
 * 记着的那件可能已经在别处结了(另一个标签页、另一位官员)。所以点下去先问一次它的现状:
 * 已结就忘掉它、改开上面那张清单,而不是把人送到审判台去读「这件案子已结案」。
 */
export function CorpusInsertIntoDesk({ statuteId }: { statuteId: string }) {
  const { t } = useI18n();
  const { user } = useTenant();
  // Read in render: the rail only renders once the corpus has loaded client-side, and
  // `lastOpenCase` answers null (not a throw) where there is no localStorage.
  const remembered = user ? lastOpenCase(user.id) : null;
  const router = useRouter();
  const [picking, setPicking] = useState(false);
  const mine = useQuery({
    queryKey: [...judgmentKeys.all, "mine-open", user?.id],
    queryFn: () => judgmentApi.list({ group: "mine", ordering: "-created_at" }).then((r) => r.data.results),
    enabled: picking,
  });

  const goRemembered = async (e: MouseEvent<HTMLAnchorElement>) => {
    // A modified click (new tab) goes as a plain link; the desk still says it is closed.
    if (!remembered || !user || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    const href = deskHref(remembered.id, statuteId);
    const fresh = await judgmentApi.get(remembered.id).then((r) => r.data, () => null);
    if (fresh?.is_final) {
      forgetOpenCase(user.id, remembered.id);
      setPicking(true); // re-renders without the remembered case: the picker, open
    } else {
      router.push(href);
    }
  };

  if (remembered) {
    return (
      <Link
        href={deskHref(remembered.id, statuteId)}
        onClick={goRemembered}
        data-testid="corpus-insert"
        className="inline-flex items-center h-8 px-3 border border-[oklch(var(--color-line))] text-sm hover:bg-[oklch(var(--color-surface-2))]"
        title={remembered.soul_name || undefined}
      >
        {t("judgment.corpus.insert_desk")}
        {remembered.soul_name && <span className="ml-2 text-xs text-[oklch(var(--color-ink-muted))]">· {remembered.soul_name}</span>}
      </Link>
    );
  }
  return (
    <div>
      <Button type="button" variant="secondary" size="sm" data-testid="corpus-insert" aria-expanded={picking} onClick={() => setPicking((v) => !v)}>
        {t("judgment.corpus.insert_desk")}
      </Button>
      {picking && (
        <div data-testid="corpus-insert-picker" className="pt-2">
          {mine.isError ? (
            <p className="text-xs text-[oklch(var(--color-ink-subtle))]">{t("common.error")}</p>
          ) : mine.isLoading || !mine.data ? (
            <p className="text-xs text-[oklch(var(--color-ink-subtle))]">{t("common.loading")}</p>
          ) : mine.data.length === 0 ? (
            <p className="text-xs text-[oklch(var(--color-ink-subtle))]">{t("judgment.corpus.insert_none")}</p>
          ) : (
            <>
              <p className="text-2xs text-[oklch(var(--color-ink-subtle))]">{t("judgment.corpus.insert_pick")}</p>
              <ul>
                {mine.data.map((j) => (
                  <li key={j.id} className="py-1 border-b border-[oklch(var(--color-rule))]">
                    <Link href={deskHref(j.id, statuteId)} className="text-sm hover:underline">
                      <DomainText value={j.soul_name} />
                    </Link>
                    <span className="ml-2 font-mono text-2xs text-[oklch(var(--color-ink-subtle))]">{j.court}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
