/**
 * The route guard IS the navigator's shape: each session status mounts a
 * different set of screens, so a screen that is not mounted cannot be reached
 * by any navigate() call, deep link or back gesture. In particular, while the
 * server says the password must change, the only screen that exists is the
 * change-password one.
 */
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { DarkTheme, DefaultTheme, NavigationContainer, type Theme } from "@react-navigation/native";
import { createNativeStackNavigator, type NativeStackScreenProps } from "@react-navigation/native-stack";
import { useColorScheme } from "react-native";

import { useI18n } from "./i18n";
import { useSession } from "./session";
import { paletteFor } from "./theme";
import { Failure, Loading, PaletteContext, Screen } from "./ui";
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

function MainTabs() {
  const { t } = useI18n();
  return (
    // Text-only tabs: no icon font is bundled, and the default icon renders as
    // a missing-glyph box on Android (seen on the emulator run).
    <Tabs.Navigator screenOptions={{ tabBarIconStyle: { display: "none" }, tabBarLabelStyle: { fontSize: 14 } }}>
      <Tabs.Screen name="Life" component={MyLifeScreen} options={{ title: t("soul_app.tabs.life") }} />
      <Tabs.Screen name="PastLives" component={PastLivesScreen} options={{ title: t("soul_app.tabs.past_lives") }} />
      <Tabs.Screen
        name="Applications"
        component={ApplicationsScreen}
        options={{ title: t("soul_app.tabs.applications") }}
      />
    </Tabs.Navigator>
  );
}

function Detail({ route }: NativeStackScreenProps<AppStackParams, "ApplicationDetail">) {
  return <ApplicationDetailScreen id={route.params.id} />;
}

export function RootNavigator() {
  const { t } = useI18n();
  const { state, retryBoot } = useSession();
  const scheme = useColorScheme() === "light" ? "light" : "dark";
  const palette = paletteFor(state.status === "signedIn" ? state.profile.civilization : null, scheme);
  const base = scheme === "light" ? DefaultTheme : DarkTheme;
  const navTheme: Theme = {
    ...base,
    colors: {
      ...base.colors,
      primary: palette.accent,
      background: palette.canvas,
      card: palette.surface1,
      text: palette.ink,
      border: palette.hairline,
    },
  };

  let screens;
  switch (state.status) {
    case "booting":
      return (
        <PaletteContext.Provider value={palette}>
          <Screen scroll={false}>
            <Loading />
          </Screen>
        </PaletteContext.Provider>
      );
    case "unreachable":
      return (
        <PaletteContext.Provider value={palette}>
          <Screen scroll={false}>
            <Failure error={state.error} onRetry={retryBoot} />
          </Screen>
        </PaletteContext.Provider>
      );
    case "signedOut":
      screens = <Stack.Screen name="Login" component={LoginScreen} options={{ title: t("soul_app.app_name") }} />;
      break;
    case "mustChangePassword":
      screens = (
        <Stack.Screen
          name="ChangePassword"
          component={ChangePasswordScreen}
          options={{ title: t("soul_app.change_password.title") }}
        />
      );
      break;
    case "signedIn":
      screens = (
        <>
          <Stack.Screen name="Tabs" component={MainTabs} options={{ headerShown: false }} />
          <Stack.Screen
            name="NewApplication"
            component={NewApplicationScreen}
            options={{ title: t("soul_app.applications.new") }}
          />
          <Stack.Screen name="ApplicationDetail" component={Detail} options={{ title: t("soul_app.detail.title") }} />
        </>
      );
      break;
  }

  return (
    <PaletteContext.Provider value={palette}>
      <NavigationContainer theme={navTheme}>
        <Stack.Navigator>{screens}</Stack.Navigator>
      </NavigationContainer>
    </PaletteContext.Provider>
  );
}
