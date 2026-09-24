/**
 * The 朋友圈 tab (handoff "灵魂簿 App · 朋友圈" 1a–1e): the feed, a new post,
 * and a post with its comments and reactions.
 *
 * What a soul can see is decided server-side (backend/apps/social/soul_circle.py);
 * nothing here filters. The rules the server also enforces are only mirrored:
 * - one reaction per soul per post, the five replace each other, the same one
 *   again removes it — except the eternal light, which is final (409
 *   `eternal_light_locked`), asked for before it is lit, and the only place the
 *   warm gold (`lamp`) appears;
 * - muted: read-only, the post / comment control becomes a dashed note with the
 *   end time in mono;
 * - pending / hidden content is its author's alone, and says so.
 *
 * Next round (not here): profiles, my page, search, report — so authors and the
 * title bar's search / "me" are not tappable yet.
 */
import { soulErrorCode, soulErrorMessage } from "@soulledger/core/api/soul";
import {
  soulSocialApi,
  type SoulComment,
  type SoulPost,
  type SoulPostVisibility,
  type SoulReactionType,
  type SoulSocialStatus,
} from "@soulledger/core/api/soul-social";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useCallback, useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Modal, Pressable, StyleSheet, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useCommittedSend } from "../composing";
import { Icon } from "../emblems";
import { useToast } from "../feedback";
import { quoteFamily } from "../fonts";
import { useI18n } from "../i18n";
import { formatStamp } from "../rules";
import {
  Button,
  Empty,
  FadeIn,
  Interp,
  Notice,
  Screen,
  Skeleton,
  SmallButton,
  Txt,
  useLayout,
  useReloadOnRefocus,
  useRemote,
  useTheme,
} from "../ui";
import type { AppStackParams } from "./applications";
import { Glyph, Tag } from "./letters";

type Nav = NativeStackNavigationProp<AppStackParams>;

/** The server's `CONTENT_MAX` (soul_serializers.py). */
export const POST_MAX = 2000;
export const COMMENT_MAX = 500;

export const REACTIONS: { type: SoulReactionType; key: string; glyph: string }[] = [
  { type: "LIKE", key: "soul_app.circle.react.like", glyph: "◇" },
  { type: "LOVE", key: "soul_app.circle.react.love", glyph: "♡" },
  { type: "RESPECT", key: "soul_app.circle.react.respect", glyph: "△" },
  { type: "SYMPATHY", key: "soul_app.circle.react.sympathy", glyph: "○" },
  { type: "ETERNAL_LIGHT", key: "soul_app.circle.react.eternal_light", glyph: "" },
];

const VISIBILITY: { value: SoulPostVisibility; label: string; hint: string }[] = [
  { value: "PUBLIC", label: "soul_app.circle.compose.vis.public", hint: "soul_app.circle.compose.vis.public_hint" },
  { value: "TENANT", label: "soul_app.circle.compose.vis.tenant", hint: "soul_app.circle.compose.vis.tenant_hint" },
  { value: "FOLLOWERS", label: "soul_app.circle.compose.vis.followers", hint: "soul_app.circle.compose.vis.followers_hint" },
  { value: "PRIVATE", label: "soul_app.circle.compose.vis.private", hint: "soul_app.circle.compose.vis.private_hint" },
];
const visLabel = (v: string) => VISIBILITY.find((o) => o.value === v)?.label ?? "soul_app.circle.compose.vis.tenant";

/** A refusal as copy: the circle's own codes first, then the app's shared table. */
function useFailure() {
  const { t } = useI18n();
  const toast = useToast();
  return (e: unknown) => {
    const code = soulErrorCode(e);
    if (code === "muted") return toast(t("soul_app.circle.muted.body"), "failure");
    if (code === "eternal_light_locked") return toast(t("soul_app.circle.react.lamp_locked"), "failure");
    const m = soulErrorMessage(e);
    toast(t(m.key, m.params), "failure");
  };
}

// ── pieces ─────────────────────────────────────────────────────────────

