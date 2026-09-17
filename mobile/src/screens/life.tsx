import { LOCALE_LABELS, SUPPORTED_LOCALES } from "@soulledger/core/config/locale";
import { soulApi, soulErrorMessage, type MeLife } from "@soulledger/core/api/soul";
import { formatHistoricalDate } from "@soulledger/core/domain/dates";
import type { Locale } from "@soulledger/core/config/locale";
import type { ReactNode } from "react";
import { View } from "react-native";

import { formatDateTime, useI18n } from "../i18n";
import { useSession } from "../session";
import { Body, Button, Card, EnumText, Failure, Field, Heading, Loading, Screen, enumText, useReloadOnRefocus, useRemote } from "../ui";

function realmName(realm: { name_zh: string; name_en: string; name_local: string }, locale: Locale): string {
  return (locale === "zh-Hans" ? realm.name_zh : realm.name_en) || realm.name_local;
}

function Section({ title, empty, children }: { title: string; empty: string; children: ReactNode[] }) {
  return (
    <Card>
      <Heading>{title}</Heading>
      {children.length ? children : <Body muted>{empty}</Body>}
    </Card>
  );
}

/**
 * One life's record. Deliberately has NO actions: it renders the current life
 * and past lives alike, and a past life is read-only. Submitting and appealing
 * live on the applications tab, which only ever loads the current life.
 */
export function LifeSections({ life }: { life: MeLife }) {
  const { t, locale } = useI18n();
  const unrecorded = t("common.value.unrecorded");
  return (
    <View style={{ gap: 12 }}>
      <Section title={t("soul_app.life.records")} empty={t("soul_app.life.no_records")}>
        {life.records.map((r) => (
          <View key={r.id}>
            <Body>
              {t(r.record_type === "DEMERIT" ? "soul_app.life.demerit_entry" : "soul_app.life.merit_entry")} ·{" "}
              <EnumText namespace="souls.categories" value={r.category} /> · {r.weight}
              {r.is_milestone ? ` · ${t("soul_app.life.milestone")}` : ""}
            </Body>
            <Body muted>{r.description}</Body>
            <Body muted>{formatHistoricalDate(r.event_date, locale) ?? unrecorded}</Body>
          </View>
        ))}
      </Section>
      <Section title={t("soul_app.life.judgments")} empty={t("soul_app.life.no_judgments")}>
        {life.judgments.map((j) => (
          <View key={j.id}>
            <Body>
              {j.court || unrecorded}
              {j.is_final ? ` · ${t("soul_app.life.final")}` : ""}
            </Body>
            <Body muted>
              {t("soul_app.life.judge")}: {j.judge ? (locale === "zh-Hans" ? j.judge.name_zh || j.judge.name : j.judge.name) : unrecorded}
            </Body>
            <Body>
              {j.verdict ? <EnumText namespace="judgment.verdicts" value={j.verdict} /> : t("soul_app.life.verdict_pending")}
            </Body>
          </View>
        ))}
      </Section>
      <Section title={t("soul_app.life.dispositions")} empty={t("soul_app.life.no_dispositions")}>
        {life.dispositions.map((d) => (
          <View key={d.id}>
            <Body>{d.destination_realm ? realmName(d.destination_realm, locale) : unrecorded}</Body>
            <Body muted>
              {d.is_eternal
                ? t("soul_app.life.eternal")
                : d.sentence_years !== null
                  ? t("soul_app.life.sentence_years", { years: String(d.sentence_years) })
                  : unrecorded}
              {" · "}
              {t(d.is_executed ? "soul_app.life.executed" : "soul_app.life.not_executed")}
            </Body>
          </View>
        ))}
      </Section>
      <Section title={t("soul_app.life.applications")} empty={t("soul_app.life.no_applications")}>
        {life.rebirth_applications.map((a) => (
          <View key={a.id} style={{ gap: 6 }}>
            <Body>
              <EnumText namespace="reincarnation.forms" value={a.desired_form} /> ·{" "}
              <EnumText namespace="soul_app.status" value={a.status} />
            </Body>
            <Body muted>{t("soul_app.applications.created_at", { date: formatDateTime(a.created_at, locale) ?? "" })}</Body>
          </View>
        ))}
      </Section>
    </View>
  );
}

