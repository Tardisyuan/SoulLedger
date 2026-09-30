/**
 * 两件写在 <html> 上的事(规范 v2):
 *
 * 1. 主题**默认跟随系统**,用户手动选过才固定(ThemeContext;首帧那一半在 app/layout.tsx
 *    的 THEME_BOOTSTRAP)。v1 默认深色,不看系统。
 * 2. 文明皮 `data-civ`:TenantContext 按租户代码写 cn / eu / eg / gr,未登录或认不得的
 *    代码写 neutral;globals.css 据此只换匾色。
 */
import { act, render, screen } from "@testing-library/react";
import { ThemeProvider, useTheme } from "@/src/contexts/ThemeContext";
import { TenantProvider, civSkinOf, useTenant } from "@/src/contexts/TenantContext";
import { useEffect } from "react";

jest.mock("@soulledger/core/api", () => ({
  permApi: { myRolePermissions: () => Promise.resolve({ data: { permissions: [] } }) },
}));

type Listener = (_e: { matches: boolean }) => void;

/** A controllable `prefers-color-scheme: light` query. */
function mockSystem(light: boolean) {
  const listeners: Listener[] = [];
  const state = { light };
  window.matchMedia = ((query: string) => ({
    get matches() {
      return query.includes("light") ? state.light : !state.light;
    },
    media: query,
    addEventListener: (_: string, l: Listener) => listeners.push(l),
    removeEventListener: (_: string, l: Listener) => listeners.splice(listeners.indexOf(l), 1),
  })) as unknown as typeof window.matchMedia;
  return {
    flip(toLight: boolean) {
      state.light = toLight;
      act(() => listeners.forEach((l) => l({ matches: toLight })));
    },
  };
}

function Probe() {
  const { theme, setTheme } = useTheme();
  return (
    <button type="button" onClick={() => setTheme("dark")}>
      {theme}
    </button>
  );
}

describe("the theme follows the system until the user chooses (规范 v2)", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = "";
  });
  afterEach(() => {
    delete (window as { matchMedia?: unknown }).matchMedia;
  });

  it("with nothing saved, a light system gives the light theme — and follows it to dark", () => {
    const system = mockSystem(true);
    render(<ThemeProvider><Probe /></ThemeProvider>);
    expect(screen.getByRole("button")).toHaveTextContent("light");
    expect(document.documentElement.classList.contains("light")).toBe(true);

    system.flip(false);
    expect(screen.getByRole("button")).toHaveTextContent("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.classList.contains("light")).toBe(false);
  });

  it("a saved choice wins over the system", () => {
    mockSystem(true);
    localStorage.setItem("soulledger_theme", "dark");
    render(<ThemeProvider><Probe /></ThemeProvider>);
    expect(screen.getByRole("button")).toHaveTextContent("dark");
  });

  it("once the user picks, a later system change is ignored", () => {
    const system = mockSystem(true);
    render(<ThemeProvider><Probe /></ThemeProvider>);
    act(() => screen.getByRole("button").click());
    expect(screen.getByRole("button")).toHaveTextContent("dark");
    system.flip(true);
    expect(screen.getByRole("button")).toHaveTextContent("dark");
  });

  it("without matchMedia at all it falls back to dark, as the bootstrap script does", () => {
    render(<ThemeProvider><Probe /></ThemeProvider>);
    expect(screen.getByRole("button")).toHaveTextContent("dark");
  });
});

describe("the civilization skin is written to <html data-civ>", () => {
  it.each([
    ["CN_DIYU", "cn"],
    ["EU_HEAVEN_HELL", "eu"],
    ["EG_DUAT", "eg"],
    ["GR_HADES", "gr"],
    ["XX_UNKNOWN", "neutral"],
    [null, "neutral"],
  ])("civSkinOf(%s) = %s", (code, skin) => {
    expect(civSkinOf(code)).toBe(skin);
  });

  function SignIn({ code }: { code: string | null }) {
    const { setUser } = useTenant();
    useEffect(() => {
      setUser(
        code === null
          ? null
          : { id: 1, username: "u", display_name: "u", email: "", role: "JUDGE", tenant: { code, display_name: code }, permissions: [] }
      );
    }, [code, setUser]);
    return null;
  }

  it("follows the signed-in tenant, and goes back to neutral on sign-out", () => {
    const { rerender } = render(<TenantProvider><SignIn code="EG_DUAT" /></TenantProvider>);
    expect(document.documentElement.dataset.civ).toBe("eg");
    rerender(<TenantProvider><SignIn code={null} /></TenantProvider>);
    expect(document.documentElement.dataset.civ).toBe("neutral");
  });
});
