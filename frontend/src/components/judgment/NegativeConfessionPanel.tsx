"use client";

/**
 * 四十二条否定告白(埃及称心,2026-10-28;docs/02_奥西里斯审判详解.md §2.2、§四)。
 *
 * 亡者向 42 位判官逐一否认一项罪;官员逐条记「如实 / 不实 / 未记」与一句备注。只在称心的案子上画
 * (`applies`),结案后只读 —— 服务端同样拒绝(409 `concluded`)。不改天平:天平读的是采信的功过。
 *
 * 版式按 Design 第五十七批 X-1 / X-2:
 *  - 两栏按条序(§ 1–21 / § 22–42),不按陪审神分组 —— 一神一条,分组就是 42 组。768 以下一栏。
 *  - 每行:条号、告白原文(serif,人说的话)、陪审神小字、三段分段(默认未记)。窄屏分段满宽、每段 44px。
 *  - 备注只在选了「不实」时展开。结案后分段换成纯文字。
 *  - 标题行吸顶:三个合计数 +「只看未记」。种子没跑时整块一句「告白条目还没有导入」。
 */
import { useState } from "react";
import { CONFESSION_ERROR_CODES, type NegativeConfessionRow } from "@soulledger/core/api/judgment";
import { useNegativeConfessions, useRecordNegativeConfession } from "@soulledger/core/hooks/useJudgments";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { JudgmentSectionHead } from "@/src/components/judgment/JudgmentGroundsPanel";
import { FilterChipToggle } from "@/src/components/ui/FilterChip";
import { Segmented } from "@/src/components/ui/Segmented";

type Choice = "true" | "false" | "null";
const CHOICES: readonly Choice[] = ["true", "false", "null"];
const LABEL: Record<Choice, string> = {
  true: "judgment.confessions.truthful",
  false: "judgment.confessions.untruthful",
  null: "judgment.confessions.unheard",
};
/** 左栏到这一条为止(§ 1–21),其后是右栏。 */
const LEFT_LAST = 21;

function choiceOf(row: NegativeConfessionRow): Choice {
  return row.truthful === true ? "true" : row.truthful === false ? "false" : "null";
}

export function NegativeConfessionPanel({ judgmentId, canRecord }: { judgmentId: string; canRecord: boolean }) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const { data } = useNegativeConfessions(judgmentId);
  const record = useRecordNegativeConfession(judgmentId);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [onlyUnrecorded, setOnlyUnrecorded] = useState(false);

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
  const shown = data.items.filter((row) => !onlyUnrecorded || choiceOf(row) === "null");
  const columns = [shown.filter((row) => row.ordinal <= LEFT_LAST), shown.filter((row) => row.ordinal > LEFT_LAST)];

  const renderRow = (row: NegativeConfessionRow) => {
    const current = choiceOf(row);
    const note = notes[row.ordinal] ?? row.note;
    return (
      <li
        key={row.statute_id}
        data-testid="confession-row"
        data-truthful={current}
        className="grid grid-cols-[40px_minmax(0,1fr)] gap-x-3 gap-y-1 py-2 border-b border-[oklch(var(--color-rule))]"
      >
        <span className="font-mono tabular-nums text-xs text-[oklch(var(--color-ink-subtle))]">§ {row.ordinal}</span>
        <div className="min-w-0">
          <p className="font-serif text-sm text-[oklch(var(--color-ink))]">{row.text}</p>
          <p className="text-2xs text-[oklch(var(--color-ink-subtle))]">{row.assessor}</p>
          {editable ? (
            <Segmented
              label={t("judgment.confessions.row_label", { n: String(row.ordinal), assessor: row.assessor })}
              value={current}
              options={CHOICES.map((choice) => ({ value: choice, label: t(LABEL[choice]) }))}
              onChange={(choice) => send(row, choice === "null" ? null : choice === "true", note)}
              disabled={record.isPending && record.variables?.ordinal === row.ordinal} // 只冻正在存的那一行
              fill="narrow"
              tall="narrow"
              className="mt-1"
            />
          ) : (
            <p className="mt-1 text-xs text-[oklch(var(--color-ink))]" data-testid="confession-result">{t(LABEL[current])}</p>
          )}
          {/* 备注只在「不实」时展开;结案后有备注照样读得到。 */}
          {editable && current === "false" ? (
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
          ) : !editable && row.note ? (
            <p className="mt-1 text-xs text-[oklch(var(--color-ink-muted))]">{row.note}</p>
          ) : null}
        </div>
      </li>
    );
  };

  return (
    <section className="mt-6 min-w-0" data-testid="negative-confessions">
      <div className="sticky top-0 z-10 bg-[oklch(var(--color-canvas))]" data-testid="confession-head">
        <JudgmentSectionHead
          title={t("judgment.confessions.title")}
          meta={
            <span className="inline-flex items-center gap-3">
              {tally && (
                <span data-testid="confession-tally">
                  {/* 窄屏只给眼睛看短的三个数;整句在窄屏 sr-only,读屏任何宽度都念得到。 */}
                  <span className="max-md:sr-only">
                    {t("judgment.confessions.tally", {
                      truthful: String(tally.truthful), untruthful: String(tally.untruthful), unheard: String(tally.unheard),
                    })}
                  </span>
                  <span className="md:hidden font-mono tabular-nums" aria-hidden="true">
                    {`${tally.truthful} · ${tally.untruthful} · ${tally.unheard}`}
                  </span>
                </span>
              )}
              {data.items.length > 0 && (
                <FilterChipToggle pressed={onlyUnrecorded} onPressedChange={setOnlyUnrecorded}>
                  {t("judgment.confessions.only_unrecorded")}
                </FilterChipToggle>
              )}
            </span>
          }
        />
      </div>
      <p className="mt-1 text-xs text-[oklch(var(--color-ink-subtle))]">{t("judgment.confessions.hint")}</p>
      {data.items.length === 0 ? (
        <p className="py-3 text-sm text-[oklch(var(--color-ink-subtle))]">{t("judgment.confessions.not_seeded")}</p>
      ) : (
        <div className="mt-2 grid grid-cols-1 gap-x-6 md:grid-cols-2">
          {columns.map((rows, i) => (
            <ol key={i} data-testid="confession-column">
              {rows.map(renderRow)}
            </ol>
          ))}
        </div>
      )}
    </section>
  );
}
