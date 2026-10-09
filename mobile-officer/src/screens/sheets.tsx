/**
 * The decision sheets (spec §四): approve, reject and add-signer, as bottom sheets.
 *
 * Reject: the reason is required and the field is flagged only when 「确认驳回」 is pressed -- the
 * button is never disabled beforehand. The confirmation is ink-solid, not the hall's colour. A
 * failure puts a Notice inside the sheet and KEEPS what was typed.
 */
import { cosignRefusalOf, officerAppApi, type SignerCandidate, type TodoItemDetail, type TodoKind } from "@soulledger/core/api/officer-app";
import { useCallback, useState } from "react";
import { View } from "react-native";

import { ActionButton, Row, Segmented } from "../kit";
import { decisionFailure, failureReasonKey, passVerdictsOf, reasonMissing, submitDecision, type FailureReason, type Verdict } from "../rules";
import { Button, FieldError, Input, Notice, Sheet, Txt, space, useI18n, useRemote, useTheme, useToast } from "../shared";

export interface CooldownFacts {
  reason: string;
  remainingDays: number;
}

export function DecisionSheet({
  open,
  verdict,
  detail,
  cooldown,
  onClose,
  onDone,
}: {
  open: boolean;
  verdict: Verdict;
  detail: TodoItemDetail;
  /** For a cooldown-shortening item: what the soul asked and how many days remain. */
  cooldown: CooldownFacts | null;
  onClose: () => void;
  /** The server accepted it. The caller reloads the item and the list. */
  onDone: () => void;
}) {
  const { t } = useI18n();
  const theme = useTheme();
  const [reason, setReason] = useState("");
  const [days, setDays] = useState("");
  const [flagged, setFlagged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<FailureReason | null>(null);
  // A node that accepts several passing verdicts asks which one; with one, it is sent as is.
  const passChoices = detail.kind === "approval" || detail.kind === "rebirth" ? passVerdictsOf(detail) : [];
  const [passVerdict, setPassVerdict] = useState<string | null>(null);
  const chosenPass = passVerdict ?? passChoices[0];

  // A sheet opened again starts clean because the caller gives it a new `key` per opening; a failed
  // submit never resets anything, so the reason typed stays.

  const needsDays = detail.kind === "cooldown" && verdict === "approve";
  const parsedDays = /^\d+$/.test(days.trim()) ? Number(days.trim()) : null;
  const daysInvalid = needsDays && (parsedDays === null || (cooldown !== null && parsedDays >= cooldown.remainingDays));
  const missingReason = reasonMissing(verdict, reason);

  const confirm = () => {
    if (missingReason || daysInvalid) {
      setFlagged(true);
      return;
    }
    setBusy(true);
    setFailure(null);
    submitDecision({ detail, verdict, reason, days: parsedDays ?? undefined, passVerdict: verdict === "approve" ? chosenPass : undefined })
      .then(() => {
        onDone();
        onClose();
      })
      .catch((e: unknown) => setFailure(decisionFailure(e).reason))
      .finally(() => setBusy(false));
  };

  return (
    <Sheet open={open} onClose={onClose} edge={theme.hair} closeLabel={t("soul_app.common.cancel")}>
      <View testID={`sheet-${verdict}`} style={{ padding: space[5], gap: space[4] }}>
        <Txt variant="title">{t(verdict === "approve" ? "officer_app.confirm.approve_title" : "officer_app.confirm.reject_title")}</Txt>
        <Txt variant="bodyLg">{detail.title}</Txt>
        <Txt variant="body" tone="muted">
          {verdict === "approve"
            ? t(`officer_app.confirm.approve_body.${detail.kind}`)
            : t("officer_app.confirm.reject_body", { name: t("officer_app.confirm.requester") })}
        </Txt>
        {cooldown && detail.kind === "cooldown" ? (
          <Txt variant="caption" tone="muted">{`${cooldown.reason} · ${t("officer_app.confirm.remaining_days", { n: String(cooldown.remainingDays) })}`}</Txt>
        ) : null}
        {verdict === "approve" && passChoices.length > 1 ? (
          <View style={{ gap: space[2] }}>
            <Txt variant="caption" tone="muted">{t("officer_app.confirm.verdict_label")}</Txt>
            <Segmented
              testID="decision-verdict"
              value={chosenPass}
              onChange={setPassVerdict}
              options={passChoices.map((key) => ({ key, label: t(`workflow.verdicts.${key.toLowerCase()}`) }))}
            />
          </View>
        ) : null}
        {needsDays ? (
          <Input
            testID="decision-days"
            label={t("officer_app.confirm.days_label")}
            keyboardType="number-pad"
            value={days}
            onChangeText={setDays}
            error={flagged && daysInvalid ? `! ${t("officer_app.confirm.days_invalid")}` : null}
          />
        ) : null}
        {verdict === "reject" ? (
          <Input
            testID="decision-reason"
            label={t("officer_app.confirm.reason_label")}
            multiline
            value={reason}
            onChangeText={setReason}
            error={flagged && missingReason ? `! ${t("officer_app.confirm.reason_required")}` : null}
          />
        ) : null}
        {failure ? <Notice tone="neg" testID="decision-failure">{`! ${t("officer_app.confirm.failed", { reason: t(failureReasonKey(failure)) })}`}</Notice> : null}
        <View style={{ flexDirection: "row", gap: space[3] }}>
          <ActionButton testID="decision-cancel" kind="outline" title={t("soul_app.common.cancel")} onPress={onClose} />
          <ActionButton
            testID="decision-confirm"
            kind={verdict === "approve" ? "primary" : "ink"}
            busy={busy}
            title={t(verdict === "approve" ? "officer_app.confirm.approve_ok" : "officer_app.confirm.reject_ok")}
            onPress={confirm}
          />
        </View>
      </View>
    </Sheet>
  );
}

/**
 * 加签: pick a colleague IN THIS HALL (`signer-candidates/` only returns the hall's people) and add
 * them to the current node. When the server says adding is not possible right now (403
 * `not_allowed`: not your node, already handled...) the confirm turns into the disabled state of
 * spec 14j -- the candidates stay choosable, the reason sits above the button. Cross-hall signing
 * stays at the desk.
 */
export function CosignSheet({
  open,
  kind,
  id,
  onClose,
  onDone,
}: {
  open: boolean;
  kind: TodoKind;
  id: string;
  onClose: () => void;
  /** The server added the signer. The caller reloads the item. */
  onDone: () => void;
}) {
  const { t } = useI18n();
  const theme = useTheme();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const load = useRemote<SignerCandidate[]>(useCandidates(q, open));

  const confirm = () => {
    if (picked === null) return;
    setBusy(true);
    setProblem(null);
    officerAppApi
      .addCosigner(kind, id, picked)
      .then(() => {
        toast(t("officer_app.cosign.added"), "success");
        onDone();
        onClose();
      })
      .catch((e: unknown) => {
        const refusal = cosignRefusalOf(e);
        if (refusal === "not_allowed") setUnavailable(true);
        else if (refusal) setProblem(t(`officer_app.cosign.${refusal}`));
        else setProblem(t("officer_app.confirm.failed", { reason: t(failureReasonKey(decisionFailure(e).reason)) }));
      })
      .finally(() => setBusy(false));
  };

  return (
    <Sheet open={open} onClose={onClose} edge={theme.hair} closeLabel={t("soul_app.common.cancel")}>
      <View testID="sheet-cosign" style={{ paddingVertical: space[5], gap: space[4] }}>
        <View style={{ paddingHorizontal: space[5], gap: space[3] }}>
          <Txt variant="title">{t("officer_app.detail.cosign")}</Txt>
          <Input testID="cosign-search" label={t("officer_app.cosign.search")} value={q} onChangeText={setQ} />
          {load.error ? <FieldError text={t("officer_app.state.error_title")} /> : null}
        </View>
        {(load.data ?? []).length === 0 && !load.loading && !load.error ? (
          <Txt variant="caption" tone="muted" style={{ paddingHorizontal: space[5] }}>
            {t("officer_app.cosign.empty")}
          </Txt>
        ) : null}
        {(load.data ?? []).slice(0, 6).map((person) => (
          <Row
            key={person.id}
            testID={`cosign-${person.id}`}
            minHeight={56}
            strong={picked === person.id}
            title={person.name || person.username}
            lines={[`${person.username} · ${person.role}`]}
            right={<Txt variant="nav">{picked === person.id ? "✓" : "○"}</Txt>}
            onPress={() => setPicked(person.id)}
          />
        ))}
        <View style={{ paddingHorizontal: space[5], gap: space[3] }}>
          {problem ? <Notice tone="neg" testID="cosign-problem">{`! ${problem}`}</Notice> : null}
          {unavailable ? (
            // 14j: the reason is the line right above the button; no promise, no date.
            <Txt variant="caption" tone="muted" testID="cosign-unavailable">{`◇ ${t("officer_app.cosign.unavailable")}`}</Txt>
          ) : null}
          <Button testID="cosign-confirm" title={t("officer_app.cosign.confirm")} busy={busy} disabled={unavailable} onPress={confirm} />
        </View>
      </View>
    </Sheet>
  );
}

function useCandidates(q: string, open: boolean) {
  return useCallback(
    () => (open ? officerAppApi.signerCandidates(q.trim() || undefined).then((r) => r.data) : Promise.resolve([] as SignerCandidate[])),
    [q, open]
  );
}
