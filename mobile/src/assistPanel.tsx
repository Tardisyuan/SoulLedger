/**
 * The 「问一问」 drawer (canvas 1c–1j). State is `assist.tsx`'s; this is only
 * what it looks like.
 *
 *   near-full-height bottom sheet, 56pt of the page left showing above it;
 *   a full-screen page at ≥ 1.7× text (the sheet head would eat too many lines).
 *   Answers are an "answer sheet", not bubbles: full width, interface face, a
 *   答 seal and a footnote. Only what the soul wrote is in the serif.
 *   v3 (round 7): the sheet rises 280ms over a fading scrim and can be pulled
 *   down by its handle; otherwise the motion is opacity (the breathing seal).
 *   Reduce motion stills all of it.
 *
 * Streaming (canvas「问一问 · 流式输出」): three dots while waiting (「还在查……」
 * after 20 s), then the text as it arrives — each fragment fades in over 120 ms,
 * a static ▍ at the end — with progressive Markdown (core's `assistBlocks`).
 * The send button turns into 「■ 停止」. Scrolled up, the view stops following
 * and offers 「↓ 最新」. Reduced motion: no fade, no cursor, still dots, and a
 * whole paragraph at a time.
 */
import { assistBlocks, assistShownText } from "@soulledger/core/api/assist-stream";
import { assistAnswerLocale, isEmptyAnswer, type AssistConversation, type AssistMessage, type AssistScreen } from "@soulledger/core/api/soul-assist";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Animated, Easing, KeyboardAvoidingView, Modal, PanResponder, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AskGlyph, useAssist, type Assist } from "./assist";
import { SHEET_CLOSE_DRAG_PT } from "./feedback";
import { Icon } from "./emblems";
import { quoteFamily } from "./fonts";
import { useI18n } from "./i18n";
import { useCurrentHall } from "./screens/letters";
import { Button, Skeleton, Txt, useLayout, useReducedMotion, useReducedMotionDurations, useTheme } from "./ui";

/** Canvas 1a 一: the page's header stays visible above the sheet. */
const PAGE_PEEK = 56;
const MAX_QUESTION = 1000;
/** A2: a new fragment fades in over 120 ms, in three steps of its colour's alpha (nested text has no opacity). */
const FADE_STEP_MS = 40;
const FADE_ALPHA = ["55", "AA", ""];
/** A1: the three dots brighten one after another, 400 ms each. */
const DOT_MS = 400;

const SCREEN_TITLE: Record<AssistScreen, string> = {
  applications: "soul_app.tabs.applications",
  sentence: "soul_app.sentence.section_title",
  life: "soul_app.tabs.life",
  letters: "soul_app.chat.title",
  circle: "soul_app.circle.tab",
  settings: "soul_app.settings.title",
  other: "soul_app.assist.screen_other",
};

/**
 * 1c: what is commonly asked on each page, written as the soul's own words.
 * NOT in the message bundles: these are sent to the model as the question, in
 * the language it answers in (A5: zh-Hans, or English for en and egy) — an egy
 * rendering would be a question the model cannot read.
 */
const SUGGESTIONS: Record<"zh-Hans" | "en", Partial<Record<AssistScreen, string[]>>> = {
  "zh-Hans": {
    applications: ["我为什么不能申请？", "被驳回了还能申诉吗？", "我的申请到哪一步了？"],
    sentence: ["下一站什么时候开始？", "各站的状态是什么意思？", "受刑结束后可以申请转生吗？"],
    life: ["本世页上的状态是什么意思？", "暂居是什么意思？", "我能看到前世的记录吗？"],
    letters: ["怎么写信给殿司？", "为什么有的灵魂不能直接说话？", "殿司多久会回信？"],
    circle: ["我的帖子为什么别人看不到？", "怎么关注别人？", "长明灯是什么？"],
    settings: ["切换语言会影响什么？", "通知会告诉我哪些事？", "问一问会保存我的提问吗？"],
  },
  en: {
    applications: ["Why can't I apply?", "Can I appeal after a rejection?", "Where is my application now?"],
    sentence: ["When does the next station begin?", "What do the station states mean?", "Can I apply for rebirth after my sentence?"],
    life: ["What does my state on this page mean?", "What does residing mean?", "Can I see my past lives?"],
    letters: ["How do I write to the hall?", "Why can't I talk freely with some souls?", "How soon does the hall reply?"],
    circle: ["Why can't others see my post?", "How do I follow someone?", "What is the eternal light?"],
    settings: ["What does switching the language change?", "What will notifications tell me?", "Does Ask keep my questions?"],
  },
};

