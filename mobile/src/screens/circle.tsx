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
 * Profiles, my page, search and report are in ./circlePeople.
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
import { useSoulMediaUploads } from "@soulledger/core/hooks/useSoulMediaUploads";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useCallback, useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Modal, Pressable, StyleSheet, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppHeader } from "../chrome";
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
import { ComposeMediaTray, MediaGrid, MediaViewer, pickImages, uploadBody, type PickedImage } from "./circleMedia";
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
const REFUSALS: Record<string, string> = {
  muted: "soul_app.circle.muted.body",
  eternal_light_locked: "soul_app.circle.react.lamp_locked",
  post_sealed: "soul_app.circle.profile.reborn_body",
  report_limit: "soul_app.circle.report.limit",
  // 图片(apps/social/media.py)。media_not_found:传好的图过了清理时限、已被清掉。
  not_an_image: "soul_app.circle.media.errors.not_an_image",
  too_large: "soul_app.circle.media.errors.too_large",
  too_many_pixels: "soul_app.circle.media.errors.too_many_pixels",
  too_many_pending: "soul_app.circle.media.errors.too_many_pending",
  too_many_media: "soul_app.circle.media.limit",
  media_not_found: "soul_app.circle.media.expired",
};

export function useFailure() {
  const { t } = useI18n();
  const toast = useToast();
  return (e: unknown) => {
    const code = soulErrorCode(e);
    if (code && code in REFUSALS) return toast(t(REFUSALS[code]), "failure");
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

export function PostCard({ post, onPress, onAuthor, full }: { post: SoulPost; onPress?: () => void; onAuthor?: () => void; full?: boolean }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const { gutter } = useLayout();
  const reborn = !post.author.is_active;
  const pending = post.moderation_status === "PENDING";
  const hidden = post.moderation_status === "HIDDEN";
  const [viewing, setViewing] = useState<number | null>(null);
  const body = (
    <>
      <View style={styles.cardHead}>
        <Pressable testID={`author-${post.id}`} accessibilityRole="button" accessibilityLabel={post.author.display_name} disabled={!onAuthor} onPress={onAuthor} hitSlop={4}>
          <Glyph text={post.author.display_name} tone={reborn ? "subtle" : "muted"} dotted={reborn} size={36} />
        </Pressable>
        <View style={styles.fill}>
          <View style={styles.line}>
            <Txt style={[styles.name, { color: reborn ? t.inkSubtle : t.ink }]} numberOfLines={1} onPress={onAuthor}>
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
      {post.content ? (
        <Txt
          numberOfLines={full ? undefined : 8}
          style={[styles.body, { color: hidden ? t.inkSubtle : t.inkMuted, fontFamily: quoteFamily(post.content) }]}
        >
          {post.content}
        </Txt>
      ) : null}
      <MediaGrid testID={`media-${post.id}`} media={post.media} onOpen={setViewing} />
      <MediaViewer media={post.media} index={viewing} onClose={() => setViewing(null)} />
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

type Page<T> = { results: T[]; next?: string | null };

/**
 * A list read a page at a time: the feed, one soul's posts, one post's comments.
 * What is held is tagged with the query it answers, so a switch shows nothing
 * stale; a late answer (another query, or overtaken by a newer request) is
 * dropped; a row already held is not added twice (the list moved under the
 * pages between two requests). `reload` re-reads every page held so far, so a
 * refresh does not fold the list back to its first page.
 */
export function usePaged<T extends { id: string }>(tag: string, fetchPage: (page: number) => Promise<Page<T>>, enabled = true) {
  const [held, setHeld] = useState<{ tag: string; rows: T[] | null; pages: number; next: number | null; error: unknown }>({
    tag,
    rows: null,
    pages: 0,
    next: null,
    error: null,
  });
  const [loading, setLoading] = useState(true);
  const ticket = useRef(0);
  const fetchRef = useRef(fetchPage);
  fetchRef.current = fetchPage;
  const pagesRef = useRef(0);
  pagesRef.current = held.tag === tag ? held.pages : 0;
  /** Read pages `from`..`to`; from 1 replaces what is held, otherwise appends. */
  const run = useCallback(
    async (from: number, to: number) => {
      const mine = ++ticket.current;
      setLoading(true);
      try {
        const got: T[] = [];
        let res: Page<T> = { results: [] };
        let last = from;
        for (; last <= to; last++) {
          res = await fetchRef.current(last);
          got.push(...res.results);
          if (!res.next || last === to) break;
        }
        if (mine !== ticket.current) return;
        setHeld((prev) => {
          const base = from === 1 || prev.tag !== tag ? [] : (prev.rows ?? []);
          const seen = new Set(base.map((r) => r.id));
          const rows = [...base];
          for (const r of got) {
            if (seen.has(r.id)) continue;
            seen.add(r.id);
            rows.push(r);
          }
          return { tag, rows, pages: last, next: res.next ? last + 1 : null, error: null };
        });
      } catch (e) {
        if (mine === ticket.current) setHeld((prev) => (prev.tag === tag ? { ...prev, error: e } : { tag, rows: null, pages: 0, next: null, error: e }));
      } finally {
        if (mine === ticket.current) setLoading(false);
      }
    },
    [tag]
  );
  useEffect(() => {
    if (enabled) void run(1, 1);
  }, [run, enabled]);
  const reload = useCallback(() => run(1, Math.max(1, pagesRef.current)), [run]);
  const current = held.tag === tag;
  const next = current ? held.next : null;
  return {
    rows: current ? held.rows : null,
    error: current ? held.error : null,
    loading,
    reload,
    more: next ? () => void run(next, next) : null,
  };
}

/** One list of posts — a feed sub-page, or one soul's posts. */
export function useFeed(query: { following?: boolean; author?: number }, enabled = true) {
  const tag = JSON.stringify(query);
  const { rows, ...rest } = usePaged<SoulPost>(tag, (page) => soulSocialApi.feed({ ...query, page }), enabled);
  return { posts: rows, ...rest };
}

/** Posts, and the "earlier posts" button while there are more. */
export function PostList({ feed, onAuthor }: { feed: ReturnType<typeof useFeed>; onAuthor: (post: SoulPost) => void }) {
  const { t: tr } = useI18n();
  const navigation = useNavigation<Nav>();
  return (
    <FadeIn>
      {(feed.posts ?? []).map((p) => (
        <PostCard key={p.id} post={p} onPress={() => navigation.navigate("CirclePost", { id: p.id })} onAuthor={() => onAuthor(p)} />
      ))}
      {feed.more ? (
        <View style={styles.more}>
          <SmallButton testID="circle-more" title={tr("soul_app.circle.feed.more")} onPress={feed.more} />
        </View>
      ) : null}
    </FadeIn>
  );
}

/** A soul's page: mine is "my page", anyone else's is their profile. */
export function useOpenSoul() {
  const navigation = useNavigation<Nav>();
  return (card: { user_id: number }, isMine: boolean) =>
    isMine ? navigation.navigate("MyCircle") : navigation.navigate("SoulProfile", { userId: card.user_id });
}

export function CircleScreen() {
  const t = useTheme();
  const { t: tr } = useI18n();
  const { gutter } = useLayout();
  const navigation = useNavigation<Nav>();
  const route = useRoute<RouteProp<{ Circle: { pendingId?: string } | undefined }, "Circle">>();
  const [following, setFollowing] = useState(true);
  const feed = useFeed({ following });
  const openSoul = useOpenSoul();
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
        <PostList feed={feed} onAuthor={(p) => openSoul(p.author, p.is_mine)} />
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
  const toast = useToast();
  const uploads = useSoulMediaUploads<PickedImage>(uploadBody);
  // 一张失败的上传在它自己的格子里说,这里另报一次原因(大小、格式……)。
  const reported = useRef(new Set<string>());
  useEffect(() => {
    for (const it of uploads.items) {
      if (it.status === "failed" && !reported.current.has(it.key)) {
        reported.current.add(it.key);
        fail(it.error);
      }
      if (it.status !== "failed") reported.current.delete(it.key);
    }
  }, [uploads.items, fail]);
  // 离开而没发出:传好的图删掉,不等清理命令。发出后 `clear()` 已把它们交给帖子。
  // `posted` 而不是只靠 clear():发出后界面立刻退出,清空的状态可能还没渲染就卸载了。
  const discard = useRef(uploads.discard);
  const posted = useRef(false);
  useEffect(() => {
    discard.current = uploads.discard;
  });
  useEffect(
    () => () => {
      if (!posted.current) discard.current();
    },
    []
  );

  const addImages = async () => {
    const picked = await pickImages(uploads.room);
    if (picked === null) toast(tr("soul_app.circle.media.permission"), "failure");
    else if (picked.length) uploads.add(picked);
  };

  const submit = async (text: string) => {
    if (busy || !uploads.ready || (!text.trim() && !uploads.mediaIds.length)) return;
    setBusy(true);
    try {
      const post = await soulSocialApi.createPost(text.trim(), visibility, uploads.mediaIds);
      posted.current = true;
      uploads.clear();
      navigation.popTo("Tabs", { screen: "Circle", params: { pendingId: post.moderation_status === "PENDING" ? post.id : undefined } });
    } catch (e) {
      setBusy(false);
      fail(e);
    }
  };
  const { press, onEndEditing } = useCommittedSend(input, draft, (text) => void submit(text), uploads.mediaIds.length > 0);

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
        <ComposeMediaTray uploads={uploads} onAdd={() => void addImages()} />
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
            disabled={(!draft.trim() && !uploads.mediaIds.length) || !status.data || !uploads.ready}
            reason={
              uploads.failed
                ? tr("soul_app.circle.media.failed_hint")
                : uploads.uploading
                  ? tr("soul_app.circle.media.waiting")
                  : undefined
            }
            reasonTestID="post-submit-reason"
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

function CommentRow({
  c,
  parent,
  onAuthor,
  onMore,
  onReply,
}: {
  c: SoulComment;
  /** The comment this one answers, when it is among those loaded; not guessed when it is not. */
  parent?: SoulComment;
  onAuthor: () => void;
  /** Mine: delete. Anyone else's: report. */
  onMore: () => void;
  /** Absent when nothing can be written here (muted, a sealed post) or this comment cannot be answered. */
  onReply?: () => void;
}) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const { gutter } = useLayout();
  return (
    <View testID={`comment-${c.id}`} style={[styles.comment, { paddingHorizontal: gutter, borderBottomColor: t.hair }]}>
      <Pressable accessibilityRole="button" accessibilityLabel={c.author.display_name} onPress={onAuthor} hitSlop={4}>
        <Glyph text={c.author.display_name} tone={c.author.is_active ? "muted" : "subtle"} dotted={!c.author.is_active} size={28} />
      </Pressable>
      <View style={styles.fill}>
        <View style={styles.line}>
          <Txt style={styles.commentName} onPress={onAuthor}>
            {c.author.display_name}
          </Txt>
          <Mono>{formatStamp(c.create_time) ?? ""}</Mono>
          {c.moderation_status === "PENDING" ? <Tag testID={`comment-pending-${c.id}`} text={tr("soul_app.circle.comment.pending")} tone="accent" /> : null}
        </View>
        {parent ? (
          <Txt testID={`reply-to-${c.id}`} variant="caption" tone="subtle" style={styles.replyTo}>
            {tr("soul_app.circle.comment.reply_to", { name: parent.author.display_name })}
          </Txt>
        ) : null}
        <Txt style={[styles.commentBody, { color: t.inkMuted, fontFamily: quoteFamily(c.content) }]}>{c.content}</Txt>
        {onReply ? (
          <Txt testID={`comment-reply-${c.id}`} accessibilityRole="button" variant="caption" tone="subtle" style={styles.replyButton} onPress={onReply}>
            {tr("soul_app.circle.comment.reply")}
          </Txt>
        ) : null}
      </View>
      <Pressable
        testID={`comment-more-${c.id}`}
        accessibilityRole="button"
        accessibilityLabel={tr(c.is_mine ? "soul_app.circle.delete.action" : "soul_app.circle.report.comment")}
        onPress={onMore}
        style={styles.commentMore}
      >
        <Icon name="more" size={14} color={t.inkSubtle} strokeWidth={2} />
      </Pressable>
    </View>
  );
}

/**
 * Deleting my own post or comment: "⋯" opens 删除 / 取消, and 删除 asks once
 * more before anything is sent. Deleting cannot be undone, so it is never one tap.
 */
function DeleteSheet({ target, onClose, onDeleted }: { target: { kind: "post" | "comment"; id: string } | null; onClose: () => void; onDeleted: () => void }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const insets = useSafeAreaInsets();
  const fail = useFailure();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const close = () => {
    setAsking(false);
    onClose();
  };
  const remove = async () => {
    if (!target || busy) return;
    setBusy(true);
    try {
      await (target.kind === "post" ? soulSocialApi.deletePost(target.id) : soulSocialApi.deleteComment(target.id));
      setAsking(false);
      onDeleted();
    } catch (e) {
      fail(e);
      close();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal visible={!!target} transparent animationType="fade" onRequestClose={close}>
      <View style={styles.scrim}>
        <Pressable style={styles.fill} onPress={close} accessibilityLabel={tr("soul_app.common.cancel")} />
        {asking ? (
          <View testID="delete-confirm-sheet" accessibilityViewIsModal style={[styles.sheet, { backgroundColor: t.s1, borderTopColor: t.negStrong, paddingBottom: 28 + insets.bottom }]}>
            <Txt variant="title" style={styles.sheetTitle}>
              {tr(target?.kind === "post" ? "soul_app.circle.delete.post_title" : "soul_app.circle.delete.comment_title")}
            </Txt>
            <Txt variant="caption" tone="muted">
              {tr("soul_app.circle.delete.body")}
            </Txt>
            <Button testID="delete-confirm" kind="danger" title={tr("soul_app.circle.delete.confirm")} busy={busy} onPress={() => void remove()} />
            <Button testID="delete-cancel" kind="secondary" title={tr("soul_app.common.cancel")} onPress={close} />
          </View>
        ) : (
          <View testID="delete-menu" accessibilityViewIsModal style={[styles.menu, { backgroundColor: t.s1, borderTopColor: t.hair2, paddingBottom: 20 + insets.bottom }]}>
            <Pressable testID="delete-row" accessibilityRole="button" onPress={() => setAsking(true)} style={[styles.menuRow, { borderBottomColor: t.hair }]}>
              <Txt variant="bodyLg" tone="neg">
                {tr("soul_app.circle.delete.action")}
              </Txt>
            </Pressable>
            <Pressable testID="delete-menu-cancel" accessibilityRole="button" onPress={close} style={styles.menuCancel}>
              <Txt variant="body" tone="muted">
                {tr("soul_app.common.cancel")}
              </Txt>
            </Pressable>
          </View>
        )}
      </View>
    </Modal>
  );
}

export function PostScreen({ id }: { id: string }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const { gutter } = useLayout();
  const insets = useSafeAreaInsets();
  const fail = useFailure();
  const post = useRemote(useCallback(() => soulSocialApi.post(id), [id]));
  const comments = usePaged<SoulComment>(id, (page) => soulSocialApi.comments(id, page));
  const status = useRemote(soulSocialApi.status);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [replyTo, setReplyTo] = useState<SoulComment | null>(null);
  const [deleting, setDeleting] = useState<{ kind: "post" | "comment"; id: string } | null>(null);
  const input = useRef<TextInput>(null);
  const navigation = useNavigation<Nav>();
  const openSoul = useOpenSoul();
  const p = post.data;

  // The title bar's "⋯" (1d): delete on my own post, report on anyone else's.
  useEffect(() => {
    if (!p) return;
    navigation.setOptions({
      header: () => (
        <AppHeader
          title={tr("soul_app.circle.post.title")}
          onBack={navigation.goBack}
          action={
            p.is_mine
              ? { icon: "more", label: tr("soul_app.circle.delete.action"), testID: "post-more", onPress: () => setDeleting({ kind: "post", id: p.id }) }
              : {
                  icon: "more",
                  label: tr("soul_app.circle.report.post"),
                  testID: "post-more",
                  onPress: () => navigation.navigate("CircleReport", { target: "POST", id: p.id, preview: p.content }),
                }
          }
        />
      ),
    });
  }, [p, navigation, tr]);

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
      await soulSocialApi.comment(id, text.trim(), replyTo?.id);
      setDraft("");
      setReplyTo(null);
      void comments.reload();
      void post.reload();
    } catch (e) {
      fail(e);
    } finally {
      setSending(false);
    }
  };
  const { press, onEndEditing } = useCommittedSend(input, draft, (text) => void send(text));
  const deleted = () => {
    const was = deleting;
    setDeleting(null);
    if (was?.kind === "post") return navigation.goBack();
    if (replyTo && replyTo.id === was?.id) setReplyTo(null);
    void comments.reload();
    void post.reload();
  };

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
  // Pending / hidden posts, and a past life's, take neither reactions nor comments (the server refuses too).
  const open = p?.moderation_status === "PUBLISHED" && p.author.is_active;
  const muted = status.data && !status.data.can_write;
  const canWrite = open && !!status.data && !muted;
  const byId = new Map((comments.rows ?? []).map((c) => [c.id, c]));

  return (
    <KeyboardAvoidingView style={[styles.fill, { backgroundColor: t.s0 }]} behavior="padding" keyboardVerticalOffset={-insets.bottom}>
      <Screen edges={["left", "right"]} testID="circle-post" refreshing={post.loading && !!p} onRefresh={() => void Promise.all([post.reload(), comments.reload()])}>
        {!p ? (
          <View style={[styles.pad, { paddingHorizontal: gutter }]}>
            <Skeleton lines={5} testID="post-loading" />
          </View>
        ) : (
          <>
            <PostCard post={p} full onAuthor={() => openSoul(p.author, p.is_mine)} />
            {open ? <ReactionBar post={p} status={status.data} onReact={(type) => void react(type)} /> : null}
            <Txt variant="section" style={[styles.commentsHead, { paddingHorizontal: gutter }]}>
              {tr("soul_app.circle.post.comments", { n: String(p.comment_count) })}
            </Txt>
            {comments.rows ? (
              <>
                {comments.rows.map((c) => (
                  <CommentRow
                    key={c.id}
                    c={c}
                    parent={c.parent ? byId.get(c.parent) : undefined}
                    onAuthor={() => openSoul(c.author, c.is_mine)}
                    onMore={() =>
                      c.is_mine ? setDeleting({ kind: "comment", id: c.id }) : navigation.navigate("CircleReport", { target: "COMMENT", id: c.id, preview: c.content })
                    }
                    onReply={
                      canWrite && c.moderation_status === "PUBLISHED"
                        ? () => {
                            setReplyTo(c);
                            input.current?.focus();
                          }
                        : undefined
                    }
                  />
                ))}
                {comments.more ? (
                  <View style={styles.more}>
                    <SmallButton testID="comments-more" title={tr("soul_app.circle.comment.more")} onPress={comments.more} />
                  </View>
                ) : null}
              </>
            ) : (
              <View style={[styles.pad, { paddingHorizontal: gutter }]}>
                <Skeleton lines={2} />
              </View>
            )}
          </>
        )}
      </Screen>
      {open ? (
        <View style={[styles.dock, { paddingHorizontal: 12, paddingBottom: 10 + insets.bottom, borderTopColor: t.hair, backgroundColor: t.s1 }]}>
          {muted ? (
            <MutedLock until={status.data?.muted_until ?? null} />
          ) : (
            <>
              {replyTo ? (
                <View testID="replying" style={styles.replying}>
                  <Txt variant="caption" tone="muted" style={styles.fill} numberOfLines={1}>
                    {tr("soul_app.circle.comment.reply_to", { name: replyTo.author.display_name })}
                  </Txt>
                  <Txt testID="reply-cancel" accessibilityRole="button" variant="caption" tone="subtle" onPress={() => setReplyTo(null)}>
                    {tr("soul_app.common.cancel")}
                  </Txt>
                </View>
              ) : null}
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
            </>
          )}
        </View>
      ) : null}
      <DeleteSheet target={deleting} onClose={() => setDeleting(null)} onDeleted={deleted} />
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
  commentMore: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  replyTo: { marginTop: 3 },
  replyButton: { marginTop: 6, alignSelf: "flex-start", paddingVertical: 4 },
  replying: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 2, paddingBottom: 8 },
  menu: { borderTopWidth: 1 },
  menuRow: { minHeight: 54, flexDirection: "row", alignItems: "center", paddingHorizontal: 20, borderBottomWidth: 1 },
  menuCancel: { minHeight: 54, alignItems: "center", justifyContent: "center" },
  dock: { borderTopWidth: 1, paddingTop: 10 },
  composer: { flexDirection: "row", gap: 8, alignItems: "flex-end" },
  commentInput: { flex: 1, minHeight: 42, maxHeight: 120, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  send: { minHeight: 42, minWidth: 56, paddingHorizontal: 14, alignItems: "center", justifyContent: "center" },
  sendText: { fontSize: 13, letterSpacing: 0.6 },
});