function Mono({ children, tone = "subtle" }: { children: string; tone?: "subtle" | "muted" }) {
  return (
    <Txt variant="value" tone={tone} style={styles.mono}>
      {children}
    </Txt>
  );
}

/** One reaction's mark: a glyph, or the lit lamp. */
function ReactionMark({ type, size, color }: { type: SoulReactionType; size: number; color: string }) {
  if (type === "ETERNAL_LIGHT") return <Icon name="lampLit" size={size} color={color} strokeWidth={1.2} />;
  return <Txt style={{ fontSize: size, lineHeight: size + 3, color, width: size + 1, textAlign: "center" }}>{REACTIONS.find((r) => r.type === type)?.glyph}</Txt>;
}

/** The five counts, non-zero only; the lamp in gold, mine in the accent. */
function ReactionSummary({ post }: { post: SoulPost }) {
  const t = useTheme();
  const shown = REACTIONS.filter((r) => post.reaction_counts[r.type] > 0);
  if (!shown.length) return null;
  return (
    <View style={styles.summary}>
      {shown.map((r) => {
        const lamp = r.type === "ETERNAL_LIGHT";
        const color = lamp ? t.lamp : post.my_reaction === r.type ? t.accent : t.inkMuted;
        return (
          <View
            key={r.type}
            testID={`count-${r.type}`}
            style={[styles.chip, { borderColor: lamp ? t.lamp : post.my_reaction === r.type ? t.accent : t.hair2, backgroundColor: lamp ? t.lampBg : "transparent" }]}
          >
            <ReactionMark type={r.type} size={12} color={color} />
            <Txt variant="value" style={[styles.chipCount, { color }]}>
              {String(post.reaction_counts[r.type])}
            </Txt>
          </View>
        );
      })}
    </View>
  );
}

/** The dashed note that stands where a muted soul's post / comment control would be (1c / 1d). */
export function MutedLock({ until, testID = "muted-lock" }: { until: string | null; testID?: string }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  return (
    <View testID={testID} style={[styles.lock, { borderColor: t.hair2 }]}>
      <View style={styles.nudge}>
        <Icon name="lock" size={14} color={t.inkSubtle} strokeWidth={1.2} />
      </View>
      <View style={styles.fill}>
        <Txt variant="caption" tone="muted">
          {tr("soul_app.circle.muted.body")}
        </Txt>
        {until ? (
          <Interp
            testID={`${testID}-until`}
            variant="caption"
            tone="subtle"
            style={styles.lockUntil}
            text={tr("soul_app.circle.muted.until")}
            parts={{ time: <Mono>{formatStamp(until) ?? until}</Mono> }}
          />
        ) : null}
      </View>
    </View>
  );
}

