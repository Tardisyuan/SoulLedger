/**
 * The 书信 tab (handoff "灵魂簿 App · 聊天" 1b / 1e): the conversation list and
 * the "find someone" screen.
 *
 * The list is cut in two and never interleaved (1a): the hall on top as its own
 * section — the current hall, then halls left behind, sealed — a solid rule,
 * then souls, newest first. Whether a soul is mutual is not a section; it shows
 * inside the conversation.
 *
 * iOS and Android differ in behaviour only (1e): iOS puts "new" in the title
 * bar as a 44pt framed plus; Android puts a 56dp square FAB bottom right and a
 * search icon in the bar. Corners stay 0, no ripple, no elevation.
 */
import { soulErrorCode } from "@soulledger/core/api/soul";
import { soulChatApi, soulChatErrorMessage, type SoulChatLookupResult, type SoulConversation } from "@soulledger/core/api/soul-chat";
import { soulSocialApi, type SoulCard } from "@soulledger/core/api/soul-social";
import { useNavigation, type NavigationProp } from "@react-navigation/native";
import { useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { Platform, Pressable, StyleSheet, TextInput, View } from "react-native";

import { useChat, type Chat } from "../chat";
import { chatSections, isCompleteCode, listStamp, normalizeCode } from "../chatRules";
import { Icon } from "../emblems";
import { family, quoteFamily } from "../fonts";
import { useI18n } from "../i18n";
import { SessionContext } from "../session";
import type { Theme } from "../theme";
import { Button, Empty, FadeIn, Notice, Screen, Skeleton, Txt, useLayout, useTheme } from "../ui";
import type { AppStackParams } from "./applications";
import { useNow } from "./auth";

export const ANDROID = Platform.OS === "android";
/** The accent, faintly: my bubbles, the Android selected tab. Hex alpha, so it follows every civilization's accent. */
export const wash = (t: Theme) => `${t.accent}1F`;

/** The hall this soul is in now (`/me/`'s tenant). */
export function useCurrentHall(): string {
  const session = useContext(SessionContext);
  return session?.state.status === "signedIn" ? session.state.profile.tenant.display_name : "";
}

/** The newest text in a room: what the row previews and when it sorts. */
export function lastOf(chat: Chat, roomId: string) {
  const messages = chat.timeline.rooms[roomId]?.messages;
  return messages?.length ? messages[messages.length - 1] : null;
}

/** A 30pt square with one character: a soul's initial, or the hall's glyph. */
export function Glyph({ text, tone, dotted, size = 30 }: { text: string; tone: "mark" | "muted" | "subtle"; dotted?: boolean; size?: number }) {
  const t = useTheme();
  const color = tone === "mark" ? t.mark : tone === "muted" ? t.inkMuted : t.inkSubtle;
  return (
    <View
      style={[
        styles.glyph,
        { width: size, height: size, borderColor: tone === "mark" ? t.mark : t.hair2, borderStyle: dotted ? "dotted" : "solid" },
      ]}
    >
      <Txt style={[styles.glyphText, { color, fontSize: size < 20 ? 9.5 : 13 }]}>{text.slice(0, 1)}</Txt>
    </View>
  );
}

/** A small square-cornered label: 待回复 (dotted accent), 已闭 / 封存 (hairline), 互关 (mark). */
export function Tag({ text, tone, testID }: { text: string; tone: "accent" | "mark" | "quiet"; testID?: string }) {
  const t = useTheme();
  const color = tone === "accent" ? t.accent : tone === "mark" ? t.mark : t.inkSubtle;
  return (
    <View testID={testID} style={[styles.tag, { borderColor: tone === "quiet" ? t.hair2 : color, borderStyle: tone === "accent" ? "dotted" : "solid" }]}>
      <Txt style={[styles.tagText, { color }]}>{text}</Txt>
    </View>
  );
}

function SectionLabel({ text, tone }: { text: string; tone: "accent" | "subtle" }) {
  const t = useTheme();
  const { gutter } = useLayout();
  return (
    <View style={[styles.sectionLabel, { paddingHorizontal: gutter, borderBottomColor: t.hair }]}>
      <Txt style={[styles.sectionText, { color: tone === "accent" ? t.accent : t.inkSubtle }]}>{text}</Txt>
    </View>
  );
}

function Row({
  testID,
  onPress,
  glyph,
  title,
  tag,
  stamp,
  preview,
  hint,
  unread,
  hall,
  dim,
}: {
  testID: string;
  onPress: () => void;
  glyph: ReactNode;
  title: string;
  tag?: ReactNode;
  stamp?: string;
  preview?: string;
  hint?: string;
  unread?: boolean;
  hall?: boolean;
  dim?: boolean;
}) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const { gutter } = useLayout();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={unread ? `${title}, ${tr("soul_app.chat.unread")}` : title}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { paddingHorizontal: gutter, borderBottomColor: hall ? t.hair2 : t.hair },
        hall && { backgroundColor: t.s1, borderLeftWidth: 3, borderLeftColor: t.mark, paddingLeft: gutter - 3 },
        dim && { opacity: 0.82 },
        pressed && { backgroundColor: t.s2 },
      ]}
    >
      {glyph}
      <View style={styles.fill}>
        <View style={styles.rowHead}>
          <Txt style={[styles.rowTitle, { fontFamily: family.ui[hall ? 600 : 500] }]} numberOfLines={1}>
            {title}
          </Txt>
          {tag}
          <View style={styles.fill} />
          {stamp ? (
            <Txt variant="value" tone="subtle" style={styles.stamp}>
              {stamp}
            </Txt>
          ) : null}
        </View>
        {preview ? (
          <Txt numberOfLines={2} style={[styles.preview, { color: t.inkMuted, fontFamily: quoteFamily(preview) }]}>
            {preview}
          </Txt>
        ) : hint ? (
          <Txt variant="caption" tone="subtle" style={styles.hint}>
            {hint}
          </Txt>
        ) : null}
      </View>
      {unread ? <View testID={`${testID}-unread`} style={[styles.dot, { backgroundColor: t.mark }]} /> : null}
    </Pressable>
  );
}

