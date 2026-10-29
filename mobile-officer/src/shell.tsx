/**
 * The signed-in shell: the identity band, the standing two-step-verification banner (when owed),
 * up to five tabs (only those the officer's codes reach), and one detail screen over them. Each tab's top bar has 「问一问」; its conversation is
 * held here, above the tabs, so a tab switch or closing the sheet does not lose it (assist.tsx).
 *
 * Navigation is a state, not a navigator: five tabs and one level of detail do not need a stack,
 * and a push landing is just "set the detail". A detail reached by a push remembers its item; going
 * back to the list washes that row for 1.2 s (kit.tsx `Highlight`; none under reduce-motion).
 */
import { useCallback, useEffect, useState } from "react";
import { notificationsApi } from "@soulledger/core/api/notifications";
import type { JudgmentQueueGroup } from "@soulledger/core/api/judgment";
import { AppState, BackHandler, StyleSheet, View } from "react-native";

import { AssistSheet, TabHead, useOfficerAssist } from "./assist";
import { ActionButton, IdentityBand, StandingBanner, TabBar, visibleTabs, type TabKey } from "./kit";
import { isRetiredResetLink, officerLinks, resetLinks, type ResetLink } from "./links";
import { OfflineBanner } from "./offlineBanner";
import { listenForArrivals, listenForLandings, registerDevice } from "./push";
import { HIGHLIGHT_MS, hallLabel, type Landing } from "./rules";
import { Detail, type DetailTarget } from "./screens/detail";
import { ChangePasswordScreen, DisplayNameScreen } from "./screens/account";
import { DevicesScreen } from "./screens/devices";
import { NotifyScreen } from "./screens/notify";
import { StatsScreen } from "./screens/stats";
import { MeTab, type AccountScreen } from "./screens/me";
import { MfaScreen } from "./screens/mfa";
import { NoticesTab } from "./screens/notices";
import { QueueTab } from "./screens/queue";
import { ResetPasswordScreen } from "./screens/reset";
import { SearchTab } from "./screens/search";
import { TodoTab, type ItemRef } from "./screens/todo";
import { needsMfaSetup, useSession } from "./session";
import { useI18n, useTheme } from "./shared";

