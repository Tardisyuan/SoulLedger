/**
 * The route guard IS the navigator's shape: each session status mounts a
 * different set of screens, so a screen that is not mounted cannot be reached
 * by any navigate() call, deep link or back gesture. In particular, while the
 * server says the password must change, the only screen that exists is the
 * change-password one.
 *
 * The theme is decided here too: neutral until a soul is signed in, then that
 * soul's civilization; light or dark follows the system.
 */
import { createBottomTabNavigator, type BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import {
  DarkTheme,
  DefaultTheme,
  NavigationContainer,
  type ParamListBase,
  createNavigationContainerRef,
  type Theme as NavTheme,
} from "@react-navigation/native";
import { createNativeStackNavigator, type NativeStackScreenProps } from "@react-navigation/native-stack";
import { platform } from "@soulledger/core/platform";
import * as Notifications from "expo-notifications";
import type { MeProfile } from "@soulledger/core/api/soul";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useColorScheme } from "react-native";

import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";

import { AssistProvider, useAssist } from "./assist";
import { AssistPanel } from "./assistPanel";
import { ChatProvider, useChat } from "./chat";
import { ColdStart } from "./coldStart";
import { AppHeader, PlaqueHeader, TabBar } from "./chrome";
import { LogoutProvider, ToastProvider } from "./feedback";
import { useI18n } from "./i18n";
import { soulLinks } from "./links";
import { NetworkProvider } from "./network";
import { useSession } from "./session";
import { preLoginTheme, themeFor } from "./theme";
import { Block, Screen, ScreenError, Skeleton, ThemeContext, useReducedMotionDurations } from "./ui";
import { Welcome } from "./welcome";
import {
  ApplicationDetailScreen,
  ApplicationsScreen,
  NewApplicationScreen,
  type AppStackParams,
} from "./screens/applications";
import { ChangePasswordScreen, LoginScreen, type LoginParams } from "./screens/auth";
import { ForgotPasswordScreen } from "./screens/forgotPassword";
import { AboutScreen } from "./screens/about";
import { NotificationPrimerScreen, SettingsScreen } from "./screens/settings";
import { PRIMER_SEEN_KEY, easProjectId, landOn, landingOf, permission, registerDevice, syncPushLocale, type Landing } from "./push";
import { NotificationHistoryScreen } from "./screens/notificationHistory";
import { MyLifeScreen } from "./screens/life";
import { SentenceScreen } from "./screens/sentence";
import { CircleScreen, ComposePostScreen, PostScreen } from "./screens/circle";
import { CircleSearchScreen, FollowListScreen, MyCircleScreen, ReportScreen, SoulProfileScreen } from "./screens/circlePeople";
import { ConversationScreen } from "./screens/conversation";
import { ANDROID, FindSoulScreen, LettersScreen } from "./screens/letters";

type RootParams = AppStackParams & { Login: LoginParams; ForgotPassword: undefined; ChangePassword: undefined };
const Stack = createNativeStackNavigator<RootParams>();
const Tabs = createBottomTabNavigator();

/** Lets a test read which routes are mounted — the guard is the set of route names, not what is on screen. */
export const navigationRef = createNavigationContainerRef<RootParams>();

/**
 * The rebirth tab. `landed` (set by `landOn` for a tapped cooldown-decision push) washes the
 * shortening block once; the param is cleared after the fade so coming back later does not repeat it.
 */
function ApplicationsTab({ route, navigation }: BottomTabScreenProps<ParamListBase, "Applications">) {
  const landed = (route.params as { landed?: boolean } | undefined)?.landed;
  useEffect(() => {
    if (!landed) return;
    const timer = setTimeout(() => navigation.setParams({ landed: undefined }), 1500);
    return () => clearTimeout(timer);
  }, [landed, navigation]);
  return <ApplicationsScreen landed={landed} />;
}

