"use client";

import { useState, useEffect } from "react";
import { BaseModal } from "@/src/components/ui/Modal";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { useUpdateSoul } from "@/src/hooks/useSouls";
import type { Soul } from "@/lib/api";

interface SoulEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  soul: Soul;
  onUpdated: () => void;
}

const STATE_OPTIONS = [
  { value: "ALIVE", label: "存活" },
  { value: "JUDGING", label: "审判中" },
  { value: "DISPOSED", label: "已处置" },
  { value: "REINCARNATING", label: "轮回中" },
  { value: "LOST", label: "失踪" },
];

export function SoulEditModal({ isOpen, onClose, soul, onUpdated }: SoulEditModalProps) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const updateMutation = useUpdateSoul();

  const [name, setName] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [originLocation, setOriginLocation] = useState("");
  const [currentState, setCurrentState] = useState<Soul["current_state"]>("ALIVE");

  // Populate form when soul changes or modal opens
  useEffect(() => {
    if (isOpen && soul) {
      setName(soul.name || "");
      setBirthDate(soul.birth_date ? soul.birth_date.split("T")[0] : "");
      setOriginLocation(soul.origin_location || "");
      setCurrentState(soul.current_state || "ALIVE");
    }
  }, [isOpen, soul]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      showToast("名称不能为空", "error");
      return;
    }
    updateMutation.mutate(
      {
        id: soul.id,
        data: {
          name: name.trim(),
          birth_date: birthDate || null,
          origin_location: originLocation,
          current_state: currentState,
        },
      },
      {
        onSuccess: () => {
          showToast("更新成功", "success");
          onUpdated();
          onClose();
        },
        onError: () => {
          showToast("更新失败", "error");
        },
      }
    );
  }

  const footer = (
    <div className="flex gap-3">
      <button
        type="button"
        onClick={onClose}
        disabled={updateMutation.isPending}
        className="flex-1 px-4 py-2 bg-surface-1 border border-hairline text-ink-muted hover:bg-surface-2 disabled:opacity-50 rounded text-sm transition-colors"
      >
        取消
      </button>
      <button
        type="submit"
        form="soul-edit-form"
        disabled={updateMutation.isPending || !name.trim()}
        className="flex-1 px-4 py-2 bg-amber-500 hover:bg-amber-400 disabled:bg-surface-3 disabled:text-ink-subtle rounded text-sm font-medium text-black transition-colors"
      >
        {updateMutation.isPending ? (
          <span className="flex items-center justify-center gap-2">
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            更新中...
          </span>
        ) : "保存"}
      </button>
    </div>
  );

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title="编辑灵魂"
      footer={footer}
    >
      <form id="soul-edit-form" onSubmit={handleSubmit} className="space-y-4">
        {/* Name */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-ink-subtle">名称</label>
          <input
            type="text"
            required
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={updateMutation.isPending}
            className="bg-surface-1 border border-hairline rounded px-3 py-2 text-sm text-ink placeholder-ink-subtle focus:outline-none focus:border-amber-500 disabled:opacity-50 transition-colors"
            placeholder="输入灵魂名称"
          />
        </div>

        {/* Birth Date */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-ink-subtle">出生日期</label>
          <input
            type="date"
            value={birthDate}
            onChange={(e) => setBirthDate(e.target.value)}
            disabled={updateMutation.isPending}
            className="bg-surface-1 border border-hairline rounded px-3 py-2 text-sm text-ink focus:outline-none focus:border-amber-500 disabled:opacity-50 transition-colors"
          />
        </div>

        {/* Origin Location */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-ink-subtle">起源地点</label>
          <input
            type="text"
            value={originLocation}
            onChange={(e) => setOriginLocation(e.target.value)}
            disabled={updateMutation.isPending}
            className="bg-surface-1 border border-hairline rounded px-3 py-2 text-sm text-ink placeholder-ink-subtle focus:outline-none focus:border-amber-500 disabled:opacity-50 transition-colors"
            placeholder="输入起源地点"
          />
        </div>

        {/* Current State */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-ink-subtle">当前状态</label>
          <select
            value={currentState}
            onChange={(e) => setCurrentState(e.target.value as Soul["current_state"])}
            disabled={updateMutation.isPending}
            className="bg-surface-1 border border-hairline rounded px-3 py-2 text-sm text-ink focus:outline-none focus:border-amber-500 disabled:opacity-50 transition-colors"
          >
            {STATE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </form>
    </BaseModal>
  );
}
