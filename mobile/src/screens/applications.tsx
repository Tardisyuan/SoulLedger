import {
  DESIRED_REBIRTH_FORMS,
  rejectionReasonOf,
  soulApi,
  soulCodeMessage,
  soulErrorMessage,
  type DesiredRebirthForm,
  type MeRebirthApplicationList,
  type SoulErrorMessage,
} from "@soulledger/core/api/soul";
import { useNavigation, type NavigationProp } from "@react-navigation/native";
import { useCallback, useState } from "react";
import { View } from "react-native";

import { formatDateTime, useI18n } from "../i18n";
import { Body, Button, Card, EnumText, ErrorText, Failure, Field, Heading, Input, Loading, Screen, useReloadOnRefocus, useRemote } from "../ui";

export type AppStackParams = {
  Tabs: undefined;
  NewApplication: undefined;
  ApplicationDetail: { id: string };
};

/**
 * Whether the "apply" entry is offered. The server decides (`can_apply`), and
 * a refusal is always explained — the reason code, and the cooling-off end
 * date when there is one — rather than a button that silently does nothing.
 */
export function EligibilityCard({ list, onApply }: { list: MeRebirthApplicationList; onApply: () => void }) {
  const { t, locale } = useI18n();
  const until = formatDateTime(list.cooldown_until, locale);
  const reason = list.reason ? soulCodeMessage(list.reason) : null;
  return (
    <Card testID="eligibility">
      {list.can_apply ? null : (
        <>
          <Body>{t("soul_app.applications.cannot_apply")}</Body>
          {/* A reason, not a failure: muted text, not the error colour. */}
          {reason ? <Body muted testID="eligibility-reason">{t(reason.key, reason.params)}</Body> : null}
          {until ? <Body muted>{t("soul_app.applications.cooldown_until", { date: until })}</Body> : null}
        </>
      )}
      <Button testID="apply" title={t("soul_app.applications.new")} onPress={onApply} disabled={!list.can_apply} />
    </Card>
  );
}

export function ApplicationsScreen() {
  const { t, locale } = useI18n();
  const navigation = useNavigation<NavigationProp<AppStackParams>>();
  const list = useRemote(soulApi.applications);
  useReloadOnRefocus(list.reload);
  return (
    <Screen refreshing={list.loading} onRefresh={list.reload}>
      {list.error ? (
        <Failure error={soulErrorMessage(list.error)} onRetry={list.reload} />
      ) : !list.data ? (
        <Loading />
      ) : (
        <>
          <EligibilityCard list={list.data} onApply={() => navigation.navigate("NewApplication")} />
          {list.data.results.length === 0 ? <Body muted>{t("soul_app.applications.empty")}</Body> : null}
          {list.data.results.map((a) => (
            <Card key={a.id}>
              <Body>
                <EnumText namespace="reincarnation.forms" value={a.desired_form} /> ·{" "}
                <EnumText namespace="soul_app.status" value={a.status} />
              </Body>
              <Body muted>{t("soul_app.applications.created_at", { date: formatDateTime(a.created_at, locale) ?? "" })}</Body>
              <Button
                kind="secondary"
                testID={`open-${a.id}`}
                title={t("soul_app.applications.view")}
                onPress={() => navigation.navigate("ApplicationDetail", { id: a.id })}
              />
            </Card>
          ))}
        </>
      )}
    </Screen>
  );
}

