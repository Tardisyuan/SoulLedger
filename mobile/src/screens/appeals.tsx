/**
 * 审判申诉 (Design 第五十二批 A-1 ~ A-4).
 *
 *   A-1 每件已结案审判卡片底部一行(`AppealLine`):能申诉写截止日 +「申诉 ›」;不能写原因;申诉过的多一行
 *       「第 N 次申诉 · 状态」,点开看各轮。
 *   A-2 整页表单(`JudgmentAppealScreen`):理由 2000 字,新证据选填;有未提交内容时离开先确认。
 *   A-3 各轮:新的一轮在上;复核意见是人写的话,用 `Quote`(serif);不写复核人;待复核 / 复核中可撤回。
 *   A-4 推送落地(`focused`):自动展开最新一轮,改判时写「原判 → 新判」与补偿各站。
 *   上诉(2026-10-27;Design 第五十五批 U-1 ~ U-5):
 *     U-1 上一轮一次复核维持原判、还有次数时(`can_escalate`),原来「申诉 ›」那一行换成左边一句 `escalate_hint`、
 *         右边「上诉 ›」;不能上诉时不画这一行(`not_escalatable` 只给后端兜底)。
 *     U-2 同一张整页表单(`escalate`),多一块各站名(`escalation_stations`),理由选填,后果说明用 `escalate_body`;不能撤回。
 *     U-3 ~ U-5 那一轮前一枚「上诉」方标,下面一条站梯(■ 已过 · ▪ 当前 · □ 未到 · ✕ 驳回),每站的结论用 `Quote`;
 *         驳回之后的站(含终审)灰 □ +「不再审」(第五十六批 `ladder_state.NOT_HEARD`)。终审站通过后写这一轮的结果
 *         (维持 / 改判),改判照 A-4。
 *   第五十五批补充(55b):终审(`is_final`)不在站梯里,而是站梯下面虚线隔开的单独一行;U-2 的各站名最后一个写成「终审 · 站名」;
 *     进度「第 n / 站数 站」不数终审。
 *     U-6 站梯走完 · 待终审(`AWAITING_FINAL`):轮次行右侧写 `ladder_state.AWAITING_FINAL`,终审一行 ◇ 浅底,
 *         右侧 `ladder_final_pending`「待作出结论」(55c:只写状态,站名在左)。
 *   55c:终审站名「终审 · {{name}}」的 name 去掉节点名末尾的「 · 终审」(`finalStationName`)。
 *   第五十六批 U-2:各站名那一行的标签是 `appeals.ladder`「申诉流程 · 文明名」;理由的标签 `escalate_reason_label`;
 *     提交按钮正上方浅底一句 `escalate_last`。
 *
 * 数据是 `GET /me/judgment-appeals/`:`judgments` 只列本世已结案的原审,所以没有这一行的审判
 * (未结案、复审、前世)不画申诉行。
 */
import {
  appealRefusalKey,
  soulApi,
  soulErrorCode,
  soulErrorMessage,
  type MeAppealableJudgment,
  type MeJudgmentAppeal,
  type MeJudgmentAppealList,
} from "@soulledger/core/api/soul";
import { appealsLeftAfterWithdraw, finalStationName } from "@soulledger/core/domain/appeals";
import { useNavigation, useRoute, type NavigationProp, type RouteProp } from "@react-navigation/native";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { useToast } from "../feedback";
import { useI18n } from "../i18n";
import { formatStamp } from "../rules";
import { Button, DataRow, DataRows, FieldError, Input, Quote, Screen, SmallButton, Txt, enumText, useLayout, useTheme } from "../ui";
import type { AppStackParams } from "./applications";
import { useDiscardGuard } from "./discardGuard";
import { ButtonPair, MfaSheet } from "./mfaParts";

/** The server's bounds (`JudgmentAppealCreateSerializer`). */
export const APPEAL_REASON_MAX = 2000;
const EVIDENCE_MAX = 4000;

/** `2026-11-08`: the deadline is a day, not a moment. */
export const appealDay = (iso: string | null | undefined) => formatStamp(iso)?.slice(0, 10) ?? "";

/** A judgment's rounds, newest first. */
export function roundsOf(list: MeJudgmentAppealList, judgment: string): MeJudgmentAppeal[] {
  return list.results.filter((r) => r.judgment === judgment).sort((a, b) => b.round - a.round);
}

