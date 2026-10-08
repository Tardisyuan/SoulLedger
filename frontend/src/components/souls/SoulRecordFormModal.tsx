"use client";

import { useEffect, useId, useState } from "react";
import type { LedgerRecord } from "@soulledger/core/api/ledger";
import type { SoulRecordEntry } from "@soulledger/core/api/souls";
import { useAddSoulRecord, useUpdateSoulRecord } from "@soulledger/core/hooks/useSouls";
import { useAllStatutes } from "@soulledger/core/hooks/useStatutes";
import { Button } from "@/src/components/ui/Button";
import { SelectField, TextAreaField, TextField } from "@/src/components/ui/Field";
import { BaseModal } from "@/src/components/ui/Modal";
import { useI18n } from "@/src/contexts/I18nContext";

/**
 * 功过台账的「新增一条 / 修改」表单。新增走 `add_record`,修改走 `PATCH …/records/<id>/`;
 * 两条写路径是同一个后端序列化器,校验只在后端有一份 —— 这里只拦「空着提交」与「次数 / 条款不成对」
 * 这两种不必往返一趟就知道的错,其余后端的 400 按字段原样显示在字段下。
 *
 * 律条只列这个灵魂所属文明的语料(后端也拒绝别的文明的律条);条款来自律条 `payload_json.clauses`。
 * 存好之后若引用了律条,窗口不立刻关,先给一张「已存入的律条快照」—— 快照由后端在存的那一刻冻结,
 * 之后律条改了它也不变。
 *
 * 事件日期是年 / 月 / 日三个数字框(年可为负 = 公元前,月日可空),与后端
 * `event_year / event_month / event_day` 一一对应;只在被动过时才随修改发出。
 */

const RECORD_TYPES = ["MERIT", "DEMERIT"] as const;
const CATEGORIES = [
  "CHARITY", "COMPASSION", "HONESTY", "COURAGE", "WISDOM", "PIETY",
  "CRUELTY", "DECEPTION", "COWARDICE", "GREED", "BLASPHEMY", "MURDER", "OTHER",
] as const;
const LIFE_STAGES = ["CHILDHOOD", "YOUTH", "ADULTHOOD", "OLD_AGE"] as const;
const EVIDENCE_SOURCES = ["REGISTRY", "WITNESS", "SELF_ACCOUNT", "OTHER"] as const;

type FieldKey =
  | "category" | "description" | "weight" | "event_date" | "occurrence_count" | "statute"
  | "statute_clause" | "life_stage" | "evidence_source" | "evidence_note";
const FIELD_KEYS = [
  "category", "description", "weight", "event_date", "occurrence_count", "statute", "statute_clause",
  "life_stage", "evidence_source", "evidence_note",
] as const;
type Errors = Partial<Record<FieldKey, string>> & { general?: string };

/** 后端稳定的错误码 → 文案键。码在 400 体的 `error_codes`(与消息同序);不认识的码退回后端原文。 */
function messageKeyOf(field: string, code: string | undefined): string | null {
  if (code === "statute_other_civilization") return "ledger.book.form.err.statute_civ";
  if (code === "clause_count_pair") return "ledger.book.form.err.pair";
  if (field === "occurrence_count" && code === "min_value") return "ledger.book.form.err.count_min";
  if (field === "weight" && (code === "min_value" || code === "max_value")) return "ledger.book.form.weight_range";
  if (code === "invalid_choice") return "ledger.book.form.err.unknown_enum";
  return null;
}

/** DRF 的 400:`{字段: [消息], error_codes: {字段: [码]}}`。认得的码译成当前语言,否则用原文;
 *  认得的字段落到字段下,其余(non_field_errors / detail)落到表单顶上。 */
