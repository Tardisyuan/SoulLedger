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
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import {
  DarkTheme,
  DefaultTheme,
  NavigationContainer,
  createNavigationContainerRef,
  type Theme as NavTheme,
} from "@react-navigation/native";
import { createNativeStackNavigator, type NativeStackScreenProps } from "@react-navigation/native-stack";
import { platform } from "@soulledger/core/platform";
import * as Notifications from "expo-notifications";
import { useEffect, useRef, useState } from "react";
import { useColorScheme } from "react-native";

import { ChatProvider, useChat } from "./chat";
import { AppHeader, TabBar } from "./chrome";
import { LogoutProvider, ToastProvider } from "./feedback";
import { useI18n } from "./i18n";
import { useSession } from "./session";
import { themeFor } from "./theme";
import { Block, Screen, ScreenError, Skeleton, ThemeContext } from "./ui";
import {
  ApplicationDetailScreen,
  ApplicationsScreen,
  NewApplicationScreen,
  type AppStackParams,
} from "./screens/applications";
import { ChangePasswordScreen, LoginScreen } from "./screens/auth";
import { NotificationPrimerScreen, SettingsScreen } from "./screens/settings";
import { PRIMER_SEEN_KEY, easProjectId, landingOf, permission, registerDevice, syncPushLocale, type Landing } from "./push";
import { MyLifeScreen, PastLivesScreen } from "./screens/life";
import { ConversationScreen } from "./screens/conversation";
import { ANDROID, FindSoulScreen, LettersScreen } from "./screens/letters";

type RootParams = AppStackParams & { Login: undefined; ChangePassword: undefined };
const Stack = createNativeStackNavigator<RootParams>();
const Tabs = createBottomTabNavigator();

/** Lets a test read which routes are mounted — the guard is the set of route names, not what is on screen. */
export const navigationRef = createNavigationContainerRef<RootParams>();

function MainTabs() {
  const { t } = useI18n();
  const chat = useChat();
  const unread = Object.values(chat.timeline.rooms).some((room) => room.unread > 0);
  return (
    <Tabs.Navigator
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={({ route, navigation }) => ({
        header: () =>
          route.name === "Letters" ? (
            // Chat handoff 1e: iOS "new" is a framed plus in the bar; Android has the FAB, and search here.
            <AppHeader
              title={t(TAB_TITLES[route.name])}
              action={{
                icon: ANDROID ? "search" : "plus",
                framed: !ANDROID,
                label: t("soul_app.chat.new"),
                testID: "chat-new",
                onPress: () => navigation.navigate("FindSoul"),
              }}
            />
          ) : (
            <AppHeader title={t(TAB_TITLES[route.name])} onAccount={() => navigation.navigate("Settings")} />
          ),
      })}
    >
      <Tabs.Screen name="Life" component={MyLifeScreen} options={{ title: t("soul_app.tabs.life") }} />
      <Tabs.Screen name="PastLives" component={PastLivesScreen} options={{ title: t("soul_app.tabs.past_lives") }} />
      {/* The tab is a signpost, the screen title the full name (chat handoff 1a): four two-character labels fit 98pt. */}
      <Tabs.Screen name="Applications" component={ApplicationsScreen} options={{ title: t("soul_app.tabs.rebirth") }} />
      {/* Not deployed here: no tab at all, rather than one that opens onto "not available" (1b). */}
      {chat.availability === "not_configured" ? null : (
        <Tabs.Screen
          name="Letters"
          component={LettersScreen}
          options={{ title: t("soul_app.chat.tab"), tabBarBadge: unread ? t("soul_app.chat.unread") : undefined }}
        />
      )}
    </Tabs.Navigator>
  );
}

/** Each tab's screen title — the full name, even where the tab label is shortened. */
const TAB_TITLES: Record<string, string> = {
  Life: "soul_app.tabs.life",
  PastLives: "soul_app.tabs.past_lives",
  Applications: "soul_app.tabs.applications",
  Letters: "soul_app.chat.title",
};

function Detail({ route }: NativeStackScreenProps<AppStackParams, "ApplicationDetail">) {
  return <ApplicationDetailScreen id={route.params.id} landed={route.params.landed} />;
}

function Conversation({ route }: NativeStackScreenProps<AppStackParams, "Conversation">) {
  return <ConversationScreen id={route.params.id} landed={route.params.landed} />;
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
    if (!landing || !signedIn || !navigationRef.isReady()) return;
    pending.current = null;
    if (landing.screen === "ApplicationDetail") navigationRef.navigate("ApplicationDetail", { id: landing.id, landed: true });
    else if (landing.screen === "Conversation") navigationRef.navigate("Conversation", { id: landing.id, landed: true });
    else navigationRef.navigate("Tabs", { screen: "Life" });
  }, [arrived, signedIn, ready]);

  return null;
}

export function RootNavigator() {
  const { t } = useI18n();
  const { state, retryBoot, signOut } = useSession();
  const [ready, setReady] = useState(0);
  const scheme = useColorScheme() === "light" ? "light" : "dark";
  const theme = themeFor(state.status === "signedIn" ? state.profile.civilization : null, scheme);
  const base = scheme === "light" ? DefaultTheme : DarkTheme;
  const navTheme: NavTheme = {
    ...base,
    colors: { ...base.colors, primary: theme.accent, background: theme.s0, card: theme.s0, text: theme.ink, border: theme.hair },
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
        screens = <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />;
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
                header: () => <AppHeader title={t("soul_app.settings.title")} onBack={navigation.goBack} />,
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
        <ChatProvider enabled={state.status === "signedIn"}>
          <NavigationContainer ref={navigationRef} theme={navTheme} onReady={() => setReady((n) => n + 1)}>
            <Stack.Navigator>{screens}</Stack.Navigator>
          </NavigationContainer>
          <PushBridge signedIn={state.status === "signedIn"} ready={ready} />
        </ChatProvider>
      );
    }
  }

  return (
    <ThemeContext.Provider value={theme}>
      <ToastProvider>
        <LogoutProvider onConfirm={signOut}>{body}</LogoutProvider>
      </ToastProvider>
    </ThemeContext.Provider>
  );
}
