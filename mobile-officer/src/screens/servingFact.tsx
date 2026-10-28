/**
 * 灵魂详情身份页的「服刑」一行(Design 第五十九批 M-2 / M-2b):
 *  - 服刑中:「服刑中 · 至 日期」,不画按钮(置灰的也不画);
 *  - 期满日已到(`can_release`,与每日期满检查同一条判定):「刑期已满 · 日期」+「期满释放」,点了先出底部确认
 *    (`disposition.release_*`,ink 实底),确认后 `POST disposition/<id>/release/`。按钮只给持 `disposition.execute` 的人(同网页);
 *  - 刑期用的是这扇门的默认年数时,副行「默认 N 年」(下判本身不上手机)。
 * 读的是这个灵魂「执行中」那一段的处置(`section=executing`),要 `disposition.read`;没有就整行不画。
 */
import { dispositionApi, releaseRefusalOf, type Disposition } from "@soulledger/core/api/disposition";
import { formatHistoricalDate } from "@soulledger/core/domain/dates";
import { useCallback, useState } from "react";
import { View } from "react-native";

import { ActionButton } from "../kit";
import { useCan } from "../session";
import { Sheet, Txt, space, useI18n, useRemote, useTheme, useToast } from "../shared";

/** 正在服的那一份:已执行、未期满、不是永久、有期满日。 */
export function servingOf(rows: readonly Disposition[]): Disposition | null {
  return rows.find((d) => d.is_executed && !d.expired_at && !d.is_eternal && !!d.term_end) ?? null;
}

/** 刑期就是默认年数时那一句的年数;不是默认时 null。 */
export function defaultTermOf(d: Pick<Disposition, "sentence_years" | "default_term_years">): number | null {
  return d.default_term_years != null && d.sentence_years === d.default_term_years ? d.default_term_years : null;
}

export function ServingFact({ soulId }: { soulId: string }) {
  const canRead = useCan("disposition.read");
  return canRead ? <Serving soulId={soulId} /> : null;
}

function Serving({ soulId }: { soulId: string }) {
  const { t } = useI18n();
  const theme = useTheme();
  const toast = useToast();
  const canRelease = useCan("disposition.execute");
  const load = useCallback(
    () => Promise.resolve().then(() => dispositionApi.list({ soul: soulId, section: "executing" })).then((r) => servingOf(r.data.results)),
    [soulId]
  );
  const { data: d, reload } = useRemote(load);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!d) return null;
  const date = formatHistoricalDate(d.term_end ?? null) ?? "";
  const due = !!d.can_release;
  const years = defaultTermOf(d);
  const release = () => {
    setBusy(true);
    dispositionApi
      .release(d.id)
      .then(() => {
        toast(t("disposition.release_success"), "success");
        setConfirming(false);
        void reload();
      })
      .catch((e: unknown) => {
        const code = releaseRefusalOf(e);
        toast(t(code ? `disposition.release_error.${code}` : "disposition.execute_error"), "failure");
        setConfirming(false);
        void reload();
      })
      .finally(() => setBusy(false));
  };
  return (
    <View testID="soul-serving" style={{ width: "100%", gap: space[1] }}>
      <Txt variant="caption" tone="muted">{t("soul_app.sentence.term")}</Txt>
      <Txt variant="body" testID="soul-serving-line">
        {due ? t("officer_app.soul.term_due", { date }) : t("disposition.serving_until", { date })}
      </Txt>
      {years != null ? <Txt variant="caption" tone="muted" testID="soul-serving-default">{t("officer_app.soul.term_default", { n: String(years) })}</Txt> : null}
      {due && canRelease && !d.is_archived ? (
        <ActionButton testID="soul-release" kind="primary" title={t("disposition.release")} onPress={() => setConfirming(true)} style={{ marginTop: space[2], minHeight: 48 }} />
      ) : null}
      <Sheet open={confirming} onClose={() => setConfirming(false)} edge={theme.hair} closeLabel={t("soul_app.common.cancel")}>
        <View testID="soul-release-sheet" style={{ padding: space[5], gap: space[4] }}>
          <Txt variant="title">{t("disposition.release_confirm")}</Txt>
          <Txt variant="body">{t("disposition.release_warning")}</Txt>
          <View style={{ flexDirection: "row", gap: space[3] }}>
            <ActionButton testID="soul-release-cancel" kind="outline" title={t("soul_app.common.cancel")} onPress={() => setConfirming(false)} />
            <ActionButton testID="soul-release-confirm" kind="ink" busy={busy} title={t("disposition.release")} onPress={release} />
          </View>
        </View>
      </Sheet>
    </View>
  );
}
