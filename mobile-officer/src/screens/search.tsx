/**
 * 查询: 查灵魂, read-only -- the list and the detail screen offer nothing that writes. 问一问 moved
 * to every tab's top bar in batch 39 (assist.tsx); the 查灵魂 / 问一问 switch is gone.
 */
import { soulsApi, type SoulListItem } from "@soulledger/core/api/souls";
import { useCallback, useRef, useState } from "react";
import { View } from "react-native";

import { Row, StateView } from "../kit";
import { MoreRow, useMoreRows, type Page } from "../paged";
import { isDenied } from "../rules";
import { useSession } from "../session";
import { Input, Screen, Txt, space, useI18n } from "../shared";

export function SearchTab({ onOpenSoul }: { onOpenSoul: (id: string) => void }) {
  return (
    <Screen testID="tab-search-screen" edges={["left", "right"]}>
      <SoulLookup onOpen={onOpenSoul} />
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
  const { rows, more, moreState } = useMoreRows(result.first, fetchPage);

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
          <MoreRow more={more} state={moreState} />
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

/** Known states read through the bundles; an unknown one keeps its raw code instead of a key path. */
function stateLabel(d: { state: string; label?: string | null }, raw: string | null | undefined): string {
  return d.state === "known" && d.label ? d.label : (raw ?? "");
}