function MainTabs() {
  const { t } = useI18n();
  const chat = useChat();
  // v3 MotionSpec 底部标签: the content cross-fades over 180ms, the bar does not move; reduce motion swaps at once
  // — by a 0ms fade, never by `animation: "none"`. The OS answers reduce motion after this first renders, and
  // flipping "fade" → "none" turns the tabs' screen container (react-native-screens, iOS) into a different
  // native component, remounting every tab: the life tab's three requests went out twice.
  const { tabFade } = useReducedMotionDurations();
  const unread = Object.values(chat.timeline.rooms).some((room) => room.unread > 0);
  return (
    <Tabs.Navigator
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={({ route, navigation }) => ({
        animation: "fade",
        transitionSpec: { animation: "timing", config: { duration: tabFade } },
        // v2 补足 B11 / C15: every tab's root wears the full plaque; its actions sit where the account icon was.
        header: () =>
          route.name === "Letters" ? (
            // Chat handoff 1e: iOS "new" is a framed plus in the bar; Android has the FAB, and search here.
            <PlaqueHeader
              title={t(TAB_TITLES[route.name])}
              assist="letters"
              action={{
                icon: ANDROID ? "search" : "plus",
                framed: !ANDROID,
                label: t("soul_app.chat.new"),
                testID: "chat-new",
                onPress: () => navigation.navigate("FindSoul"),
              }}
            />
          ) : route.name === "Circle" ? (
            // 1a: find people and my page; settings stay on the life tab.
            <PlaqueHeader
              title={t(TAB_TITLES[route.name])}
              assist="circle"
              action={[
                { icon: "search", label: t("soul_app.circle.search.title"), testID: "circle-search-open", onPress: () => navigation.navigate("CircleSearch") },
                { icon: "person", label: t("soul_app.circle.me.title"), testID: "circle-me", onPress: () => navigation.navigate("MyCircle") },
              ]}
            />
          ) : (
            <PlaqueHeader
              title={t(TAB_TITLES[route.name])}
              assist={route.name === "Applications" ? "applications" : "life"}
              onAccount={() => navigation.navigate("Settings")}
            />
          ),
      })}
    >
      {/* Four tabs (朋友圈 handoff 1a): 本世 / 转生 / 书信 / 朋友圈. 前世 is the life tab's last section now. */}
      {/* v3: the life tab draws its own identity band (it compacts as the page scrolls), so no navigator header. */}
      <Tabs.Screen name="Life" component={MyLifeScreen} options={{ title: t("soul_app.tabs.life"), headerShown: false }} />
      {/* The tab is a signpost, the screen title the full name (chat handoff 1a): four two-character labels fit 98pt. */}
      <Tabs.Screen name="Applications" component={ApplicationsTab} options={{ title: t("soul_app.tabs.rebirth") }} />
      {/* Not deployed here: no tab at all, rather than one that opens onto "not available" (1b). */}
      {chat.availability === "not_configured" ? null : (
        <Tabs.Screen
          name="Letters"
          component={LettersScreen}
          options={{ title: t("soul_app.chat.tab"), tabBarBadge: unread ? t("soul_app.chat.unread") : undefined }}
        />
      )}
      <Tabs.Screen name="Circle" component={CircleScreen} options={{ title: t("soul_app.circle.tab") }} />
    </Tabs.Navigator>
  );
}

/** Each tab's screen title — the full name, even where the tab label is shortened. */
const TAB_TITLES: Record<string, string> = {
  Life: "soul_app.tabs.life",
  Applications: "soul_app.tabs.applications",
  Letters: "soul_app.chat.title",
  Circle: "soul_app.circle.tab",
};

/** Success goes back to sign-in carrying a notice — never into a session. */
function ForgotPassword({ navigation }: NativeStackScreenProps<RootParams, "ForgotPassword">) {
  return (
    <ForgotPasswordScreen onDone={() => navigation.popTo("Login", { passwordReset: true })} onCancel={() => navigation.popTo("Login")} />
  );
}

function Detail({ route }: NativeStackScreenProps<AppStackParams, "ApplicationDetail">) {
  return <ApplicationDetailScreen id={route.params.id} landed={route.params.landed} />;
}

