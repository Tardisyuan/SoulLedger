/**
 * 查询: 查灵魂, read-only -- the list and the detail screen offer nothing that writes. 问一问 moved
 * to every tab's top bar in batch 39 (assist.tsx); the 查灵魂 / 问一问 switch is gone.
 *
 * One box, no switch (Design 第四十批 O-d): the same search also asks the judgment list -- by soul name, or a case
 * number's beginning (the server's `^case_number`) -- and what it answers is pinned above the souls as a 「案件」
 * group: shown, never jumped to (as the web's search, 8g).
 *
 * Convenience audit 2026-11-15 D2: it searches SEARCH_PAUSE_MS after the last keystroke (「搜索」 on the keyboard still
 * searches at once), and an empty box shows 「最近打开」 -- the last cases and souls opened (recentOpened.ts).
 */
import { judgmentApi, type Judgment } from "@soulledger/core/api/judgment";
import { soulsApi, type SoulListItem } from "@soulledger/core/api/souls";
import { courtLabel } from "@soulledger/core/domain/courts";
import { useCallback, useEffect, useRef, useState } from "react";
import { View } from "react-native";

import { Row, StateView } from "../kit";
import { MoreRow, useMoreRows, type Page } from "../paged";
import { readRecent } from "../recentOpened";
import { isDenied } from "../rules";
import { useSession } from "../session";
import { Input, Screen, SectionLabel, Txt, space, useI18n } from "../shared";

/**
 * `initialQuery` / `onSearch`: the last search, kept by the shell. Opening a soul unmounts this tab, and 返回 used to
 * land on an empty box (review 2026-11-01); now the same search runs again on the way back.
 */
export function SearchTab({
  onOpenSoul,
  onOpenJudgment,
  initialQuery,
  onSearch,
}: {
  onOpenSoul: (id: string) => void;
  onOpenJudgment?: (id: string) => void;
  initialQuery?: string;
  onSearch?: (query: string) => void;
}) {
  return (
    <Screen testID="tab-search-screen" edges={["left", "right"]}>
      <SoulLookup onOpen={onOpenSoul} onOpenJudgment={onOpenJudgment} initialQuery={initialQuery} onSearch={onSearch} />
    </Screen>
  );
}

/** How long the search waits after the last keystroke before it asks the server (as 加签's, sheets.tsx). */
const SEARCH_PAUSE_MS = 300;

/**
 * A soul code typed with dashes (`QU3-3Q9F-W5F`) is sent compact: the backend's DRF SearchFilter splits on
 * whitespace only, so a dashed code reached it as one term and matched nothing (Huawei pass, 2026-10-29).
 * Anything that is not a whole code goes through unchanged.
 */
export function soulSearchTerm(query: string): string {
  const compact = query.replace(/[\s\-－]/g, "").toUpperCase();
  return /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{10}$/.test(compact) ? compact : query;
}

