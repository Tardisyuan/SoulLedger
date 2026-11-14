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
 *
 * Design 第五十批 C2: the box stays on top (outside the scroll) and is focused on arrival. Empty: 「最近打开」 (the name
 * in the dossier face, a case number in mono, when at the right) with 「清除」. Typed: 「案件 · n」 first (CASES_SHOWN
 * rows; 「看全部 n 件 ›」 shows the rest of what the server answered, in place) and 「人物 · n」 under it (PEOPLE_SHOWN
 * rows, 「灵魂 · 殿名」). Where the typed text matches it is bold and underlined, never coloured. Nothing at all:
 * 「没有找到「…」」 and how to search, with this hall's case-number prefix for this year (`caseNumberExample`).
 *
 * 人物 is souls only: the officer app has no officer search to ask (the web's search has none either).
 */
import { judgmentApi, type Judgment } from "@soulledger/core/api/judgment";
import { soulsApi, type SoulListItem } from "@soulledger/core/api/souls";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";

import { formatWhen } from "../format";
import { StateView } from "../kit";
import { type Page } from "../paged";
import { clearRecent, readRecent, type RecentOpened } from "../recentOpened";
import { caseNumberExample, hallLabel, isDenied } from "../rules";
import { useSession } from "../session";
import { Input, Screen, SectionLabel, Txt, family, space, useI18n, useTheme } from "../shared";

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
  return <SoulLookup onOpen={onOpenSoul} onOpenJudgment={onOpenJudgment} initialQuery={initialQuery} onSearch={onSearch} />;
}

/** How long the search waits after the last keystroke before it asks the server (as 加签's, sheets.tsx). */
const SEARCH_PAUSE_MS = 300;

/** 第五十批 C2: the cases shown before 「看全部」, and the people shown at all. */
export const CASES_SHOWN = 5;
export const PEOPLE_SHOWN = 3;

/**
 * A soul code typed with dashes (`QU3-3Q9F-W5F`) is sent compact: the backend's DRF SearchFilter splits on
 * whitespace only, so a dashed code reached it as one term and matched nothing (Huawei pass, 2026-10-29).
 * Anything that is not a whole code goes through unchanged.
 */
export function soulSearchTerm(query: string): string {
  const compact = query.replace(/[\s\-－]/g, "").toUpperCase();
  return /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{10}$/.test(compact) ? compact : query;
}

