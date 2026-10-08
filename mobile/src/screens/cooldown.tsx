import { soulApi, soulErrorMessage, type MeRebirthApplicationList, type SoulErrorMessage } from "@soulledger/core/api/soul";
import { useState } from "react";
import { StyleSheet, View } from "react-native";

import { useToast } from "../feedback";
import { useI18n } from "../i18n";
import { formatStamp } from "../rules";
import { Button, Input, Interp, Notice, SectionLabel, Txt } from "../ui";

/**
 * 「申请缩短冷却」: under the cooling-off line of the applications page. The server
 * says whether the entry is offered (`can_shorten_cooldown` — once per cooldown, like
 * the appeal) and carries the latest request (`cooldown_shortening`), whose status is
 * shown here: pending, approved (the new end date is the list's `cooldown_until`), or
 * rejected with the officer's note. The form is the appeal block's shape: one
 * statement input, one submit.
 */
export function CooldownShorteningBlock({ list, onChanged }: { list: MeRebirthApplicationList; onChanged: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SoulErrorMessage | null>(null);
  const row = list.cooldown_shortening;

  const submit = async () => {
    if (!reason.trim()) return setError({ key: "soul_app.errors.validation" });
    setBusy(true);
    setError(null);
    try {
      await soulApi.requestCooldownShortening(reason);
      toast(t("soul_app.cooldown.submitted"));
      setOpen(false);
      onChanged();
    } catch (e) {
      setError(soulErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View testID="cooldown-shortening" style={styles.block}>
      {row?.status === "PENDING" ? (
        <Txt testID="cooldown-shortening-status" variant="caption" tone="muted">
          {t("soul_app.cooldown.pending")}
        </Txt>
      ) : null}
      {row?.status === "APPROVED" ? (
        <Interp
          testID="cooldown-shortening-status"
          variant="caption"
          tone="muted"
          text={t("soul_app.cooldown.approved")}
          parts={{ date: <Txt variant="value" tone="muted">{formatStamp(list.cooldown_until) ?? ""}</Txt> }}
        />
      ) : null}
      {row?.status === "REJECTED" ? (
        <View style={styles.rejected}>
          <Txt testID="cooldown-shortening-status" variant="caption" tone="muted">
            {t("soul_app.cooldown.rejected")}
          </Txt>
          {row.decision_note ? (
            <Txt testID="cooldown-shortening-note" variant="caption" tone="subtle">
              {t("soul_app.cooldown.note")}: {row.decision_note}
            </Txt>
          ) : null}
        </View>
      ) : null}
      {list.can_shorten_cooldown && !open ? (
        <Button testID="request-cooldown-shortening" kind="secondary" title={t("soul_app.cooldown.request")} onPress={() => setOpen(true)} />
      ) : null}
      {list.can_shorten_cooldown && open ? (
        <View style={styles.form}>
          <View>
            <SectionLabel>{t("soul_app.cooldown.request")}</SectionLabel>
            <Txt variant="caption" tone="subtle" style={styles.hint}>
              {t("soul_app.cooldown.hint")}
            </Txt>
          </View>
          <Input testID="cooldown-shortening-reason" label={t("soul_app.cooldown.reason")} value={reason} onChangeText={setReason} multiline maxLength={2000} />
          {error ? <Notice tone="neg">{t(error.key, error.params)}</Notice> : null}
          <Button
            testID="submit-cooldown-shortening"
            title={t(busy ? "soul_app.applications.submitting" : "soul_app.cooldown.submit")}
            onPress={submit}
            busy={busy}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { marginTop: 12, gap: 12 },
  rejected: { gap: 4 },
  form: { gap: 16 },
  hint: { marginTop: 8 },
});