const OPEN = ["PENDING", "IN_REVIEW"];
const GLYPH = { PASSED: "■", CURRENT: "▪", AHEAD: "□", REJECTED: "✕", AWAITING_FINAL: "◇" } as const;
const DECIDED = ["UPHELD", "AMENDED"];

/** 「上诉」方标:2px ink 框,申诉那一轮没有。 */
function EscalatedTag() {
  const { t } = useI18n();
  const theme = useTheme();
  return (
    <View testID="appeal-escalated-tag" style={[styles.tag, { borderColor: theme.ink }]}>
      <Txt variant="caption">{t("appeals.escalated_tag")}</Txt>
    </View>
  );
}

/** U-3 ~ U-5:上诉那一轮的站梯。不写复核人(同申诉)。 */
function Ladder({ round }: { round: MeJudgmentAppeal }) {
  const { t } = useI18n();
  const theme = useTheme();
  const ladder = round.ladder;
  if (!ladder) return null;
  const over = round.workflow_status === "COMPLETED" || round.workflow_status === "REJECTED";
  const final = ladder.stations.find((s) => s.is_final);
  const row = (s: Station) => {
    const notHeard = over && s.state === "AHEAD";
    const faint = s.state === "AHEAD";
    // The final station passing hands the appeal to the final judge: its result is the round's own.
    const state = notHeard
      ? t("appeals.ladder_state.NOT_HEARD")
      : s.state === "AWAITING_FINAL"
        ? t("appeals.ladder_final_pending")
        : s.is_final && s.state === "PASSED"
          ? DECIDED.includes(round.status)
            ? t(`appeals.status.${round.status}`)
            : null
          : t(`appeals.ladder_state.${s.state}`);
    return (
      <View
        key={s.node}
        testID={`appeal-station-${round.id}-${s.order}`}
        style={[styles.station, s.state === "AWAITING_FINAL" ? [styles.awaiting, { backgroundColor: theme.s2 }] : null]}
      >
        <Txt variant="body" tone={faint ? "subtle" : "ink"}>
          {GLYPH[s.state]}
        </Txt>
        <View style={styles.fill}>
          <View style={styles.entryLine}>
            <Txt variant="body" tone={faint ? "subtle" : "ink"} style={styles.fill}>
              {s.is_final ? t("appeals.ladder_final", { name: finalStationName(s.name) }) : t("appeals.ladder_station", { n: String(s.order), name: s.name })}
            </Txt>
            {state ? (
              <Txt testID={`appeal-station-state-${round.id}-${s.order}`} variant="caption" tone="muted">
                {state}
              </Txt>
            ) : null}
          </View>
          {s.note ? <Quote text={s.note} /> : null}
        </View>
      </View>
    );
  };
  return (
    <View testID={`appeal-stations-${round.id}`} style={styles.ladder}>
      {ladder.stations.filter((s) => !s.is_final).map(row)}
      {final ? (
        <View testID={`appeal-final-${round.id}`} style={[styles.finalRow, { borderColor: theme.hair2 }]}>
          {row(final)}
        </View>
      ) : null}
    </View>
  );
}

type Station = NonNullable<MeJudgmentAppeal["ladder"]>["stations"][number];

/** 轮次行右侧:待终审时写那一句;流程停在某一站(不是终审)时写「第 n / 站数 站」,站数不含终审。 */
function ladderProgress(ladder: MeJudgmentAppeal["ladder"], t: (key: string, vars?: Record<string, string>) => string) {
  if (!ladder) return null;
  if (ladder.stations.some((s) => s.state === "AWAITING_FINAL")) return t("appeals.ladder_state.AWAITING_FINAL");
  const current = ladder.stations.find((s) => s.state === "CURRENT");
  if (!current || current.is_final) return null;
  return t("appeals.ladder_progress", { n: String(current.order), total: String(ladder.stations.filter((s) => !s.is_final).length) });
}

function useVerdict() {
  const { enumLabel, t } = useI18n();
  return (v: string | null | undefined) => enumText(enumLabel("judgment.verdicts", v), t);
}