function SoulLookup({
  onOpen,
  onOpenJudgment,
  initialQuery = "",
  onSearch,
}: {
  onOpen: (id: string) => void;
  onOpenJudgment?: (id: string) => void;
  initialQuery?: string;
  onSearch?: (query: string) => void;
}) {
  const { t, enumLabel } = useI18n();
  const { state } = useSession();
  const role = state.status === "signedIn" ? state.user.role : "";
  const [text, setText] = useState(initialQuery);
  const [result, setResult] = useState<{ status: "idle" | "loading" | "error" | "denied" | "done"; first: Page<SoulListItem> | null; query: string }>({ status: "idle", first: null, query: "" });
  // The 「案件」 group. A failed or refused judgment search just shows no group.
  const [cases, setCases] = useState<Judgment[]>([]);
  const sent = useRef(0);
  // The query last sent, so the pause does not send again what 「搜索」 (or the way back) just sent.
  const lastSent = useRef("");
  const [recent] = useState(readRecent);
  const { query } = result;
  const fetchPage = useCallback((page: number) => soulsApi.list({ search: soulSearchTerm(query), page }).then((r) => r.data), [query]);
  const { rows, more, moreState } = useMoreRows(result.first, fetchPage);

  const search = useCallback(() => {
    const query = text.trim();
    if (!query) return;
    const mine = ++sent.current;
    lastSent.current = query;
    onSearch?.(query);
    setResult({ status: "loading", first: null, query });
    setCases([]);
    judgmentApi.list({ search: query }).then(
      (r) => mine === sent.current && setCases(r.data.results),
      () => undefined
    );
    soulsApi.list({ search: soulSearchTerm(query) }).then(
      (r) => mine === sent.current && setResult({ status: "done", first: r.data, query }),
      (e: unknown) => mine === sent.current && setResult({ status: isDenied(e) ? "denied" : "error", first: null, query })
    );
  }, [text, onSearch]);
  // Back from a soul (or a tab switch): the kept search runs again, once.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a fetch started once on mount; its loading state is the point
    if (initialQuery.trim()) search();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per mount, with the query it was given
  }, []);
  // Typing searches after a pause; the timer reads `lastSent` when it fires, so a search 「搜索」 already sent is not repeated.
  useEffect(() => {
    const query = text.trim();
    if (!query) return;
    const id = setTimeout(() => {
      if (query !== lastSent.current) search();
    }, SEARCH_PAUSE_MS);
    return () => clearTimeout(id);
  }, [text, search]);
  // An emptied box drops the last answer (one still on its way is ignored) and shows 「最近打开」 again.
  const change = (next: string) => {
    setText(next);
    if (next.trim()) return;
    sent.current++;
    lastSent.current = "";
    onSearch?.("");
    setResult({ status: "idle", first: null, query: "" });
    setCases([]);
  };

  const souls = result.status === "done" && rows && rows.length > 0;
  return (
    <View>
      <View style={{ paddingHorizontal: space[5], gap: space[3], paddingTop: space[4], paddingBottom: space[3] }}>
        <Input
          testID="soul-search"
          label={t("officer_app.search.souls")}
          placeholder={t("officer_app.search.placeholder")}
          value={text}
          onChangeText={change}
          returnKeyType="search"
          onSubmitEditing={search}
        />
        <Txt variant="caption" tone="muted">
          {t("officer_app.search.read_only")}
        </Txt>
      </View>
      {text.trim() === "" && recent.length > 0 ? (
        <View testID="search-recent">
          <View style={{ paddingHorizontal: space[5], paddingVertical: space[3] }}>
            <SectionLabel>{t("officer_app.search.recent")}</SectionLabel>
          </View>
          {recent.map((e) => {
            const open = e.type === "soul" ? () => onOpen(e.id) : onOpenJudgment ? () => onOpenJudgment(e.id) : undefined;
            return (
              <Row
                key={`${e.type}:${e.id}`}
                testID={`recent-row-${e.type}-${e.id}`}
                title={e.title}
                lines={[[t(e.type === "soul" ? "search.group_souls" : "officer_app.search.group_case"), e.line].filter(Boolean).join(" · ")]}
                onPress={open}
                right={open ? <Txt tone="muted">›</Txt> : undefined}
              />
            );
          })}
        </View>
      ) : null}
      {cases.length > 0 ? (
        <View testID="search-cases">
          <View style={{ paddingHorizontal: space[5], paddingVertical: space[3] }}>
            <SectionLabel>{t("officer_app.search.group_case")}</SectionLabel>
          </View>
          {cases.map((j) => (
            <Row
              key={j.id}
              testID={`case-row-${j.id}`}
              strong
              title={j.case_number}
              lines={[[j.soul_name, courtLabel(t, j.court)].filter(Boolean).join(" · ")]}
              onPress={onOpenJudgment ? () => onOpenJudgment(j.id) : undefined}
              right={onOpenJudgment ? <Txt tone="muted">›</Txt> : undefined}
            />
          ))}
          <View style={{ paddingHorizontal: space[5], paddingVertical: space[3] }}>
            <SectionLabel>{t("search.group_souls")}</SectionLabel>
          </View>
          {result.status === "done" && !souls ? (
            <Txt testID="search-no-soul" variant="body" tone="muted" style={{ paddingHorizontal: space[5] }}>
              {t("officer_app.search.no_soul")}
            </Txt>
          ) : null}
        </View>
      ) : null}
      {result.status === "idle" ? null : souls ? (
        <>
          {rows!.map((soul) => (
          <Row
            key={soul.id}
            testID={`soul-row-${soul.id}`}
            strong
            title={soul.name}
            lines={[{ one: stateLabel(enumLabel("souls.states", soul.current_state), soul.current_state) }]}
            onPress={() => onOpen(soul.id)}
            right={<Txt tone="muted">›</Txt>}
          />
          ))}
          <MoreRow more={more} state={moreState} />
        </>
      ) : cases.length > 0 && result.status === "done" ? null : (
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

/** Known states read through the bundles; an unknown one keeps its raw code instead of a key path. */
function stateLabel(d: { state: string; label?: string | null }, raw: string | null | undefined): string {
  return d.state === "known" && d.label ? d.label : (raw ?? "");
}
