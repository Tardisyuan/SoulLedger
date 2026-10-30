/**
 * 审判详情里的案情(Design 第三十四批 O-10):案由(超过 5 行折叠)→ 证据 → 附件;空的一段整段不画。
 *
 * 证据 = 这个灵魂本世的功过记录(`souls/<id>/records/`,网页审判台「证据」栏的同一批):标题是记录的描述,
 * 来源标签用网页现有的 `souls.evidence_sources`,日期取事件日期、没有就取入簿时间。记录本身没有附件,
 * 所以每行都打开全文页(描述 + 来源说明);案卷附件(`judgment/<id>/attachments/`)单列在「附件」一段。
 * 案由 = `summary`(官员写的概述,不是灵魂的供词 `confession`);空的不画。
 */
import { judgmentApi, type Judgment } from "@soulledger/core/api/judgment";
import { soulsApi, type SoulRecordEntry } from "@soulledger/core/api/souls";
import type { Locale } from "@soulledger/core/config/locale";
import { formatHistoricalDate } from "@soulledger/core/domain/dates";
import { useCallback, useState } from "react";
import { View } from "react-native";

import { AttachmentList } from "../attachments";
import { formatWhen } from "../format";
import { Row } from "../kit";
import { useCan } from "../session";
import { CaseUpload } from "./caseUpload";
import { SectionLabel, SmallButton, Txt, space, useI18n, useRemote } from "../shared";
import { AccountFrame } from "./account";

/** 超过这个字数就当作会过 5 行,给「展开全文」。(量行数要先渲染一遍;这里宁可多给一个按钮。) */
export const SUMMARY_FOLD_CHARS = 110;
const SUMMARY_LINES = 5;

export function summaryFolds(text: string): boolean {
  return text.length > SUMMARY_FOLD_CHARS || text.split("\n").length > SUMMARY_LINES;
}

/** When a record happened: its historical date in core's words (BC years too), else the day it was entered. */
export function recordDate(r: Pick<SoulRecordEntry, "event_date" | "recorded_at">, locale: Locale): string {
  return formatHistoricalDate(r.event_date, locale) ?? formatWhen(r.recorded_at).slice(0, 10);
}

export function JudgmentCase({ data, onOpenRecord }: { data: Judgment; onOpenRecord: (r: SoulRecordEntry) => void }) {
  const { t, enumLabel, locale } = useI18n();
  const [expanded, setExpanded] = useState(false);
  // 一段取不到不挡别的段:失败 = 那一段不画,整体写一句「案情没有加载出来」。
  const loadRecords = useCallback(() => Promise.resolve().then(() => soulsApi.records(data.soul)).then((r) => r.data), [data.soul]);
  const loadFiles = useCallback(() => Promise.resolve().then(() => judgmentApi.attachments(data.id)), [data.id]);
  const canExecute = useCan("judgment.execute");
  const records = useRemote(loadRecords);
  const files = useRemote(loadFiles);
  const evidence = (records.data ?? []).filter((r) => r.cycle === (data.cycle ?? r.cycle));
  const attachments = files.data?.items ?? [];
  const summary = (data.summary ?? "").trim();
  const failed = (records.error && !records.data) || (files.error && !files.data);

  return (
    <View testID="judgment-case" style={{ gap: space[4] }}>
      {summary ? (
        <View style={{ gap: space[2] }}>
          <SectionLabel>{t("officer_app.case.summary")}</SectionLabel>
          <Txt variant="body" testID="judgment-summary" numberOfLines={expanded ? undefined : SUMMARY_LINES}>
            {summary}
          </Txt>
          {!expanded && summaryFolds(summary) ? (
            <SmallButton testID="judgment-summary-more" title={t("officer_app.case.summary_more")} onPress={() => setExpanded(true)} />
          ) : null}
        </View>
      ) : null}
      {evidence.length > 0 ? (
        <View style={{ gap: space[2] }}>
          <SectionLabel>{t("officer_app.case.evidence", { n: String(evidence.length) })}</SectionLabel>
          {evidence.map((r) => {
            const source = r.evidence_source ? enumLabel("souls.evidence_sources", r.evidence_source) : null;
            return (
              <Row
                key={r.id}
                testID={`evidence-${r.id}`}
                minHeight={64}
                title={r.description}
                lines={[{ one: [source?.state === "known" ? source.label : null, recordDate(r, locale)].filter(Boolean).join(" · ") }]}
                onPress={() => onOpenRecord(r)}
                right={<Txt variant="nav">›</Txt>}
              />
            );
          })}
        </View>
      ) : null}
      <View style={{ gap: space[2] }}>
        {attachments.length > 0 ? (
          <>
            <SectionLabel>{t("officer_app.case.evidence_attachment", { n: String(attachments.length) })}</SectionLabel>
            <AttachmentList
              items={attachments.map((a) => ({ ...a, meta: `${a.uploader_name} · ${formatWhen(a.created_at)}` }))}
              resolve={(a) => judgmentApi.attachmentLink(data.id, a.id).then((link) => link.url)}
            />
          </>
        ) : null}
        {/* 只有持 judgment.execute 的人才有入口 —— 服务端 add_attachment 只认这个码,认领人被收回码后点了也是 403(RBAC A4)。
            结案后与没有码各只写一行。 */}
        {files.data || files.error ? (
          <CaseUpload
            judgmentId={data.id}
            list={files.data ?? null}
            canWrite={canExecute}
            onUploaded={() => void files.reload()}
          />
        ) : null}
      </View>
      {failed ? (
        <Txt variant="caption" tone="muted" testID="judgment-case-failed">
          {t("officer_app.case.load_failed")}
        </Txt>
      ) : null}
    </View>
  );
}

/** 纯文字的证据:全文页。 */
export function EvidenceText({ record, onBack }: { record: SoulRecordEntry; onBack: () => void }) {
  const { enumLabel, locale } = useI18n();
  const source = record.evidence_source ? enumLabel("souls.evidence_sources", record.evidence_source) : null;
  return (
    <AccountFrame testID="evidence-text" onBack={onBack}>
      <Txt variant="title">{record.description}</Txt>
      <Txt variant="caption" tone="muted">
        {[source?.state === "known" ? source.label : null, recordDate(record, locale)].filter(Boolean).join(" · ")}
      </Txt>
      {record.evidence_note ? <Txt variant="body">{record.evidence_note}</Txt> : null}
    </AccountFrame>
  );
}