export function NewApplicationScreen() {
  const { t } = useI18n();
  const navigation = useNavigation<NavigationProp<AppStackParams>>();
  const [form, setForm] = useState<DesiredRebirthForm | null>(null);
  const [statement, setStatement] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SoulErrorMessage | null>(null);

  const submit = async () => {
    if (!form) return setError({ key: "soul_app.applications.choose_form" });
    setBusy(true);
    setError(null);
    try {
      const created = await soulApi.submitApplication(form, statement);
      navigation.goBack();
      navigation.navigate("ApplicationDetail", { id: created.id });
    } catch (e) {
      setError(soulErrorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Card>
        <Heading>{t("soul_app.applications.desired_form")}</Heading>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {DESIRED_REBIRTH_FORMS.map((f) => (
            <View key={f} style={{ minWidth: "30%", flexGrow: 1 }}>
              <Button
                testID={`form-${f}`}
                kind={form === f ? "primary" : "secondary"}
                title={t(`reincarnation.forms.${f}`)}
                onPress={() => setForm(f)}
              />
            </View>
          ))}
        </View>
        <Input
          testID="statement"
          label={t("soul_app.applications.statement")}
          value={statement}
          onChangeText={setStatement}
          multiline
          maxLength={2000}
          style={{ minHeight: 96, textAlignVertical: "top" }}
        />
        <ErrorText testID="new-application-error" error={error} />
        <Button
          testID="submit-application"
          title={t(busy ? "soul_app.applications.submitting" : "soul_app.applications.submit")}
          onPress={submit}
          disabled={busy}
        />
      </Card>
    </Screen>
  );
}

export function ApplicationDetailScreen({ id }: { id: string }) {
  const { t, locale } = useI18n();
  const fetcher = useCallback(() => soulApi.application(id), [id]);
  const app = useRemote(fetcher);
  const [appeal, setAppeal] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SoulErrorMessage | null>(null);

  if (app.error) return <Screen><Failure error={soulErrorMessage(app.error)} onRetry={app.reload} /></Screen>;
  if (!app.data) return <Screen><Loading /></Screen>;
  const a = app.data;
  const reason = rejectionReasonOf(a);
  const unrecorded = t("common.value.unrecorded");

  const submitAppeal = async () => {
    setBusy(true);
    setError(null);
    try {
      await soulApi.appeal(a.id, appeal);
      setAppeal("");
      await app.reload();
    } catch (e) {
      setError(soulErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen refreshing={app.loading} onRefresh={app.reload}>
      <Card testID="application-detail">
        <Field label={t("soul_app.detail.status")}>
          <EnumText namespace="soul_app.status" value={a.status} />
        </Field>
        <Field label={t("soul_app.detail.desired_form")}>
          <EnumText namespace="reincarnation.forms" value={a.desired_form} />
        </Field>
        {a.statement ? <Field label={t("soul_app.detail.statement")}>{a.statement}</Field> : null}
        {a.current_step ? (
          <Field label={t("soul_app.detail.current_step")}>
            <EnumText namespace="workflow.node_type" value={a.current_step.node_type} /> ·{" "}
            <EnumText namespace="users.roles" value={a.current_step.approver_role} />
            {a.current_step.is_appeal ? ` · ${t("soul_app.detail.appeal_round")}` : ""}
          </Field>
        ) : null}
        <Field label={t("soul_app.detail.cross_civilization")}>
          {a.cross_civilization === null || a.cross_civilization === undefined
            ? t("soul_app.detail.cross_undecided")
            : t(a.cross_civilization ? "soul_app.detail.cross_yes" : "soul_app.detail.cross_no")}
        </Field>
        {a.decided_at ? <Field label={t("soul_app.detail.decided_at")}>{formatDateTime(a.decided_at, locale) ?? unrecorded}</Field> : null}
        {reason ? <Field label={t("soul_app.detail.rejection_reason")}>{reason}</Field> : null}
        {a.appeal_statement ? <Field label={t("soul_app.detail.appeal_statement")}>{a.appeal_statement}</Field> : null}
      </Card>
      {a.can_appeal ? (
        <Card testID="appeal">
          <Heading>{t("soul_app.detail.appeal")}</Heading>
          <Body muted>{t("soul_app.detail.appeal_hint")}</Body>
          <Input
            testID="appeal-statement"
            label={t("soul_app.detail.appeal_statement")}
            value={appeal}
            onChangeText={setAppeal}
            multiline
            maxLength={2000}
            style={{ minHeight: 96, textAlignVertical: "top" }}
          />
          <ErrorText error={error} />
          <Button testID="submit-appeal" title={t("soul_app.detail.appeal_submit")} onPress={submitAppeal} disabled={busy} />
        </Card>
      ) : null}
    </Screen>
  );
}
