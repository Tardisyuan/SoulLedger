/**
 * The decision sheets (spec §四): approve, reject and add-signer, as bottom sheets.
 *
 * Reject: the reason is required and the field is flagged only when 「确认驳回」 is pressed -- the
 * button is never disabled beforehand. The confirmation is ink-solid, not the hall's colour. A
 * failure puts a Notice inside the sheet and KEEPS what was typed.
 */
import { cosignRefusalOf, officerAppApi, type SignerCandidate, type TodoItemDetail, type TodoKind } from "@soulledger/core/api/officer-app";
import { useCallback, useEffect, useState } from "react";
import { Share, View } from "react-native";

import { decisionAllowed, useBioWord } from "../deviceCheck";
import { ActionButton, Row, Segmented } from "../kit";
import {
  decisionFailure,
  deskUrl,
  failureReasonKey,
  hallLabel,
  passVerdictsOf,
  reasonMissing,
  rebirthCross,
  submitDecision,
  todoTitle,
  type FailureReason,
  type Verdict,
} from "../rules";
import { effectLine, objectLines } from "../todoFacts";
import { Button, FieldError, Input, Notice, Sheet, SmallButton, Txt, space, useI18n, useRemote, useTheme, useToast } from "../shared";
import { PEOPLE_SHOWN } from "./letterActions";

/** How long the 加签 search waits after the last keystroke before it asks the server. */
const SEARCH_PAUSE_MS = 300;

