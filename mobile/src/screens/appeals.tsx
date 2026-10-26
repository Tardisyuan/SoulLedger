/**
 * 审判申诉 (Design 第五十二批 A-1 ~ A-4).
 *
 *   A-1 每件已结案审判卡片底部一行(`AppealLine`):能申诉写截止日 +「申诉 ›」;不能写原因;申诉过的多一行
 *       「第 N 次申诉 · 状态」,点开看各轮。
 *   A-2 整页表单(`JudgmentAppealScreen`):理由 2000 字,新证据选填;有未提交内容时离开先确认。
 *   A-3 各轮:新的一轮在上;复核意见是人写的话,用 `Quote`(serif);不写复核人;待复核 / 复核中可撤回。
 *   A-4 推送落地(`focused`):自动展开最新一轮,改判时写「原判 → 新判」与补偿各站。
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
import { appealsLeftAfterWithdraw } from "@soulledger/core/domain/appeals";
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
      const m = soulErrorMessage(error);
      toast(t(m.key, m.params), "failure");
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
      {OPEN.includes(round.status) ? (
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
        {row.can_appeal ? (
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
          <Txt variant="body" style={styles.fill}>
            {`${t("appeals.round", { round: String(latest.round) })} · ${t(`appeals.status.${latest.status}`)}`}
          </Txt>
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

export type JudgmentAppealParams = { judgment: string; caseNumber: string; verdict: string; deadline: string };

/** A-2: the form, a whole page — a 2000-character reason does not fit a sheet with the keyboard up. */
export function JudgmentAppealScreen() {
  const { t } = useI18n();
  const toast = useToast();
  const { gutter } = useLayout();
  const verdict = useVerdict();
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
    if (!reason.trim()) return setMissing(true);
    setBusy(true);
    setError(null);
    try {
      await soulApi.fileJudgmentAppeal(params.judgment, reason.trim(), evidence.trim());
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
        </DataRows>
        <View>
          <Input
            testID="appeal-reason"
            label={t("appeals.reason_label")}
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
          {t("appeals.file_body")}
        </Txt>
        <Txt variant="caption" tone="subtle">
          {t("appeals.deadline", { date: appealDay(params.deadline) })}
        </Txt>
        {error ? <FieldError testID="appeal-error" text={error} /> : null}
        <Button testID="appeal-submit" title={t("appeals.submit")} busy={busy} onPress={() => void submit()} />
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
});
