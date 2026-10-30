/**
 * 互动消息 (Design 第四十批 S-a): what others did to me in the circle — comments and replies one row each, reactions
 * and lamps one row per post per day, follows one row per day ("{{name}} 等 {{n}} 人…"). Grouped 今天 / 更早, kept
 * 90 days (the server drops the rest).
 *
 * Opening the page reads everything (`readInteractions`), once the first page is in: the dots it shows are the
 * ones from before, and stay until the page is left. Where a row leads: a comment / reply → the post, that comment
 * scrolled to and washed; a reaction / lamp → the post; a follow → the first soul's page.
 */
import { soulErrorMessage } from "@soulledger/core/api/soul";
import { soulSocialApi, type SoulInteraction } from "@soulledger/core/api/soul-social";
import { useNavigation, type NavigationProp } from "@react-navigation/native";
import { useEffect, useRef } from "react";
import { Pressable, SectionList, StyleSheet, View } from "react-native";

import { family } from "../fonts";
import { useGone } from "../gone";
import { useI18n } from "../i18n";
import { Empty, Interp, Notice, OneLine, Screen, Skeleton, Txt, useLayout, useReloadOnRefocus, useTheme } from "../ui";
import { invalidateSocialStatus, useSocialStatus } from "../socialStatus";
import type { AppStackParams } from "../navTypes";
import { PagedFooter, usePaged } from "../paged";

const pad = (n: number) => String(n).padStart(2, "0");
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** Today's rows by the clock (09:12), older ones by the day (10-15) — device time. */
export function interactionStamp(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  return sameDay(d, now) ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The row's sentence, with `{{name}}` left for the bold name. `n` is everyone on the row, the first one included. */
const SENTENCE: Record<"COMMENT" | "REPLY", string> = {
  COMMENT: "soul_app.social.commented",
  REPLY: "soul_app.social.replied",
};
/** Merged rows: one person, two, or more (Design 第四十一批). `[one, two, many]`. */
const MERGED: Record<"REACTION" | "LAMP" | "FOLLOW", [string, string, string]> = {
  REACTION: ["soul_app.social.reacted_one", "soul_app.social.reacted_two", "soul_app.social.reacted_many"],
  LAMP: ["soul_app.social.lamp_one", "soul_app.social.lamp_two", "soul_app.social.lamp_many"],
  FOLLOW: ["soul_app.social.followed_one", "soul_app.social.followed_two", "soul_app.social.followed_many"],
};

/**
 * zh / egy count everyone (「某某等 3 人」); en counts the others ("and 2 others"), so en gets `n − 1`.
 * Two people has its own key because en says "1 other", not "1 others". Same `{{n}}` in all three bundles.
 */
export function mergedSentence(kind: keyof typeof MERGED, count: number, locale: string): [string, Record<string, string>] {
  const [one, two, many] = MERGED[kind];
  if (count <= 1) return [one, {}];
  return [count === 2 ? two : many, { n: String(locale === "en" ? count - 1 : count) }];
}

function sentenceFor(kind: SoulInteraction["kind"], count: number, locale: string): [string, Record<string, string>] {
  if (kind === "COMMENT" || kind === "REPLY") return [SENTENCE[kind], { n: String(count) }];
  return mergedSentence(kind, count, locale);
}

function Row({ row, onPress: open }: { row: SoulInteraction; onPress: () => void }) {
  const t = useTheme();
  const { t: tr, locale } = useI18n();
  const { gutter } = useLayout();
  const comment = row.kind === "COMMENT" || row.kind === "REPLY";
  // O-c: the post it opens turned out to be gone -- greyed, and it opens nothing. A follow opens a soul, never gone here.
  const gone = useGone().has(row.kind !== "FOLLOW" && row.post_id ? `post:${row.post_id}` : "");
  const onPress = gone ? undefined : open;
  return (
    <Pressable
      testID={`interaction-${row.id}`}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityState={gone ? { disabled: true } : undefined}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [styles.row, { paddingHorizontal: gutter, borderTopColor: t.hair, backgroundColor: t.s1 }, pressed && styles.pressed, gone && styles.gone]}
    >
      <View style={styles.dotCol}>
        {row.unread ? (
          <View testID={`interaction-unread-${row.id}`} accessibilityLabel={tr("soul_app.chat.unread")} style={[styles.dot, { backgroundColor: t.ink }]} />
        ) : null}
      </View>
      <View style={styles.fill}>
        <Interp
          variant="body"
          text={tr(...sentenceFor(row.kind, row.count, locale))}
          parts={{ name: <Txt style={styles.name}>{row.actor.display_name}</Txt> }}
        />
        {row.excerpt ? (
          <Txt variant="body" tone="muted" numberOfLines={comment ? 2 : 1}>
            {comment ? `「${row.excerpt}」` : row.excerpt}
          </Txt>
        ) : null}
        <OneLine variant="caption" tone="muted" onPress={onPress}>
          {interactionStamp(row.last_at)}
        </OneLine>
      </View>
    </Pressable>
  );
}