export function recordFormErrorsOf(error: unknown, t: (key: string) => string): Errors {
  const data = (error as { response?: { status?: number; data?: unknown } })?.response;
  if (data?.status !== 400 || typeof data.data !== "object" || data.data === null) return {};
  const body = data.data as Record<string, unknown>;
  const codes = (typeof body.error_codes === "object" && body.error_codes ? body.error_codes : {}) as Record<string, string[]>;
  const out: Errors = {};
  for (const [key, value] of Object.entries(body)) {
    if (key === "error_codes") continue;
    const raw = Array.isArray(value) ? String(value[0] ?? "") : typeof value === "string" ? value : "";
    if (!raw) continue;
    const mapped = messageKeyOf(key, codes[key]?.[0]);
    const message = mapped ? t(mapped) : raw;
    if ((FIELD_KEYS as readonly string[]).includes(key)) out[key as FieldKey] = message;
    else out.general = message;
  }
  return out;
}

/** `'<code>:<条款原文>'` 的条款原文那一半。 */
export function clauseText(statuteClause: string): string {
  const i = statuteClause.indexOf(":");
  return i < 0 ? "" : statuteClause.slice(i + 1).trim();
}

export interface SoulRecordFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  soulId: string;
  /** 灵魂所属文明(`Soul.civilization`):只列这一文明的律条。 */
  civilization: string;
  /** 有 = 修改这一条;没有 = 新增。 */
  record?: LedgerRecord | null;
}