function PostCard({ post, onPress, full }: { post: SoulPost; onPress?: () => void; full?: boolean }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const { gutter } = useLayout();
  const reborn = !post.author.is_active;
  const pending = post.moderation_status === "PENDING";
  const hidden = post.moderation_status === "HIDDEN";
  const body = (
    <>
      <View style={styles.cardHead}>
        <Glyph text={post.author.display_name} tone={reborn ? "subtle" : "muted"} dotted={reborn} size={36} />
        <View style={styles.fill}>
          <View style={styles.line}>
            <Txt style={[styles.name, { color: reborn ? t.inkSubtle : t.ink }]} numberOfLines={1}>
              {post.author.display_name}
            </Txt>
            {reborn ? <Tag testID={`reborn-${post.id}`} text={tr("soul_app.circle.post.reborn")} tone="quiet" /> : null}
          </View>
          <View style={[styles.line, styles.meta]}>
            <Mono>{formatStamp(post.create_time) ?? ""}</Mono>
            <Tag text={tr(visLabel(post.visibility))} tone="quiet" />
            {pending ? <Tag testID={`pending-${post.id}`} text={tr("soul_app.circle.post.pending")} tone="accent" /> : null}
            {hidden ? (
              <View style={[styles.tagNeg, { borderColor: t.neg }]}>
                <Txt style={[styles.tagNegText, { color: t.neg }]}>{tr("soul_app.circle.post.hidden")}</Txt>
              </View>
            ) : null}
          </View>
        </View>
      </View>
      <Txt
        numberOfLines={full ? undefined : 8}
        style={[styles.body, { color: hidden ? t.inkSubtle : t.inkMuted, fontFamily: quoteFamily(post.content) }]}
      >
        {post.content}
      </Txt>
      {pending ? (
        <View style={[styles.note, { borderColor: t.hair2 }]}>
          <Txt variant="caption" tone="subtle">
            {tr("soul_app.circle.post.pending_note")}
          </Txt>
        </View>
      ) : hidden ? (
        <View style={[styles.note, { borderColor: t.negStrong }]}>
          <Txt variant="caption" tone="neg">
            {tr("soul_app.circle.post.hidden_note")}
          </Txt>
        </View>
      ) : null}
      <View style={styles.cardFoot}>
        <ReactionSummary post={post} />
        <View style={styles.fill} />
        {full ? null : (
          <Txt variant="caption" tone="subtle">
            {tr("soul_app.circle.post.comments", { n: String(post.comment_count) })}
          </Txt>
        )}
      </View>
    </>
  );
  const style = [styles.card, { paddingHorizontal: gutter, borderBottomColor: t.hair }];
  return onPress ? (
    <Pressable testID={`post-${post.id}`} accessibilityRole="button" onPress={onPress} style={({ pressed }) => [style, pressed && { backgroundColor: t.s1 }]}>
      {body}
    </Pressable>
  ) : (
    <View testID={`post-${post.id}`} style={style}>
      {body}
    </View>
  );
}

// ── feed ───────────────────────────────────────────────────────────────

/**
 * One sub-page of the feed, a page at a time. What is held is tagged with the
 * sub-page it answers, so a switch shows nothing stale, and a late answer for
 * the other sub-page is dropped.
 */
function useFeed(following: boolean) {
  const [held, setHeld] = useState<{ following: boolean; posts: SoulPost[] | null; next: number | null; error: unknown }>({
    following,
    posts: null,
    next: null,
    error: null,
  });
  const [loading, setLoading] = useState(true);
  const ticket = useRef(0);
  const run = useCallback(
    async (page: number) => {
      const mine = ++ticket.current;
      setLoading(true);
      try {
        const res = await soulSocialApi.feed({ following, page });
        if (mine !== ticket.current) return;
        setHeld((prev) => ({
          following,
          posts: page === 1 || prev.following !== following ? res.results : [...(prev.posts ?? []), ...res.results],
          next: res.next ? page + 1 : null,
          error: null,
        }));
      } catch (e) {
        if (mine === ticket.current) setHeld((prev) => (prev.following === following ? { ...prev, error: e } : { following, posts: null, next: null, error: e }));
      } finally {
        if (mine === ticket.current) setLoading(false);
      }
    },
    [following]
  );
  useEffect(() => {
    void run(1);
  }, [run]);
  const reload = useCallback(() => run(1), [run]);
  const mineNow = held.following === following;
  const next = mineNow ? held.next : null;
  return {
    posts: mineNow ? held.posts : null,
    error: mineNow ? held.error : null,
    loading,
    reload,
    more: next ? () => void run(next) : null,
  };
}

