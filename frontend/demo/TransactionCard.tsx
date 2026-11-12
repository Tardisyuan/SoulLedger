"use client";

import { useState } from "react";
import { isAxiosError } from "axios";
import { api } from "@soulledger/core/api/client";
import { BaseModal } from "@/src/components/ui/Modal";
import { useI18n } from "@/src/contexts/I18nContext";

type Case = { id: string; case_number?: string; verdict?: string | null; is_final?: boolean };
type Result = { status: number; data: unknown };

/** A judgment's own page: what the banner's 「并发与事务」 is offered on. */
export const CASE_PAGE = /^\/judgment\/[0-9a-f-]{36}$/;

/** This page's case if it is concluded, else the first concluded one: the second conclusion needs a first. */
async function concludedCase(id: string): Promise<Case | null> {
  const here = (await api.get<Case>(`/judgment/${id}/`)).data;
  if (here?.is_final) return here;
  const list = (await api.get<{ results?: Case[] }>("/judgment/", { params: { has_verdict: "true", page_size: 1 } })).data;
  return list.results?.[0] ?? null;
}

/**
 * 「并发与事务」(作品集建议 A5): two judges concluding one case, and why the second gets 409 and nothing is half-written.
 * The 「试一下」 sends the second judge's request for real, through the same client the bench uses; the demo answers it by
 * the server's rule (`ALREADY_CONCLUDED` in flows.ts), and the card says that is where the answer comes from.
 */
export function TransactionCard({ caseId }: { caseId: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<Case | null | undefined>(undefined);
  const [result, setResult] = useState<Result | null>(null);
  const show = () => {
    setOpen(true);
    setResult(null);
    void concludedCase(caseId).then(setTarget, () => setTarget(null));
  };
  const second = async (judgment: Case) => {
    try {
      const res = await api.post(`/judgment/${judgment.id}/conclude/`, { verdict: judgment.verdict, notes: "" });
      setResult({ status: res.status, data: res.data });
    } catch (e) {
      setResult(isAxiosError(e) && e.response ? { status: e.response.status, data: e.response.data } : { status: 0, data: String(e) });
    }
  };
  const label = "text-2xs text-[oklch(var(--color-ink-subtle))]";
  const mono = "m-0 font-mono break-all text-[oklch(var(--color-ink))]";
  return (
    <>
      <button type="button" data-testid="demo-txn-open" onClick={show} className="shrink-0 text-[oklch(var(--color-ink))] underline underline-offset-2">
        {t("demo.txn.open")}
      </button>
      <BaseModal isOpen={open} onClose={() => setOpen(false)} title={t("demo.txn.title")} wide>
        <div data-testid="demo-txn" className="flex flex-col gap-4 text-sm text-[oklch(var(--color-ink))]">
          <p className="m-0 text-[oklch(var(--color-ink-muted))]">{t("demo.txn.lede")}</p>
          <ol className="m-0 flex list-none flex-col gap-2 p-0">
            {([1, 2, 3, 4] as const).map((n) => (
              <li key={n} className="flex gap-3">
                <span aria-hidden="true" className="w-6 shrink-0 font-mono text-xs text-[oklch(var(--color-ink-subtle))]">{n}</span>
                <span className="min-w-0">{t(`demo.txn.step${n}`)}</span>
              </li>
            ))}
          </ol>
          <section aria-labelledby="demo-txn-rollback" className="border-l-2 border-[oklch(var(--color-line-strong))] pl-3">
            <h3 id="demo-txn-rollback" className="m-0 text-sm font-semibold">{t("demo.txn.rollback_title")}</h3>
            <p className="m-0 mt-1 text-[oklch(var(--color-ink-muted))]">{t("demo.txn.rollback_body")}</p>
          </section>
          <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-2xs">
            <dt className={label}>{t("demo.probe.code")}</dt>
            <dd className={mono}>backend/apps/judgment/services.py · conclude_judgment</dd>
            <dt className={label}>{t("demo.probe.test")}</dt>
            <dd className={mono}>backend/tests/test_concurrency.py · TestConcludeRechecksUnderTheLock</dd>
            <dt className={label} />
            <dd className={mono}>backend/tests/test_event_log_inside_transactions.py</dd>
          </dl>
          <section aria-labelledby="demo-txn-try" className="border-t border-[oklch(var(--color-line))] pt-3">
            <h3 id="demo-txn-try" className="m-0 text-sm font-semibold">{t("demo.txn.try_title")}</h3>
            {target === undefined ? null : target === null ? (
              <p className="m-0 mt-1 text-[oklch(var(--color-ink-muted))]">{t("demo.txn.no_case")}</p>
            ) : (
              <>
                <p className="m-0 mt-1 text-[oklch(var(--color-ink-muted))]">{t("demo.txn.try_body", { case: target.case_number ?? target.id })}</p>
                <button
                  type="button"
                  data-testid="demo-txn-try"
                  onClick={() => void second(target)}
                  className="mt-2 min-h-9 border border-[oklch(var(--color-ink))] px-3 text-sm text-[oklch(var(--color-ink))]"
                >
                  {t("demo.txn.try")}
                </button>
              </>
            )}
            {result ? (
              <div data-testid="demo-txn-result" role="status" className="mt-3">
                <p className="m-0 flex items-baseline gap-2">
                  <span data-testid="demo-txn-status" className="border border-[oklch(var(--color-danger))] px-1 font-mono text-xs text-[oklch(var(--color-danger))]">
                    {result.status}
                  </span>
                  <span className="font-mono text-2xs text-[oklch(var(--color-ink-muted))]">POST /api/v1/judgment/…/conclude/</span>
                </p>
                <pre className="mt-2 mb-0 overflow-x-auto bg-[oklch(var(--color-surface-2))] p-2 font-mono text-2xs whitespace-pre-wrap">{JSON.stringify(result.data, null, 2)}</pre>
                <p className="m-0 mt-2 text-xs text-[oklch(var(--color-ink-muted))]">{t("demo.txn.result_note")}</p>
              </div>
            ) : null}
          </section>
        </div>
      </BaseModal>
    </>
  );
}