export function Shell({ onResetDone }: { onResetDone?: () => void } = {}) {
  const { t } = useI18n();
  const theme = useTheme();
  const { state, signOut } = useSession();
  // A reset link opened while signed in. Its form is drawn over the shell (nothing under it is lost on close);
  // while the recovery codes are on screen unconfirmed it waits, like every other thing that would move the officer away.
  const [resetLink, setResetLink] = useState<ResetLink | null>(null);
  const [tab, setTab] = useState<TabKey>("todo");
  const [detail, setDetail] = useState<DetailTarget | null>(null);
  // 我的's two sub-screens, drawn over the tabs like a detail (not a tab, so no tab-bar entry).
  const [account, setAccount] = useState<AccountScreen | null>(null);
  const [locked, setLocked] = useState(false);
  // Bumped whenever a list should ask again: after a detail closes, after a push (tapped or arrived), back in the foreground.
  const [version, setVersion] = useState(0);
  const [landed, setLanded] = useState<ItemRef | null>(null);
  const [highlight, setHighlight] = useState<ItemRef | null>(null);
  const [unread, setUnread] = useState(false);
  // 审判's segment, kept above the tab: opening a case unmounts the tab, and 「返回」 should land where it was.
  const [queueGroup, setQueueGroup] = useState<JudgmentQueueGroup>("mine");
  const assist = useOfficerAssist();
  // O-c: the tab a detail was opened from (a notice lands on 待办 / 审判 / 查询, but 「回到…」 means 通知), and the
  // rows whose detail turned out to be gone -- greyed in the lists until the app restarts.
  const [origin, setOrigin] = useState<TabKey>("todo");
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const markGone = useCallback((key: string) => setGone((prev) => (prev.has(key) ? prev : new Set(prev).add(key))), []);

  const land = useCallback((landing: Landing, from?: TabKey) => {
    setOrigin(from ?? (landing.judgment ? "queue" : landing.soul ? "search" : "todo"));
    if (landing.judgment || landing.soul) {
      setTab(landing.judgment ? "queue" : "search");
      setDetail(landing.judgment ? { type: "judgment", id: landing.judgment } : { type: "soul", id: landing.soul! });
      return;
    }
    setTab("todo");
    setVersion((v) => v + 1);
    if (landing.item) {
      setLanded(landing.item);
      setDetail({ type: "todo", ...landing.item });
    }
  }, []);

  useEffect(() => {
    // Idempotent on the server; does nothing without the system permission (asked in 我的, never here).
    void registerDevice();
    return listenForLandings(land);
  }, [land]);

  // The lists ask again when the app comes back to the foreground and when a push arrives while it is open:
  // the same bump a closed detail gives them (待办 / 审判 / 通知 remount on `version`).
  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    const stop = listenForArrivals(bump);
    let previous = AppState.currentState;
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active" && previous !== "active") bump();
      previous = next;
    });
    return () => {
      stop();
      sub.remove();
    };
  }, []);

  // 通知's ● is the server's unread count, not what the tab has loaded: asked at start and on every bump
  // (push, foreground, a detail closed, a notice marked read). A count that fails keeps the mark it had.
  const countUnread = useCallback(() => {
    notificationsApi
      .list({ is_read: "false" })
      .then((r) => setUnread((r.data.count ?? r.data.results.length) > 0))
      .catch(() => {});
  }, []);
  useEffect(() => countUnread(), [version, countUnread]);

  useEffect(
    // A link held while signed out (or before this mounted) arrives here first. Same landing as a push.
    () =>
      officerLinks.subscribe((link) => {
        setVersion((v) => v + 1);
        if (link.item) {
          setTab("todo");
          setOrigin("todo");
          setLanded(link.item);
          setDetail({ type: "todo", ...link.item });
        } else {
          setDetail(null);
          setTab(link.tab);
        }
      }),
    []
  );

  useEffect(
    () =>
      resetLinks.subscribe((link) => {
        if (!isRetiredResetLink(link)) setResetLink(link);
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
  // The password must be changed first: nothing but that screen (and signing out) until it is.
  if (user.password_change_required) {
    return (
      <View testID="shell" style={{ flex: 1, backgroundColor: theme.s0 }}>
        <IdentityBand hall={hallLabel(t, user.tenant) ?? t("officer_app.name")} name={user.display_name || user.username} />
        <ChangePasswordScreen required onBack={() => {}} />
      </View>
    );
  }
  // The role requires two-step verification and it is off: the server answers 403 `mfa_setup_required` to
  // everything else, so only the setup screen (and signing out from it) until it is on.
  if (user.mfa_setup_required) {
    return (
      <View testID="shell" style={{ flex: 1, backgroundColor: theme.s0 }}>
        <IdentityBand hall={hallLabel(t, user.tenant) ?? t("officer_app.name")} name={user.display_name || user.username} />
        <StandingBanner testID="mfa-setup-required">{t("profile.mfa_must_setup")}</StandingBanner>
        <MfaScreen onBack={() => {}} onLocked={setLocked} />
        <View style={{ padding: 16 }}>
          <ActionButton testID="mfa-hold-signout" kind="outline" title={t("officer_app.me.logout")} onPress={signOut} />
        </View>
      </View>
    );
  }

  // Only the tabs this officer's codes reach (kit.tsx `TAB_CODES`); a tab asked for that is not among them (the
  // starting 待办 of a 访客, a link, a landing) shows the first one there is -- 通知 and 我的 are always there.
  const tabs = visibleTabs(user.permissions);
  const current = tabs.includes(tab) ? tab : tabs[0];

  return (
    <View testID="shell" style={{ flex: 1, backgroundColor: theme.s0 }}>
      <IdentityBand hall={hallLabel(t, user.tenant) ?? t("officer_app.name")} name={user.display_name || user.username} />
      {needsMfaSetup(user) ? (
        <StandingBanner testID="mfa-banner" action={{ label: t("mfa.banner.action"), onPress: () => { setDetail(null); setTab("me"); setAccount("mfa"); } }}>
          {t("mfa.banner.text")}
        </StandingBanner>
      ) : null}
      <OfflineBanner />
      {account || detail ? null : (
        <TabHead
          tab={current}
          onAsk={() => {
            assist.setView("chat");
            assist.setOpen(true);
          }}
        />
      )}
      <View style={{ flex: 1 }}>
        {account === "mfa" ? (
          <MfaScreen onBack={() => setAccount(null)} onLocked={setLocked} />
        ) : account === "password" ? (
          <ChangePasswordScreen onBack={() => setAccount(null)} />
        ) : account === "name" ? (
          <DisplayNameScreen onBack={() => setAccount(null)} />
        ) : account === "devices" ? (
          <DevicesScreen onBack={() => setAccount(null)} />
        ) : account === "stats" ? (
          <StatsScreen onBack={() => setAccount(null)} onOpenQueue={() => { setAccount(null); setTab("queue"); }} />
        ) : account === "notify" ? (
          <NotifyScreen onBack={() => setAccount(null)} />
        ) : detail ? (
          <Detail
            target={detail}
            from={t(`officer_app.tabs.${origin}`)}
            onBack={close}
            onLeave={() => {
              close();
              setTab(origin);
            }}
            onSettled={() => setVersion((v) => v + 1)}
            onGone={markGone}
          />
        ) : current === "todo" ? (
          <TodoTab key={version} highlight={highlight} gone={gone} onOpen={(item) => { setOrigin("todo"); setDetail({ type: "todo", ...item }); }} />
        ) : current === "queue" ? (
          <QueueTab key={version} gone={gone} initialGroup={queueGroup} onGroup={setQueueGroup} onOpen={(id) => { setOrigin("queue"); setDetail({ type: "judgment", id }); }} />
        ) : current === "search" ? (
          <SearchTab
            onOpenSoul={(id) => { setOrigin("search"); setDetail({ type: "soul", id }); }}
            onOpenJudgment={(id) => { setOrigin("search"); setDetail({ type: "judgment", id }); }}
          />
        ) : current === "notices" ? (
          <NoticesTab key={version} gone={gone} onRead={countUnread} onLand={(landing) => land(landing, "notices")} />
        ) : (
          <MeTab onOpen={setAccount} />
        )}
      </View>
      <TabBar
        current={current}
        tabs={tabs}
        unread={unread}
        onSelect={(next) => {
          if (locked) return; // the recovery codes are on screen and not yet confirmed saved
          setDetail(null);
          setAccount(null);
          setTab(next);
        }}
      />
      <AssistSheet assist={assist} tab={current} />
      {resetLink && !locked ? (
        <View testID="reset-overlay" style={StyleSheet.absoluteFill}>
          <ResetPasswordScreen
            credential={resetLink}
            onClose={() => setResetLink(null)}
            onDone={() => {
              // The reset signed every device out, this one included, as of its next request; end it here and now.
              setResetLink(null);
              onResetDone?.();
              signOut();
            }}
          />
        </View>
      ) : null}
    </View>
  );
}
