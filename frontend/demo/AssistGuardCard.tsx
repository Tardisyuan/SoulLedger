"use client";

import { useI18n } from "@/src/contexts/I18nContext";
import { AnswerTrace } from "@/src/components/assist/AnswerTrace";
import type { AssistTrace } from "@soulledger/core/api/officer-assist";
import security from "./data/assist-security.json";

type Lang = "zh-Hans" | "en";
interface Case {
  id: string;
  question: Record<Lang, string>;
  expect: Record<Lang, string>;
  answer?: Record<Lang, string>;
  trace?: Record<Lang, AssistTrace>;
}

/**
 * 「为什么越不了权」(作品集建议 B3): what keeps 问一问 inside the asker's own data, each line with the code that does it
 * and the test that holds it (a jest guard checks both still exist), then the injection cases. A case's answer is
 * what the real assistant said when scripts/demo-record-assist.py asked it, replayed with its trace; a case not yet
 * recorded says so and shows only what it is expected to do — never an answer made up here.
 */
export function AssistGuardCard() {
  const { t, locale } = useI18n();
  const lang: Lang = locale === "zh-Hans" ? "zh-Hans" : "en";
  const cases = security.cases as Case[];
  return (
    <div data-testid="demo-assist-guard" className="mt-3 max-h-[50vh] overflow-y-auto border-t border-[oklch(var(--color-line))] pt-3 text-xs">
      <p className="m-0 font-semibold text-[oklch(var(--color-ink))]">{t("demo.assist_guard.how_title")}</p>
      <ul className="mt-1 mb-0 grid gap-2 pl-0">
        {security.guards.map((g) => (
          <li key={g.id} className="list-none">
            <p className="m-0 text-[oklch(var(--color-ink-muted))]">{t(`demo.assist_guard.guard.${g.id}`)}</p>
            <p className="m-0 font-mono text-2xs break-all text-[oklch(var(--color-ink-subtle))]">
              {g.code} · {g.test.split("::")[1]}
            </p>
          </li>
        ))}
      </ul>
      <p className="mt-3 mb-0 font-semibold text-[oklch(var(--color-ink))]">{t("demo.assist_guard.cases_title")}</p>
      <ol className="mt-1 mb-0 grid gap-2 pl-4">
        {cases.map((c) => (
          <li key={c.id} data-testid="demo-assist-guard-case">
            <p className="m-0 font-serif text-[oklch(var(--color-ink))]">{c.question[lang]}</p>
            <p className="m-0 text-[oklch(var(--color-ink-muted))]">
              {t("demo.assist_guard.expect")} {c.expect[lang]}
            </p>
            {c.answer?.[lang] ? (
              <>
                <p className="mt-1 mb-0 whitespace-pre-wrap border-l border-[oklch(var(--color-block))] pl-2 text-[oklch(var(--color-ink))]" data-testid="demo-assist-guard-answer">
                  {c.answer[lang]}
                </p>
                <p className="m-0 text-2xs text-[oklch(var(--color-ink-subtle))]">{t("demo.assist_guard.recorded", { at: (security.recordedAt ?? "").slice(0, 10) })}</p>
                {c.trace?.[lang] ? <AnswerTrace trace={c.trace[lang]} /> : null}
              </>
            ) : (
              <p className="mt-1 mb-0 text-2xs text-[oklch(var(--color-ink-subtle))]" data-testid="demo-assist-guard-unrecorded">
                {t("demo.assist_guard.not_recorded")}
              </p>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