export function CircleInboxScreen() {
  const t = useTheme();
  const { t: tr } = useI18n();
  const { gutter } = useLayout();
  const navigation = useNavigation<NavigationProp<AppStackParams>>();
  const list = usePaged<SoulInteraction>("interactions", (page) => soulSocialApi.interactions(page));
  // Everything is read once the first page is in (its dots are the ones from before).
  const marked = useRef(false);
  const loaded = list.rows !== null;
  useEffect(() => {
    if (!loaded || marked.current) return;
    marked.current = true;
    void soulSocialApi.readInteractions().then(invalidateSocialStatus, () => {});
  }, [loaded]);

  const open = (row: SoulInteraction) => {
    if (row.kind === "FOLLOW") navigation.navigate("SoulProfile", { userId: row.actor.user_id });
    // Only comment / reply rows carry a comment id; reactions and lamps open the post as it is.
    else if (row.post_id) navigation.navigate("CirclePost", row.comment_id ? { id: row.post_id, comment: row.comment_id } : { id: row.post_id });
  };

  if (list.error && !list.rows) {
    const e = soulErrorMessage(list.error);
    return (
      <Screen testID="circle-inbox">
        <View style={[styles.pad, { paddingHorizontal: gutter }]}>
          <Notice tone="neg" onRetry={() => void list.reload()} testID="circle-inbox-error">
            {tr(e.key, e.params)}
          </Notice>
        </View>
      </Screen>
    );
  }
  if (!list.rows) {
    return (
      <Screen testID="circle-inbox">
        <View style={[styles.pad, { paddingHorizontal: gutter }]}>
          <Skeleton lines={5} testID="circle-inbox-loading" />
        </View>
      </Screen>
    );
  }
  const now = new Date();
  const today = list.rows.filter((r) => sameDay(new Date(r.last_at), now));
  const earlier = list.rows.filter((r) => !sameDay(new Date(r.last_at), now));
  const sections = [
    { key: "today", title: tr("soul_app.assist.today"), data: today },
    { key: "earlier", title: tr("officer_app.assist.group_earlier"), data: earlier },
  ].filter((s) => s.data.length);
  return (
    <Screen scroll={false} edges={["left", "right"]} testID="circle-inbox">
      <SectionList
        testID="circle-inbox-list"
        sections={sections}
        keyExtractor={(row) => row.id}
        renderSectionHeader={({ section }) => (
          <Txt testID={`circle-inbox-${section.key}`} variant="caption" tone="muted" style={[styles.group, { paddingHorizontal: gutter, backgroundColor: t.s0 }]}>
            {section.title}
          </Txt>
        )}
        renderItem={({ item }) => <Row row={item} onPress={() => open(item)} />}
        stickySectionHeadersEnabled={false}
        ListEmptyComponent={<Empty testID="circle-inbox-empty" text={tr("soul_app.social.inbox_empty")} />}
        ListFooterComponent={
          <>
            <View style={[styles.last, { borderTopColor: t.hair }]} />
            <PagedFooter list={list} testID="circle-inbox-more" title={tr("soul_app.history.more")} />
            <Txt testID="circle-inbox-retention" variant="caption" tone="muted" style={styles.retention}>
              {tr("soul_app.social.inbox_retention")}
            </Txt>
          </>
        }
        onEndReached={list.more ?? undefined}
        onEndReachedThreshold={0.5}
      />
    </Screen>
  );
}

/**
 * The unread count for the circle bar's 「互动」, read again whenever the circle tab is shown (coming back from
 * 互动消息 it is 0). `null`: not known yet, or none — no badge either way.
 */
export function useUnreadInteractions(): string | null {
  const status = useSocialStatus();
  useReloadOnRefocus(status.reload);
  const n = status.data?.unread_interactions ?? 0;
  return n > 0 ? (n > 99 ? "99+" : String(n)) : null;
}

const styles = StyleSheet.create({
  gone: { opacity: 0.45 },
  fill: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.8 },
  pad: { paddingVertical: 16 },
  group: { paddingTop: 12, paddingBottom: 4, fontFamily: family.ui[600] },
  row: { minHeight: 72, flexDirection: "row", gap: 12, paddingVertical: 12, borderTopWidth: 1 },
  dotCol: { width: 8, paddingTop: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  name: { fontFamily: family.ui[600] },
  last: { borderTopWidth: 1 },
  retention: { padding: 16, textAlign: "center" },
});
