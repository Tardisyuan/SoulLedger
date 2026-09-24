/**
 * 朋友圈, people (handoff "灵魂簿 App · 朋友圈" 1f–1i): another soul's page,
 * my page, the follow lists, search, and report.
 *
 * What the server keeps from a soul is kept here too: a card never shows a
 * soul code (not even one found by its code), a past life has no follow button
 * and no "⋯", and search answers every miss with the same one sentence.
 */
import { soulChatErrorMessage } from "@soulledger/core/api/soul-chat";
import {
  soulSocialApi,
  type SoulProfile,
  type SoulRelationCard,
  type SoulReportReason,
  type SoulReportTarget,
  type SoulSearchResult,
} from "@soulledger/core/api/soul-social";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useCallback, useContext, useRef, useState } from "react";
import { Modal, Pressable, StyleSheet, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useChat } from "../chat";
import { AppHeader } from "../chrome";
import { useCommittedSend } from "../composing";
import { Emblem, Icon } from "../emblems";
import { useToast } from "../feedback";
import { quoteFamily } from "../fonts";
import { useI18n } from "../i18n";
import { SessionContext } from "../session";
import { Button, Empty, Notice, Screen, Skeleton, SmallButton, Txt, useLayout, useRemote, useTheme } from "../ui";
import type { AppStackParams } from "./applications";
import { PostList, useFailure, useFeed } from "./circle";
import { Glyph, Tag } from "./letters";

type Nav = NativeStackNavigationProp<AppStackParams>;

/** The server's report reasons; their copy is the moderation section's (egy settled there). */
const REASONS: SoulReportReason[] = ["SPAM", "ABUSE", "SEXUAL", "ILLEGAL", "OTHER"];

/** The civilization the soul is in now, by name, with its mark — the only "where" a card carries. */
function CivMark() {
  const t = useTheme();
  const session = useContext(SessionContext);
  const name = session?.state.status === "signedIn" ? session.state.profile.tenant.display_name : "";
  return (
    <View style={styles.civ}>
      <Emblem civ={t.civ} size={12} stroke={t.mark} strokeWidth={2.4} />
      <Txt style={[styles.civText, { color: t.mark }]}>{name}</Txt>
    </View>
  );
}

function Count({ n, label, onPress, testID }: { n: number; label: string; onPress?: () => void; testID: string }) {
  const t = useTheme();
  const body = (
    <>
      <Txt style={styles.countLabel} tone="subtle">
        {label}
      </Txt>
      <View style={styles.countValue}>
        <Txt variant="value" style={styles.countN}>
          {String(n)}
        </Txt>
        {onPress ? <Icon name="chevron" size={11} color={t.inkSubtle} /> : null}
      </View>
    </>
  );
  return onPress ? (
    <Pressable testID={testID} accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.countCell, { borderColor: t.hair }, pressed && { backgroundColor: t.s1 }]}>
      {body}
    </Pressable>
  ) : (
    <View testID={testID} style={[styles.countCell, { borderColor: t.hair }]}>
      {body}
    </View>
  );
}

/** 关注 / 回关 / 已关注 / 互相关注 (1f). The secondary ones undo the follow. */
function FollowButton({ following, followedBy, onPress, busy, compact }: { following: boolean; followedBy: boolean; onPress: () => void; busy?: boolean; compact?: boolean }) {
  const { t: tr } = useI18n();
  const t = useTheme();
  const label = following
    ? tr(followedBy ? "soul_app.circle.profile.mutual" : "soul_app.circle.profile.followed")
    : tr(followedBy ? "soul_app.circle.profile.follow_back" : "soul_app.circle.profile.follow");
  if (!compact) return <Button testID="follow" kind={following ? "secondary" : "primary"} title={label} onPress={onPress} busy={busy} />;
  return (
    <Pressable
      testID="follow"
      accessibilityRole="button"
      accessibilityState={{ busy: !!busy }}
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.smallFollow,
        following ? { borderWidth: 1, borderColor: t.hair2 } : { backgroundColor: pressed ? t.mark : t.accent },
      ]}
    >
      <Txt style={[styles.smallFollowText, { color: following ? t.inkMuted : t.onAccent }]}>{label}</Txt>
    </Pressable>
  );
}

