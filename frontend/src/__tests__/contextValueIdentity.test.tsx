/**
 * Context value identity, measured in consumer renders rather than argued.
 *
 * WHAT WAS WRONG. All six providers in this app built their context value as an
 * inline object literal in the `return`:
 *
 *     <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>
 *
 * A fresh object on every render of the provider, so every consumer of that
 * context re-renders whenever the provider does, whether or not anything in the
 * value actually moved.
 *
 * WHY IT COST ALMOST NOTHING IN PRACTICE, said plainly so this file is not read
 * as a performance win it is not. Two things were holding it up, and neither is
 * stated anywhere in the code:
 *
 *   1. Every provider renders `{children}`, and `children` comes from
 *      `app/layout.tsx`, an async **server** component. Those elements arrive in
 *      the RSC payload and are referentially stable, so a provider re-rendering
 *      on its own state does not re-render the providers nested beneath it.
 *   2. There is almost nothing downstream that would have been saved anyway:
 *      three files in the whole app use `React.memo`.
 *
 * So the safety was positional, not stated. It holds only while the stack stays
 * under a server component and while none of these providers gains
 * frequently-changing state. Put a search query in `I18nProvider` and 104
 * `useI18n` consumers start re-rendering per keystroke, with nothing in the tree
 * to absorb it and no test that would go red.
 *
 * WHAT THIS FILE MEASURES. Each case mounts the **real** provider — the one
 * `app/layout.tsx` mounts, imported from its own module, not a local
 * reimplementation — under a parent that can be forced to re-render, with a
 * `children` element hoisted to module scope so it is referentially stable
 * exactly the way the RSC payload's is. A probe inside counts its own renders.
 *
 * Forcing the parent creates a new `<XProvider>` element (so the provider
 * re-renders) whose `children` prop is unchanged (so the subtree would bail out
 * on its own). The only thing that can still reach the probe is a changed
 * context value. That makes the render count a direct readout of value
 * identity — nothing here infers it from the source.
 *
 * PROVEN TO FAIL. Each of the six fixes was reverted, one at a time, and the
 * matching "survives a parent re-render" case went red with the probe at 4
 * renders instead of 1.
 *
 * The sixth reading is the interesting one, and it is why `ToastContext` is not
 * shaped like the other five. Neutering its `useMemo` (calling the factory on
 * every render, deps ignored) left this file **green**: the value there is a
 * module constant, so the memo was never what made it stable and wrapping it
 * was decoration. Restoring the actual inline literal is what reddens it. A
 * mutation that lands on disk is not the same as a mutation the test can see —
 * the first attempt at proving these six only proved five.
 *
 * AND THE OTHER DIRECTION. Every provider that has an input also has a case
 * asserting the value DOES change when that input moves. A `useMemo` with an
 * under-specified dependency list is not an optimisation, it is a consumer that
 * never hears about an update, and it would pass every test above.
 */