/** Android's "new": a 56dp square, accent, bottom right. No elevation, no ripple (1e). */
export function Fab({ onPress, label }: { onPress: () => void; label: string }) {
  const t = useTheme();
  return (
    <Pressable
      testID="chat-fab"
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.fab, { backgroundColor: pressed ? t.mark : t.accent }]}
    >
      <Icon name="plus" size={22} color={t.onAccent} strokeWidth={1.5} />
    </Pressable>
  );
}

export function LettersScreen() {
  const t = useTheme();
  const { t: tr } = useI18n();
  const chat = useChat();
  const hallName = useCurrentHall();
  const navigation = useNavigation<NavigationProp<AppStackParams>>();
  const now = useNow();
  const open = (c: SoulConversation) => navigation.navigate("Conversation", { id: c.id });
  const [opening, setOpening] = useState(false);
  const openHall = async (c: SoulConversation | null) => {
    if (c) return open(c);
    if (opening) return;
    setOpening(true);
    try {
      open(await chat.openInbox());
    } catch {
      // The list's own notice says when chat is down; nothing else to add here.
    } finally {
      setOpening(false);
    }
  };
  const lastTs = useCallback((roomId: string) => lastOf(chat, roomId)?.ts ?? 0, [chat]);

  if (chat.availability === "not_configured") {
    return (
      <Screen scroll={false} edges={["left", "right"]}>
        <View style={styles.pad}>
          <Notice tone="neutral" testID="chat-not-configured">
            {tr("soul_app.chat.not_configured")}
          </Notice>
        </View>
      </Screen>
    );
  }
  if (!chat.conversations) {
    return (
      <Screen scroll={false} edges={["left", "right"]}>
        <View style={styles.pad}>
          {chat.listError ? (
            <Notice tone="neutral" onRetry={() => void chat.reload()} testID="chat-list-error">
              {tr("soul_app.chat.unavailable.list")}
            </Notice>
          ) : (
            <Skeleton lines={4} testID="chat-loading" />
          )}
        </View>
      </Screen>
    );
  }

  const { hall, sealedHalls, souls } = chatSections([...chat.conversations, ...Object.values(chat.gone)], lastTs);
  const hallGlyph = tr("soul_app.chat.section.hall");
  const preview = (c: SoulConversation) => {
    const last = lastOf(chat, c.room_id);
    return { stamp: last ? listStamp(last.ts, now) : undefined, preview: last?.body, unread: (chat.timeline.rooms[c.room_id]?.unread ?? 0) > 0 };
  };
  const awaiting = (c: SoulConversation) =>
    c.throttled && c.initiated_by_me && !(chat.timeline.rooms[c.room_id]?.messages ?? []).some((m) => m.sender !== chat.me);

  return (
    <View style={styles.fill}>
      <Screen refreshing={false} onRefresh={() => void chat.reload()} edges={["left", "right"]} testID="letters">
        <FadeIn>
          {chat.availability === "unavailable" ? (
            <View style={styles.pad}>
              <Notice tone="neutral" onRetry={chat.reconnect} testID="chat-unavailable">
                {tr("soul_app.chat.unavailable.list")}
              </Notice>
            </View>
          ) : null}
          <SectionLabel text={tr("soul_app.chat.section.hall")} tone="accent" />
          <Row
            testID="hall-row"
            hall
            onPress={() => void openHall(hall)}
            glyph={<Glyph text={hallGlyph} tone="mark" />}
            title={tr("soul_app.chat.hall.title", { hall: hall?.hall || hallName })}
            hint={tr("soul_app.chat.hall.hint")}
            {...(hall ? preview(hall) : {})}
          />
          {sealedHalls.map((c) => (
            <Row
              key={c.id}
              testID={`hall-sealed-${c.id}`}
              onPress={() => open(c)}
              glyph={<Glyph text={hallGlyph} tone="subtle" dotted />}
              title={tr("soul_app.chat.hall.title", { hall: c.hall })}
              tag={<Tag text={tr("soul_app.chat.badge.sealed")} tone="quiet" />}
              {...preview(c)}
            />
          ))}
          <View style={{ height: 1, backgroundColor: t.hair2 }} />
          <SectionLabel text={tr("soul_app.chat.section.souls")} tone="subtle" />
          {souls.length === 0 ? (
            <View testID="chat-empty" style={styles.empty}>
              <View style={{ width: 28, height: 1, backgroundColor: t.hair2 }} />
              <Txt variant="nav">{tr("soul_app.chat.empty.title")}</Txt>
              <Txt variant="caption" tone="subtle" style={styles.center}>
                {tr("soul_app.chat.empty.body")}
              </Txt>
              <Button testID="chat-empty-find" title={tr("soul_app.chat.new")} onPress={() => navigation.navigate("FindSoul")} style={styles.emptyButton} />
            </View>
          ) : (
            souls.map((c) => (
              <Row
                key={c.id}
                testID={`soul-row-${c.id}`}
                onPress={() => open(c)}
                glyph={<Glyph text={c.peer_name} tone={c.refusal === "closed" ? "subtle" : "muted"} dotted={awaiting(c)} />}
                title={c.peer_name}
                dim={c.refusal === "closed"}
                tag={
                  c.refusal === "closed" ? (
                    <Tag testID={`closed-${c.id}`} text={tr("soul_app.chat.badge.closed")} tone="quiet" />
                  ) : awaiting(c) ? (
                    <Tag testID={`awaiting-${c.id}`} text={tr("soul_app.chat.badge.awaiting")} tone="accent" />
                  ) : undefined
                }
                {...preview(c)}
              />
            ))
          )}
          {ANDROID ? <View style={styles.fabSpace} /> : null}
        </FadeIn>
      </Screen>
      {ANDROID ? <Fab label={tr("soul_app.chat.new")} onPress={() => navigation.navigate("FindSoul")} /> : null}
    </View>
  );
}