export function CircleScreen() {
  const t = useTheme();
  const { t: tr } = useI18n();
  const { gutter } = useLayout();
  const navigation = useNavigation<Nav>();
  const route = useRoute<RouteProp<{ Circle: { pendingId?: string } | undefined }, "Circle">>();
  const [following, setFollowing] = useState(true);
  const feed = useFeed(following);
  useReloadOnRefocus(feed.reload);
  const pendingId = route.params?.pendingId;
  const justPending = feed.posts?.some((p) => p.id === pendingId && p.moderation_status === "PENDING");
  const write = () => navigation.navigate("ComposePost");

  return (
    <Screen refreshing={feed.loading && !!feed.posts} onRefresh={feed.reload} edges={["left", "right"]} testID="circle">
      <View style={[styles.subTabs, { borderBottomColor: t.hair }]}>
        {([true, false] as const).map((f) => {
          const on = f === following;
          return (
            <Pressable
              key={String(f)}
              testID={f ? "circle-following" : "circle-tenant"}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              onPress={() => setFollowing(f)}
              style={[styles.subTab, { borderBottomColor: on ? t.mark : "transparent" }]}
            >
              <Txt variant="label" tone={on ? "ink" : "subtle"} style={styles.subTabText}>
                {tr(f ? "soul_app.circle.feed.following" : "soul_app.circle.feed.tenant")}
              </Txt>
            </Pressable>
          );
        })}
      </View>
      <Pressable
        testID="compose-entry"
        accessibilityRole="button"
        onPress={write}
        style={[styles.entry, { paddingHorizontal: gutter, borderBottomColor: t.hair }]}
      >
        <View style={[styles.entryBox, { borderColor: t.hair, backgroundColor: t.s1 }]}>
          <Txt style={[styles.entryText, { color: t.inkSubtle, fontFamily: quoteFamily(tr("soul_app.circle.feed.compose_hint")) }]}>
            {tr("soul_app.circle.feed.compose_hint")}
          </Txt>
        </View>
      </Pressable>
      {justPending ? (
        <View testID="pending-banner" style={[styles.banner, { paddingHorizontal: gutter, borderBottomColor: t.hair, borderLeftColor: t.accent, backgroundColor: t.s1 }]}>
          <Txt variant="bodyLg">{tr("soul_app.circle.compose.pending_title")}</Txt>
          <Txt variant="caption" tone="muted">
            {tr("soul_app.circle.compose.pending_body")}
          </Txt>
        </View>
      ) : null}
      {feed.error && !feed.posts ? (
        <View style={[styles.pad, { paddingHorizontal: gutter }]}>
          <Notice tone="neg" onRetry={() => void feed.reload()} testID="circle-error">
            {tr("soul_app.circle.feed.error")}
          </Notice>
        </View>
      ) : !feed.posts ? (
        <View style={[styles.pad, { paddingHorizontal: gutter }]}>
          <Skeleton lines={6} testID="circle-loading" />
        </View>
      ) : feed.posts.length === 0 ? (
        <View testID="circle-empty" style={styles.empty}>
          <Txt variant="bodyLg" tone="muted" style={styles.center}>
            {tr("soul_app.circle.feed.empty_title")}
          </Txt>
          <Empty text={tr("soul_app.circle.feed.empty_body")} />
          <Button testID="circle-write" title={tr("soul_app.circle.feed.write")} onPress={write} />
        </View>
      ) : (
        <FadeIn>
          {feed.posts.map((p) => (
            <PostCard key={p.id} post={p} onPress={() => navigation.navigate("CirclePost", { id: p.id })} />
          ))}
          {feed.more ? (
            <View style={styles.more}>
              <SmallButton testID="circle-more" title={tr("soul_app.circle.feed.more")} onPress={feed.more} />
            </View>
          ) : null}
        </FadeIn>
      )}
    </Screen>
  );
}

// ── compose ────────────────────────────────────────────────────────────