export interface CooldownFacts {
  reason: string;
  remainingDays: number;
  /** APPROVED: `remainingDays` is then the cooldown left now, with the approval applied. */
  approved: boolean;
  /** What the soul hopes remains after approval; pre-fills the days field. */
  desiredDays: number | null;
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
  const bio = useBioWord();
  const theme = useTheme();
  const toast = useToast();
  // O-b: a rebirth's first review says 「不跨」 on the sheet and on the button; one already set to cross is the desk's.
  const cross = verdict === "approve" ? rebirthCross(detail) : null;
  const toDesk = () => void Share.share({ message: deskUrl({ kind: "rebirth", id: detail.id }) }).catch(() => {});
  const [reason, setReason] = useState("");
  // The soul's wish pre-fills the days (editable, same rules); with none the field starts empty as before.
  const [days, setDays] = useState(cooldown?.desiredDays != null ? String(cooldown.desiredDays) : "");
  const [flagged, setFlagged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<FailureReason | null>(null);
  // The phone's own check was cancelled or did not recognise the officer: nothing was sent.
  const [unrecognised, setUnrecognised] = useState(false);
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

  const hall = (h: { code: string; display_name: string } | null | undefined) => hallLabel(t, h) ?? "";
  const effect = effectLine(detail, verdict, hall, parsedDays ?? cooldown?.desiredDays ?? null);
  const [objectTop, objectBottom] = objectLines({ ...detail, title: todoTitle(detail, t) }, hall, t);

  const confirm = () => {
    if (missingReason || daysInvalid) {
      setFlagged(true);
      return;
    }
    setBusy(true);
    setFailure(null);
    setUnrecognised(false);
    decisionAllowed()
      .then((allowed) => {
        if (!allowed) {
          setUnrecognised(true);
          return;
        }
        return submitDecision({ detail, verdict, reason, days: parsedDays ?? undefined, passVerdict: verdict === "approve" ? chosenPass : undefined }).then(() => {
          // O-f: an approved dispatch has not moved the soul yet -- the receiving hall executes it on the desk.
          if (detail.kind === "reassignment" && verdict === "approve") toast(t("officer_app.dispatch.approved_next"), "success");
          onDone();
          onClose();
        });
      })
      .catch((e: unknown) => setFailure(decisionFailure(e).reason))
      .finally(() => setBusy(false));
  };

  return (
    <Sheet open={open} onClose={onClose} edge={theme.hair} closeLabel={t("soul_app.common.cancel")}>
      <View testID={`sheet-${verdict}`} style={{ padding: space[5], gap: space[4] }}>
        <Txt variant="title">{t(verdict === "approve" ? "officer_app.confirm.approve_title" : "officer_app.confirm.reject_title")}</Txt>
        {cross === "no" ? (
          // Written first, above the object: approving here settles it for good.
          <View testID="decision-cross" style={{ gap: space[1] }}>
            <Txt variant="bodyLg">{t("officer_app.rebirth.cross_civ_none")}</Txt>
            <Txt variant="body" tone="muted">{t("officer_app.rebirth.cross_civ_body")}</Txt>
          </View>
        ) : cross === "desk" ? (
          <Txt variant="body" testID="decision-cross-wanted">{t("officer_app.rebirth.cross_wanted")}</Txt>
        ) : null}
        {/* 对象: a bordered block (what, then who asked). 后果: one sentence under it. */}
        <View testID="decision-object" style={{ borderWidth: 1, borderColor: theme.hair, padding: space[3], gap: space[1] }}>
          <Txt variant="bodyLg">{objectTop}</Txt>
          {objectBottom ? <Txt variant="caption" tone="muted">{objectBottom}</Txt> : null}
        </View>
        <Txt variant="body" tone="muted" testID="decision-effect">
          {effect
            ? t(`officer_app.confirm.${effect.key}`, effect.values)
            : verdict === "approve"
              ? t(`officer_app.confirm.approve_body.${detail.kind}`)
              : t("officer_app.confirm.reject_body", { name: t("officer_app.confirm.requester") })}
        </Txt>
        {cooldown && detail.kind === "cooldown" ? (
          <Txt variant="caption" tone="muted">{`${cooldown.reason} · ${t("officer_app.confirm.remaining_days", { n: String(cooldown.remainingDays) })}`}</Txt>
        ) : null}
        {verdict === "approve" && cooldown && cooldown.desiredDays != null ? (
          <Txt variant="caption" tone="muted" testID="decision-desired">{t("officer_app.confirm.desired", { n: String(cooldown.desiredDays) })}</Txt>
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
            error={flagged && daysInvalid ? t("officer_app.confirm.days_invalid") : null}
          />
        ) : null}
        {verdict === "reject" ? (
          <Input
            testID="decision-reason"
            label={t("officer_app.confirm.reason_label")}
            multiline
            value={reason}
            onChangeText={setReason}
            error={flagged && missingReason ? t("officer_app.confirm.reason_required") : null}
          />
        ) : null}
        {failure ? <Notice tone="neg" testID="decision-failure">{t("officer_app.confirm.failed", { reason: t(failureReasonKey(failure)) })}</Notice> : null}
        {unrecognised ? <Notice tone="neg" testID="decision-unrecognised">{t(verdict === "approve" ? "officer_app.biometric.failed" : "officer_app.biometric.failed_reject", { bio: bio.start })}</Notice> : null}
        {cross === "desk" ? (
          // No approval on the phone: approving would turn down the wish for another civilization.
          <View style={{ flexDirection: "row", gap: space[3] }}>
            <ActionButton testID="decision-cancel" kind="outline" title={t("soul_app.common.cancel")} onPress={onClose} />
            <ActionButton testID="decision-desk" kind="primary" title={t("officer_app.continue_on_desk")} onPress={toDesk} />
          </View>
        ) : (
          <View style={{ flexDirection: "row", gap: space[3] }}>
            {cross === "no" ? (
              <ActionButton testID="decision-desk" kind="outline" title={t("officer_app.rebirth.decide_on_desk")} onPress={toDesk} />
            ) : (
              <ActionButton testID="decision-cancel" kind="outline" title={t("soul_app.common.cancel")} onPress={onClose} />
            )}
            <ActionButton
              testID="decision-confirm"
              kind={verdict === "approve" ? "primary" : "ink"}
              busy={busy}
              title={t(cross === "no" ? "officer_app.rebirth.approve_no_cross" : verdict === "approve" ? "officer_app.confirm.approve_ok" : "officer_app.confirm.reject_ok")}
              onPress={confirm}
            />
          </View>
        )}
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
  const { t, enumLabel } = useI18n();
  const theme = useTheme();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // The search asks the server: once the typing pauses, not on every character.
  const [asked, setAsked] = useState("");
  useEffect(() => {
    if (q === asked) return;
    const timer = setTimeout(() => setAsked(q), SEARCH_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [q, asked]);
  const [all, setAll] = useState(false);
  const load = useRemote<SignerCandidate[]>(useCandidates(asked, open));
  const people = load.data ?? [];

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
          <Txt variant="caption" tone="muted" testID="cosign-rules">{t("officer_app.cosign.rules")}</Txt>
          <Input testID="cosign-search" label={t("officer_app.cosign.search")} value={q} onChangeText={setQ} />
          {load.error ? <FieldError text={t("officer_app.state.error_title")} /> : null}
        </View>
        {people.length === 0 && !load.loading && !load.error ? (
          <Txt variant="caption" tone="muted" style={{ paddingHorizontal: space[5] }}>
            {t("officer_app.cosign.empty")}
          </Txt>
        ) : null}
        {(all ? people : people.slice(0, PEOPLE_SHOWN)).map((person) => (
          <Row
            key={person.id}
            testID={`cosign-${person.id}`}
            minHeight={56}
            strong={picked === person.id}
            title={person.name || person.username}
            lines={[{ one: `${person.username} · ${roleLabel(enumLabel, person.role)}` }]}
            right={<Txt variant="nav">{picked === person.id ? "✓" : "○"}</Txt>}
            onPress={() => setPicked(person.id)}
          />
        ))}
        {!all && people.length > PEOPLE_SHOWN ? (
          <View style={{ paddingHorizontal: space[5], alignItems: "flex-start" }}>
            <SmallButton testID="cosign-more" title={t("officer_app.cosign.more", { n: String(people.length - PEOPLE_SHOWN) })} onPress={() => setAll(true)} />
          </View>
        ) : null}
        <View style={{ paddingHorizontal: space[5], gap: space[3] }}>
          {problem ? <Notice tone="neg" testID="cosign-problem">{problem}</Notice> : null}
          {unavailable ? (
            // 14j: the reason is the line right above the button; no promise, no date.
            <Txt variant="caption" tone="muted" testID="cosign-unavailable">{`◇ ${t("officer_app.cosign.unavailable")}`}</Txt>
          ) : null}
          <Button
            testID="cosign-confirm"
            title={t("officer_app.cosign.confirm")}
            busy={busy}
            disabled={unavailable}
            accessibilityHint={unavailable ? t("officer_app.cosign.unavailable") : undefined}
            onPress={confirm}
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

/** A role code through the bundles (审判者), the raw code only when the bundles do not know it. */
function roleLabel(enumLabel: ReturnType<typeof useI18n>["enumLabel"], role: string | null | undefined): string {
  const d = enumLabel("users.roles", role);
  return d.state === "known" ? d.label : (role ?? "");
}