function Conversation({ route }: NativeStackScreenProps<AppStackParams, "Conversation">) {
  return <ConversationScreen id={route.params.id} landed={route.params.landed} />;
}

function Sentence({ route }: NativeStackScreenProps<AppStackParams, "Sentence">) {
  return <SentenceScreen landing={route.params?.landing} />;
}

function CirclePost({ route }: NativeStackScreenProps<AppStackParams, "CirclePost">) {
  return <PostScreen id={route.params.id} />;
}

function SoulProfile({ route }: NativeStackScreenProps<AppStackParams, "SoulProfile">) {
  return <SoulProfileScreen userId={route.params.userId} />;
}

function CircleFollows({ route }: NativeStackScreenProps<AppStackParams, "CircleFollows">) {
  return <FollowListScreen relation={route.params.relation} />;
}

function CircleReport({ route }: NativeStackScreenProps<AppStackParams, "CircleReport">) {
  return <ReportScreen target={route.params.target} id={route.params.id} preview={route.params.preview} />;
}

/** 「问一问」 above the navigator, so a drawer closed mid-answer still gets its answer. */
function AssistRoot({ profile, signedIn, ready, children }: { profile: MeProfile | null; signedIn: boolean; ready: number; children: ReactNode }) {
  const chat = useChat();
  const openLetters = useCallback(() => navigationRef.navigate("Tabs", { screen: "Letters" }), []);
  return (
    <AssistProvider profile={profile} onOpenLetters={chat.availability === "not_configured" ? null : openLetters}>
      {children}
      <LinkBridge signedIn={signedIn} ready={ready} />
      <AssistPanel />
    </AssistProvider>
  );
}

/** Notification ids already landed in this process. */
const HANDLED_TAPS = new Set<string>();

/**
 * The push glue that needs the navigator: taps (while running, and the one that
 * cold-started the app) become a landing, held until a soul is signed in and
 * the navigator is ready — so a tap that meets the login screen still lands
 * after sign-in. Signed in: register the device (cold start and sign-in alike),
 * follow token changes, keep the push language, and offer the primer once.
 */