// ── find ───────────────────────────────────────────────────────────────

type Lookup = { state: "idle" } | { state: "busy" } | { state: "found"; card: SoulChatLookupResult } | { state: "not_found" } | { state: "error"; key: string; params?: Record<string, string> };

export function FindSoulScreen() {
  const t = useTheme();
  const { t: tr } = useI18n();
  const chat = useChat();
  const navigation = useNavigation<NavigationProp<AppStackParams>>();
  const [code, setCode] = useState("");
  const [lookup, setLookup] = useState<Lookup>({ state: "idle" });
  const [circle, setCircle] = useState<{ card: SoulCard; mutual: boolean }[] | null>(null);
  const [opening, setOpening] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([soulSocialApi.following(), soulSocialApi.followers()])
      .then(([following, followers]) => {
        if (!alive) return;
        const back = new Set(followers.results.map((c) => c.user_id));
        const seen = new Set<number>();
        const rows = [...following.results, ...followers.results]
          .filter((c) => c.is_active && !seen.has(c.user_id) && seen.add(c.user_id))
          .map((card) => ({ card, mutual: back.has(card.user_id) && following.results.some((f) => f.user_id === card.user_id) }));
        setCircle(rows);
      })
      .catch(() => alive && setCircle([]));
    return () => {
      alive = false;
    };
  }, []);

  const find = async () => {
    const normalized = normalizeCode(code);
    if (!isCompleteCode(normalized)) return setLookup({ state: "error", key: "soul_app.chat.errors.invalid_code" });
    setLookup({ state: "busy" });
    try {
      setLookup({ state: "found", card: await soulChatApi.lookup(normalized) });
    } catch (error) {
      const code = soulErrorCode(error);
      // One sentence for every miss (1a rule 二): no such code, yourself, a past life, an officer.
      if (code === "not_found") setLookup({ state: "not_found" });
      else setLookup({ state: "error", ...soulChatErrorMessage(error) });
    }
  };

  const write = async (userId: number) => {
    if (opening !== null) return;
    setOpening(userId);
    try {
      const c = await chat.openDirect(userId);
      navigation.navigate("Conversation", { id: c.id });
    } catch (error) {
      setLookup({ state: "error", ...soulChatErrorMessage(error) });
    } finally {
      setOpening(null);
    }
  };

  return (
    <Screen edges={["left", "right", "bottom"]} testID="find-soul">
      <View style={[styles.findBlock, { borderBottomColor: t.hair }]}>
        <Txt style={[styles.sectionText, { color: t.accent }]}>{tr("soul_app.chat.find.by_code")}</Txt>
        <View style={[styles.codeBox, { backgroundColor: t.s1, borderColor: lookup.state === "error" ? t.negStrong : t.hair }]}>
          <TextInput
            testID="find-code"
            accessibilityLabel={tr("soul_app.chat.find.by_code")}
            value={code}
            onChangeText={(v) => {
              setCode(v);
              if (lookup.state !== "idle") setLookup({ state: "idle" });
            }}
            onSubmitEditing={() => void find()}
            placeholder={tr("soul_app.chat.find.code_placeholder")}
            placeholderTextColor={t.inkSubtle}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={16}
            returnKeyType="search"
            style={[styles.codeInput, { color: t.ink }]}
          />
        </View>
        <Txt variant="label" tone="subtle" style={styles.noSpacing}>
          {tr("soul_app.chat.find.code_hint")}
        </Txt>
        <Button testID="find-submit" kind="secondary" title={tr("soul_app.chat.find.title")} busy={lookup.state === "busy"} onPress={() => void find()} />
        {lookup.state === "found" ? (
          <View testID="find-result" style={[styles.card, { borderColor: t.hair, backgroundColor: t.s1 }]}>
            <View style={styles.fill}>
              <Txt variant="bodyLg">{lookup.card.display_name}</Txt>
            </View>
            <Pressable
              testID="find-write"
              accessibilityRole="button"
              onPress={() => void write(lookup.card.user_id)}
              style={({ pressed }) => [styles.write, { backgroundColor: pressed ? t.mark : t.accent }]}
            >
              <Txt style={[styles.writeText, { color: t.onAccent }]}>{tr("soul_app.chat.find.write")}</Txt>
            </Pressable>
          </View>
        ) : lookup.state === "not_found" ? (
          <Empty testID="find-not-found" text={tr("soul_app.chat.find.not_found")} />
        ) : lookup.state === "error" ? (
          <Notice tone="neg" testID="find-error">
            {tr(lookup.key, lookup.params)}
          </Notice>
        ) : null}
      </View>
      <View style={styles.findBlock}>
        <Txt style={[styles.sectionText, { color: t.accent }]}>{tr("soul_app.chat.find.from_circle")}</Txt>
        <Txt variant="label" tone="subtle" style={styles.noSpacing}>
          {tr("soul_app.chat.find.circle_hint")}
        </Txt>
        {circle === null ? (
          <Skeleton lines={2} />
        ) : (
          <View style={[styles.circle, { backgroundColor: t.hair }]}>
            {circle.map(({ card, mutual }) => (
              <Pressable
                key={card.user_id}
                testID={`circle-${card.user_id}`}
                accessibilityRole="button"
                onPress={() => void write(card.user_id)}
                style={({ pressed }) => [styles.circleRow, { backgroundColor: pressed ? t.s1 : t.s0 }]}
              >
                <Txt variant="body" style={styles.fill}>
                  {card.display_name}
                </Txt>
                <Tag text={tr(mutual ? "soul_app.chat.badge.mutual" : "soul_app.chat.badge.following")} tone={mutual ? "mark" : "quiet"} />
              </Pressable>
            ))}
          </View>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { textAlign: "center" },
  noSpacing: { letterSpacing: 0 },
  pad: { padding: 20 },
  sectionLabel: { paddingTop: 13, paddingBottom: 9, borderBottomWidth: 1 },
  sectionText: { fontFamily: family.ui[600], fontSize: 11, lineHeight: 15, letterSpacing: 1.5 },
  row: { flexDirection: "row", gap: 13, alignItems: "flex-start", paddingVertical: 15, borderBottomWidth: 1, minHeight: 64 },
  rowHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  rowTitle: { fontSize: 14, lineHeight: 20 },
  stamp: { fontSize: 11, lineHeight: 16 },
  preview: { fontSize: 14.5, lineHeight: 24, marginTop: 4 },
  hint: { marginTop: 5 },
  dot: { width: 8, height: 8, marginTop: 9 },
  glyph: { borderWidth: 1, alignItems: "center", justifyContent: "center" },
  glyphText: { fontFamily: family.ui[500] },
  tag: { borderWidth: 1, paddingHorizontal: 6, paddingVertical: 1 },
  tagText: { fontFamily: family.ui[500], fontSize: 10, lineHeight: 14, letterSpacing: 0.8 },
  empty: { alignItems: "center", gap: 12, paddingHorizontal: 28, paddingTop: 50, paddingBottom: 46 },
  emptyButton: { alignSelf: "stretch", marginTop: 4 },
  fab: { position: "absolute", right: 16, bottom: 16, width: 56, height: 56, alignItems: "center", justifyContent: "center" },
  fabSpace: { height: 88 },
  findBlock: { paddingHorizontal: 20, paddingVertical: 18, gap: 11, borderBottomWidth: 1, borderBottomColor: "transparent" },
  codeBox: { minHeight: 48, borderWidth: 1, justifyContent: "center" },
  codeInput: { minHeight: 46, paddingHorizontal: 13, fontFamily: family.mono[500], fontSize: 16, letterSpacing: 2.2 },
  card: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, padding: 14 },
  write: { minHeight: ANDROID ? 48 : 38, paddingHorizontal: 13, alignItems: "center", justifyContent: "center" },
  writeText: { fontFamily: family.ui[600], fontSize: 12.5, lineHeight: 17 },
  circle: { gap: 1 },
  circleRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 13, paddingHorizontal: 2, minHeight: ANDROID ? 48 : 44 },
});