export function ComposePostScreen() {
  const t = useTheme();
  const { t: tr } = useI18n();
  const { gutter } = useLayout();
  const navigation = useNavigation<Nav>();
  const fail = useFailure();
  const status = useRemote(soulSocialApi.status);
  const [draft, setDraft] = useState("");
  const [visibility, setVisibility] = useState<SoulPostVisibility>("TENANT");
  const [busy, setBusy] = useState(false);
  const input = useRef<TextInput>(null);

  const submit = async (text: string) => {
    if (busy || !text.trim()) return;
    setBusy(true);
    try {
      const post = await soulSocialApi.createPost(text.trim(), visibility);
      navigation.popTo("Tabs", { screen: "Circle", params: { pendingId: post.moderation_status === "PENDING" ? post.id : undefined } });
    } catch (e) {
      setBusy(false);
      fail(e);
    }
  };
  const { press, onEndEditing } = useCommittedSend(input, draft, (text) => void submit(text));

  return (
    <Screen edges={["left", "right", "bottom"]} testID="compose-post">
      <View style={[styles.form, { paddingHorizontal: gutter }]}>
        <TextInput
          ref={input}
          testID="post-body"
          accessibilityLabel={tr("soul_app.circle.compose.title")}
          value={draft}
          onChangeText={setDraft}
          onEndEditing={onEndEditing}
          placeholder={tr("soul_app.circle.feed.compose_hint")}
          placeholderTextColor={t.inkSubtle}
          multiline
          maxLength={POST_MAX}
          style={[styles.postInput, { borderColor: t.hair2, backgroundColor: t.s1, color: t.ink, fontFamily: quoteFamily(draft || tr("soul_app.circle.feed.compose_hint")) }]}
        />
        <View style={styles.counter}>
          <Mono>{`${draft.length} / ${POST_MAX}`}</Mono>
        </View>
        <Txt variant="section" style={styles.formLabel}>
          {tr("soul_app.circle.compose.visibility")}
        </Txt>
        <View accessibilityRole="radiogroup" style={[styles.radios, { backgroundColor: t.hair, borderColor: t.hair }]}>
          {VISIBILITY.map((o) => {
            const on = o.value === visibility;
            return (
              <Pressable
                key={o.value}
                testID={`vis-${o.value}`}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                onPress={() => setVisibility(o.value)}
                style={[styles.radio, { backgroundColor: t.s0, borderLeftColor: on ? t.mark : "transparent" }]}
              >
                <View style={[styles.dot, { borderColor: on ? t.mark : t.hair2, backgroundColor: on ? t.mark : "transparent" }]}>
                  {on ? <View style={[styles.dotInner, { backgroundColor: t.s0 }]} /> : null}
                </View>
                <View style={styles.fill}>
                  <Txt variant="bodyLg">{tr(o.label)}</Txt>
                  <Txt variant="caption" tone="subtle">
                    {tr(o.hint)}
                  </Txt>
                </View>
              </Pressable>
            );
          })}
        </View>
        <Txt variant="caption" tone="subtle" style={styles.scope}>
          {tr("soul_app.circle.compose.scope_note")}
        </Txt>
        {status.data && !status.data.can_write ? (
          <MutedLock until={status.data.muted_until} />
        ) : (
          <Button
            testID="post-submit"
            title={tr("soul_app.circle.compose.submit")}
            onPress={press}
            busy={busy}
            disabled={!draft.trim() || !status.data}
          />
        )}
      </View>
    </Screen>
  );
}

// ── one post ───────────────────────────────────────────────────────────

