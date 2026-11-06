/**
 * 「不过」的理由(v4 S10,Design 第五、六批)与希腊判通过时选文书的底页,给滑卡审判(swipe.tsx)用。
 * 选项、校验与发出的内容在 `verdict.ts`;这里只画。
 */
import { judgmentApi, type ConcludeJudgmentPayload, type GreekAccount, type JudgmentDetail } from "@soulledger/core/api/judgment";
import { soulsApi } from "@soulledger/core/api/souls";
import { OFFENCES_BY_COURT, offenceCourt } from "@soulledger/core/domain/diyuCase";
import { useCallback, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { ActionButton } from "../kit";
import { Icon, Input, Sheet, Txt, family, radius, space, useI18n, useRemote, useTheme } from "../shared";
import {
  CN_TOP,
  DENIED_IMMORTALITY_CIRCLE,
  EU_REASONS,
  GR_ACCOUNTS,
  GR_REASONS,
  NO_CHOICE,
  OTHER,
  chooseAccount,
  courtNumeral,
  failPayload,
  previewOf,
  rejectReady,
  toggleReason,
  type RejectChoice,
} from "../verdict";

/** 一行可选项:单选画圆点,多选画方框。`aside` 在右边(地府的殿号)。 */
function Choice({
  testID,
  label,
  on,
  multi,
  disabled,
  aside,
  sub,
  onPress,
}: {
  testID: string;
  label: string;
  on: boolean;
  multi?: boolean;
  disabled?: boolean;
  aside?: string;
  /** 标签下面一行小字(希腊通过:这一篇把灵魂送到哪里)。 */
  sub?: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole={multi ? "checkbox" : "radio"}
      accessibilityState={{ checked: on, disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.choice, { borderColor: on ? theme.ink : theme.hair2, backgroundColor: on ? theme.field : "transparent", opacity: disabled ? 0.45 : 1 }]}
    >
      <View style={[styles.mark, { borderRadius: multi ? radius.control : radius.pill, borderColor: on ? theme.ink : theme.inkSubtle, backgroundColor: on ? theme.ink : "transparent" }]}>
        {on ? <Icon name="check" size={10} color={theme.s0} strokeWidth={2} /> : null}
      </View>
      <View style={{ flex: 1 }}>
        <Txt variant="body" style={{ fontFamily: on ? family.ui[500] : family.ui[400] }}>
          {label}
        </Txt>
        {sub ? (
          <Txt variant="caption" tone="muted">
            {sub}
          </Txt>
        ) : null}
      </View>
      {aside ? (
        <Txt variant="caption" tone="muted">
          {aside}
        </Txt>
      ) : null}
    </Pressable>
  );
}

/** 「不过」的理由(S10):各文明一套。选不够时「不过 · 落印」是灰的。 */
export function RejectSheet({
  open,
  judgment,
  busy,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  judgment: JudgmentDetail;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (payload: ConcludeJudgmentPayload) => void;
}) {
  const { t, locale } = useI18n();
  const theme = useTheme();
  const civ = judgment.civilization;
  const [choice, setChoice] = useState<RejectChoice>(NO_CHOICE);
  const [more, setMore] = useState(false);
  const pick = (code: string) => setChoice((c) => toggleReason(civ, c, code));
  const has = (code: string) => choice.reasons.includes(code);
  const ready = rejectReady(civ, choice);
  const preview = previewOf(t, civ, choice, locale);

  // 欧洲:「否认灵魂不灭」「中立者」只在灵魂登记里写了时可选(否则服务端 `fail_reason_contradicts_record`)。
  const loadSoul = useCallback(() => (open && civ === "EUROPEAN" ? soulsApi.get(judgment.soul).then((r) => r.data) : Promise.resolve(null)), [open, civ, judgment.soul]);
  const soul = useRemote(loadSoul).data;
  // 埃及:列出记为「不实」的否定告白,不能另选。
  const loadDenials = useCallback(() => (open && civ === "EGYPTIAN" ? judgmentApi.negativeConfessions(judgment.id).then((r) => r.items) : Promise.resolve(null)), [open, civ, judgment.id]);
  const untrue = (useRemote(loadDenials).data ?? []).filter((d) => d.truthful === false);

  const scope =
    civ === "EUROPEAN" ? t("reject.sheet.eu_scope") : civ === "EGYPTIAN" ? t("reject.sheet.eg_auto") : civ === "GREEK" && choice.account === "REPUBLIC" ? t("map.greece.thousand_year_cycle") : civ === "GREEK" ? t("reject.sheet.gr_scars") : null;
  const otherLabel = civ === "GREEK" && choice.account === "REPUBLIC" ? t("reject_reason.gr_er.other") : t("reject_reason.other");
  const courtName = (code: string) => {
    const court = offenceCourt(code);
    return court ? t("reject_reason.cn.court", { n: courtNumeral(court, locale) }) : undefined;
  };
  const offenceCount = OFFENCES_BY_COURT.reduce((sum, g) => sum + g.offences.length, 0);

  return (
    <Sheet open={open} onClose={onCancel} edge={theme.hair} closeLabel={t("reject.sheet.cancel")}>
      <View testID="swipe-reject-sheet" style={{ padding: space[5], gap: space[3] }}>
        <Txt variant="label" tone="neg">{t("judgment.verdicts.failed")}</Txt>
        <Txt variant="title">{civ === "EGYPTIAN" ? t("desk.eg.fail") : t("reject.sheet.title")}</Txt>
        <Txt variant="caption" tone="muted">
          {[t("reject.sheet.unstamped", { soul: judgment.soul_name }), scope].filter(Boolean).join(" · ")}
        </Txt>

        {civ === "CHINESE" ? (
          more ? (
            <>
              <Txt variant="label" tone="muted">{t("reject.sheet.by_court")}</Txt>
              {OFFENCES_BY_COURT.map((g) => (
                <View key={g.court} style={{ gap: space[2] }}>
                  <Txt variant="label" tone="muted">{t("reject_reason.cn.court", { n: courtNumeral(g.court, locale) })}</Txt>
                  {g.offences.map((code) => (
                    <Choice key={code} testID={`reject-${code}`} label={t(`judgment.offences.${code}`)} on={has(code)} onPress={() => pick(code)} />
                  ))}
                </View>
              ))}
            </>
          ) : (
            <>
              <Txt variant="label" tone="muted">{t("reject.sheet.cn_top", { n: String(CN_TOP.length) })}</Txt>
              {CN_TOP.map((code) => (
                <Choice key={code} testID={`reject-${code}`} label={t(`judgment.offences.${code}`)} aside={courtName(code)} on={has(code)} onPress={() => pick(code)} />
              ))}
              <Pressable testID="reject-more" accessibilityRole="button" onPress={() => setMore(true)} style={[styles.choice, { borderColor: theme.hair2 }]}>
                <Txt variant="body" style={{ flex: 1 }}>{t("nav.more")}</Txt>
                <Txt variant="caption" tone="muted">{t("reject.sheet.cn_more_sub", { n: String(offenceCount) })}</Txt>
                <Icon name="chevron" size={12} color={theme.inkMuted} />
              </Pressable>
            </>
          )
        ) : null}

        {civ === "EUROPEAN" ? (
          <>
            {EU_REASONS.map((code) => (
              <Choice
                key={code}
                testID={`reject-${code}`}
                label={
                  code === "MORTAL_SIN"
                    ? t("reject_reason.eu.mortal_sin")
                    : code === "NEUTRAL"
                      ? t("reject_reason.eu.neutral")
                      : `${t("souls.denied_immortality.label")} ${t("reject.sheet.circle", { n: String(DENIED_IMMORTALITY_CIRCLE) })}`
                }
                disabled={(code === "DENIED_IMMORTALITY" && !soul?.denied_immortality) || (code === "NEUTRAL" && !soul?.neutral_in_life)}
                on={has(code)}
                onPress={() => pick(code)}
              />
            ))}
            {has("MORTAL_SIN") && (judgment.cited_deadly_sins ?? []).length > 0 ? (
              <Txt variant="caption" tone="muted" testID="reject-eu-sins">
                {(judgment.cited_deadly_sins ?? []).map((s) => t(`reject_reason.eu.sin.${s}`)).join(" · ")}
              </Txt>
            ) : null}
          </>
        ) : null}

        {civ === "GREEK" ? (
          <>
            {GR_ACCOUNTS.map((account) => (
              <Choice
                key={account}
                testID={`reject-account-${account}`}
                label={t(account === "GORGIAS" ? "judgment.statute_corpus.GORGIAS" : "judgment.statute_corpus.REPUBLIC_ER")}
                on={choice.account === account}
                onPress={() => setChoice((c) => chooseAccount(c, account))}
              />
            ))}
            {choice.account
              ? GR_REASONS[choice.account].map((code) => (
                  <Choice key={code} testID={`reject-${code}`} multi label={t(greekReasonKey(code))} on={has(code)} onPress={() => pick(code)} />
                ))
              : null}
            {choice.account ? (
              <>
                <Txt variant="label" tone="muted">{`${t("reject_reason.gr.mark")} · ${t("reject.sheet.required")}`}</Txt>
                <View style={{ flexDirection: "row", gap: space[3] }}>
                  {(["CURABLE", "INCURABLE"] as const).map((mark) => (
                    <View key={mark} style={{ flex: 1 }}>
                      <Choice
                        testID={`reject-mark-${mark}`}
                        label={t(mark === "CURABLE" ? "reject_reason.gr.curable" : "reject_reason.gr.incurable")}
                        on={choice.curability === mark}
                        onPress={() => setChoice((c) => ({ ...c, curability: mark }))}
                      />
                    </View>
                  ))}
                </View>
              </>
            ) : null}
          </>
        ) : null}

        {civ === "EGYPTIAN"
          ? untrue.map((d) => (
              <View key={d.ordinal} testID={`reject-denial-${d.ordinal}`} style={[styles.choice, { borderColor: theme.hair2, flexDirection: "column", alignItems: "flex-start" }]}>
                <Txt variant="body">{t("reject_reason.eg.false_confession", { n: String(d.ordinal) })}</Txt>
                <Txt variant="caption" tone="muted">{d.text}</Txt>
              </View>
            ))
          : null}

        {/* 「其他 · 写一句」:地府、欧洲、希腊(选了文书之后)。埃及的理由不能另选,所以没有这一项。 */}
        {civ === "CHINESE" || civ === "EUROPEAN" || (civ === "GREEK" && choice.account) ? (
          <>
            <Choice testID="reject-OTHER" multi={civ === "GREEK"} label={otherLabel} on={has(OTHER)} onPress={() => pick(OTHER)} />
            {has(OTHER) ? (
              <Input
                testID="reject-note"
                label={otherLabel}
                labelHidden
                multiline
                maxLength={500}
                value={choice.note}
                onChangeText={(note) => setChoice((c) => ({ ...c, note }))}
              />
            ) : null}
          </>
        ) : null}

        {preview ? (
          <Txt variant="body" testID="reject-preview" style={{ backgroundColor: theme.s2, padding: space[3] }}>
            {`${t("reject.sheet.preview_label")} · ${preview}`}
          </Txt>
        ) : null}
        <View style={{ flexDirection: "row", gap: space[3] }}>
          <ActionButton testID="reject-cancel" kind="outline" title={t("reject.sheet.cancel")} onPress={onCancel} />
          <ActionButton testID="reject-confirm" kind="ink" busy={busy} disabled={!ready} title={t("reject.sheet.confirm")} onPress={() => onConfirm(failPayload(civ, choice))} style={{ flex: 1 }} />
        </View>
      </View>
    </Sheet>
  );
}

function greekReasonKey(code: string): string {
  switch (code) {
    case "PERJURY":
      return "reject_reason.gr.perjury";
    case "INJUSTICE":
      return "reject_reason.gr.injustice";
    case "MANY_DEATHS":
      return "reject_reason.gr_er.many_deaths";
    case "BETRAYAL":
      return "reject_reason.gr_er.betrayal";
    default:
      return "reject_reason.gr_er.enslavement";
  }
}

/**
 * 希腊判通过:只问一件 —— 判决写进哪一篇(D8;Design 第十一批第 3 条)。右滑过线后不落印,先弹这一页:
 * 两个选项各带一行去处(`judgment.greek_account.*_pass`),一句为什么要选(`.why`),下面是判语预览(第五批定稿)。
 * 刚打开时两项都不选,「通过 · 落印」是灰的 —— 不替官员猜。「放回」或下滑关掉,卡片回原位。
 */
export function AccountSheet({ open, busy, onCancel, onConfirm }: { open: boolean; busy: boolean; onCancel: () => void; onConfirm: (account: GreekAccount) => void }) {
  const { t } = useI18n();
  const theme = useTheme();
  const [account, setAccount] = useState<GreekAccount | null>(null);
  const preview = account === "GORGIAS" ? t("verdict_doc.gr.verdict.isles") : account === "REPUBLIC" ? t("verdict_doc.gr_er.verdict.just") : null;
  return (
    <Sheet open={open} onClose={onCancel} edge={theme.hair} closeLabel={t("reject.sheet.cancel")}>
      <View testID="swipe-pass-sheet" style={{ padding: space[5], gap: space[3] }}>
        <Txt variant="label" tone="pos">{t("judgment.verdicts.passed")}</Txt>
        <Txt variant="title">{t("judgment.greek_account_label")}</Txt>
        <Txt variant="body" tone="muted">{t("judgment.greek_account.why")}</Txt>
        {GR_ACCOUNTS.map((a) => (
          <Choice
            key={a}
            testID={`pass-account-${a}`}
            label={t(a === "GORGIAS" ? "judgment.greek_account.gorgias" : "judgment.greek_account.republic")}
            sub={t(a === "GORGIAS" ? "judgment.greek_account.gorgias_pass" : "judgment.greek_account.republic_pass")}
            on={account === a}
            onPress={() => setAccount(a)}
          />
        ))}
        {preview ? (
          <Txt variant="body" testID="pass-preview" style={{ backgroundColor: theme.s2, padding: space[3] }}>
            {`${t("reject.sheet.preview_label")} · ${preview}`}
          </Txt>
        ) : null}
        <View style={{ flexDirection: "row", gap: space[3] }}>
          <ActionButton testID="pass-cancel" kind="outline" title={t("reject.sheet.cancel")} onPress={onCancel} />
          <ActionButton testID="pass-confirm" kind="primary" busy={busy} disabled={!account} title={t("judgment.greek_account.confirm_pass")} onPress={() => account && onConfirm(account)} style={{ flex: 1 }} />
        </View>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  choice: { flexDirection: "row", alignItems: "center", gap: space[3], minHeight: 48, paddingHorizontal: space[4], paddingVertical: space[2], borderWidth: 1, borderRadius: radius.control },
  mark: { width: 18, height: 18, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
});