const pad = (n: number) => String(n).padStart(2, "0");
const clock = (iso: string) => {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();


export function AssistPanel() {
  const t = useTheme();
  const { t: tr } = useI18n();
  const assist = useAssist();
  const insets = useSafeAreaInsets();
  const { drawerIn, drawerOut } = useReducedMotionDurations();
  const { height: screenHeight } = useWindowDimensions();
  const { stack: full } = useLayout();
  const visible = !!assist?.openFrom;
  // v3: the sheet rises (translateY 100% → 0, 280ms) over a fading scrim; RN Animated only.
  // `rise` 0 → 1 is the opening; `drag` is the soul's pull on the handle. Reduce motion: in place.
  const [rise] = useState(() => new Animated.Value(0));
  const [drag] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (!visible) return;
    drag.setValue(0);
    rise.setValue(drawerIn ? 0 : 1);
    const run = Animated.timing(rise, { toValue: 1, duration: drawerIn, easing: Easing.bezier(0.2, 0.8, 0.2, 1), useNativeDriver: true });
    run.start();
    return () => run.stop();
  }, [visible, drawerIn, rise, drag]);
  const close = assist?.close;
  // The handle follows a downward pull only; let go past SHEET_CLOSE_DRAG_PT and the sheet leaves
  // over `drawerOut` (200ms, the exit curve), else it settles back. Vertical travel and a
  // release threshold only — no velocity snapping (that would need a gesture library).
  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => g.dy > 4 && Math.abs(g.dy) > Math.abs(g.dx),
        onPanResponderMove: (_, g) => drag.setValue(Math.max(0, g.dy)),
        onPanResponderRelease: (_, g) => {
          const leave = g.dy > SHEET_CLOSE_DRAG_PT;
          Animated.timing(drag, {
            toValue: leave ? screenHeight : 0,
            duration: drawerOut,
            easing: leave ? Easing.bezier(0.4, 0, 1, 1) : Easing.bezier(0.2, 0.8, 0.2, 1),
            useNativeDriver: true,
          }).start(() => leave && close?.());
        },
      }),
    [drag, drawerOut, screenHeight, close]
  );
  if (!assist) return null;
  const translateY = Animated.add(rise.interpolate({ inputRange: [0, 1], outputRange: [screenHeight, 0] }), drag);
  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={assist.close}>
      <View style={styles.fill}>
        <Animated.View testID="assist-scrim-shade" pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: t.scrim, opacity: rise }]} />
        {full ? null : (
          <Pressable
            testID="assist-scrim"
            style={{ height: insets.top + PAGE_PEEK }}
            onPress={assist.close}
            accessibilityLabel={tr("soul_app.assist.close")}
          />
        )}
        <Animated.View testID="assist-sheet" style={[styles.fill, { transform: [{ translateY }] }]}>
          <KeyboardAvoidingView
            testID="assist-panel"
            accessibilityViewIsModal
            // Both platforms, as in screens/conversation.tsx: Android draws edge-to-edge (SDK 57), so the
            // window no longer shrinks for the keyboard and the input sat under it (seen on the emulator).
            // No negative keyboardVerticalOffset here (unlike conversation.tsx): inside a Modal it
            // over-corrects — the input stayed half under the keyboard.
            behavior="padding"
            style={[styles.sheet, { backgroundColor: t.s0, borderTopColor: t.hair2, paddingTop: full ? insets.top : 0 }]}
          >
            {full ? null : (
              // A2's one pill: the drawer handle. Decoration for touch; the close button stays the way out.
              <View testID="assist-handle" {...pan.panHandlers} style={styles.handleZone} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                <View style={[styles.handle, { backgroundColor: t.hair2 }]} />
              </View>
            )}
            {/* The gesture-bar inset lives on an inner view: behavior="padding" writes the avoiding
                view's own paddingBottom and would silently drop it (the input sank into the bar). */}
            <View style={[styles.fill, { paddingBottom: insets.bottom }]}>
              <Sheet assist={assist} />
            </View>
          </KeyboardAvoidingView>
        </Animated.View>
      </View>
    </Modal>
  );
}