export function SoulRecordFormModal({ isOpen, onClose, soulId, civilization, record }: SoulRecordFormModalProps) {
  const { t, locale } = useI18n();
  const formId = useId();
  const add = useAddSoulRecord();
  const update = useUpdateSoulRecord();
  const pending = add.isPending || update.isPending;
  const statutes = useAllStatutes({ enabled: isOpen });

  const [recordType, setRecordType] = useState<string>("MERIT");
  const [category, setCategory] = useState<string>("OTHER");
  const [description, setDescription] = useState("");
  const [weight, setWeight] = useState("1");
  const [count, setCount] = useState("");
  const [dateYear, setDateYear] = useState("");
  const [dateMonth, setDateMonth] = useState("");
  const [dateDay, setDateDay] = useState("");
  const [dateTouched, setDateTouched] = useState(false);
  const [lifeStage, setLifeStage] = useState("");
  const [statuteId, setStatuteId] = useState("");
  const [clause, setClause] = useState("");
  const [evidenceSource, setEvidenceSource] = useState("");
  const [evidenceNote, setEvidenceNote] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [saved, setSaved] = useState<SoulRecordEntry | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setErrors({});
    setSaved(null);
    setDateTouched(false);
    setRecordType(record?.type ?? "MERIT");
    setCategory(record?.category ?? "OTHER");
    setDescription(record?.description ?? "");
    setWeight(String(record?.original_weight ?? 1));
    setCount(record?.occurrence_count != null ? String(record.occurrence_count) : "");
    setDateYear(record?.event_date ? String(record.event_date.year) : "");
    setDateMonth(record?.event_date?.month ? String(record.event_date.month) : "");
    setDateDay(record?.event_date?.day ? String(record.event_date.day) : "");
    setLifeStage(record?.life_stage ?? "");
    setStatuteId(record?.statute_snapshot?.statute_id ?? "");
    setClause(record ? clauseText(record.statute_clause) : "");
    setEvidenceSource(record?.evidence_source ?? "");
    setEvidenceNote(record?.evidence_note ?? "");
  }, [isOpen, record]);

  const own = (statutes.data ?? []).filter((s) => s.civilization === civilization);
  const chosen = own.find((s) => s.id === statuteId);
  const titleKey = locale === "zh-Hans" ? "zh" : locale === "egy" ? "egy" : "en";
  const statuteOptions = [
    { value: "", label: t("ledger.book.form.statute_none") },
    ...own.map((s) => ({ value: s.id, label: `${s.code} ${s.display_title}`.trim() })),
    // 列表没载入(没有读律条的权限、或还在载入)时,已引用的那条仍要能显示、不被改掉。
    ...(statuteId && !chosen ? [{ value: statuteId, label: record?.statute_snapshot?.code ?? statuteId }] : []),
  ];
  const clauses = ((chosen?.payload_json?.clauses as { condition_zh?: string }[] | undefined) ?? [])
    .map((c) => c.condition_zh ?? "")
    .filter(Boolean);
  const clauseOptions = [
    { value: "", label: t("ledger.book.form.clause_none") },
    ...[...new Set(clause && !clauses.includes(clause) ? [clause, ...clauses] : clauses)].map((c) => ({ value: c, label: c })),
  ];
  const stageOptions = [
    { value: "", label: t("common.value.unrecorded") },
    ...LIFE_STAGES.map((v) => ({ value: v, label: t(`souls.life_stages.${v}`) })),
  ];
  const sourceOptions = [
    { value: "", label: t("common.value.unrecorded") },
    ...EVIDENCE_SOURCES.map((v) => ({ value: v, label: t(`souls.evidence_sources.${v}`) })),
  ];

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const next: Errors = {};
    const weightNumber = Number(weight);
    if (!description.trim()) next.description = t("common.field_required");
    if (!Number.isInteger(weightNumber) || weightNumber < 1 || weightNumber > 100) next.weight = t("ledger.book.form.weight_range");
    const code = chosen?.code ?? (statuteId ? record?.statute_snapshot?.code : undefined);
    const [y, m, d] = [dateYear.trim(), dateMonth.trim(), dateDay.trim()];
    if (y || m || d) {
      const [yn, mn, dn] = [Number(y), Number(m), Number(d)];
      if (!y || (d && !m)) next.event_date = t("ledger.book.form.err.date_order");
      else if (!Number.isInteger(yn) || yn === 0 || (m && !(Number.isInteger(mn) && mn >= 1 && mn <= 12))
        || (d && !(Number.isInteger(dn) && dn >= 1 && dn <= 31))) next.event_date = t("ledger.book.form.err.date_invalid");
    }
    if (count.trim() && !clause) next.statute_clause = t("ledger.book.form.count_needs_clause");
    if (!count.trim() && clause) next.occurrence_count = t("ledger.book.form.clause_needs_count");
    if (clause && !code) next.statute = t("common.field_required");
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    const data = {
      record_type: recordType,
      category,
      description: description.trim(),
      weight: weightNumber,
      occurrence_count: count.trim() ? Number(count) : null,
      statute_clause: clause && code ? `${code}:${clause}` : "",
      statute: statuteId || null,
      life_stage: lifeStage,
      evidence_source: evidenceSource,
      evidence_note: evidenceNote.trim(),
      ...(dateTouched || (!record && dateYear.trim())
        ? {
            event_date: dateYear.trim()
              ? { year: Number(dateYear), month: dateMonth.trim() ? Number(dateMonth) : null, day: dateDay.trim() ? Number(dateDay) : null }
              : null,
          }
        : {}),
    };
    const handlers = {
      onSuccess: (res: { data: SoulRecordEntry }) => {
        if (res.data.statute_snapshot) setSaved(res.data);
        else onClose();
      },
      onError: (error: unknown) => setErrors(recordFormErrorsOf(error, t)),
    };
    if (record) update.mutate({ id: soulId, recordId: record.id, data }, handlers);
    else add.mutate({ id: soulId, data }, handlers);
  }

  if (saved) {
    const snap = saved.statute_snapshot;
    return (
      <BaseModal
        isOpen={isOpen}
        onClose={onClose}
        title={t("ledger.book.form.snapshot")}
        footer={
          <div className="flex justify-end">
            <Button type="button" variant="primary" onClick={onClose}>
              {t("common.close")}
            </Button>
          </div>
        }
      >
        <p data-testid="record-snapshot" className="text-sm text-[oklch(var(--color-ink))]">
          <span className="font-mono">{snap?.code}</span> {snap?.title[titleKey] ?? ""}
        </p>
      </BaseModal>
    );
  }

  const clear = (key: FieldKey) => setErrors((prev) => ({ ...prev, [key]: undefined }));

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={() => !pending && onClose()}
      title={record ? t("ledger.book.form.edit_title") : t("ledger.book.form.add_title")}
      wide
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form={formId} variant="primary" loading={pending}>
            {t("common.save")}
          </Button>
        </div>
      }
    >
      <form id={formId} onSubmit={submit} className="space-y-4" noValidate>
        {errors.general ? (
          <p role="alert" className="text-sm text-[oklch(var(--color-danger))]">
            <span aria-hidden="true">✕ </span>
            {errors.general}
          </p>
        ) : null}
        <div className="grid gap-4 md:grid-cols-2">
          <SelectField
            label={t("ledger.book.form.type")}
            value={recordType}
            onChange={(e) => setRecordType(e.target.value)}
            disabled={pending}
            options={RECORD_TYPES.map((v) => ({
              value: v,
              label: t(v === "MERIT" ? "ledger.book.col_merit" : "ledger.book.col_demerit"),
            }))}
          />
          <SelectField
            label={t("ledger.journal.category")}
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            disabled={pending}
            error={errors.category}
            options={CATEGORIES.map((v) => ({ value: v, label: t(`souls.categories.${v}`) }))}
          />
        </div>
        <TextAreaField
          label={t("ledger.book.col_item")}
          required
          rows={2}
          value={description}
          onChange={(e) => { setDescription(e.target.value); clear("description"); }}
          disabled={pending}
          error={errors.description}
        />
        <div className="grid gap-4 md:grid-cols-2">
          <TextField
            label={t("ledger.figure_scale_weight")}
            required
            type="number"
            min={1}
            max={100}
            step={1}
            value={weight}
            onChange={(e) => { setWeight(e.target.value); clear("weight"); }}
            disabled={pending}
            error={errors.weight}
          />
          <SelectField
            label={t("ledger.book.form.life_stage")}
            value={lifeStage}
            onChange={(e) => setLifeStage(e.target.value)}
            disabled={pending}
            error={errors.life_stage}
            options={stageOptions}
          />
        </div>
        {/* 年可为负(公元前,-612 = 公元前 612 年);月、日可空,但日须有月、月须有年(后端同此规则)。 */}
        <div className="grid grid-cols-3 gap-4">
          <TextField
            label={`${t("ledger.book.col_date")} · ${t("ledger.book.form.date_year")}`}
            type="number"
            step={1}
            placeholder="-612"
            value={dateYear}
            onChange={(e) => { setDateYear(e.target.value); setDateTouched(true); clear("event_date"); }}
            disabled={pending}
            error={errors.event_date}
          />
          <TextField
            label={t("ledger.book.form.date_month")}
            type="number"
            min={1}
            max={12}
            step={1}
            value={dateMonth}
            onChange={(e) => { setDateMonth(e.target.value); setDateTouched(true); clear("event_date"); }}
            disabled={pending}
          />
          <TextField
            label={t("ledger.book.form.date_day")}
            type="number"
            min={1}
            max={31}
            step={1}
            value={dateDay}
            onChange={(e) => { setDateDay(e.target.value); setDateTouched(true); clear("event_date"); }}
            disabled={pending}
          />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <SelectField
            label={t("ledger.book.form.statute")}
            value={statuteId}
            onChange={(e) => { setStatuteId(e.target.value); setClause(""); clear("statute"); }}
            disabled={pending}
            error={errors.statute}
            options={statuteOptions}
          />
          <SelectField
            label={t("ledger.book.clause")}
            value={clause}
            onChange={(e) => { setClause(e.target.value); clear("statute_clause"); }}
            disabled={pending || !statuteId}
            error={errors.statute_clause}
            options={clauseOptions}
          />
        </div>
        <TextField
          label={t("ledger.book.form.occurrence_count")}
          type="number"
          min={1}
          step={1}
          value={count}
          onChange={(e) => { setCount(e.target.value); clear("occurrence_count"); }}
          disabled={pending}
          error={errors.occurrence_count}
        />
        <div className="grid gap-4 md:grid-cols-2">
          <SelectField
            label={t("ledger.book.form.evidence_source")}
            value={evidenceSource}
            onChange={(e) => setEvidenceSource(e.target.value)}
            disabled={pending}
            error={errors.evidence_source}
            options={sourceOptions}
          />
          <TextAreaField
            label={t("ledger.book.form.evidence_note")}
            rows={2}
            value={evidenceNote}
            onChange={(e) => setEvidenceNote(e.target.value)}
            disabled={pending}
            error={errors.evidence_note}
          />
        </div>
      </form>
    </BaseModal>
  );
}
