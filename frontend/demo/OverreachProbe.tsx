"use client";

import { useState } from "react";
import { useI18n } from "@/src/contexts/I18nContext";
import { type Answer, DEMO_USERNAMES, langOf, read, recording } from "./store";

/** The request a judge's console never makes: the permissions page is hidden from them, so this is the bypass. */
const PATH = "/perm/permissions/";

/**
 * 「试一下越权」(作品集建议 A4). The answer is the judge's recording, not a rule of the demo's: the recorder signed in as
 * demo_judge and asked this endpoint (scripts/demo-record.mjs), and the server said 403. Replayed as it was; a recording
 * that no longer holds a refusal says so instead of showing one.
 */
export function OverreachProbe() {
  const { t, locale } = useI18n();
  const [answer, setAnswer] = useState<Answer | null>(null);
  const ask = () => void recording("judge", langOf(locale)).then((rec) => setAnswer(read(rec, PATH, new URLSearchParams())));
  const refused = !!answer && answer.status >= 400;
  return (
    <div data-testid="demo-overreach" className="mt-3 border-t border-[oklch(var(--color-line))] pt-3">
      {!answer ? (
        <button
          type="button"
          data-testid="demo-overreach-try"
          onClick={ask}
          className="min-h-9 w-full border border-[oklch(var(--color-ink))] px-3 text-left text-sm text-[oklch(var(--color-ink))]"
        >
          {t("demo.probe.try")}
          <span className="block font-mono text-2xs text-[oklch(var(--color-ink-muted))]">
            GET /api/v1{PATH} · {DEMO_USERNAMES.judge}
          </span>
        </button>
      ) : refused ? (
        <div data-testid="demo-overreach-answer" role="status">
          <p className="m-0 flex items-baseline gap-2 text-sm text-[oklch(var(--color-ink))]">
            <span data-testid="demo-overreach-status" className="border border-[oklch(var(--color-danger))] px-1 font-mono text-xs text-[oklch(var(--color-danger))]">
              {answer.status}
            </span>
            <span className="font-mono text-2xs text-[oklch(var(--color-ink-muted))]">GET /api/v1{PATH}</span>
          </p>
          <pre className="mt-2 mb-0 overflow-x-auto bg-[oklch(var(--color-surface-2))] p-2 font-mono text-2xs whitespace-pre-wrap text-[oklch(var(--color-ink))]">
            {JSON.stringify(answer.data, null, 2)}
          </pre>
          <p className="mt-1 mb-0 text-2xs text-[oklch(var(--color-ink-subtle))]">{t("demo.probe.recorded", { user: DEMO_USERNAMES.judge })}</p>
          <p className="mt-3 mb-0 text-xs font-semibold text-[oklch(var(--color-ink))]">{t("demo.probe.why_title")}</p>
          <p className="mt-1 mb-0 text-xs text-[oklch(var(--color-ink-muted))]">{t("demo.probe.why_front")}</p>
          <p className="mt-1 mb-0 text-xs text-[oklch(var(--color-ink-muted))]">{t("demo.probe.why_back")}</p>
          <dl className="mt-2 mb-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1 text-2xs">
            <dt className="text-[oklch(var(--color-ink-subtle))]">{t("demo.probe.code")}</dt>
            <dd className="m-0 font-mono break-all text-[oklch(var(--color-ink))]">backend/apps/perm/views.py · CanReadPermissionCatalogue</dd>
            <dt className="text-[oklch(var(--color-ink-subtle))]">{t("demo.probe.test")}</dt>
            <dd className="m-0 font-mono break-all text-[oklch(var(--color-ink))]">backend/tests/test_perm_prefix_discloses_only_the_catalogue.py</dd>
          </dl>
        </div>
      ) : (
        <p data-testid="demo-overreach-answer" role="status" className="m-0 text-xs text-[oklch(var(--color-ink-muted))]">
          {t("demo.probe.not_recorded", { status: String(answer.status) })}
        </p>
      )}
    </div>
  );
}