/** Inside the Modal, so each opening starts on the conversation, not the history. */
function Sheet({ assist }: { assist: Assist }) {
  const [view, setView] = useState<"chat" | "history">("chat");
  return (
    <>
      <Head view={view} setView={setView} assist={assist} />
      {view === "history" ? <History assist={assist} onOpened={() => setView("chat")} /> : <Conversation assist={assist} />}
    </>
  );
}

/** 1c / 1i / 1j: the 问 seal in 匾色 (v2 has no mark), the name, 「助手 · 只读」, and 历史; a 1px ink rule under it. */
function Head({ view, setView, assist }: { view: "chat" | "history"; setView: (v: "chat" | "history") => void; assist: Assist }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const history = view === "history";
  return (
    <View style={[styles.head, { borderBottomColor: t.ink }]}>
      {history ? (
        <Pressable testID="assist-back" accessibilityRole="button" accessibilityLabel={tr("common.back")} onPress={() => setView("chat")} style={styles.icon}>
          <Icon name="back" size={17} color={t.inkMuted} strokeWidth={1.4} />
        </Pressable>
      ) : (
        <View style={styles.seal}>
          <AskGlyph color={t.plaque} />
        </View>
      )}
      <View style={styles.headText}>
        <Txt accessibilityRole="header" variant="nav" numberOfLines={2}>
          {tr(history ? "soul_app.assist.history_title" : "soul_app.assist.title")}
        </Txt>
        {history ? null : (
          <Txt variant="label" tone="subtle" numberOfLines={2}>
            {tr("soul_app.assist.read_only")}
          </Txt>
        )}
      </View>
      {history ? (
        <HeadButton
          testID="assist-new"
          label={tr("soul_app.assist.new")}
          onPress={() => {
            assist.startNew();
            setView("chat");
          }}
        />
      ) : (
        <HeadButton
          testID="assist-history"
          label={tr("soul_app.assist.history")}
          onPress={() => {
            assist.loadHistory();
            setView("history");
          }}
        />
      )}
      <Pressable testID="assist-close" accessibilityRole="button" accessibilityLabel={tr("soul_app.assist.close")} onPress={assist.close} style={styles.icon}>
        <Icon name="close" size={16} color={t.inkSubtle} strokeWidth={1.3} />
      </Pressable>
    </View>
  );
}

function HeadButton({ label, onPress, testID }: { label: string; onPress: () => void; testID: string }) {
  const t = useTheme();
  return (
    <Pressable testID={testID} accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.headButton, pressed && { backgroundColor: t.s2 }]}>
      <Txt variant="label" tone="muted" numberOfLines={1}>
        {label}
      </Txt>
    </Pressable>
  );
}

