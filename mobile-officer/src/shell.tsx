/**
 * The signed-in shell: the identity band, the standing two-step-verification banner (when owed),
 * five tabs, and one detail screen over them.
 *
 * Navigation is a state, not a navigator: five tabs and one level of detail do not need a stack,
 * and a push landing is just "set the detail". A detail reached by a push remembers its item; going
 * back to the list washes that row for 1.2 s (kit.tsx `Highlight`; none under reduce-motion).
 */
import { useCallback, useEffect, useState } from "react";
import { BackHandler, View } from "react-native";

import { IdentityBand, StandingBanner, TabBar, type TabKey } from "./kit";
import { officerLinks } from "./links";
import { listenForLandings, registerDevice } from "./push";
import { HIGHLIGHT_MS, hallLabel } from "./rules";
import { Detail, type DetailTarget } from "./screens/detail";
import { ChangePasswordScreen } from "./screens/account";
import { MeTab, type AccountScreen } from "./screens/me";
import { MfaScreen } from "./screens/mfa";
import { NoticesTab } from "./screens/notices";
import { QueueTab } from "./screens/queue";
import { SearchTab } from "./screens/search";
import { TodoTab, type ItemRef } from "./screens/todo";
import { needsMfaSetup, useSession } from "./session";
import { useI18n, useTheme } from "./shared";

export function Shell() {
  const { t } = useI18n();
  const theme = useTheme();
  const { state } = useSession();
  const [tab, setTab] = useState<TabKey>("todo");
  const [detail, setDetail] = useState<DetailTarget | null>(null);
  // 我的's two sub-screens, drawn over the tabs like a detail (not a tab, so no tab-bar entry).
  const [account, setAccount] = useState<AccountScreen | null>(null);
  const [locked, setLocked] = useState(false);
  // Bumped whenever a list should ask again: after a detail closes, after a push.
  const [version, setVersion] = useState(0);
  const [landed, setLanded] = useState<ItemRef | null>(null);
  const [highlight, setHighlight] = useState<ItemRef | null>(null);
  const [unread, setUnread] = useState(false);

  useEffect(() => {
    // Idempotent on the server; does nothing without the system permission (asked in 我的, never here).
    void registerDevice();
    return listenForLandings((landing) => {
      setTab("todo");
      setVersion((v) => v + 1);
      if (landing.item) {
        setLanded(landing.item);
        setDetail({ type: "todo", ...landing.item });
      }
    });
  }, []);

  useEffect(
    // A link held while signed out (or before this mounted) arrives here first. Same landing as a push.
    () =>
      officerLinks.subscribe((link) => {
        setVersion((v) => v + 1);
        if (link.item) {
          setTab("todo");
          setLanded(link.item);
          setDetail({ type: "todo", ...link.item });
        } else {
          setDetail(null);
          setTab(link.tab);
        }
      }),
    []
  );

  const close = useCallback(() => {
    setDetail(null);
    setVersion((v) => v + 1);
    if (landed) {
      setHighlight(landed);
      setLanded(null);
    }
  }, [landed]);

  useEffect(() => {
    if (!detail) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      close();
      return true;
    });
    return () => sub.remove();
  }, [detail, close]);

  useEffect(() => {
    if (!highlight) return;
    const id = setTimeout(() => setHighlight(null), HIGHLIGHT_MS + 400);
    return () => clearTimeout(id);
  }, [highlight]);

  if (state.status !== "signedIn") return null;
  const { user } = state;

  return (
    <View testID="shell" style={{ flex: 1, backgroundColor: theme.s0 }}>
      <IdentityBand hall={hallLabel(t, user.tenant) ?? t("officer_app.name")} name={user.display_name || user.username} />
      {needsMfaSetup(user) ? (
        <StandingBanner testID="mfa-banner" action={{ label: t("mfa.banner.action"), onPress: () => { setDetail(null); setTab("me"); setAccount("mfa"); } }}>
          {t("mfa.banner.text")}
        </StandingBanner>
      ) : null}
      <View style={{ flex: 1 }}>
        {account === "mfa" ? (
          <MfaScreen onBack={() => setAccount(null)} onLocked={setLocked} />
        ) : account === "password" ? (
          <ChangePasswordScreen onBack={() => setAccount(null)} />
        ) : detail ? (
          <Detail target={detail} onBack={close} onSettled={() => setVersion((v) => v + 1)} />
        ) : tab === "todo" ? (
          <TodoTab key={version} highlight={highlight} onOpen={(item) => setDetail({ type: "todo", ...item })} />
        ) : tab === "queue" ? (
          <QueueTab key={version} onOpen={(id) => setDetail({ type: "judgment", id })} />
        ) : tab === "search" ? (
          <SearchTab onOpenSoul={(id) => setDetail({ type: "soul", id })} />
        ) : tab === "notices" ? (
          <NoticesTab onUnread={setUnread} />
        ) : (
          <MeTab onOpen={setAccount} />
        )}
      </View>
      <TabBar
        current={tab}
        unread={unread}
        onSelect={(next) => {
          if (locked) return; // the recovery codes are on screen and not yet confirmed saved
          setDetail(null);
          setAccount(null);
          setTab(next);
        }}
      />
    </View>
  );
}