function Round({
  round,
  roundsFiled,
  onWithdrawn,
  heading = true,
}: {
  round: MeJudgmentAppeal;
  /** The toggle row above already names the latest round: its body leaves the heading out (2026-10-27, simulator). */
  heading?: boolean;
  /** Rounds filed on this judgment, this one included: the withdraw confirmation says how many are left. */
  roundsFiled: number;
  onWithdrawn: () => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const verdict = useVerdict();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const left = appealsLeftAfterWithdraw(roundsFiled);
  const withdraw = async () => {
    setBusy(true);
    try {
      await soulApi.withdrawJudgmentAppeal(round.id);
      setAsking(false);
      toast(t("appeals.withdrawn_toast"));
      onWithdrawn();
    } catch (error) {
      // 撤回被拒(已有结论 / 已进申诉流程)有专门的一句;其余照通用分类。
      const refusal = appealRefusalKey(soulErrorCode(error));
      const m = soulErrorMessage(error);
      toast(refusal ? t(refusal) : t(m.key, m.params), "failure");
    } finally {
      setBusy(false);
    }
  };
  return (
    <View testID={`appeal-round-${round.id}`} style={styles.round}>
      {heading ? (
        <Txt variant="bodyLg">{`${t("appeals.round", { round: String(round.round) })} · ${t(`appeals.status.${round.status}`)}`}</Txt>
      ) : null}
      <Txt variant="caption" tone="subtle">
        {t("appeals.reason_label")}
      </Txt>
      <Txt variant="body" tone="muted">
        {round.reason}
      </Txt>
      {round.evidence ? (
        <>
          <Txt variant="caption" tone="subtle">
            {t("appeals.evidence_label")}
          </Txt>
          <Txt variant="body" tone="muted">
            {round.evidence}
          </Txt>
        </>
      ) : null}
      {round.workflow_name ? (
        <Txt testID={`appeal-ladder-${round.id}`} variant="caption" tone="muted">
          {t("appeals.ladder", { name: round.workflow_name })}
        </Txt>
      ) : null}
      <Ladder round={round} />
      {round.status === "AMENDED" ? (
        <DataRows>
          <DataRow label={t("appeals.original_verdict")}>{verdict(round.original_verdict)}</DataRow>
          <DataRow label={t("appeals.new_verdict")}>
            <Txt testID={`appeal-change-${round.id}`} variant="body">
              {t("appeals.verdict_change", { from: verdict(round.original_verdict), to: verdict(round.new_verdict) })}
            </Txt>
          </DataRow>
        </DataRows>
      ) : null}
      {round.decision_note ? (
        <>
          <Txt variant="caption" tone="subtle">
            {`${t("appeals.decision_note")}${round.decided_at ? ` · ${appealDay(round.decided_at)}` : ""}`}
          </Txt>
          <Quote text={round.decision_note} testID={`appeal-note-${round.id}`} />
        </>
      ) : null}
      {round.compensations.length ? (
        <View testID={`appeal-compensation-${round.id}`} style={styles.compensation}>
          <Txt variant="caption" tone="subtle">
            {t("appeals.compensation")}
          </Txt>
          {round.compensations.map((c) => {
            const order = c.order;
            return (
              <Txt key={c.id} variant="value" tone="muted">
                {order === null ? `${c.description} · +${c.weight}` : t("appeals.compensation_row", { order: String(order), weight: String(c.weight) })}
              </Txt>
            );
          })}
          <Txt variant="caption" tone="subtle">
            {t("appeals.compensation_hint")}
          </Txt>
        </View>
      ) : null}
      {OPEN.includes(round.status) && !round.workflow ? (
        <Button testID={`appeal-withdraw-${round.id}`} kind="secondary" title={t("appeals.withdraw")} onPress={() => setAsking(true)} />
      ) : null}
      <MfaSheet testID="appeal-withdraw-sheet" open={asking} onClose={() => setAsking(false)} closeLabel={t("soul_app.common.cancel")}>
        <Txt variant="title" accessibilityRole="header">
          {t("appeals.withdraw_title")}
        </Txt>
        <Txt testID="appeal-withdraw-body" variant="bodyLg">
          {left > 0 ? t("appeals.withdraw_body", { left: String(left) }) : t("appeals.withdraw_body_last")}
        </Txt>
        <ButtonPair>
          <Button testID="appeal-withdraw-cancel" kind="secondary" title={t("soul_app.common.cancel")} onPress={() => setAsking(false)} style={styles.fill} />
          <Button testID="appeal-withdraw-confirm" kind="secondary" title={t("appeals.withdraw")} busy={busy} onPress={() => void withdraw()} style={styles.fill} />
        </ButtonPair>
      </MfaSheet>
    </View>
  );
}

/**
 * The appeal line at the foot of a concluded judgment's card. `row` absent → nothing (not appealable in this life).
 * `focused`: a decision push landed on this judgment — the latest round opens by itself.
 */
export function AppealLine({
  row,
  rounds,
  focused,
  onChanged,
}: {
  row: MeAppealableJudgment | undefined;
  rounds: MeJudgmentAppeal[];
  focused?: boolean;
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const theme = useTheme();
  const navigation = useNavigation<NavigationProp<AppStackParams>>();
  // The soul's own toggle wins; until then a landed push holds it open.
  const [toggled, setToggled] = useState<boolean | null>(null);
  const open = toggled ?? !!focused;
  if (!row) return null;
  const latest = rounds[0];
  const refusal = appealRefusalKey(row.refusal_code);
  return (
    <View testID={`appeal-line-${row.judgment_id}`} style={[styles.line, { borderTopColor: theme.hair }]}>
      <View style={styles.entry}>
        {row.can_escalate ? (
          <>
            <Txt testID={`appeal-escalate-hint-${row.judgment_id}`} variant="caption" tone="muted" style={styles.fill}>
              {t("appeals.escalate_hint")}
            </Txt>
            <SmallButton
              testID={`appeal-escalate-${row.judgment_id}`}
              title={`${t("appeals.escalate")} ›`}
              onPress={() =>
                navigation.navigate("JudgmentAppeal", {
                  judgment: row.judgment_id,
                  caseNumber: row.case_number,
                  verdict: row.verdict,
                  deadline: row.deadline,
                  escalate: true,
                  stations: row.escalation_stations,
                  civilization: row.civilization,
                })
              }
            />
          </>
        ) : row.can_appeal ? (
          <>
            <Txt testID={`appeal-deadline-${row.judgment_id}`} variant="caption" tone="muted" style={styles.fill}>
              {t("appeals.deadline", { date: appealDay(row.deadline) })}
            </Txt>
            <SmallButton
              testID={`appeal-file-${row.judgment_id}`}
              title={`${t("appeals.file")} ›`}
              onPress={() =>
                navigation.navigate("JudgmentAppeal", {
                  judgment: row.judgment_id,
                  caseNumber: row.case_number,
                  verdict: row.verdict,
                  deadline: row.deadline,
                })
              }
            />
          </>
        ) : (
          <Txt testID={`appeal-refusal-${row.judgment_id}`} variant="caption" tone="subtle" style={styles.fill}>
            {refusal ? t(refusal, { date: appealDay(row.deadline) }) : t("appeals.refusal.not_appealable")}
          </Txt>
        )}
      </View>
      {latest ? (
        <Pressable
          testID={`appeal-rounds-${row.judgment_id}`}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          onPress={() => setToggled(!open)}
          style={styles.entry}
        >
          {latest.workflow ? <EscalatedTag /> : null}
          <Txt variant="body" style={styles.fill}>
            {`${t("appeals.round", { round: String(latest.round) })} · ${t(`appeals.status.${latest.status}`)}`}
          </Txt>
          {ladderProgress(latest.ladder, t) ? (
            <Txt testID={`appeal-progress-${latest.id}`} variant="value" tone="muted">
              {ladderProgress(latest.ladder, t)}
            </Txt>
          ) : null}
          <Txt variant="caption" tone="subtle">
            {open ? "▲" : "▼"}
          </Txt>
        </Pressable>
      ) : null}
      {open
        ? rounds.map((r) => (
            <Round key={r.id} round={r} roundsFiled={row.rounds_used} onWithdrawn={onChanged} heading={r.id !== latest?.id} />
          ))
        : null}
    </View>
  );
}

export type JudgmentAppealParams = {
  judgment: string;
  caseNumber: string;
  verdict: string;
  deadline: string;
  /** 上诉到本文明的申诉流程,而不是再一次一次复核。 */
  escalate?: boolean;
  /** 上诉时要过的各站名(`escalation_stations`),确认页列出。 */
  stations?: string[];
  /** 审判本身的文明(上诉建的就是它的申诉流程):「申诉流程 · 文明名」。 */
  civilization?: string;
};

/** A-2: the form, a whole page — a 2000-character reason does not fit a sheet with the keyboard up. */
export function JudgmentAppealScreen() {
  const { t, enumLabel } = useI18n();
  const toast = useToast();
  const { gutter } = useLayout();
  const verdict = useVerdict();
  const theme = useTheme();
  const navigation = useNavigation<NavigationProp<AppStackParams>>();
  const params = useRoute<RouteProp<{ JudgmentAppeal: JudgmentAppealParams }, "JudgmentAppeal">>().params;
  const [reason, setReason] = useState("");
  const [evidence, setEvidence] = useState("");
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = !!(reason.trim() || evidence.trim());
  const guard = useDiscardGuard(dirty, "appeal");

  const submit = async () => {
    if (busy) return;
    // 上诉的理由选填:第一次申诉已经写过(U-2)。
    if (!reason.trim() && !params.escalate) return setMissing(true);
    setBusy(true);
    setError(null);
    try {
      await soulApi.fileJudgmentAppeal(params.judgment, reason.trim(), evidence.trim(), !!params.escalate);
      guard.release();
      toast(t("appeals.submitted_toast"));
      navigation.goBack();
    } catch (e) {
      const refusal = appealRefusalKey(soulErrorCode(e));
      if (refusal) setError(t(refusal, { date: appealDay(params.deadline) }));
      else {
        const m = soulErrorMessage(e);
        setError(t(m.key, m.params));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen testID="judgment-appeal" belowHeader>
      <View style={[styles.form, { paddingHorizontal: gutter }]}>
        <DataRows>
          <DataRow label={t("appeals.original_verdict")}>{`${params.caseNumber} · ${verdict(params.verdict)}`}</DataRow>
          {params.escalate && params.stations?.length ? (
            <DataRow label={t("appeals.ladder", { name: enumText(enumLabel("souls.civilizations", params.civilization), t) })}>
              <Txt testID="appeal-stations" variant="body">
                {/* 55b:最后一站是终审,写成「终审 · 站名」(55c:站名去掉末尾的「 · 终审」)。 */}
                {params.stations
                  .map((name, i) => (i === params.stations!.length - 1 ? t("appeals.ladder_final", { name: finalStationName(name) }) : name))
                  .join(" → ")}
              </Txt>
            </DataRow>
          ) : null}
        </DataRows>
        <View>
          <Input
            testID="appeal-reason"
            label={t(params.escalate ? "appeals.escalate_reason_label" : "appeals.reason_label")}
            value={reason}
            onChangeText={(v) => {
              setReason(v);
              if (v.trim()) setMissing(false);
            }}
            multiline
            maxLength={APPEAL_REASON_MAX}
            editable={!busy}
            error={missing ? t("appeals.reason_required") : null}
          />
          <Txt testID="appeal-reason-count" variant="caption" tone="subtle" style={styles.count}>
            {`${reason.length}/${APPEAL_REASON_MAX}`}
          </Txt>
        </View>
        <Input testID="appeal-evidence" label={t("appeals.evidence_label")} value={evidence} onChangeText={setEvidence} multiline maxLength={EVIDENCE_MAX} editable={!busy} />
        <Txt testID="appeal-file-body" variant="body" tone="muted">
          {t(params.escalate ? "appeals.escalate_body" : "appeals.file_body")}
        </Txt>
        <Txt variant="caption" tone="subtle">
          {t("appeals.deadline", { date: appealDay(params.deadline) })}
        </Txt>
        {error ? <FieldError testID="appeal-error" text={error} /> : null}
        {params.escalate ? (
          <Txt testID="appeal-escalate-last" variant="body" style={[styles.last, { backgroundColor: theme.s2 }]}>
            {t("appeals.escalate_last")}
          </Txt>
        ) : null}
        <Button testID="appeal-submit" title={t(params.escalate ? "appeals.escalate" : "appeals.submit")} busy={busy} onPress={() => void submit()} />
        <Button testID="appeal-cancel" kind="secondary" title={t("soul_app.common.cancel")} onPress={() => navigation.goBack()} />
      </View>
      {guard.sheet}
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  line: { marginTop: 12, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, gap: 4 },
  entry: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 12 },
  round: { paddingVertical: 8, gap: 4 },
  compensation: { gap: 2, marginTop: 4 },
  form: { paddingVertical: 24, gap: 20 },
  count: { alignSelf: "flex-end", marginTop: 4 },
  tag: { borderWidth: 2, paddingHorizontal: 4 },
  ladder: { gap: 8, marginTop: 4 },
  station: { flexDirection: "row", gap: 8 },
  awaiting: { paddingHorizontal: 8, paddingVertical: 4 },
  last: { paddingHorizontal: 12, paddingVertical: 8 },
  finalRow: { borderTopWidth: 1, borderStyle: "dashed", paddingTop: 8, marginTop: 4 },
  entryLine: { flexDirection: "row", alignItems: "baseline", gap: 8 },
});
