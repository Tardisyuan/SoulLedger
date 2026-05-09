"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useTenant } from "@/src/contexts/TenantContext";

interface UserModalProps {
  open: boolean;
  onClose: () => void;
}

export function UserModal({ open, onClose }: UserModalProps) {
  const { user } = useTenant();

  // Close on Escape key
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Card */}
      <div
        className="relative z-10 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-80 p-6 text-center"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Avatar circle */}
        <div className="w-16 h-16 rounded-full bg-amber-500/20 border-2 border-amber-500 flex items-center justify-center mx-auto mb-4">
          <span className="text-2xl text-amber-500 font-bold">
            {user?.username?.charAt(0).toUpperCase()}
          </span>
        </div>

        {/* Username */}
        <h2 className="text-white text-xl font-semibold mb-1">
          {user?.username}
        </h2>

        {/* Email */}
        <p className="text-zinc-400 text-sm mb-4">{user?.email}</p>

        {/* Role badge */}
        <div className="inline-block px-3 py-1 rounded-full bg-amber-500/20 text-amber-500 text-xs font-medium mb-4">
          {user?.role}
        </div>

        {/* Tenant */}
        {user?.tenant && (
          <p className="text-zinc-500 text-xs mb-4">
            {user.tenant.display_name} · {user.tenant.code}
          </p>
        )}

        {/* Close button */}
        <button
          onClick={onClose}
          className="mt-2 w-full py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm transition-colors"
        >
          关闭
        </button>
      </div>
    </div>,
    document.body
  );
}
