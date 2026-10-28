/**
 * 查询: 查灵魂, read-only -- the list and the detail screen offer nothing that writes. 问一问 moved
 * to every tab's top bar in batch 39 (assist.tsx); the 查灵魂 / 问一问 switch is gone.
 *
 * One box, no switch (Design 第四十批 O-d): when the text looks like a whole case number (`looksLikeCaseNumber`) the
 * same search also asks the judgment list, and an exact match is pinned above the souls as a 「案件」 group -- shown,
 * never jumped to (as the web's search, 8g). A case that does not match exactly is not offered.
 */
import { judgmentApi, type Judgment } from "@soulledger/core/api/judgment";
import { soulsApi, type SoulListItem } from "@soulledger/core/api/souls";
import { useCallback, useRef, useState } from "react";
import { View } from "react-native";

import { Row, StateView } from "../kit";
import { MoreRow, useMoreRows, type Page } from "../paged";
import { isDenied, looksLikeCaseNumber } from "../rules";
import { useSession } from "../session";
import { Input, Screen, SectionLabel, Txt, space, useI18n } from "../shared";

export function SearchTab({ onOpenSoul, onOpenJudgment }: { onOpenSoul: (id: string) => void; onOpenJudgment?: (id: string) => void }) {
  return (
    <Screen testID="tab-search-screen" edges={["left", "right"]}>
      <SoulLookup onOpen={onOpenSoul} onOpenJudgment={onOpenJudgment} />
    </Screen>
  );
}

/**
 * A soul code typed with dashes (`QU3-3Q9F-W5F`) is sent compact: the backend's DRF SearchFilter splits on
 * whitespace only, so a dashed code reached it as one term and matched nothing (Huawei pass, 2026-10-29).
 * Anything that is not a whole code goes through unchanged.
 */
export function soulSearchTerm(query: string): string {
  const compact = query.replace(/[\s\-－]/g, "").toUpperCase();
  return /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{10}$/.test(compact) ? compact : query;
}

function SoulLookup({ onOpen, onOpenJudgment }: { onOpen: (id: string) => void; onOpenJudgment?: (id: string) => void }) {
  const { t, enumLabel } = useI18n();
  const { state } = useSession();
  const role = state.status === "signedIn" ? state.user.role : "";
  const [text, setText] = useState("");
  const [result, setResult] = useState<{ status: "idle" | "loading" | "error" | "denied" | "done"; first: Page<SoulListItem> | null; query: string }>({ status: "idle", first: null, query: "" });
  // The 「案件」 group: only exact case-number matches. A failed or refused judgment search just shows no group.
  const [cases, setCases] = useState<Judgment[]>([]);
  const sent = useRef(0);
  const { query } = result;
  const fetchPage = useCallback((page: number) => soulsApi.list({ search: soulSearchTerm(query), page }).then((r) => r.data), [query]);
  const { rows, more, moreState } = useMoreRows(result.first, fetchPage);

  const search = useCallback(() => {
    const query = text.trim();
    if (!query) return;
    const mine = ++sent.current;
    setResult({ status: "loading", first: null, query });
    setCases([]);
    if (looksLikeCaseNumber(query)) {
      judgmentApi.list({ search: query }).then(
        (r) => mine === sent.current && setCases(r.data.results.filter((j) => j.case_number?.toLowerCase() === query.toLowerCase())),
        () => undefined
      );
    }
    soulsApi.list({ search: soulSearchTerm(query) }).then(
      (r) => mine === sent.current && setResult({ status: "done", first: r.data, query }),
      (e: unknown) => mine === sent.current && setResult({ status: isDenied(e) ? "denied" : "error", first: null, query })
    );
  }, [text]);

  const souls = result.status === "done" && rows && rows.length > 0;
  return (
    <View>
      <View style={{ paddingHorizontal: space[5], gap: space[3], paddingTop: space[4], paddingBottom: space[3] }}>
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
              lines={[[j.soul_name, j.court].filter(Boolean).join(" · ")]}
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