function Conversation({ assist }: { assist: Assist }) {
  const t = useTheme();
  const { t: tr, locale } = useI18n();
  const { thread, pending, failure } = assist;
  const messages = thread.messages;
  // A4: follow new text while at the bottom; scrolled up, stop and offer 「↓ 最新」.
  const scroller = useRef<ScrollView>(null);
  const [follow, setFollow] = useState(true);

  if (failure?.kind === "not_configured") return <NotConfigured assist={assist} />;
  if (!messages) return <Skeleton lines={4} testID="assist-loading" />;
  const fresh = messages.length === 0 && !pending && failure?.kind !== "unanswered";
  if (fresh && !assist.acked) return <Intro onAck={assist.ack} />;

  const suggestions = SUGGESTIONS[assistAnswerLocale(locale)][thread.screen] ?? [];
  return (
    <>
      <ScrollView
        ref={scroller}
        testID="assist-scroll"
        style={styles.fill}
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        scrollEventThrottle={100}
        onScroll={({ nativeEvent: n }) => setFollow(n.contentSize.height - n.contentOffset.y - n.layoutMeasurement.height <= 8)}
        onContentSizeChange={() => {
          if (follow) scroller.current?.scrollToEnd({ animated: false });
        }}
      >
        {fresh ? (
          <View testID="assist-empty" style={styles.gap}>
            <Txt variant="caption" tone="subtle">
              {tr("soul_app.assist.suggest_intro", { screen: tr(SCREEN_TITLE[thread.screen]) })}
            </Txt>
            {suggestions.map((q) => (
              <Pressable
                key={q}
                testID="assist-suggestion"
                accessibilityRole="button"
                onPress={() => assist.ask(q)}
                style={({ pressed }) => [styles.suggestion, { borderColor: t.hair2 }, pressed && { backgroundColor: t.s2 }]}
              >
                <Txt style={{ fontFamily: quoteFamily(q) }}>{q}</Txt>
              </Pressable>
            ))}
          </View>
        ) : null}
        {messages.map((m) =>
          m.role === "user" ? (
            <Question key={m.id} text={m.content} meta={clock(m.created_at)} />
          ) : (
            <Answer key={m.id} message={m} assist={assist} onRetry={m.id === assist.retryable ? assist.retryInterrupted : undefined} />
          )
        )}
        {pending ? (
          <>
            <Question text={pending.question} meta={`${clock(pending.at)} · ${tr("soul_app.assist.sent")}`} />
            {pending.text ? <Streaming text={pending.text} /> : <Waiting slow={pending.slow} />}
          </>
        ) : null}
        {failure?.kind === "unanswered" ? <Unanswered failure={failure} assist={assist} /> : null}
        {failure?.kind === "limited" ? <Limited retryAt={failure.retryAt} /> : null}
      </ScrollView>
      {!follow && pending ? (
        <Pressable
          testID="assist-jump"
          accessibilityRole="button"
          onPress={() => {
            setFollow(true);
            scroller.current?.scrollToEnd({ animated: false });
          }}
          style={[styles.jump, { borderColor: t.hair2, backgroundColor: t.s0 }]}
        >
          <Txt variant="label" tone="muted">
            {tr("soul_app.assist.jump_latest")}
          </Txt>
        </Pressable>
      ) : null}
      <Composer assist={assist} />
    </>
  );
}

/** What the soul asked: the serif, set off by a hairline on the right, with its time in mono. */
function Question({ text, meta }: { text: string; meta: string }) {
  const t = useTheme();
  return (
    <View testID="assist-question" style={[styles.question, { borderRightColor: t.hair2 }]}>
      <Txt variant="bodyLg" style={{ fontFamily: quoteFamily(text), textAlign: "right" }}>
        {text}
      </Txt>
      <Txt variant="value" tone="subtle" style={styles.meta}>
        {meta}
      </Txt>
    </View>
  );
}

/** 答 seal, time, the answer full width in the interface face, and the footnote. 1i: egy reads it as English. */
function Answer({ message, assist, onRetry }: { message: AssistMessage; assist: Assist; onRetry?: () => void }) {
  const t = useTheme();
  const { t: tr, locale } = useI18n();
  const english = assistAnswerLocale(locale) === "en";
  return (
    <View testID="assist-answer" style={styles.answer}>
      <View style={styles.answerHead}>
        <AskGlyph color={t.plaque} glyph="答" />
        {english && locale !== "en" ? (
          <View testID="assist-en" style={[styles.en, { borderColor: t.inkSubtle }]}>
            <Txt variant="label" tone="subtle" style={styles.enText}>
              EN
            </Txt>
          </View>
        ) : null}
        <Txt variant="value" tone="subtle">
          {clock(message.created_at)}
        </Txt>
      </View>
      <AnswerText testID="assist-answer-text" text={message.content} english={english} />
      {message.interruption === "stopped" ? (
        // A6: not a failure — small ink3, no retry.
        <Txt testID="assist-stopped" variant="label" tone="subtle">
          {tr("soul_app.assist.stopped")}
        </Txt>
      ) : message.interruption === "interrupted" ? (
        // A7: the warning colour (not the cool rose), and 「重试」 on the latest answer only (A9).
        <View testID="assist-interrupted" style={[styles.interrupted, { borderColor: t.warn, backgroundColor: t.warnBg }]}>
          <Txt variant="label" style={[styles.fill, { color: t.warn }]}>
            {`! ${tr("soul_app.assist.interrupted")}`}
          </Txt>
          {onRetry ? <HeadButton testID="assist-retry-interrupted" label={tr("soul_app.common.retry")} onPress={onRetry} /> : null}
        </View>
      ) : null}
      {isEmptyAnswer(message.content) ? <LettersCard assist={assist} /> : null}
      <Txt variant="label" tone="subtle">
        {tr("soul_app.assist.footnote")}
      </Txt>
    </View>
  );
}

