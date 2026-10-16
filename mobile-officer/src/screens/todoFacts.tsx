/**
 * What a waiting item asks for (Design batch 34, O-01), read before the officer decides:
 * current node -> object fields -> reason -> earlier steps -> attachments, in that order for all four kinds.
 * The facts come from the server (`TodoItemDetail.facts`); an older server sends none and the screen shows only
 * what it showed before. The earlier steps are a vertical timeline; past 4 steps only 发起 and the last 2 show,
 * with one row 「还有 N 步」 that opens the middle. Attachments: a picture opens in the letter image viewer, a PDF in
 * the system (the row ends with ↗︎); offline a PDF row is greyed with 「联网后才能打开」; no attachments, no section.
 */
import type { FactAttachment, FactHistory, TodoFacts, TodoItemDetail } from "@soulledger/core/api/officer-app";
import { mediaUrl } from "@soulledger/core/domain/postMedia";
import { useState } from "react";
import { Linking, Pressable, View } from "react-native";

import { formatWhen } from "../format";
import { hallLabel } from "../rules";
import { SectionLabel, Txt, space, useI18n, useOnline, useTheme, useToast } from "../shared";
import { historyView, isPdf, sizeText, soulsView } from "../todoFacts";
import { LetterImageViewer } from "./letterImages";

type Hall = { code: string; display_name: string } | null | undefined;

export function TodoFactsView({ detail }: { detail: TodoItemDetail }) {
  const { t } = useI18n();
  const f = detail.facts;
  if (!f) return null;
  const hall = (h: Hall) => hallLabel(t, h) ?? "";
  return (
    <View testID="todo-facts" style={{ gap: space[4] }}>
      {f.node ? (
        <View testID="facts-node" style={{ gap: space[1] }}>
          <Txt variant="caption" tone="muted">{t("officer_app.detail.node", { n: String(f.node.index), total: String(f.node.total) })}</Txt>
          <Txt variant="bodyLg">{f.node.name}</Txt>
        </View>
      ) : null}
      {detail.kind === "reassignment" ? <DispatchHeader f={f} hall={hall} /> : null}
      <Fields detail={detail} f={f} hall={hall} />
      {f.reason ? (
        <View testID="facts-reason" style={{ gap: space[1] }}>
          <Txt variant="caption" tone="muted">{t("officer_app.detail.reason")}</Txt>
          <Txt variant="body">{f.reason}</Txt>
        </View>
      ) : null}
      {detail.kind === "reassignment" ? <Souls f={f} /> : null}
      {f.history && f.history.length > 0 ? <History steps={f.history} /> : null}
      {f.attachments && f.attachments.length > 0 ? <Attachments items={f.attachments} /> : null}
    </View>
  );
}

function Field({ label, value, testID }: { label: string; value: string; testID?: string }) {
  return (
    <View testID={testID} style={{ gap: space[1] }}>
      <Txt variant="caption" tone="muted">{label}</Txt>
      <Txt variant="bodyLg">{value}</Txt>
    </View>
  );
}

/** 调拨: 「从 → 到」 is the most important thing on the page, so it is the first block, big. */
function DispatchHeader({ f, hall }: { f: TodoFacts; hall: (h: Hall) => string }) {
  const { t } = useI18n();
  const theme = useTheme();
  return (
    <View testID="facts-from-to" style={{ borderWidth: 1, borderColor: theme.hair, padding: space[4], gap: space[2] }}>
      <Txt variant="caption" tone="muted">{t("officer_app.detail.from")}</Txt>
      <Txt variant="title">{hall(f.from_hall)}</Txt>
      <Txt variant="caption" tone="muted">{`→ ${t("officer_app.detail.to")}`}</Txt>
      <Txt variant="title">{hall(f.to_hall)}</Txt>
    </View>
  );
}

