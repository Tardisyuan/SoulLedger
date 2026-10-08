/**
 * The decision sheets (spec §四): approve, reject and add-signer, as bottom sheets.
 *
 * Reject: the reason is required and the field is flagged only when 「确认驳回」 is pressed -- the
 * button is never disabled beforehand. The confirmation is ink-solid, not the hall's colour. A
 * failure puts a Notice inside the sheet and KEEPS what was typed.
 */
import { officerAppApi, type SignerCandidate, type TodoItemDetail } from "@soulledger/core/api/officer-app";
import { useCallback, useState } from "react";
import { View } from "react-native";

import { ActionButton, Row } from "../kit";
import { decisionFailure, failureReasonKey, reasonMissing, submitDecision, type FailureReason, type Verdict } from "../rules";
import { Button, FieldError, Input, Notice, Sheet, Txt, space, useI18n, useRemote, useTheme } from "../shared";

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
    submitDecision({ detail, verdict, reason, days: parsedDays ?? undefined })
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
 * 加签: pick a colleague IN THIS HALL (`signer-candidates/` only returns the hall's people).
 * TODO(server): there is no endpoint that adds the signer yet -- the candidates exist, the action
 * does not -- so the confirm button is disabled and says why. Cross-hall signing stays at the desk.
 */
export function CosignSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const theme = useTheme();
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<number | null>(null);
  const load = useRemote<SignerCandidate[]>(useCandidates(q, open));
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
        <View style={{ paddingHorizontal: space[5] }}>
          <Button
            testID="cosign-confirm"
            title={t("officer_app.cosign.confirm")}
            disabled
            reason={t("officer_app.cosign.no_endpoint")}
            onPress={() => {}}
          />
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