/**
 * Progressive Markdown (A3): each line a block — a list item, or a paragraph — and `**bold**` once closed.
 * While `streaming`, the newest fragment fades in (A2) and a static ▍ in ink3 sits at the end; reduced
 * motion shows whole paragraphs only, with neither (A11). `testID` is on the whole text, in one string.
 */
function AnswerText({ text, english, streaming = false, testID }: { text: string; english: boolean; streaming?: boolean; testID?: string }) {
  const t = useTheme();
  const reduced = useReducedMotion();
  const shown = assistShownText(text, streaming, reduced);
  const blocks = assistBlocks(shown, streaming);
  const [seen, setSeen] = useState({ length: shown.length, fresh: 0 });
  if (seen.length !== shown.length) setSeen({ length: shown.length, fresh: Math.max(0, shown.length - seen.length) });
  const fresh = streaming && !reduced ? seen.fresh : 0;
  const last = blocks.length - 1;
  return (
    <View testID={testID} accessibilityLabel={shown} accessibilityLanguage={english ? "en" : "zh-Hans"} style={styles.gap4}>
      {blocks.map((b, i) => (
        <View key={i} style={[b.kind === "li" ? styles.item : null, b.gap ? styles.paraGap : null]}>
          {b.kind === "li" ? (
            <Txt variant="bodyLg" tone="subtle" importantForAccessibility="no">
              {b.marker}
            </Txt>
          ) : null}
          <Txt variant="bodyLg" style={styles.answerText}>
            {b.spans.map((sp, j) => {
              const tail = i === last && j === b.spans.length - 1 ? Math.min(fresh, sp.text.length) : 0;
              return (
                <Text key={j} style={sp.bold ? styles.bold : undefined}>
                  {tail ? sp.text.slice(0, sp.text.length - tail) : sp.text}
                  {tail ? <FadeIn key={shown.length} text={sp.text.slice(sp.text.length - tail)} color={t.ink} /> : null}
                </Text>
              );
            })}
            {i === last && streaming && !reduced ? (
              <Text testID="assist-cursor" style={{ color: t.inkSubtle }} accessibilityElementsHidden importantForAccessibility="no">
                ▍
              </Text>
            ) : null}
          </Txt>
        </View>
      ))}
    </View>
  );
}

/** One fragment's 120 ms fade, as its colour's alpha in three steps. */
function FadeIn({ text, color }: { text: string; color: string }) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (step >= FADE_ALPHA.length - 1) return;
    const timer = setTimeout(() => setStep((n) => n + 1), FADE_STEP_MS);
    return () => clearTimeout(timer);
  }, [step]);
  return <Text style={{ color: `${color}${FADE_ALPHA[step]}` }}>{text}</Text>;
}

/** The answer being written (A2, A10): busy for assistive tech; it is announced once, when done. */
function Streaming({ text }: { text: string }) {
  const t = useTheme();
  const { locale } = useI18n();
  return (
    <View testID="assist-streaming" style={styles.answer} accessibilityState={{ busy: true }}>
      <View style={styles.answerHead}>
        <AskGlyph color={t.plaque} glyph="答" />
      </View>
      <AnswerText text={text} streaming english={assistAnswerLocale(locale) === "en"} />
    </View>
  );
}

/** A1: three dots brightening in turn (still under reduced motion), and one line; 「还在查……」 after 20 s. */
function Waiting({ slow }: { slow: boolean }) {
  const { t: tr } = useI18n();
  return (
    <View testID="assist-waiting" style={styles.answer}>
      <View style={styles.answerHead}>
        <Dots />
        <Txt testID="assist-waiting-text" variant="body" tone="muted" style={styles.fill}>
          {tr(slow ? "soul_app.assist.still_searching" : "soul_app.assist.waiting")}
        </Txt>
      </View>
    </View>
  );
}

function Dots() {
  const t = useTheme();
  const reduced = useReducedMotion();
  const [lit, setLit] = useState(0);
  useEffect(() => {
    if (reduced) return;
    const timer = setInterval(() => setLit((n) => (n + 1) % 3), DOT_MS);
    return () => clearInterval(timer);
  }, [reduced]);
  return (
    <View testID="assist-dots" style={styles.dots} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      {[0, 1, 2].map((i) => (
        <View key={i} style={[styles.dot, { backgroundColor: t.inkSubtle, opacity: reduced || i === lit ? 1 : 0.3 }]} />
      ))}
    </View>
  );
}

