"use client";

import React, {
  createContext,
  useContext,
  useReducer,
  useCallback,
} from "react";

// ── Types ───────────────────────────────────────────

export type ToastType = "success" | "error" | "info";

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
  duration: number;
}

interface ToastState {
  toasts: Toast[];
}

type ToastAction =
  | { type: "ADD_TOAST"; payload: Toast }
  | { type: "REMOVE_TOAST"; payload: string };

// ── Reducer ─────────────────────────────────────────

let toastIdCounter = 0;
function generateId(): string {
  toastIdCounter += 1;
  return `toast-${Date.now()}-${toastIdCounter}`;
}

const DEFAULT_DURATION = 5000;

function toastReducer(state: ToastState, action: ToastAction): ToastState {
  switch (action.type) {
    case "ADD_TOAST":
      return { toasts: [...state.toasts, action.payload] };
    case "REMOVE_TOAST":
      return {
        toasts: state.toasts.filter((t) => t.id !== action.payload),
      };
    default:
      return state;
  }
}

// ── Context ─────────────────────────────────────────

interface ToastContextValue {
  toasts: Toast[];
  showToast: (
    message: string,
    type?: ToastType,
    duration?: number,
  ) => string;
  dismissToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

// ── Provider ────────────────────────────────────────

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(toastReducer, { toasts: [] });

  const dismissToast = useCallback((id: string) => {
    dispatch({ type: "REMOVE_TOAST", payload: id });
  }, []);

  const showToast = useCallback(
    (
      message: string,
      type: ToastType = "info",
      duration: number = DEFAULT_DURATION,
    ): string => {
      const id = generateId();
      dispatch({
        type: "ADD_TOAST",
        payload: { id, message, type, duration },
      });

      if (duration > 0) {
        setTimeout(() => {
          dispatch({ type: "REMOVE_TOAST", payload: id });
        }, duration);
      }

      return id;
    },
    [],
  );

  return (
    <ToastContext.Provider value={{ toasts: state.toasts, showToast, dismissToast }}>
      {children}
    </ToastContext.Provider>
  );
}

// ── Hook ────────────────────────────────────────────

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return ctx;
}