export function MyLifeScreen() {
  const { t, locale, setLocale } = useI18n();
  const { state, signOut, refreshProfile } = useSession();
  const life = useRemote(soulApi.life);
  useReloadOnRefocus(life.reload);
  if (state.status !== "signedIn") return null;
  const me = state.profile;

  const refresh = () => {
    void life.reload();
    refreshProfile().catch(() => {});
  };

  return (
    <Screen refreshing={life.loading} onRefresh={refresh}>
      <Card testID="profile-card">
        <Heading>
          {me.name} · {t("soul_app.life.cycle", { cycle: String(me.account.cycle + 1) })}
        </Heading>
        <Field label={t("soul_app.life.soul_code")}>{me.soul_code}</Field>
        <Field label={t("soul_app.life.civilization")}>
          <EnumText namespace="souls.civilizations" value={me.civilization} />
        </Field>
        <Field label={t("soul_app.life.state")}>
          <EnumText namespace="souls.states" value={me.current_state} />
        </Field>
        <Field label={t("soul_app.life.birth")}>{formatHistoricalDate(me.birth_date, locale) ?? t("common.value.unrecorded")}</Field>
        <Field label={t("soul_app.life.death")}>{formatHistoricalDate(me.death_date, locale) ?? t("common.value.unrecorded")}</Field>
        <Field label={t("soul_app.life.origin")}>{me.origin_location || t("common.value.unrecorded")}</Field>
        <Field label={`${t("soul_app.life.merit")} / ${t("soul_app.life.demerit")}`}>
          {me.merit_score} / {me.demerit_score}
        </Field>
      </Card>
      {life.data ? (
        <LifeSections life={life.data} />
      ) : life.error ? (
        <Failure error={soulErrorMessage(life.error)} onRetry={life.reload} />
      ) : (
        <Loading />
      )}
      <Card>
        <Body muted>{t("soul_app.common.language")}</Body>
        <View style={{ flexDirection: "row", gap: 8 }}>
          {SUPPORTED_LOCALES.map((l) => (
            <View key={l} style={{ flex: 1 }}>
              <Button kind={l === locale ? "primary" : "secondary"} title={LOCALE_LABELS[l]} onPress={() => setLocale(l)} />
            </View>
          ))}
        </View>
        <Button testID="logout" kind="secondary" title={t("soul_app.life.logout")} onPress={signOut} />
      </Card>
    </Screen>
  );
}

export function PastLivesScreen() {
  const { t, locale, enumLabel } = useI18n();
  const lives = useRemote(soulApi.pastLives);
  return (
    <Screen refreshing={lives.loading} onRefresh={lives.reload}>
      <Body muted>{t("soul_app.past_lives.read_only")}</Body>
      {lives.error ? (
        <Failure error={soulErrorMessage(lives.error)} onRetry={lives.reload} />
      ) : !lives.data ? (
        <Loading />
      ) : lives.data.length === 0 ? (
        <Body muted>{t("soul_app.past_lives.empty")}</Body>
      ) : (
        [...lives.data].reverse().map((life) => (
          <View key={life.cycle} style={{ gap: 12 }} testID={`past-life-${life.cycle}`}>
            <Heading>{t("soul_app.life.cycle", { cycle: String(life.cycle + 1) })}</Heading>
            {life.reincarnation ? (
              <Body muted>
                {t("soul_app.past_lives.reincarnated", {
                  date: formatDateTime(life.reincarnation.reincarnated_at, locale) ?? t("common.value.unrecorded"),
                  form: enumText(enumLabel("reincarnation.forms", life.reincarnation.rebirth_form), t),
                })}
              </Body>
            ) : null}
            <LifeSections life={life} />
          </View>
        ))
      )}
    </Screen>
  );
}
