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
import { useColorScheme } from "react-native";

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
import { MyLifeScreen, PastLivesScreen } from "./screens/life";

const Stack = createNativeStackNavigator<AppStackParams & { Login: undefined; ChangePassword: undefined }>();
const Tabs = createBottomTabNavigator();

/** Lets a test read which routes are mounted — the guard is the set of route names, not what is on screen. */
export const navigationRef = createNavigationContainerRef();

function MainTabs() {
  const { t } = useI18n();
  return (
    <Tabs.Navigator
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={({ route }) => ({
        header: () => <AppHeader title={t(TAB_TITLES[route.name])} account />,
      })}
    >
      <Tabs.Screen name="Life" component={MyLifeScreen} options={{ title: t("soul_app.tabs.life") }} />
      <Tabs.Screen name="PastLives" component={PastLivesScreen} options={{ title: t("soul_app.tabs.past_lives") }} />
      <Tabs.Screen name="Applications" component={ApplicationsScreen} options={{ title: t("soul_app.tabs.applications") }} />
    </Tabs.Navigator>
  );
}

const TAB_TITLES: Record<string, string> = {
  Life: "soul_app.tabs.life",
  PastLives: "soul_app.tabs.past_lives",
  Applications: "soul_app.tabs.applications",
};

function Detail({ route }: NativeStackScreenProps<AppStackParams, "ApplicationDetail">) {
  return <ApplicationDetailScreen id={route.params.id} />;
}

export function RootNavigator() {
  const { t } = useI18n();
  const { state, retryBoot, signOut } = useSession();
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
        <NavigationContainer ref={navigationRef} theme={navTheme}>
          <Stack.Navigator>{screens}</Stack.Navigator>
        </NavigationContainer>
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