function ReactionBar({ post, status, onReact }: { post: SoulPost; status: SoulSocialStatus | null; onReact: (type: SoulReactionType) => void }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const { gutter } = useLayout();
  const lit = post.my_reaction === "ETERNAL_LIGHT";
  const [asking, setAsking] = useState(false);
  const insets = useSafeAreaInsets();
  const inert = lit || !status?.can_write;
  return (
    <View testID="reactions" style={[styles.bar, { paddingHorizontal: gutter, borderBottomColor: t.hair }]}>
      <View style={styles.summary}>
        {REACTIONS.map((r) => {
          const lamp = r.type === "ETERNAL_LIGHT";
          const on = post.my_reaction === r.type;
          const color = on ? (lamp ? t.lamp : t.accent) : t.inkSubtle;
          return (
            <Pressable
              key={r.type}
              testID={`react-${r.type}`}
              accessibilityRole="button"
              accessibilityLabel={tr(r.key)}
              accessibilityState={{ selected: on, disabled: inert }}
              disabled={inert}
              onPress={() => (lamp ? setAsking(true) : onReact(r.type))}
              style={[
                styles.reaction,
                on
                  ? { borderColor: lamp ? t.lamp : t.accent, borderStyle: "solid", backgroundColor: lamp ? t.lampBg : "transparent" }
                  : { borderColor: t.hair2, borderStyle: lit ? "dotted" : "solid", opacity: lit ? 0.5 : 1 },
              ]}
            >
              {lamp ? <Icon name={on ? "lampLit" : "lamp"} size={13} color={color} strokeWidth={1.2} /> : <ReactionMark type={r.type} size={13} color={color} />}
              <Txt variant="label" style={[styles.noSpacing, { color }]}>
                {tr(r.key)}
              </Txt>
            </Pressable>
          );
        })}
      </View>
      {lit ? (
        <View testID="lamp-locked" style={styles.lampNote}>
          <Icon name="lampLit" size={12} color={t.lamp} strokeWidth={1.2} />
          <Txt variant="caption" style={{ color: t.lamp }}>
            {tr("soul_app.circle.react.lamp_locked")}
          </Txt>
        </View>
      ) : null}
      <Modal visible={asking} transparent animationType="fade" onRequestClose={() => setAsking(false)}>
        <View style={styles.scrim}>
          <Pressable style={styles.fill} onPress={() => setAsking(false)} accessibilityLabel={tr("soul_app.circle.react.lamp_cancel")} />
          <View testID="lamp-sheet" accessibilityViewIsModal style={[styles.sheet, { backgroundColor: t.s1, borderTopColor: t.lamp, paddingBottom: 28 + insets.bottom }]}>
            <View style={styles.line}>
              <Icon name="lampLit" size={22} color={t.lamp} strokeWidth={1.2} />
              <Txt variant="title" style={styles.sheetTitle}>
                {tr("soul_app.circle.react.lamp_confirm_title", { name: post.author.display_name })}
              </Txt>
            </View>
            <Txt variant="caption" tone="muted">
              {tr("soul_app.circle.react.lamp_confirm_body")}
            </Txt>
            <Pressable
              testID="lamp-confirm"
              accessibilityRole="button"
              onPress={() => {
                setAsking(false);
                onReact("ETERNAL_LIGHT");
              }}
              style={({ pressed }) => [styles.lampButton, { backgroundColor: t.lamp, opacity: pressed ? 0.85 : 1 }]}
            >
              <Txt style={[styles.lampButtonText, { color: t.lampBg }]}>{tr("soul_app.circle.react.lamp_confirm")}</Txt>
            </Pressable>
            <Button testID="lamp-cancel" kind="secondary" title={tr("soul_app.circle.react.lamp_cancel")} onPress={() => setAsking(false)} />
          </View>
        </View>
      </Modal>
    </View>
  );
}

function CommentRow({ c }: { c: SoulComment }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const { gutter } = useLayout();
  return (
    <View testID={`comment-${c.id}`} style={[styles.comment, { paddingHorizontal: gutter, borderBottomColor: t.hair }]}>
      <Glyph text={c.author.display_name} tone={c.author.is_active ? "muted" : "subtle"} dotted={!c.author.is_active} size={28} />
      <View style={styles.fill}>
        <View style={styles.line}>
          <Txt style={styles.commentName}>{c.author.display_name}</Txt>
          <Mono>{formatStamp(c.create_time) ?? ""}</Mono>
          {c.moderation_status === "PENDING" ? <Tag testID={`comment-pending-${c.id}`} text={tr("soul_app.circle.comment.pending")} tone="accent" /> : null}
        </View>
        <Txt style={[styles.commentBody, { color: t.inkMuted, fontFamily: quoteFamily(c.content) }]}>{c.content}</Txt>
      </View>
    </View>
  );
}

