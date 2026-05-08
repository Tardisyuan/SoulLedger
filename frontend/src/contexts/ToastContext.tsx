"use client";

import { createContext, useContext, type ReactNode } from "react";
import {
  showToast as _show,
  dismissToast as _dismiss,
  ToastContainer as _container,
  type ToastItem,
  type ToastType,
} from "@/src/components/ui/Toast";

interface ToastContextValue {
  showToast: (msg: string, type?: ToastType, dur?: number) => string;
  dismissToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue>({
  showToast: _show,
  dismissToast: _dismiss,
});

export function ToastProvider({ children }: { children: ReactNode }) {
  return (
    <ToastContext.Provider value={{ showToast: _show, dismissToast: _dismiss }}>
      <_container />
      {children}
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
