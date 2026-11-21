import { Component, Fragment, type ReactNode } from "react";
import { useColorScheme } from "react-native";

import { captureCrash } from "./crashReport";
import { themeFor } from "./theme";
import { Screen, ScreenError, ThemeContext } from "./ui";

function Fallback({ onRetry, onHome, reported }: { onRetry: () => void; onHome: () => void; reported: boolean }) {
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  return (
    <ThemeContext.Provider value={themeFor(null, scheme)}>
      <Screen testID="crash-screen" scroll={false} edges={["top", "left", "right", "bottom"]}>
        <ScreenError error={{ key: "soul_app.errors.unknown", params: { code: "render" } }} onRetry={onRetry} onHome={onHome} reported={reported} />
      </Screen>
    </ThemeContext.Provider>
  );
}

/**
 * Root error boundary: a render error shows the app's own error screen and is reported, instead of
 * a white screen. "Reported automatically" appears only after the report was really delivered
 * (see `captureCrash`); with no DSN, a failed send or a dropped event the line is simply absent.
 * Retry and Back to home both remount the whole tree under a new key, which is each app's
 * home tab (the navigators keep no state above this boundary). Must sit inside the i18n provider.
 */
export class RootErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean; reported: boolean; attempt: number }> {
  state = { failed: false, reported: false, attempt: 0 };
  private alive = true;

  static getDerivedStateFromError() {
    return { failed: true, reported: false };
  }

  componentDidCatch(error: unknown) {
    const attempt = this.state.attempt;
    void captureCrash(error).then((sent) => {
      if (sent && this.alive && this.state.failed && this.state.attempt === attempt) this.setState({ reported: true });
    });
  }

  componentWillUnmount() {
    this.alive = false;
  }

  private remount = () => this.setState((s) => ({ failed: false, reported: false, attempt: s.attempt + 1 }));

  render() {
    return this.state.failed ? (
      <Fallback onRetry={this.remount} onHome={this.remount} reported={this.state.reported} />
    ) : (
      <Fragment key={this.state.attempt}>{this.props.children}</Fragment>
    );
  }
}