function Fields({ detail, f, hall }: { detail: TodoItemDetail; f: TodoFacts; hall: (h: Hall) => string }) {
  const { t, enumLabel } = useI18n();
  const rows: { key: string; label: string; value: string }[] = [];
  if (detail.kind === "approval" && f.soul) rows.push({ key: "soul", label: t("officer_app.detail.souls", { n: "1" }), value: `${f.soul.name} · ${f.soul.soul_code}` });
  if (detail.kind === "cooldown" && f.soul) rows.push({ key: "soul", label: t("officer_app.detail.souls", { n: "1" }), value: `${f.soul.name} · ${f.soul.soul_code}` });
  if (detail.kind === "rebirth") {
    if (f.soul) rows.push({ key: "soul", label: t("officer_app.detail.souls", { n: "1" }), value: `${f.soul.name} · ${f.soul.soul_code}` });
    if (f.cycle != null) rows.push({ key: "cycle", label: t("souls.detail.life_number", { n: String(f.cycle) }), value: "" });
    if (f.desired_form) {
      const d = enumLabel("reincarnation.forms", f.desired_form);
      rows.push({ key: "form", label: t("soul_accounts.rebirth.fields.desired_form"), value: d.state === "known" ? d.label : f.desired_form });
    }
    if (f.merit_balance != null) rows.push({ key: "merit", label: t("ledger.journal.col_balance"), value: String(f.merit_balance) });
  }
  if (detail.kind === "cooldown") {
    if (f.cooldown_now_days != null) rows.push({ key: "now", label: t("officer_app.detail.cooldown_now", { n: String(f.cooldown_now_days) }), value: "" });
    if (f.cooldown_asked_days != null) rows.push({ key: "asked", label: t("officer_app.detail.cooldown_asked", { n: String(f.cooldown_asked_days) }), value: "" });
  }
  if (detail.kind !== "rebirth" && detail.kind !== "cooldown" && f.requester) {
    rows.push({ key: "requester", label: t("officer_app.detail.requester"), value: [f.requester, f.requester_hall ? hall(f.requester_hall) : ""].filter(Boolean).join(" · ") });
  }
  if (detail.kind !== "rebirth" && detail.kind !== "cooldown" && f.requested_at) {
    rows.push({ key: "at", label: t("officer_app.detail.requested_at"), value: formatWhen(f.requested_at) });
  }
  return (
    <>
      {rows.map((r) =>
        r.value === "" ? (
          // A label that already carries its number ("现在剩 {{n}} 天", "第 {{n}} 世") stands alone.
          <Txt key={r.key} variant="bodyLg" testID={`facts-${r.key}`}>{r.label}</Txt>
        ) : (
          <Field key={r.key} testID={`facts-${r.key}`} label={r.label} value={r.value} />
        )
      )}
    </>
  );
}

/** 灵魂 · N: the first 2, then 「还有 N 个 ›」 opens the rest. */
function Souls({ f }: { f: TodoFacts }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const all = f.souls ?? [];
  if (all.length === 0) return null;
  const { shown, more } = soulsView(all, open);
  return (
    <View testID="facts-souls" style={{ gap: space[2] }}>
      <SectionLabel>{t("officer_app.detail.souls", { n: String(f.soul_count ?? all.length) })}</SectionLabel>
      {shown.map((s) => (
        <Txt key={s.soul_code} variant="body">{`${s.name} · ${s.soul_code}`}</Txt>
      ))}
      {more > 0 ? (
        <Pressable testID="facts-souls-more" accessibilityRole="button" onPress={() => setOpen(true)} style={{ minHeight: 44, justifyContent: "center" }}>
          <Txt variant="nav">{`${t("officer_app.detail.souls_more", { n: String(more) })} ›`}</Txt>
        </Pressable>
      ) : null}
    </View>
  );
}