export function PostScreen({ id }: { id: string }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const { gutter } = useLayout();
  const insets = useSafeAreaInsets();
  const fail = useFailure();
  const post = useRemote(useCallback(() => soulSocialApi.post(id), [id]));
  // ponytail: first page of comments only (20); a "more" like the feed's when threads grow.
  const comments = useRemote(useCallback(() => soulSocialApi.comments(id), [id]));
  const status = useRemote(soulSocialApi.status);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const input = useRef<TextInput>(null);

  const react = async (type: SoulReactionType) => {
    try {
      await soulSocialApi.react(id, type);
    } catch (e) {
      fail(e);
    }
    void post.reload();
  };
  const send = async (text: string) => {
    if (sending || !text.trim()) return;
    setSending(true);
    try {
      await soulSocialApi.comment(id, text.trim());
      setDraft("");
      void comments.reload();
      void post.reload();
    } catch (e) {
      fail(e);
    } finally {
      setSending(false);
    }
  };
  const { press, onEndEditing } = useCommittedSend(input, draft, (text) => void send(text));

  if (post.error && !post.data) {
    return (
      <Screen scroll={false} edges={["left", "right"]}>
        <View style={[styles.pad, { paddingHorizontal: gutter }]}>
          <Notice tone="neg" onRetry={() => void post.reload()} testID="post-error">
            {tr(soulErrorMessage(post.error).key, soulErrorMessage(post.error).params)}
          </Notice>
        </View>
      </Screen>
    );
  }
  const p = post.data;
  // Pending / hidden posts, and a past life's, take neither reactions nor comments (the server refuses too).
  const open = p?.moderation_status === "PUBLISHED" && p.author.is_active;
  const muted = status.data && !status.data.can_write;

  return (
    <KeyboardAvoidingView style={[styles.fill, { backgroundColor: t.s0 }]} behavior="padding" keyboardVerticalOffset={-insets.bottom}>
      <Screen edges={["left", "right"]} testID="circle-post" refreshing={post.loading && !!p} onRefresh={() => void post.reload()}>
        {!p ? (
          <View style={[styles.pad, { paddingHorizontal: gutter }]}>
            <Skeleton lines={5} testID="post-loading" />
          </View>
        ) : (
          <>
            <PostCard post={p} full />
            {open ? <ReactionBar post={p} status={status.data} onReact={(type) => void react(type)} /> : null}
            <Txt variant="section" style={[styles.commentsHead, { paddingHorizontal: gutter }]}>
              {tr("soul_app.circle.post.comments", { n: String(p.comment_count) })}
            </Txt>
            {comments.data ? comments.data.results.map((c) => <CommentRow key={c.id} c={c} />) : <View style={[styles.pad, { paddingHorizontal: gutter }]}><Skeleton lines={2} /></View>}
          </>
        )}
      </Screen>
      {open ? (
        <View style={[styles.dock, { paddingHorizontal: 12, paddingBottom: 10 + insets.bottom, borderTopColor: t.hair, backgroundColor: t.s1 }]}>
          {muted ? (
            <MutedLock until={status.data?.muted_until ?? null} />
          ) : (
            <View testID="comment-composer" style={styles.composer}>
              <TextInput
                ref={input}
                testID="comment-body"
                accessibilityLabel={tr("soul_app.circle.comment.hint")}
                value={draft}
                onChangeText={setDraft}
                onEndEditing={onEndEditing}
                placeholder={tr("soul_app.circle.comment.hint")}
                placeholderTextColor={t.inkSubtle}
                multiline
                maxLength={COMMENT_MAX}
                style={[styles.commentInput, { borderColor: t.hair2, backgroundColor: t.s0, color: t.ink, fontFamily: quoteFamily(draft || tr("soul_app.circle.comment.hint")) }]}
              />
              <Pressable
                testID="comment-send"
                accessibilityRole="button"
                accessibilityState={{ disabled: !draft.trim() || sending || !status.data }}
                disabled={!draft.trim() || sending || !status.data}
                onPress={press}
                style={({ pressed }) => [styles.send, { backgroundColor: pressed ? t.mark : t.accent, opacity: draft.trim() ? 1 : 0.6 }]}
              >
                <Txt style={[styles.sendText, { color: t.onAccent }]}>{tr("soul_app.circle.comment.send")}</Txt>
              </Pressable>
            </View>
          )}
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { textAlign: "center" },
  noSpacing: { letterSpacing: 0 },
  pad: { paddingVertical: 22 },
  mono: { fontSize: 11.5, lineHeight: 16 },
  line: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  meta: { marginTop: 5 },
  name: { fontSize: 14, lineHeight: 19, flexShrink: 1 },
  card: { paddingVertical: 16, borderBottomWidth: 1 },
  cardHead: { flexDirection: "row", gap: 11, alignItems: "flex-start" },
  body: { marginTop: 12, fontSize: 15.5, lineHeight: 27 },
  note: { marginTop: 10, borderWidth: 1, borderStyle: "dashed", paddingHorizontal: 11, paddingVertical: 9 },
  cardFoot: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 13, flexWrap: "wrap" },
  summary: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 7, paddingVertical: 3, borderWidth: 1 },
  chipCount: { fontSize: 11.5, lineHeight: 15 },
  tagNeg: { borderWidth: 1, paddingHorizontal: 6, paddingVertical: 2 },
  tagNegText: { fontSize: 10.5, lineHeight: 14, letterSpacing: 0.8 },
  subTabs: { flexDirection: "row", borderBottomWidth: 1 },
  subTab: { flex: 1, minHeight: 44, alignItems: "center", justifyContent: "center", borderBottomWidth: 2 },
  subTabText: { fontSize: 13, letterSpacing: 0.4 },
  entry: { paddingVertical: 12, borderBottomWidth: 1 },
  entryBox: { minHeight: 40, borderWidth: 1, justifyContent: "center", paddingHorizontal: 12 },
  entryText: { fontSize: 14 },
  banner: { paddingVertical: 14, borderBottomWidth: 1, borderLeftWidth: 3, gap: 5 },
  empty: { paddingVertical: 48, paddingHorizontal: 34, alignItems: "stretch", gap: 4 },
  more: { alignItems: "center", paddingVertical: 20 },
  form: { paddingVertical: 18 },
  postInput: { minHeight: 150, borderWidth: 1, padding: 13, fontSize: 15.5, lineHeight: 27, textAlignVertical: "top" },
  counter: { alignItems: "flex-end", marginTop: 6 },
  formLabel: { marginTop: 20, marginBottom: 10 },
  radios: { gap: 1, borderWidth: 1 },
  radio: { flexDirection: "row", gap: 12, alignItems: "flex-start", paddingHorizontal: 14, paddingVertical: 13, borderLeftWidth: 2 },
  dot: { width: 16, height: 16, marginTop: 4, borderRadius: 999, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  dotInner: { width: 8, height: 8, borderRadius: 999 },
  scope: { marginTop: 10, marginBottom: 20 },
  lock: { flexDirection: "row", gap: 9, alignItems: "flex-start", borderWidth: 1, borderStyle: "dashed", paddingHorizontal: 13, paddingVertical: 12 },
  nudge: { marginTop: 3 },
  lockUntil: { marginTop: 6 },
  bar: { paddingVertical: 12, borderBottomWidth: 1 },
  reaction: { minWidth: 44, minHeight: 40, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderWidth: 1 },
  lampNote: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: 9 },
  scrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)" },
  sheet: { borderTopWidth: 1, paddingTop: 22, paddingHorizontal: 20, gap: 10 },
  sheetTitle: { fontSize: 16, flexShrink: 1 },
  lampButton: { minHeight: 46, alignItems: "center", justifyContent: "center", marginTop: 8 },
  lampButtonText: { fontSize: 14, letterSpacing: 0.6 },
  commentsHead: { paddingTop: 14, paddingBottom: 8 },
  comment: { flexDirection: "row", gap: 10, paddingVertical: 13, borderBottomWidth: 1 },
  commentName: { fontSize: 13, lineHeight: 18 },
  commentBody: { marginTop: 5, fontSize: 14.5, lineHeight: 24 },
  dock: { borderTopWidth: 1, paddingTop: 10 },
  composer: { flexDirection: "row", gap: 8, alignItems: "flex-end" },
  commentInput: { flex: 1, minHeight: 42, maxHeight: 120, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  send: { minHeight: 42, minWidth: 56, paddingHorizontal: 14, alignItems: "center", justifyContent: "center" },
  sendText: { fontSize: 13, letterSpacing: 0.6 },
});