/** The text cut where the typed term first matches (case-insensitive); the match is drawn bold and underlined. */
export function marked(text: string, q: string): { text: string; hit: boolean }[] {
  const term = q.trim();
  const at = term ? text.toLowerCase().indexOf(term.toLowerCase()) : -1;
  if (at < 0) return [{ text, hit: false }];
  return [
    { text: text.slice(0, at), hit: false },
    { text: text.slice(at, at + term.length), hit: true },
    { text: text.slice(at + term.length), hit: false },
  ].filter((p) => p.text !== "");
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
  const { t } = useI18n();
  const { state } = useSession();
  const role = state.status === "signedIn" ? state.user.role : "";
  const hallCode = state.status === "signedIn" ? state.user.tenant?.code : null;
  const [text, setText] = useState(initialQuery);
  const [result, setResult] = useState<{ status: "idle" | "loading" | "error" | "denied" | "done"; first: Page<SoulListItem> | null; query: string }>({ status: "idle", first: null, query: "" });
  // The 「案件」 group. A failed or refused judgment search just shows no group.
  const [cases, setCases] = useState<{ rows: Judgment[]; count: number }>({ rows: [], count: 0 });
  const [allCases, setAllCases] = useState(false);
  const sent = useRef(0);
  // The query last sent, so the pause does not send again what 「搜索」 (or the way back) just sent.
  const lastSent = useRef("");
  const [recent, setRecent] = useState(readRecent);

  const search = useCallback(() => {
    const query = text.trim();
    if (!query) return;
    const mine = ++sent.current;
    lastSent.current = query;
    onSearch?.(query);
    setResult({ status: "loading", first: null, query });
    setCases({ rows: [], count: 0 });
    setAllCases(false);
    judgmentApi.list({ search: query }).then(
      (r) => mine === sent.current && setCases({ rows: r.data.results, count: r.data.count ?? r.data.results.length }),
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
    setCases({ rows: [], count: 0 });
  };

  const { query } = result;
  const people = result.first?.results ?? [];
  const peopleCount = result.first?.count ?? people.length;
  const shownCases = allCases ? cases.rows : cases.rows.slice(0, CASES_SHOWN);
  const nothing = result.status === "done" && people.length === 0 && cases.rows.length === 0;
  const failed = result.status === "error" || result.status === "denied";
  return (
    <View style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: space[5], paddingTop: space[4], paddingBottom: space[3] }}>
        <Input
          testID="soul-search"
          label={t("officer_app.search.souls")}
          labelHidden
          placeholder={t("officer_app.search.placeholder")}
          value={text}
          onChangeText={change}
          autoFocus
          returnKeyType="search"
          onSubmitEditing={search}
        />
      </View>
      <Screen testID="tab-search-screen" edges={["left", "right"]}>
        {text.trim() === "" ? (
          <View testID="search-recent">
            <GroupHead
              title={t("search.group_recent")}
              action={
                recent.length > 0
                  ? {
                      testID: "search-recent-clear",
                      label: t("officer_app.search.clear_recent"),
                      onPress: () => {
                        clearRecent();
                        setRecent([]);
                      },
                    }
                  : undefined
              }
            />
            {recent.length === 0 ? (
              <Txt testID="search-recent-empty" variant="body" tone="muted" style={{ paddingHorizontal: space[5], paddingVertical: space[3] }}>
                {t("officer_app.search.recent_empty")}
              </Txt>
            ) : (
              recent.map((e) => (
                <RecentRow key={`${e.type}:${e.id}`} entry={e} onOpen={e.type === "soul" ? () => onOpen(e.id) : onOpenJudgment ? () => onOpenJudgment(e.id) : undefined} />
              ))
            )}
          </View>
        ) : null}
        {cases.rows.length > 0 ? (
          <View testID="search-cases">
            <GroupHead title={t("officer_app.search.group_cases", { n: String(cases.count) })} />
            {shownCases.map((j) => (
              <HitRow
                key={j.id}
                testID={`case-row-${j.id}`}
                name={j.soul_name ?? ""}
                q={query}
                line={j.case_number}
                mono
                right={caseState(t, j)}
                onPress={onOpenJudgment ? () => onOpenJudgment(j.id) : undefined}
              />
            ))}
            {!allCases && cases.count > CASES_SHOWN ? (
              // ponytail: shows the rest of the first page the server answered; a hall with more than a page of matches
              // for one term gets that page, not every match.
              <Pressable testID="search-see-all" accessibilityRole="button" onPress={() => setAllCases(true)} style={{ minHeight: 48, justifyContent: "center", paddingHorizontal: space[5] }}>
                <Txt variant="bodyLg">{t("officer_app.search.see_all", { n: String(cases.count) })}</Txt>
              </Pressable>
            ) : null}
          </View>
        ) : null}
        {people.length > 0 ? (
          <View testID="search-people">
            <GroupHead title={t("officer_app.search.group_people", { n: String(peopleCount) })} />
            {people.slice(0, PEOPLE_SHOWN).map((soul) => (
              <HitRow
                key={soul.id}
                testID={`soul-row-${soul.id}`}
                name={soul.name}
                q={query}
                line={[t(PERSON_KIND.soul), hallLabel(t, { code: soul.tenant_code })].filter(Boolean).join(" · ")}
                onPress={() => onOpen(soul.id)}
              />
            ))}
          </View>
        ) : null}
        {nothing ? (
          <View testID="search-no-results" style={{ alignItems: "center", gap: space[2], paddingHorizontal: space[5], paddingVertical: space[6] }}>
            <Txt accessibilityRole="header" style={{ fontFamily: family.title, fontSize: 17, lineHeight: 24, textAlign: "center" }}>
              {t("search.no_results_title", { q: query })}
            </Txt>
            <Txt variant="body" tone="muted" style={{ textAlign: "center" }}>
              {t("officer_app.search.no_results_hint", { example: caseNumberExample(hallCode, new Date().getFullYear()) })}
            </Txt>
          </View>
        ) : failed || (result.status === "loading" && cases.rows.length === 0) ? (
          <StateView state={result.status as "loading" | "error" | "denied"} onRetry={search} role={role} area={t("officer_app.areas.search")} />
        ) : null}
      </Screen>
    </View>
  );
}

