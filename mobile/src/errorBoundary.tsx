import { Component, type ReactNode } from "react";
import { useColorScheme } from "react-native";

import { captureCrash } from "./crashReport";
import { themeFor } from "./theme";
import { Screen, ScreenError, ThemeContext } from "./ui";

function Fallback({ onRetry }: { onRetry: () => void }) {
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  return (
    <ThemeContext.Provider value={themeFor(null, scheme)}>
      <Screen testID="crash-screen" scroll={false} edges={["top", "left", "right", "bottom"]}>
        <ScreenError error={{ key: "soul_app.errors.unknown", params: { code: "render" } }} onRetry={onRetry} />
      </Screen>
    </ThemeContext.Provider>
  );
}

/**
 * Root error boundary: a render error shows the app's own error screen (retry remounts the tree)
 * and is reported, instead of a white screen. Must sit inside the i18n provider.
 */
export class RootErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    captureCrash(error);
  }

  render() {
    return this.state.failed ? <Fallback onRetry={() => this.setState({ failed: false })} /> : this.props.children;
  }
}
