"use client";

/**
 * 四十二条否定告白(埃及称心,2026-10-28;docs/02_奥西里斯审判详解.md §2.2、§四)。
 *
 * 亡者向 42 位判官逐一否认一项罪;官员逐条记「如实 / 不实 / 未记」与一句备注。只在称心的案子上画
 * (`applies`),结案后只读 —— 服务端同样拒绝(409 `concluded`)。不改天平:天平读的是采信的功过。
 *
 * 版式是临时的:Design 还没画这一块(见交接)。
 */
import { useState } from "react";
import { CONFESSION_ERROR_CODES, type NegativeConfessionRow } from "@soulledger/core/api/judgment";
import { useNegativeConfessions, useRecordNegativeConfession } from "@soulledger/core/hooks/useJudgments";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { JudgmentSectionHead } from "@/src/components/judgment/JudgmentGroundsPanel";

type Choice = "true" | "false" | "null";
const CHOICES: readonly Choice[] = ["true", "false", "null"];
const LABEL: Record<Choice, string> = {
  true: "judgment.confessions.truthful",
  false: "judgment.confessions.untruthful",
  null: "judgment.confessions.unheard",
};

function choiceOf(row: NegativeConfessionRow): Choice {
  return row.truthful === true ? "true" : row.truthful === false ? "false" : "null";
}

export function NegativeConfessionPanel({ judgmentId, canRecord }: { judgmentId: string; canRecord: boolean }) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const { data } = useNegativeConfessions(judgmentId);
  const record = useRecordNegativeConfession(judgmentId);
  const [notes, setNotes] = useState<Record<number, string>>({});

  if (!data?.applies) return null;
  const editable = canRecord && !data.concluded;

  const send = (row: NegativeConfessionRow, truthful: boolean | null, note: string) =>
    record.mutate(
      { ordinal: row.ordinal, data: { truthful, note } },
      {
        onError: (error) => {
          const code = (error as { response?: { data?: { code?: string } } })?.response?.data?.code;
          const known = code && (CONFESSION_ERROR_CODES as readonly string[]).includes(code);
          showToast(t(`judgment.confessions.errors.${known ? code : "generic"}`), "error");
        },
      },
    );

  const tally = data.tally;
  return (
    <section className="mt-6 min-w-0" data-testid="negative-confessions">
      <JudgmentSectionHead
        title={t("judgment.confessions.title")}
        meta={tally ? t("judgment.confessions.tally", {
          truthful: String(tally.truthful), untruthful: String(tally.untruthful), unheard: String(tally.unheard),
        }) : undefined}
      />
      <p className="mt-1 text-xs text-[oklch(var(--color-ink-subtle))]">{t("judgment.confessions.hint")}</p>
      {data.items.length === 0 ? (
        <p className="py-3 text-sm text-[oklch(var(--color-ink-subtle))]">{t("judgment.confessions.empty")}</p>
      ) : (
        <ol className="mt-2">
          {data.items.map((row) => {
            const current = choiceOf(row);
            const note = notes[row.ordinal] ?? row.note;
            return (
              <li
                key={row.statute_id}
                data-testid="confession-row"
                data-truthful={current}
                className="grid grid-cols-[32px_minmax(0,1fr)] gap-x-3 gap-y-1 py-2 border-b border-[oklch(var(--color-rule))]"
              >
                <span className="font-mono tabular-nums text-xs text-[oklch(var(--color-ink-subtle))]">{row.ordinal}</span>
                <div className="min-w-0">
                  <p className="text-xs text-[oklch(var(--color-ink-subtle))]">{row.assessor}</p>
                  <p className="font-serif text-sm text-[oklch(var(--color-ink))]">{row.text}</p>
                  <div
                    role="radiogroup"
                    aria-label={t("judgment.confessions.row_label", { n: String(row.ordinal), assessor: row.assessor })}
                    className="mt-1 flex flex-wrap gap-1"
                  >
                    {CHOICES.map((choice) => (
                      <button
                        key={choice}
                        type="button"
                        role="radio"
                        aria-checked={current === choice}
                        disabled={!editable || record.isPending}
                        onClick={() => send(row, choice === "null" ? null : choice === "true", note)}
                        className={`min-h-(--control-h-sm) px-2 text-xs border border-[oklch(var(--color-line))] ${
                          current === choice
                            ? "bg-[oklch(var(--color-ink))] text-[oklch(var(--color-surface-1))]"
                            : "text-[oklch(var(--color-ink))]"
                        } disabled:cursor-default`}
                      >
                        {t(LABEL[choice])}
                      </button>
                    ))}
                  </div>
                  {editable ? (
                    <input
                      type="text"
                      aria-label={t("judgment.confessions.note")}
                      placeholder={t("judgment.confessions.note_placeholder")}
                      value={note}
                      maxLength={2000}
                      onChange={(e) => setNotes((prev) => ({ ...prev, [row.ordinal]: e.target.value }))}
                      onBlur={() => {
                        if (note.trim() !== row.note) send(row, row.truthful ?? null, note);
                      }}
                      className="mt-1 w-full min-h-(--control-h-sm) border-b border-[oklch(var(--color-line))] bg-transparent text-xs text-[oklch(var(--color-ink))]"
                    />
                  ) : row.note ? (
                    <p className="mt-1 text-xs text-[oklch(var(--color-ink-muted))]">{row.note}</p>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
