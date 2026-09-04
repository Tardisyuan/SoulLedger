"use client";

import { createContext, useContext, type ReactNode } from "react";
import {
  showToast as _show,
  dismissToast as _dismiss,
  ToastContainer as _container,
  type ToastType,
} from "@/src/components/ui/Toast";

interface ToastContextValue {
  showToast: (msg: string, type?: ToastType, dur?: number) => string;
  dismissToast: (id: string) => void;
}

/**
 * ONE object, used as both the default and the provider's value.
 *
 * This is the odd one of the six contexts, and it gets a module constant rather
 * than the `useMemo` the other five got. Both members are module-level imports
 * from `ui/Toast`, so there is nothing for a memo to depend on — `useMemo(() =>
 * ({…}), [])` would allocate a memo cell per provider instance to express
 * "never changes", which a `const` already says, and says outside React.
 *
 * That is not a small distinction here, and the difference is measurable: with
 * the value hoisted, `useMemo` versus no `useMemo` is indistinguishable — the
 * mutation test that reddens the other five providers cannot redden this one,
 * because the memo was never the thing making it stable. The inline literal
 * was the defect; the `const` is the fix.
 *
 * Sharing it with the default is deliberate. `useToast()` now returns the same
 * object whether or not a `ToastProvider` is above it, which makes the thing
 * this file already was — a module singleton wearing a context's clothes —
 * true by construction instead of by two literals that happen to agree.
 */
const VALUE: ToastContextValue = { showToast: _show, dismissToast: _dismiss };

const ToastContext = createContext<ToastContextValue>(VALUE);

export function ToastProvider({ children }: { children: ReactNode }) {
  return (
    <ToastContext.Provider value={VALUE}>
      <_container />
      {children}
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
