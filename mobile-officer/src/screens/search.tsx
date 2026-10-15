/**
 * 查询: 「查灵魂(只读)/ 问一问(官员版)」. The soul lookup is read-only -- the list and the detail
 * screen offer nothing that writes. The assistant is the console's own (`/assist/`, the officer
 * token): the same endpoints and the same fixed texts, answered in one piece (no streaming on the
 * phone).
 */
import { isOfficerEmptyAnswer, officerAssistApi, officerAssistErrorCode } from "@soulledger/core/api/officer-assist";
import { soulsApi, type SoulListItem } from "@soulledger/core/api/souls";
import { useCallback, useRef, useState } from "react";
import { AccessibilityInfo, View } from "react-native";

import { Row, Segmented, StateView } from "../kit";
import { MoreRow, useMoreRows, type Page } from "../paged";
import { isDenied } from "../rules";
import { useSession } from "../session";
import { Button, Input, Notice, Screen, Txt, space, useI18n } from "../shared";

type Mode = "souls" | "ask";

export function SearchTab({ onOpenSoul }: { onOpenSoul: (id: string) => void }) {
  const { t } = useI18n();
  const [mode, setMode] = useState<Mode>("souls");
  return (
    <Screen testID="tab-search-screen" edges={["left", "right"]}>
      <Segmented
        testID="search-mode"
        value={mode}
        onChange={setMode}
        options={[
          { key: "souls", label: t("officer_app.search.souls") },
          { key: "ask", label: t("officer_app.search.ask") },
        ]}
      />
      {mode === "souls" ? <SoulLookup onOpen={onOpenSoul} /> : <Ask />}
    </Screen>
  );
}

function SoulLookup({ onOpen }: { onOpen: (id: string) => void }) {
  const { t, enumLabel } = useI18n();
  const { state } = useSession();
  const role = state.status === "signedIn" ? state.user.role : "";
  const [text, setText] = useState("");
  const [result, setResult] = useState<{ status: "idle" | "loading" | "error" | "denied" | "done"; first: Page<SoulListItem> | null; query: string }>({ status: "idle", first: null, query: "" });
  const sent = useRef(0);
  const { query } = result;
  const fetchPage = useCallback((page: number) => soulsApi.list({ search: query, page }).then((r) => r.data), [query]);
  const { rows, more } = useMoreRows(result.first, fetchPage);

  const search = useCallback(() => {
    const query = text.trim();
    if (!query) return;
    const mine = ++sent.current;
    setResult({ status: "loading", first: null, query });
    soulsApi.list({ search: query }).then(
      (r) => mine === sent.current && setResult({ status: "done", first: r.data, query }),
      (e: unknown) => mine === sent.current && setResult({ status: isDenied(e) ? "denied" : "error", first: null, query })
    );
  }, [text]);

  return (
    <View>
      <View style={{ paddingHorizontal: space[5], gap: space[3], paddingBottom: space[3] }}>
        <Input
          testID="soul-search"
          label={t("officer_app.search.souls")}
          placeholder={t("officer_app.search.placeholder")}
          value={text}
          onChangeText={setText}
          returnKeyType="search"
          onSubmitEditing={search}
        />
        <Txt variant="caption" tone="muted">
          {t("officer_app.search.read_only")}
        </Txt>
      </View>
      {result.status === "idle" ? null : result.status === "done" && rows && rows.length > 0 ? (
        <>
          {rows.map((soul) => (
          <Row
            key={soul.id}
            testID={`soul-row-${soul.id}`}
            strong
            title={soul.name}
            lines={[stateLabel(enumLabel("souls.states", soul.current_state), soul.current_state)]}
            onPress={() => onOpen(soul.id)}
            right={<Txt tone="muted">›</Txt>}
          />
          ))}
          <MoreRow more={more} />
        </>
      ) : (
        <StateView
          state={result.status === "done" ? "empty" : result.status}
          onRetry={search}
          role={role}
          area={t("officer_app.areas.search")}
          emptyTitle={t("officer_app.search.no_souls_title")}
          emptyBody={t("officer_app.search.no_souls_body")}
        />
      )}
    </View>
  );
}

interface Line {
  role: "user" | "assistant";
  text: string;
}

function Ask() {
  const { t } = useI18n();
  const [question, setQuestion] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const conversation = useRef<string | null>(null);

  const send = () => {
    const text = question.trim();
    if (!text || busy) return;
    setBusy(true);
    setFailure(null);
    officerAssistApi
      .ask({ question: text, screen: "other", conversation_id: conversation.current })
      .then((answer) => {
        conversation.current = answer.conversation_id;
        const reply = answer.answer.content;
        setLines((prev) => [...prev, { role: "user", text }, { role: "assistant", text: isOfficerEmptyAnswer(reply) ? t("officer_assist.cannot_answer") : reply }]);
        setQuestion("");
        // The answer lands below the box; a screen reader is told it has (the desk's 「已回答」).
        AccessibilityInfo.announceForAccessibility(t("officer_assist.answered"));
      })
      .catch((e: unknown) => {
        // The question stays in the box: "你的问题还在".
        const code = officerAssistErrorCode(e);
        setFailure(
          code === "rate_limited"
            ? t("officer_assist.limited_later")
            : code === "assistant_not_configured"
              ? t("officer_assist.not_configured_title")
              : t("officer_assist.unanswered")
        );
      })
      .finally(() => setBusy(false));
  };

  return (
    <View style={{ paddingHorizontal: space[5], gap: space[4] }}>
      {lines.map((line, i) => (
        <View key={i} testID={`ask-${line.role}`} style={{ gap: space[1] }}>
          <Txt variant="caption" tone="muted">
            {line.role === "user" ? "›" : "◇"}
          </Txt>
          <Txt variant="bodyLg">{line.text}</Txt>
        </View>
      ))}
      {failure ? <Notice tone="neg">{failure}</Notice> : null}
      <Input testID="ask-input" label={t("officer_app.search.ask")} placeholder={t("officer_assist.placeholder")} value={question} onChangeText={setQuestion} multiline />
      <Button testID="ask-send" title={t("officer_assist.send")} busy={busy} onPress={send} />
      <Txt variant="caption" tone="subtle">
        {t("officer_assist.footnote")}
      </Txt>
    </View>
  );
}

/** Known states read through the bundles; an unknown one keeps its raw code instead of a key path. */
function stateLabel(d: { state: string; label?: string | null }, raw: string | null | undefined): string {
  return d.state === "known" && d.label ? d.label : (raw ?? "");
}