function PushBridge({ signedIn, ready }: { signedIn: boolean; ready: number }) {
  const pending = useRef<Landing | null>(null);
  const [arrived, setArrived] = useState(0);

  useEffect(() => {
    let alive = true;
    const hold = (r: Notifications.NotificationResponse) => {
      // The "last response" outlives this component (a retryBoot remounts it): a tap
      // is landed once, never again — or it lands a later session on an old record.
      const id = r.notification.request.identifier;
      if (HANDLED_TAPS.has(id)) return;
      HANDLED_TAPS.add(id);
      pending.current = landingOf(r.notification.request.content.data);
      setArrived((n) => n + 1);
    };
    Notifications.getLastNotificationResponseAsync()
      .then((r) => {
        if (!r) return;
        Notifications.clearLastNotificationResponse();
        if (alive) hold(r);
      })
      .catch(() => {});
    const sub = Notifications.addNotificationResponseReceivedListener(hold);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);

  useEffect(() => {
    if (!signedIn) return;
    let alive = true;
    void syncPushLocale();
    void registerDevice().then(async () => {
      const offer =
        alive &&
        !pending.current &&
        easProjectId() !== null &&
        !platform().persistent.get(PRIMER_SEEN_KEY) &&
        (await permission()) === "undetermined";
      if (offer && navigationRef.isReady()) navigationRef.navigate("NotificationPrimer");
    });
    const sub = Notifications.addPushTokenListener(() => void registerDevice());
    return () => {
      alive = false;
      sub.remove();
    };
  }, [signedIn]);

  useEffect(() => {
    const landing = pending.current;
    if (!landing || !signedIn || !ready || !navigationRef.isReady()) return;
    pending.current = null;
    landOn(navigationRef.navigate, landing);
  }, [arrived, signedIn, ready]);

  return null;
}

/**
 * 语音与桌面快捷方式的链接(soulledger://life 等):只打开页面。未登录时链接留在收件箱,
 * 登录且导航器就绪后才落地 —— 与 PushBridge 同一条规矩。信箱不可用时「书信」落到本世。
 */
function LinkBridge({ signedIn, ready }: { signedIn: boolean; ready: number }) {
  const assist = useAssist();
  const chat = useChat();
  const open = assist?.open;
  const setDraft = assist?.setDraft;
  const lettersOff = chat.availability === "not_configured";
  useEffect(() => {
    // `ready` counts this mount's onReady. isReady() alone is not enough: when a launcher shortcut makes
    // Android recreate the activity, the root remounts and the module-level ref still reports the old
    // container until the new one is up -- navigate() then throws "navigation object hasn't been initialized".
    if (!signedIn || !ready || !navigationRef.isReady()) return;
    return soulLinks.subscribe((link) => {
      if (link.page === "assist" || link.page === "ask") {
        landOn(navigationRef.navigate, { screen: "Life" });
        open?.("life");
        // 问一问 with the question typed in, not sent: the soul reads it and presses send.
        if (link.question) setDraft?.(link.question);
      } else if (link.page === "letters" && !lettersOff) navigationRef.navigate("Tabs", { screen: "Letters" });
      else landOn(navigationRef.navigate, { screen: link.page === "cooldown" ? "Applications" : "Life" });
    });
  }, [signedIn, ready, open, setDraft, lettersOff]);
  return null;
}

export function RootNavigator() {
  const { t } = useI18n();
  const { state, retryBoot, signOut } = useSession();
  const [ready, setReady] = useState(0);
  const scheme = useColorScheme() === "light" ? "light" : "dark";
  const theme = state.status === "signedIn" ? themeFor(state.profile.civilization, scheme) : preLoginTheme(scheme);
  const base = scheme === "light" ? DefaultTheme : DarkTheme;
  const navTheme: NavTheme = {
    ...base,
    colors: { ...base.colors, primary: theme.ink, background: theme.s0, card: theme.s0, text: theme.ink, border: theme.hair },
  };

  let body;
  switch (state.status) {
    case "booting":
      body = (
        <Screen scroll={false} edges={["top", "left", "right", "bottom"]}>
          <Block last>
            <Skeleton lines={5} testID="booting" />
          </Block>
        </Screen>
      );
      break;
    case "unreachable":
      body = (
        <Screen scroll={false} edges={["top", "left", "right", "bottom"]}>
          <ScreenError error={state.error} onRetry={retryBoot} />
        </Screen>
      );
      break;
    default: {
      let screens;
      if (state.status === "signedOut") {
        screens = (
          <>
            <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
            <Stack.Screen
              name="ForgotPassword"
              component={ForgotPassword}
              options={({ navigation }) => ({
                header: () => <AppHeader title={t("soul_app.app_name")} onBack={navigation.goBack} serif />,
              })}
            />
          </>
        );
      } else if (state.status === "mustChangePassword") {
        screens = (
          <Stack.Screen
            name="ChangePassword"
            component={ChangePasswordScreen}
            options={{ header: () => <AppHeader title={t("soul_app.change_password.title")} /> }}
          />
        );
      } else {
        screens = (
          <>
            <Stack.Screen name="Tabs" component={MainTabs} options={{ headerShown: false }} />
            <Stack.Screen
              name="NewApplication"
              component={NewApplicationScreen}
              options={({ navigation }) => ({
                header: () => <AppHeader title={t("soul_app.applications.new")} onBack={navigation.goBack} />,
              })}
            />
            <Stack.Screen
              name="Settings"
              component={SettingsScreen}
              options={({ navigation }) => ({
                header: () => <AppHeader title={t("soul_app.settings.title")} onBack={navigation.goBack} assist="settings" />,
              })}
            />
            <Stack.Screen
              name="AccountPassword"
              component={ChangePasswordScreen}
              options={({ navigation }) => ({
                header: () => <AppHeader title={t("profile.change_password")} onBack={navigation.goBack} />,
              })}
            />
            <Stack.Screen
              name="About"
              component={AboutScreen}
              options={({ navigation }) => ({
                header: () => <AppHeader title={t("about.title")} onBack={navigation.goBack} />,
              })}
            />
            <Stack.Screen
              name="NotificationHistory"
              component={NotificationHistoryScreen}
              options={({ navigation }) => ({
                header: () => <AppHeader title={t("soul_app.history.title")} onBack={navigation.goBack} />,
              })}
            />
            <Stack.Screen name="NotificationPrimer" component={NotificationPrimerScreen} options={{ headerShown: false }} />
            <Stack.Screen name="Conversation" component={Conversation} options={{ headerShown: false }} />
            <Stack.Screen
              name="FindSoul"
              component={FindSoulScreen}
              options={({ navigation }) => ({
                header: () => <AppHeader title={t("soul_app.chat.find.title")} onBack={navigation.goBack} />,
              })}
            />
            <Stack.Screen
              name="ComposePost"
              component={ComposePostScreen}
              options={({ navigation }) => ({
                header: () => <AppHeader title={t("soul_app.circle.compose.title")} onBack={navigation.goBack} />,
              })}
            />
            <Stack.Screen
              name="CirclePost"
              component={CirclePost}
              options={({ navigation }) => ({
                header: () => <AppHeader title={t("soul_app.circle.post.title")} onBack={navigation.goBack} />,
              })}
            />
            {/* These draw their own title bar: a name, a count, or the "⋯" that depends on what loaded. */}
            <Stack.Screen name="SoulProfile" component={SoulProfile} options={{ headerShown: false }} />
            <Stack.Screen name="CircleFollows" component={CircleFollows} options={{ headerShown: false }} />
            <Stack.Screen name="CircleReport" component={CircleReport} options={{ headerShown: false }} />
            <Stack.Screen
              name="MyCircle"
              component={MyCircleScreen}
              options={({ navigation }) => ({
                header: () => <AppHeader title={t("soul_app.circle.me.title")} onBack={navigation.goBack} />,
              })}
            />
            <Stack.Screen
              name="CircleSearch"
              component={CircleSearchScreen}
              options={({ navigation }) => ({
                header: () => <AppHeader title={t("soul_app.circle.search.title")} onBack={navigation.goBack} />,
              })}
            />
            <Stack.Screen
              name="Sentence"
              component={Sentence}
              options={({ navigation }) => ({
                header: () => <AppHeader title={t("soul_app.sentence.section_title")} onBack={navigation.goBack} assist="sentence" />,
              })}
            />
            <Stack.Screen
              name="ApplicationDetail"
              component={Detail}
              options={({ navigation }) => ({
                header: () => <AppHeader title={t("soul_app.detail.title")} onBack={navigation.goBack} />,
              })}
            />
          </>
        );
      }
      body = (
        <ChatProvider account={state.status === "signedIn" ? state.profile.soul_code : null}>
          <AssistRoot profile={state.status === "signedIn" ? state.profile : null} signedIn={state.status === "signedIn"} ready={ready}>
            <NavigationContainer ref={navigationRef} theme={navTheme} onReady={() => setReady((n) => n + 1)}>
              <Stack.Navigator>{screens}</Stack.Navigator>
            </NavigationContainer>
          </AssistRoot>
          <PushBridge signedIn={state.status === "signedIn"} ready={ready} />
          {/* 文明气质 1b: over everything, the first time this soul enters its current civilization. */}
          {state.status === "signedIn" ? <Welcome profile={state.profile} scheme={scheme} /> : null}
        </ChatProvider>
      );
    }
  }

  return (
    <ThemeContext.Provider value={theme}>
      <ToastProvider>
        {/* Inside the theme: a sheet renders in this provider's host, so it sees only the contexts above it. */}
        <BottomSheetModalProvider>
          <LogoutProvider onConfirm={signOut}>
            {/* Offline: a bar above every screen, pushing it down; gone when the network is back. */}
            <NetworkProvider>{body}</NetworkProvider>
          </LogoutProvider>
        </BottomSheetModalProvider>
        {/* 补足 C18: over everything, once per process. */}
        <ColdStart session={state} />
      </ToastProvider>
    </ThemeContext.Provider>
  );
}