/** 1g ③: the question stays, marked 未答; retry, or put it back in the box. */
function Unanswered({ failure, assist }: { failure: Extract<Assist["failure"], { kind: "unanswered" }>; assist: Assist }) {
  const { t: tr } = useI18n();
  return (
    <View testID="assist-unanswered" style={styles.gap}>
      <Question text={failure.question} meta={`${clock(failure.at)} · ${tr("soul_app.assist.unanswered_mark")}`} />
      <Txt variant="caption" tone="muted">
        {tr(failure.timeout ? "soul_app.assist.unanswered_timeout" : "soul_app.assist.unanswered")}
      </Txt>
      <View style={styles.row}>
        <Button testID="assist-retry" kind="secondary" title={tr("soul_app.common.retry")} onPress={() => assist.ask(failure.question)} style={styles.fill} />
        <Button testID="assist-edit" kind="secondary" title={tr("soul_app.assist.edit")} onPress={assist.edit} style={styles.fill} />
      </View>
    </View>
  );
}

/** 1g ②. The server tells when, not how many were used, so only the when is said. */
function Limited({ retryAt }: { retryAt: string | null }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  return (
    <View testID="assist-limited" style={[styles.card, { borderColor: t.hair2, backgroundColor: t.s1 }]}>
      <Txt variant="nav">{tr("soul_app.assist.limited_title")}</Txt>
      <Txt testID="assist-limited-body" variant="caption" tone="muted">
        {retryAt ? tr("soul_app.assist.limited_body", { time: clock(retryAt) }) : tr("soul_app.assist.limited_later")}
      </Txt>
    </View>
  );
}

/** 1g ①: the entry was shown from a stale profile. Closing hides it (assist.tsx). */
function NotConfigured({ assist }: { assist: Assist }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  return (
    <View style={styles.body}>
      <View testID="assist-not-configured" style={[styles.card, { borderColor: t.hair2, backgroundColor: t.s1 }]}>
        <Txt variant="nav">{tr("soul_app.assist.not_configured_title")}</Txt>
        <Txt variant="caption" tone="muted">
          {tr("soul_app.assist.not_configured_body")}
        </Txt>
        {assist.openLetters ? <Button testID="assist-letters" kind="secondary" title={tr("soul_app.assist.to_letters")} onPress={assist.openLetters} /> : null}
      </View>
    </View>
  );
}

/** 1g ④: after the server's fixed "cannot answer" only — never guessed from other text. */
function LettersCard({ assist }: { assist: Assist }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const hall = useCurrentHall();
  if (!assist.openLetters) return null;
  return (
    <View testID="assist-letters-card" style={[styles.card, { borderColor: t.hair2, backgroundColor: t.s1 }]}>
      <Txt variant="caption" tone="muted">
        {tr("soul_app.assist.letters_card", { hall })}
      </Txt>
      <Button testID="assist-letters" kind="secondary" title={tr("soul_app.assist.to_letters")} onPress={assist.openLetters} />
      <Txt variant="label" tone="subtle">
        {tr("soul_app.assist.letters_note")}
      </Txt>
    </View>
  );
}

/** 1h: once per account, in place of the empty state. */
function Intro({ onAck }: { onAck: () => void }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const items: [string, string, string][] = [
    ["一", "soul_app.assist.intro_ai_title", "soul_app.assist.intro_ai_body"],
    ["二", "soul_app.assist.intro_keep_title", "soul_app.assist.intro_keep_body"],
    ["三", "soul_app.assist.intro_ro_title", "soul_app.assist.intro_ro_body"],
  ];
  return (
    <ScrollView style={styles.fill} contentContainerStyle={styles.body}>
      <View testID="assist-intro" style={styles.gap}>
        <Txt variant="title">{tr("soul_app.assist.intro_title")}</Txt>
        {items.map(([n, title, body]) => (
          <View key={n} style={[styles.introItem, { borderTopColor: t.hair }]}>
            <Txt variant="value" tone="ink" importantForAccessibility="no">
              {n}
            </Txt>
            <View style={styles.fill}>
              <Txt variant="nav">{tr(title)}</Txt>
              <Txt variant="caption" tone="muted">
                {tr(body)}
              </Txt>
            </View>
          </View>
        ))}
        <Button testID="assist-ack" title={tr("soul_app.assist.intro_ok")} onPress={onAck} />
      </View>
    </ScrollView>
  );
}