function useFollow(onDone: () => unknown) {
  const fail = useFailure();
  const [busy, setBusy] = useState<number | null>(null);
  const toggle = async (userId: number, following: boolean) => {
    if (busy !== null) return;
    setBusy(userId);
    try {
      await (following ? soulSocialApi.unfollow(userId) : soulSocialApi.follow(userId));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
      void onDone();
    }
  };
  return { busy, toggle };
}

// ── another soul ───────────────────────────────────────────────────────

export function SoulProfileScreen({ userId }: { userId: number }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const { gutter } = useLayout();
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const chat = useChat();
  const toast = useToast();
  const profile = useRemote(useCallback(() => soulSocialApi.profile(userId), [userId]));
  const feed = useFeed({ author: userId });
  const follow = useFollow(() => Promise.all([profile.reload(), feed.reload()]));
  const [menu, setMenu] = useState(false);
  const p: SoulProfile | null = profile.data;
  const reborn = p ? !p.is_active : false;

  const letter = async () => {
    setMenu(false);
    try {
      const c = await chat.openDirect(userId);
      navigation.navigate("Conversation", { id: c.id });
    } catch (e) {
      const m = soulChatErrorMessage(e);
      toast(tr(m.key, m.params), "failure");
    }
  };

  return (
    <View style={[styles.fill, { backgroundColor: t.s0 }]}>
      <AppHeader
        title={p?.display_name ?? ""}
        onBack={navigation.goBack}
        action={p && !reborn && !p.is_self ? { icon: "more", label: tr("soul_app.circle.post.more"), testID: "profile-more", onPress: () => setMenu(true) } : undefined}
      />
      <Screen edges={["left", "right"]} testID="soul-profile" refreshing={profile.loading && !!p} onRefresh={() => void Promise.all([profile.reload(), feed.reload()])}>
        {profile.error && !p ? (
          <View style={[styles.pad, { paddingHorizontal: gutter }]}>
            {/* Another civilization, an officer, nobody: one answer (the server's 404). */}
            <Empty testID="profile-not-found" text={tr("soul_app.circle.search.not_found")} />
          </View>
        ) : !p ? (
          <View style={[styles.pad, { paddingHorizontal: gutter }]}>
            <Skeleton lines={4} testID="profile-loading" />
          </View>
        ) : (
          <>
            <View style={[styles.head, { paddingHorizontal: gutter, borderBottomColor: t.hair }]}>
              <View style={styles.row}>
                <Glyph text={p.display_name} tone={reborn ? "subtle" : "muted"} dotted={reborn} size={60} />
                <View style={styles.fill}>
                  <Txt variant="title" tone={reborn ? "muted" : "ink"}>
                    {p.display_name}
                  </Txt>
                  <CivMark />
                </View>
              </View>
              <View style={styles.counts}>
                <Count testID="count-following" n={p.following_count} label={tr("soul_app.circle.profile.following")} />
                <Count testID="count-followers" n={p.followers_count} label={tr("soul_app.circle.profile.followers")} />
              </View>
              {p.is_followed_by && !p.is_following && !reborn ? (
                <Txt testID="follows-you" variant="caption" tone="subtle">
                  {tr("soul_app.circle.profile.follows_you")}
                </Txt>
              ) : null}
              {reborn ? (
                <View testID="profile-reborn" style={[styles.reborn, { borderColor: t.hair2, backgroundColor: t.s1 }]}>
                  <Tag text={tr("soul_app.circle.profile.reborn")} tone="quiet" />
                  <Txt variant="caption" tone="muted" style={styles.fill}>
                    {tr("soul_app.circle.profile.reborn_body")}
                  </Txt>
                </View>
              ) : (
                <FollowButton following={p.is_following} followedBy={p.is_followed_by} busy={follow.busy === userId} onPress={() => void follow.toggle(userId, p.is_following)} />
              )}
            </View>
            {feed.posts ? <PostList feed={feed} onAuthor={() => {}} /> : <View style={[styles.pad, { paddingHorizontal: gutter }]}><Skeleton lines={3} /></View>}
            {!reborn && !p.is_following ? (
              <Txt testID="more-hint" variant="caption" tone="subtle" style={[styles.pad, { paddingHorizontal: gutter }]}>
                {tr("soul_app.circle.profile.more_hint")}
              </Txt>
            ) : null}
          </>
        )}
      </Screen>
      <Modal visible={menu} transparent animationType="fade" onRequestClose={() => setMenu(false)}>
        <View style={styles.scrim}>
          <Pressable style={styles.fill} onPress={() => setMenu(false)} accessibilityLabel={tr("soul_app.common.cancel")} />
          <View testID="profile-menu" accessibilityViewIsModal style={[styles.sheet, { backgroundColor: t.s1, borderTopColor: t.hair2, paddingBottom: 20 + insets.bottom }]}>
            {chat.availability !== "not_configured" && p ? (
              <>
                <Pressable testID="menu-letter" accessibilityRole="button" onPress={() => void letter()} style={[styles.menuRow, { borderBottomColor: t.hair }]}>
                  <Txt variant="bodyLg" style={styles.fill}>
                    {tr("soul_app.circle.profile.menu.letter")}
                  </Txt>
                  <Txt variant="caption" tone="subtle">
                    {tr(p.is_mutual ? "soul_app.circle.profile.menu.letter_mutual" : "soul_app.circle.profile.menu.letter_request")}
                  </Txt>
                </Pressable>
                {p.is_mutual ? null : (
                  <Txt testID="menu-letter-rule" variant="caption" tone="subtle" style={[styles.menuNote, { borderBottomColor: t.hair }]}>
                    {tr("soul_app.circle.profile.menu.letter_rule")}
                  </Txt>
                )}
              </>
            ) : null}
            <Pressable
              testID="menu-report"
              accessibilityRole="button"
              onPress={() => {
                setMenu(false);
                if (p) navigation.navigate("CircleReport", { target: "USER", id: String(userId), preview: p.display_name });
              }}
              style={[styles.menuRow, { borderBottomColor: t.hair }]}
            >
              <Txt variant="bodyLg" tone="neg">
                {tr("soul_app.circle.profile.menu.report")}
              </Txt>
            </Pressable>
            <Pressable testID="menu-cancel" accessibilityRole="button" onPress={() => setMenu(false)} style={styles.menuCancel}>
              <Txt variant="body" tone="muted">
                {tr("soul_app.common.cancel")}
              </Txt>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ── me ─────────────────────────────────────────────────────────────────

export function MyCircleScreen() {
  const t = useTheme();
  const { t: tr } = useI18n();
  const { gutter } = useLayout();
  const navigation = useNavigation<Nav>();
  // My user id is the circle status's; my page is my profile as others would ask for it.
  const me = useRemote(useCallback(async () => soulSocialApi.profile((await soulSocialApi.status()).user_id), []));
  const feed = useFeed({ author: me.data?.user_id ?? 0 }, !!me.data);
  const mine = me.data ? feed : null;

  return (
    <Screen edges={["left", "right"]} testID="my-circle" refreshing={me.loading && !!me.data} onRefresh={() => void Promise.all([me.reload(), feed.reload()])}>
      {me.error && !me.data ? (
        <View style={[styles.pad, { paddingHorizontal: gutter }]}>
          <Notice tone="neg" onRetry={() => void me.reload()}>
            {tr("soul_app.circle.feed.error")}
          </Notice>
        </View>
      ) : !me.data ? (
        <View style={[styles.pad, { paddingHorizontal: gutter }]}>
          <Skeleton lines={4} testID="me-loading" />
        </View>
      ) : (
        <>
          <View style={[styles.head, { paddingHorizontal: gutter, borderBottomColor: t.hair }]}>
            <View style={styles.row}>
              <Glyph text={me.data.display_name} tone="muted" size={60} />
              <View style={styles.fill}>
                <Txt variant="title">{me.data.display_name}</Txt>
                <Txt variant="caption" tone="subtle">
                  {tr("soul_app.circle.me.display_name")}
                </Txt>
              </View>
            </View>
            <View style={[styles.countBox, { borderColor: t.hair }]}>
              <Count testID="my-following" n={me.data.following_count} label={tr("soul_app.circle.profile.following")} onPress={() => navigation.navigate("CircleFollows", { relation: "following" })} />
              <Count testID="my-followers" n={me.data.followers_count} label={tr("soul_app.circle.profile.followers")} onPress={() => navigation.navigate("CircleFollows", { relation: "followers" })} />
            </View>
          </View>
          {mine?.posts ? <PostList feed={mine} onAuthor={() => {}} /> : <View style={[styles.pad, { paddingHorizontal: gutter }]}><Skeleton lines={3} /></View>}
        </>
      )}
    </Screen>
  );
}

// ── lists ──────────────────────────────────────────────────────────────

export function FollowListScreen({ relation }: { relation: "following" | "followers" }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const { gutter } = useLayout();
  const navigation = useNavigation<Nav>();
  const [rows, setRows] = useState<SoulRelationCard[] | null>(null);
  const [count, setCount] = useState(0);
  const [next, setNext] = useState<number | null>(null);
  const load = useCallback(
    async (page = 1) => {
      const res = await (relation === "following" ? soulSocialApi.following(page) : soulSocialApi.followers(page));
      setRows((prev) => (page === 1 ? res.results : [...(prev ?? []), ...res.results]));
      setCount(res.count);
      setNext(res.next ? page + 1 : null);
    },
    [relation]
  );
  const first = useRemote(load);
  const follow = useFollow(() => load(1));
  const title = tr(relation === "following" ? "soul_app.circle.list.following_title" : "soul_app.circle.list.followers_title", { n: String(count) });

  return (
    <View style={[styles.fill, { backgroundColor: t.s0 }]}>
      <AppHeader title={title} onBack={navigation.goBack} />
      <Screen edges={["left", "right", "bottom"]} testID={`follows-${relation}`}>
        {first.error && !rows ? (
          <View style={[styles.pad, { paddingHorizontal: gutter }]}>
            <Notice tone="neg" onRetry={() => void first.reload()}>
              {tr("soul_app.circle.feed.error")}
            </Notice>
          </View>
        ) : !rows ? (
          <View style={[styles.pad, { paddingHorizontal: gutter }]}>
            <Skeleton lines={4} />
          </View>
        ) : (
          <>
            {rows.map((r) => (
              <Pressable
                key={r.user_id}
                testID={`soul-${r.user_id}`}
                accessibilityRole="button"
                onPress={() => navigation.navigate("SoulProfile", { userId: r.user_id })}
                style={({ pressed }) => [styles.listRow, { paddingHorizontal: gutter, borderBottomColor: t.hair }, pressed && { backgroundColor: t.s1 }]}
              >
                <Glyph text={r.display_name} tone={r.is_active ? "muted" : "subtle"} dotted={!r.is_active} size={36} />
                <View style={styles.fill}>
                  <Txt variant="bodyLg" tone={r.is_active ? "ink" : "subtle"}>
                    {r.display_name}
                  </Txt>
                  {r.is_active ? null : (
                    <Txt variant="caption" tone="subtle">
                      {tr("soul_app.circle.profile.reborn")}
                    </Txt>
                  )}
                </View>
                {r.is_active ? (
                  <FollowButton compact following={r.is_following} followedBy={r.is_followed_by} busy={follow.busy === r.user_id} onPress={() => void follow.toggle(r.user_id, r.is_following)} />
                ) : null}
              </Pressable>
            ))}
            {next ? (
              <View style={styles.more}>
                <SmallButton testID="follows-more" title={tr("soul_app.circle.feed.more")} onPress={() => void load(next)} />
              </View>
            ) : null}
            {rows.some((r) => !r.is_active) ? (
              <Txt variant="caption" tone="subtle" style={[styles.pad, { paddingHorizontal: gutter }]}>
                {tr("soul_app.circle.list.reborn_note")}
              </Txt>
            ) : null}
          </>
        )}
      </Screen>
    </View>
  );
}

// ── search ─────────────────────────────────────────────────────────────

/** A soul code is 10 letters and digits; anything else is a name. (Only for the label — the server decides.) */
const looksLikeCode = (q: string) => /^[A-Z0-9]{10}$/i.test(q);

export function CircleSearchScreen() {
  const t = useTheme();
  const { t: tr } = useI18n();
  const { gutter } = useLayout();
  const navigation = useNavigation<Nav>();
  const session = useContext(SessionContext);
  const civ = session?.state.status === "signedIn" ? session.state.profile.tenant.display_name : "";
  const [q, setQ] = useState("");
  const [asked, setAsked] = useState("");
  const [rows, setRows] = useState<SoulSearchResult[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const ticket = useRef(0);

  const search = async (typed: string) => {
    const query = typed.trim();
    const mine = ++ticket.current;
    setAsked(query);
    setRows(null);
    setError(null);
    if (!query) return;
    try {
      const res = await soulSocialApi.search(query);
      if (mine === ticket.current) setRows(res);
    } catch (e) {
      if (mine === ticket.current) setError(e);
    }
  };

  return (
    <Screen edges={["left", "right", "bottom"]} testID="circle-search">
      <View style={[styles.searchBar, { paddingHorizontal: 16, borderBottomColor: t.hair }]}>
        <View style={[styles.searchBox, { borderColor: asked ? t.accent : t.hair2, backgroundColor: t.s1 }]}>
          <Icon name="search" size={15} color={t.inkSubtle} />
          <TextInput
            testID="search-input"
            accessibilityLabel={tr("soul_app.circle.search.hint")}
            value={q}
            onChangeText={setQ}
            onSubmitEditing={(e) => void search(e.nativeEvent.text)}
            placeholder={tr("soul_app.circle.search.hint")}
            placeholderTextColor={t.inkSubtle}
            returnKeyType="search"
            autoCorrect={false}
            autoCapitalize="none"
            style={[styles.searchInput, { color: t.ink }]}
          />
        </View>
      </View>
      {!asked ? (
        <Txt testID="search-scope" variant="caption" tone="subtle" style={[styles.pad, { paddingHorizontal: gutter }]}>
          {tr("soul_app.circle.search.scope", { civ })}
        </Txt>
      ) : error ? (
        <View style={[styles.pad, { paddingHorizontal: gutter }]}>
          <Notice tone="neg" onRetry={() => void search(asked)}>
            {tr("soul_app.circle.feed.error")}
          </Notice>
        </View>
      ) : !rows ? (
        <View style={[styles.pad, { paddingHorizontal: gutter }]}>
          <Skeleton lines={2} testID="search-loading" />
        </View>
      ) : rows.length === 0 ? (
        // One sentence for every miss: another civilization, a past life, a mistyped code.
        <Empty testID="search-none" text={tr("soul_app.circle.search.not_found")} />
      ) : (
        <>
          <Txt variant="label" tone="subtle" style={[styles.resultsHead, { paddingHorizontal: gutter }]}>
            {looksLikeCode(asked) ? tr("soul_app.circle.search.by_code") : tr("soul_app.circle.search.count", { n: String(rows.length) })}
          </Txt>
          {rows.map((r) => (
            <Pressable
              key={r.user_id}
              testID={`result-${r.user_id}`}
              accessibilityRole="button"
              onPress={() => navigation.navigate("SoulProfile", { userId: r.user_id })}
              style={({ pressed }) => [styles.listRow, { paddingHorizontal: gutter, borderBottomColor: t.hair }, pressed && { backgroundColor: t.s1 }]}
            >
              <Glyph text={r.display_name} tone="muted" size={36} />
              <View style={styles.fill}>
                <Txt variant="bodyLg">{r.display_name}</Txt>
                <CivMark />
              </View>
              <Icon name="chevron" size={12} color={t.inkSubtle} />
            </Pressable>
          ))}
          <Txt variant="caption" tone="subtle" style={[styles.pad, { paddingHorizontal: gutter }]}>
            {tr("soul_app.circle.search.result_note")}
          </Txt>
        </>
      )}
    </Screen>
  );
}

// ── report ─────────────────────────────────────────────────────────────

const REPORT_TITLES: Record<SoulReportTarget, string> = {
  POST: "soul_app.circle.report.post",
  COMMENT: "soul_app.circle.report.comment",
  USER: "soul_app.circle.report.user",
};

export function ReportScreen({ target, id, preview }: { target: SoulReportTarget; id: string; preview: string }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const { gutter } = useLayout();
  const navigation = useNavigation<Nav>();
  const fail = useFailure();
  const [reason, setReason] = useState<SoulReportReason | null>(null);
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const input = useRef<TextInput>(null);

  const submit = async (text: string) => {
    if (!reason || busy) return;
    setBusy(true);
    try {
      await soulSocialApi.report(target, id, reason, text.trim());
      setDone(true);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  // The detail may be the focused field when the button is pressed: send what the keyboard committed.
  const { press, onEndEditing } = useCommittedSend(input, detail, (text) => void submit(text));
  // The detail is optional: with nothing typed there is nothing to commit.
  const send = () => (detail.trim() ? press() : void submit(""));

  return (
    <View style={[styles.fill, { backgroundColor: t.s0 }]}>
      <AppHeader title={tr(REPORT_TITLES[target])} onBack={navigation.goBack} />
      {done ? (
        <View testID="report-done" style={[styles.done, { paddingHorizontal: gutter }]}>
          <Icon name="check" size={28} color={t.pos} />
          <Txt variant="title">{tr("soul_app.circle.report.done_title")}</Txt>
          <Txt variant="caption" tone="muted" style={styles.center}>
            {tr("soul_app.circle.report.done_body")}
          </Txt>
          <Button testID="report-back" kind="secondary" title={tr("common.back")} onPress={navigation.goBack} style={styles.stretch} />
        </View>
      ) : (
        <Screen edges={["left", "right", "bottom"]} testID="report">
          <View style={[styles.form, { paddingHorizontal: gutter }]}>
            {target === "USER" ? (
              <View style={styles.row}>
                <Glyph text={preview} tone="muted" size={32} />
                <Txt variant="bodyLg">{preview}</Txt>
              </View>
            ) : (
              <Txt numberOfLines={3} style={[styles.preview, { borderLeftColor: t.hair2, color: t.inkSubtle, fontFamily: quoteFamily(preview) }]}>
                {preview}
              </Txt>
            )}
            <Txt variant="section" style={styles.formLabel}>
              {tr("soul_app.circle.report.reason")}
            </Txt>
            <View accessibilityRole="radiogroup" style={[styles.radios, { backgroundColor: t.hair, borderColor: t.hair }]}>
              {REASONS.map((r) => {
                const on = r === reason;
                return (
                  <Pressable
                    key={r}
                    testID={`reason-${r}`}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: on }}
                    onPress={() => setReason(r)}
                    style={[styles.radio, { backgroundColor: t.s0, borderLeftColor: on ? t.mark : "transparent" }]}
                  >
                    <View style={[styles.dot, { borderColor: on ? t.mark : t.hair2, backgroundColor: on ? t.mark : "transparent" }]}>
                      {on ? <View style={[styles.dotInner, { backgroundColor: t.s0 }]} /> : null}
                    </View>
                    <Txt variant="bodyLg">{tr(`social_moderation.reason.${r}`)}</Txt>
                  </Pressable>
                );
              })}
            </View>
            <Txt variant="section" style={styles.formLabel}>
              {tr("soul_app.circle.report.detail")}
            </Txt>
            <TextInput
              ref={input}
              testID="report-detail"
              accessibilityLabel={tr("soul_app.circle.report.detail")}
              value={detail}
              onChangeText={setDetail}
              onEndEditing={onEndEditing}
              placeholder={tr("soul_app.circle.report.detail_hint")}
              placeholderTextColor={t.inkSubtle}
              multiline
              maxLength={500}
              style={[styles.detail, { borderColor: t.hair, backgroundColor: t.s1, color: t.ink }]}
            />
            <Button testID="report-submit" title={tr("soul_app.circle.report.submit")} onPress={send} busy={busy} disabled={!reason} style={styles.submit} />
          </View>
        </Screen>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { textAlign: "center" },
  stretch: { alignSelf: "stretch", marginTop: 12 },
  pad: { paddingVertical: 18 },
  row: { flexDirection: "row", alignItems: "center", gap: 14 },
  head: { paddingTop: 22, paddingBottom: 18, gap: 14, borderBottomWidth: 1 },
  civ: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 },
  civText: { fontSize: 10.5, lineHeight: 14, letterSpacing: 1.4 },
  counts: { flexDirection: "row", gap: 22 },
  countBox: { flexDirection: "row", borderWidth: 1 },
  countCell: { flex: 1, minHeight: 52, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, paddingHorizontal: 14, borderLeftWidth: 0 },
  countLabel: { fontSize: 12.5, lineHeight: 18 },
  countValue: { flexDirection: "row", alignItems: "center", gap: 6 },
  countN: { fontSize: 15, lineHeight: 20 },
  reborn: { flexDirection: "row", gap: 10, alignItems: "flex-start", borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12 },
  smallFollow: { minHeight: 34, paddingHorizontal: 12, alignItems: "center", justifyContent: "center" },
  smallFollowText: { fontSize: 12, letterSpacing: 0.4 },
  listRow: { minHeight: 62, flexDirection: "row", alignItems: "center", gap: 12, borderBottomWidth: 1, paddingVertical: 10 },
  more: { alignItems: "center", paddingVertical: 20 },
  scrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)" },
  sheet: { borderTopWidth: 1 },
  menuRow: { minHeight: 54, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 20, borderBottomWidth: 1 },
  menuNote: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 12, borderBottomWidth: 1 },
  menuCancel: { minHeight: 54, alignItems: "center", justifyContent: "center" },
  searchBar: { paddingVertical: 12, borderBottomWidth: 1 },
  searchBox: { minHeight: 44, borderWidth: 1, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12 },
  searchInput: { flex: 1, minHeight: 42, fontSize: 14.5 },
  resultsHead: { paddingTop: 10, paddingBottom: 6 },
  done: { flex: 1, alignItems: "center", gap: 12, paddingTop: 40 },
  form: { paddingVertical: 18 },
  preview: { borderLeftWidth: 2, paddingLeft: 12, fontSize: 14, lineHeight: 24 },
  formLabel: { marginTop: 20, marginBottom: 10 },
  radios: { gap: 1, borderWidth: 1 },
  radio: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, borderLeftWidth: 2 },
  dot: { width: 16, height: 16, borderRadius: 999, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  dotInner: { width: 8, height: 8, borderRadius: 999 },
  detail: { minHeight: 86, borderWidth: 1, padding: 12, fontSize: 13.5, lineHeight: 21, textAlignVertical: "top" },
  submit: { marginTop: 18 },
});