/** Who a 人物 row is: a soul, or (when there is an officer search to ask) an officer -- 「灵魂 / 官员 · 殿名」. */
const PERSON_KIND = { soul: "officer_app.search.kind_soul", officer: "officer_app.search.kind_officer" } as const;

/** A group's heading: 12 / 500 in the faint ink, as every group heading; an optional text link at its right. */
function GroupHead({ title, action }: { title: string; action?: { testID: string; label: string; onPress: () => void } }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: space[5], paddingTop: space[4], paddingBottom: space[2], borderBottomWidth: 1, borderBottomColor: theme.hair }}>
      <SectionLabel style={{ color: theme.faintText }}>{title}</SectionLabel>
      {action ? (
        <Pressable testID={action.testID} accessibilityRole="button" onPress={action.onPress} hitSlop={12}>
          <Txt variant="caption" tone="muted">
            {action.label}
          </Txt>
        </Pressable>
      ) : null}
    </View>
  );
}

/** 「最近打开」: a case shows its soul's name with the case number under it; a soul its name and 「灵魂」. When, at the right. */
function RecentRow({ entry, onOpen }: { entry: RecentOpened; onOpen?: () => void }) {
  const { t } = useI18n();
  const judgment = entry.type === "judgment";
  return (
    <HitRow
      testID={`recent-row-${entry.type}-${entry.id}`}
      name={judgment ? (entry.line ?? entry.title) : entry.title}
      q=""
      line={judgment ? entry.title : t(PERSON_KIND.soul)}
      mono={judgment}
      right={entry.at ? formatWhen(entry.at) : undefined}
      onPress={onOpen}
    />
  );
}

function HitRow({ testID, name, q, line, mono, right, onPress }: { testID: string; name: string; q: string; line: string; mono?: boolean; right?: string; onPress?: () => void }) {
  const theme = useTheme();
  const hit = (part: { text: string; hit: boolean }, i: number, face: string) =>
    part.hit ? (
      <Txt key={i} testID={`${testID}-hit`} style={{ fontFamily: face, textDecorationLine: "underline" }}>
        {part.text}
      </Txt>
    ) : (
      part.text
    );
  return (
    <Pressable
      testID={testID}
      accessibilityRole={onPress ? "button" : undefined}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 64,
        flexDirection: "row",
        alignItems: "center",
        gap: space[3],
        paddingHorizontal: space[5],
        paddingVertical: space[3],
        borderBottomWidth: 1,
        borderBottomColor: theme.hair,
        backgroundColor: pressed ? theme.hair : "transparent",
      })}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Txt numberOfLines={1} style={{ fontFamily: family.serifHan, fontSize: 17, lineHeight: 24 }}>
          {marked(name, q).map((p, i) => hit(p, i, family.title))}
        </Txt>
        <Txt numberOfLines={1} variant="caption" tone="muted" style={mono ? { fontFamily: family.mono[400] } : undefined}>
          {marked(line, q).map((p, i) => hit(p, i, mono ? family.mono[500] : family.ui[600]))}
        </Txt>
      </View>
      {right ? (
        <Txt variant="caption" tone="muted">
          {right}
        </Txt>
      ) : null}
    </Pressable>
  );
}

/** What a case row says at its right: 已结, 待认领, or who holds it. */
function caseState(t: (key: string) => string, j: Judgment): string {
  if (j.concluded_at) return t("souls.detail.case_closed");
  if (!j.claimed_by) return t("officer_app.desk.groups.unclaimed");
  return j.claimed_by_name ?? "";
}