/** The box. It stays open while an answer is written (A5); only the button waits: 「■ 停止」 until done. */
function Composer({ assist }: { assist: Assist }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const busy = !!assist.pending;
  const ready = !busy && assist.draft.trim().length > 0;
  return (
    <View style={[styles.composer, { borderTopColor: t.hair }]}>
      {busy ? (
        <Txt testID="assist-locked" variant="label" tone="subtle">
          {tr("soul_app.assist.wait_lock")}
        </Txt>
      ) : null}
      <View style={styles.row}>
        <TextInput
          testID="assist-input"
          accessibilityLabel={tr("soul_app.assist.placeholder")}
          value={assist.draft}
          onChangeText={assist.setDraft}
          placeholder={tr("soul_app.assist.placeholder")}
          placeholderTextColor={t.inkSubtle}
          maxLength={MAX_QUESTION}
          multiline
          cursorColor={t.ink}
          style={[styles.input, { color: t.ink, backgroundColor: t.s1, borderColor: t.hair, fontFamily: quoteFamily(assist.draft) }]}
        />
        {busy ? (
          <Pressable
            testID="assist-stop"
            accessibilityRole="button"
            accessibilityLabel={tr("soul_app.assist.stop_aria")}
            onPress={assist.stop}
            style={({ pressed }) => [styles.stop, { borderColor: t.ink }, pressed && { backgroundColor: t.s2 }]}
          >
            <Txt variant="label">{`■ ${tr("soul_app.assist.stop")}`}</Txt>
          </Pressable>
        ) : (
          <Pressable
            testID="assist-send"
            accessibilityRole="button"
            accessibilityLabel={tr("soul_app.assist.send")}
            accessibilityState={{ disabled: !ready }}
            disabled={!ready}
            onPress={() => assist.ask(assist.draft)}
            style={[styles.send, { borderColor: ready ? t.ink : t.hair }]}
          >
            <Icon name="send" size={18} color={ready ? t.ink : t.inkSubtle} strokeWidth={1.4} />
          </Pressable>
        )}
      </View>
    </View>
  );
}

/** 1f: start page (ink hairline) + mono time + first question in the serif; delete is a 44pt target, no swipe. */
function History({ assist, onOpened }: { assist: Assist; onOpened: () => void }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const [asking, setAsking] = useState<AssistConversation | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const list = assist.history;
  const now = new Date();
  const stamp = (iso: string) => {
    const d = new Date(iso);
    return sameDay(d, now) ? `${tr("soul_app.assist.today")} ${clock(iso)}` : `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${clock(iso)}`;
  };
  const remove = async () => {
    if (!asking) return;
    setBusy(true);
    try {
      await assist.remove(asking.id);
      setAsking(null);
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={styles.fill}>
      <ScrollView style={styles.fill} contentContainerStyle={styles.body}>
        {!list ? <Skeleton lines={3} /> : null}
        {list?.length === 0 ? (
          <Txt testID="assist-history-empty" variant="body" tone="muted">
            {tr("soul_app.assist.history_empty")}
          </Txt>
        ) : null}
        {list?.map((c) => (
          <View key={c.id} testID={`assist-row-${c.id}`} style={[styles.historyRow, { borderBottomColor: t.hair }]}>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                assist.openConversation(c);
                onOpened();
              }}
              style={styles.fill}
            >
              <View style={styles.answerHead}>
                <View style={[styles.screenTag, { borderLeftColor: t.ink }]}>
                  <Txt variant="label" tone="muted">
                    {tr(SCREEN_TITLE[c.screen])}
                  </Txt>
                </View>
                <Txt variant="value" tone="subtle">
                  {stamp(c.last_active_at)}
                </Txt>
              </View>
              <Txt numberOfLines={2} style={{ fontFamily: quoteFamily(c.first_question) }}>
                {c.first_question}
              </Txt>
            </Pressable>
            <Pressable
              testID={`assist-delete-${c.id}`}
              accessibilityRole="button"
              accessibilityLabel={tr("soul_app.assist.delete_label")}
              onPress={() => setAsking(c)}
              style={styles.icon}
            >
              <Icon name="close" size={14} color={t.inkSubtle} strokeWidth={1.3} />
            </Pressable>
          </View>
        ))}
        {list && list.length > 0 ? (
          <Txt variant="label" tone="subtle">
            {tr("soul_app.assist.history_end")}
          </Txt>
        ) : null}
      </ScrollView>
      {asking ? (
        <Confirm>
          <Txt variant="title">{tr("soul_app.assist.delete_title")}</Txt>
          <Txt variant="caption" tone="muted">
            {tr("soul_app.assist.delete_body", { screen: tr(SCREEN_TITLE[asking.screen]) })}
          </Txt>
          {failed ? (
            <Txt testID="assist-delete-failed" variant="caption" tone="negInk" accessibilityRole="alert">
              {tr("soul_app.errors.section")}
            </Txt>
          ) : null}
          <Button testID="assist-delete-confirm" kind="danger" title={tr("soul_app.assist.delete_confirm")} busy={busy} onPress={() => void remove()} />
          <Button
            testID="assist-delete-cancel"
            kind="secondary"
            title={tr("soul_app.common.cancel")}
            onPress={() => {
              setAsking(null);
              setFailed(false);
            }}
          />
        </Confirm>
      ) : null}
    </View>
  );
}