import React, { useState, type ReactElement, type ReactNode } from "react";
import { render, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { I18nProvider, useI18n } from "@/src/contexts/I18nContext";
import { TenantProvider, useTenant, type AuthUser } from "@/src/contexts/TenantContext";
import { ThemeProvider, useTheme } from "@/src/contexts/ThemeContext";
import { ToastProvider, useToast } from "@/src/contexts/ToastContext";
import { WebSocketProvider, useWebSocket } from "@/src/contexts/WebSocketContext";
import { SocialEventBusProvider, useSocialEventBus } from "@/hooks/useSocialEventBus";
import { usePermissions } from "@/src/hooks/usePermissions";

// One client for the whole file, created outside every render path: a fresh
// `new QueryClient()` per render would give `QueryClientProvider` a moving
// value of its own and the probe counts would measure that instead.
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

interface Probe<T> {
  /** Created once, at module-ish scope for the test — the stable-`children`
   *  half of the setup. Re-creating this per render would re-render the probe
   *  for reasons that have nothing to do with context. */
  element: ReactElement;
  renders: () => number;
  value: () => T;
}

function makeProbe<T>(useValue: () => T): Probe<T> {
  let count = 0;
  let last: T | undefined;
  const Consumer = () => {
    count += 1;
    last = useValue();
    return null;
  };
  return {
    element: <Consumer />,
    renders: () => count,
    value: () => last as T,
  };
}

/**
 * Mount `children` inside `wrap(...)` under a parent that can be re-rendered on
 * demand. `children` is passed in already built, so the provider sees the same
 * element reference on every one of those re-renders.
 */
function mountUnderForcibleParent(
  children: ReactElement,
  wrap: (_children: ReactNode) => ReactElement
) {
  let bump: () => void = () => {};
  function Harness() {
    const [, setN] = useState(0);
    bump = () => setN((n) => n + 1);
    return wrap(children);
  }
  const utils = render(<Harness />);
  return {
    ...utils,
    /** Re-render the parent three times. Once would do; three makes an
     *  off-by-one in the counting impossible to mistake for a pass. */
    forceParentRenders: () => {
      act(() => bump());
      act(() => bump());
      act(() => bump());
    },
  };
}

const ADMIN: AuthUser = {
  id: 7,
  username: "yama",
  display_name: "Yama",
  email: "yama@example.com",
  role: "ADMIN",
  tenant: { code: "CN_DIYU", display_name: "地府" },
  permissions: [],
};

afterEach(() => {
  localStorage.clear();
});

describe("context values survive a parent re-render", () => {
  it("ThemeProvider", () => {
    const probe = makeProbe(useTheme);
    const { forceParentRenders } = mountUnderForcibleParent(probe.element, (c) => (
      <ThemeProvider>{c}</ThemeProvider>
    ));
    const before = probe.renders();
    expect(before).toBeGreaterThan(0);
    forceParentRenders();
    expect(probe.renders()).toBe(before);
  });

  it("ToastProvider", () => {
    const probe = makeProbe(useToast);
    const { forceParentRenders } = mountUnderForcibleParent(probe.element, (c) => (
      <ToastProvider>{c}</ToastProvider>
    ));
    const before = probe.renders();
    const valueBefore = probe.value();
    forceParentRenders();
    expect(probe.renders()).toBe(before);
    // This one has no inputs at all, so the object should be not merely equal
    // but the same object for the life of the provider.
    expect(probe.value()).toBe(valueBefore);
  });

  it("ToastProvider hands out the same object with or without a provider", () => {
    // The context's default and the provider's value are one constant. Nothing
    // depends on that today, but it is the fact the file claims about itself,
    // and two literals that merely agree would pass every other case here.
    const inside = makeProbe(useToast);
    const outside = makeProbe(useToast);
    render(<ToastProvider>{inside.element}</ToastProvider>);
    render(<>{outside.element}</>);
    expect(inside.value()).toBe(outside.value());
  });

  it("TenantProvider", () => {
    const probe = makeProbe(useTenant);
    const { forceParentRenders } = mountUnderForcibleParent(probe.element, (c) => (
      <TenantProvider>{c}</TenantProvider>
    ));
    const before = probe.renders();
    forceParentRenders();
    expect(probe.renders()).toBe(before);
  });

  it("I18nProvider", () => {
    const probe = makeProbe(useI18n);
    const { forceParentRenders } = mountUnderForcibleParent(probe.element, (c) => (
      <I18nProvider initialLocale="zh-Hans">{c}</I18nProvider>
    ));
    const before = probe.renders();
    forceParentRenders();
    expect(probe.renders()).toBe(before);
  });

  it("WebSocketProvider", () => {
    const probe = makeProbe(useWebSocket);
    const { forceParentRenders } = mountUnderForcibleParent(probe.element, (c) => (
      <QueryClientProvider client={queryClient}>
        <TenantProvider>
          <WebSocketProvider>{c}</WebSocketProvider>
        </TenantProvider>
      </QueryClientProvider>
    ));
    const before = probe.renders();
    forceParentRenders();
    expect(probe.renders()).toBe(before);
  });

  it("SocialEventBusProvider", () => {
    const probe = makeProbe(useSocialEventBus);
    const { forceParentRenders } = mountUnderForcibleParent(probe.element, (c) => (
      <QueryClientProvider client={queryClient}>
        <TenantProvider>
          <SocialEventBusProvider>{c}</SocialEventBusProvider>
        </TenantProvider>
      </QueryClientProvider>
    ));
    const before = probe.renders();
    forceParentRenders();
    expect(probe.renders()).toBe(before);
  });
});

describe("...and still change when their inputs do", () => {
  it("ThemeProvider republishes on setTheme", () => {
    const probe = makeProbe(useTheme);
    mountUnderForcibleParent(probe.element, (c) => <ThemeProvider>{c}</ThemeProvider>);
    const before = probe.renders();
    expect(probe.value().theme).toBe("dark");
    act(() => probe.value().setTheme("light"));
    expect(probe.renders()).toBeGreaterThan(before);
    expect(probe.value().theme).toBe("light");
  });

  it("TenantProvider republishes on setUser, derived tenantCode included", () => {
    const probe = makeProbe(useTenant);
    mountUnderForcibleParent(probe.element, (c) => <TenantProvider>{c}</TenantProvider>);
    const before = probe.renders();
    expect(probe.value().user).toBeNull();
    expect(probe.value().tenantCode).toBeNull();
    act(() => probe.value().setUser(ADMIN));
    expect(probe.renders()).toBeGreaterThan(before);
    expect(probe.value().user?.username).toBe("yama");
    // `tenantCode` is the derived field left on this context now that
    // `isAdmin` moved to `usePermissions`; it is what proves the memo
    // republished rather than merely that `user` changed.
    expect(probe.value().tenantCode).toBe("CN_DIYU");
  });

  it("I18nProvider republishes on setLocale", async () => {
    const probe = makeProbe(useI18n);
    mountUnderForcibleParent(probe.element, (c) => (
      <I18nProvider initialLocale="zh-Hans">{c}</I18nProvider>
    ));
    const before = probe.renders();
    // `await act` rather than `act`: switching locale kicks off the lazy bundle
    // import, and `t` is rebuilt again when it lands.
    await act(async () => {
      probe.value().setLocale("en");
    });
    expect(probe.renders()).toBeGreaterThan(before);
    expect(probe.value().locale).toBe("en");
  });
});

describe("the role booleans are gone, and stay gone", () => {
  // Absence, asserted. `isJudge` / `isGuardian` / `isViewer` were set by the
  // provider and read by nothing in the tree, and `isAdmin` had exactly one
  // reader that was asking an authorization question. All four are now off
  // this context and "admin" is derived in one place, `usePermissions`.
  //
  // This is the check that stops the second derivation coming back: the
  // deletion is otherwise recorded only in a comment, and a re-added boolean
  // would go unremarked until it disagreed with `usePermissions` about
  // somebody's access.
  it("TenantContext exposes no role boolean at all", () => {
    const probe = makeProbe(useTenant);
    mountUnderForcibleParent(probe.element, (c) => <TenantProvider>{c}</TenantProvider>);
    const keys = Object.keys(probe.value() as object);
    expect(keys.filter((k) => /^is[A-Z]/.test(k))).toEqual([]);
    // Presence alongside absence: the probe really did read a live context.
    expect(keys).toEqual(expect.arrayContaining(["user", "tenantCode", "setUser", "logout"]));
  });

  it("usePermissions is the one place that answers it, and it tracks the user", () => {
    // Not just "the key exists" — the surviving derivation has to actually
    // follow `user.role`, or removing the context copy would have traded two
    // agreeing answers for one wrong one.
    const probe = makeProbe(() => {
      const { isAdmin } = usePermissions();
      const { setUser } = useTenant();
      return { isAdmin, setUser };
    });
    mountUnderForcibleParent(probe.element, (c) => <TenantProvider>{c}</TenantProvider>);
    expect(probe.value().isAdmin).toBe(false);
    act(() => probe.value().setUser(ADMIN));
    expect(probe.value().isAdmin).toBe(true);
    act(() => probe.value().setUser(null));
    expect(probe.value().isAdmin).toBe(false);
  });
});