/** 前面几步: a vertical timeline. A comment shows at most 2 lines. */
function History({ steps }: { steps: FactHistory[] }) {
  const { t, enumLabel } = useI18n();
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);
  const { shown, hidden, foldAt } = historyView(steps, expanded);
  const line = (s: FactHistory): string => {
    if (s.kind === "start") return [t("officer_app.detail.requester"), s.actor, formatWhen(s.at)].filter(Boolean).join(" · ");
    if (s.kind === "current") return [s.name, s.mine ? t("officer_app.detail.history_yours") : null].filter(Boolean).join(" · ");
    const verdict = s.verdict ? enumLabel("workflow.verdicts", s.verdict) : null;
    return [s.name, s.actor, verdict?.state === "known" ? verdict.label : s.verdict, formatWhen(s.at)].filter(Boolean).join(" · ");
  };
  const row = (s: FactHistory, i: number) => (
    <View key={`${s.kind}-${i}`} testID={`facts-step-${s.kind}`} style={{ flexDirection: "row", gap: space[3] }}>
      <View style={{ width: 16, alignItems: "center" }}>
        <Txt variant="body">{s.kind === "current" ? "◐" : "✓"}</Txt>
        <View style={{ flex: 1, width: 1, backgroundColor: theme.hair }} />
      </View>
      <View style={{ flex: 1, gap: space[1], paddingBottom: space[3] }}>
        <Txt variant="body">{line(s)}</Txt>
        {s.comment ? <Txt variant="caption" tone="muted" numberOfLines={2}>{`「${s.comment}」`}</Txt> : null}
      </View>
    </View>
  );
  return (
    <View testID="facts-history" style={{ gap: space[2] }}>
      <SectionLabel>{t("officer_app.detail.history")}</SectionLabel>
      {shown.map((s, i) => (
        <View key={`${s.kind}-${i}`}>
          {i === foldAt && hidden.length > 0 ? (
            <Pressable testID="facts-history-more" accessibilityRole="button" onPress={() => setExpanded(true)} style={{ minHeight: 44, justifyContent: "center", paddingLeft: 16 + space[3] }}>
              <Txt variant="nav">{`${t("officer_app.detail.history_more", { n: String(hidden.length) })} ›`}</Txt>
            </Pressable>
          ) : null}
          {row(s, i)}
        </View>
      ))}
    </View>
  );
}

/** 附件 · N: pictures open in the letter image viewer, a PDF goes to the system. Offline, a PDF row is greyed. */
function Attachments({ items }: { items: FactAttachment[] }) {
  const { t } = useI18n();
  const theme = useTheme();
  const toast = useToast();
  const { offline } = useOnline();
  const [viewing, setViewing] = useState<number | null>(null);
  const images = items.filter((a) => !isPdf(a.content_type));
  const gallery = images.map((a) => ({ id: a.id, url: a.url, width: 1, height: 1 }));
  const open = (a: FactAttachment) => {
    if (!isPdf(a.content_type)) {
      setViewing(Math.max(0, images.findIndex((x) => x.id === a.id)));
      return;
    }
    Linking.openURL(mediaUrl(a.url)).catch(() => toast(t("officer_app.detail.attachment_failed"), "failure"));
  };
  return (
    <View testID="facts-attachments" style={{ gap: space[2] }}>
      <SectionLabel>{t("officer_app.detail.attachments", { n: String(items.length) })}</SectionLabel>
      {items.map((a) => {
        const pdf = isPdf(a.content_type);
        const blocked = pdf && offline;
        const second = [pdf ? "PDF" : "IMG", sizeText(a.byte_size), blocked ? t("officer_app.detail.attachment_offline") : pdf ? t("officer_app.detail.open_system") : null].filter(Boolean).join(" · ");
        return (
          <Pressable
            key={a.id}
            testID={`attachment-${a.id}`}
            accessibilityRole="button"
            accessibilityState={{ disabled: blocked }}
            disabled={blocked}
            onPress={() => open(a)}
            style={{ minHeight: 56, flexDirection: "row", alignItems: "center", gap: space[3], borderBottomWidth: 1, borderBottomColor: theme.hair, opacity: blocked ? 0.5 : 1 }}
          >
            <View style={{ flex: 1, gap: space[1] }}>
              <Txt variant="body" numberOfLines={1}>{a.name}</Txt>
              <Txt variant="caption" tone="muted">{second}</Txt>
            </View>
            <Txt variant="nav">{pdf ? "↗︎" : "›"}</Txt>
          </Pressable>
        );
      })}
      <LetterImageViewer images={gallery} index={viewing} onClose={() => setViewing(null)} />
    </View>
  );
}