/** The delete confirmation, over the list inside the drawer (a second Modal over a Modal is unreliable). */
function Confirm({ children }: { children: ReactNode }) {
  const t = useTheme();
  return (
    <View style={[StyleSheet.absoluteFill, styles.confirmScrim, { backgroundColor: t.scrim }]}>
      <View testID="assist-delete-sheet" accessibilityViewIsModal style={[styles.confirm, { backgroundColor: t.s1, borderTopColor: t.negStrong }]}>
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  sheet: { flex: 1, borderTopWidth: 1 },
  /** The pull zone around the 36 × 4 handle (a drag, not a tap target: closing has its button). */
  handleZone: { height: 24, alignItems: "center", justifyContent: "center" },
  handle: { width: 36, height: 4, borderRadius: 999 },
  head: { minHeight: 56, flexDirection: "row", alignItems: "center", paddingHorizontal: 4, borderBottomWidth: 1 },
  seal: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  headText: { flex: 1, paddingHorizontal: 4 },
  headButton: { minHeight: 44, minWidth: 44, paddingHorizontal: 12, alignItems: "center", justifyContent: "center" },
  icon: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  body: { padding: 20, gap: 16 },
  gap: { gap: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  suggestion: { borderWidth: 1, paddingHorizontal: 16, paddingVertical: 12 },
  question: { alignSelf: "flex-end", maxWidth: "85%", borderRightWidth: 2, paddingRight: 12, gap: 2 },
  meta: { fontSize: 11, textAlign: "right" },
  answer: { gap: 8 },
  answerHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  answerText: { flexShrink: 1 },
  gap4: { gap: 4 },
  paraGap: { marginTop: 8 },
  item: { flexDirection: "row", gap: 8 },
  bold: { fontWeight: "600" },
  dots: { flexDirection: "row", gap: 2, width: 20, justifyContent: "center" },
  dot: { width: 4, height: 4 },
  interrupted: { flexDirection: "row", alignItems: "center", borderWidth: 1, paddingLeft: 8, gap: 8 },
  stop: { minHeight: 44, borderWidth: 1, paddingHorizontal: 12, alignItems: "center", justifyContent: "center" },
  jump: { position: "absolute", right: 12, bottom: 72, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 4 },
  en: { borderWidth: 1, borderStyle: "dotted", paddingHorizontal: 4 },
  enText: { fontSize: 10, lineHeight: 14, letterSpacing: 0.6 },
  card: { borderWidth: 1, padding: 16, gap: 12 },
  introItem: { flexDirection: "row", gap: 12, borderTopWidth: 1, paddingTop: 12 },
  composer: { borderTopWidth: 1, paddingHorizontal: 12, paddingVertical: 8, gap: 4 },
  input: { flex: 1, minHeight: 44, maxHeight: 120, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8, fontSize: 15 },
  send: { width: 44, height: 44, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  historyRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 12, borderBottomWidth: 1 },
  screenTag: { borderLeftWidth: 2, paddingLeft: 8 },
  confirmScrim: { justifyContent: "flex-end" },
  confirm: { borderTopWidth: 1, padding: 20, gap: 12 },
});
