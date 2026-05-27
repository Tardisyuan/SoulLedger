"use client";

import { useState } from "react";
import { BaseModal } from "@/src/components/ui/Modal";
import { useI18n } from "@/src/contexts/I18nContext";

export default function TestPage() {
  const { t } = useI18n();
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <div className="min-h-screen bg-[hsl(var(--color-canvas))] text-[hsl(var(--color-ink))]">
      <div className="pt-14">
        <div className="max-w-4xl mx-auto p-8">
          <h1 className="text-2xl font-bold text-[hsl(var(--color-accent))] mb-4">Modal Test</h1>
          <p className="text-[hsl(var(--color-ink-muted))] mb-6">
            Click the button below to test if the modal displays correctly on top of everything.
          </p>
          <button
            onClick={() => setIsModalOpen(true)}
            className="px-4 py-2 bg-[hsl(var(--color-accent))] hover:bg-[hsl(var(--color-accent-hover))] text-black rounded font-medium transition-colors"
          >
            Open Modal
          </button>
        </div>
      </div>

      <BaseModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Test Modal"
        footer={
          <div className="flex gap-3">
            <button
              onClick={() => setIsModalOpen(false)}
              className="flex-1 px-4 py-2 bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] text-[hsl(var(--color-ink-muted))] hover:bg-[hsl(var(--color-surface-3))] rounded text-sm transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => setIsModalOpen(false)}
              className="flex-1 px-4 py-2 bg-[hsl(var(--color-accent))] hover:bg-[hsl(var(--color-accent-hover))] text-black rounded text-sm font-medium transition-colors"
            >
              Confirm
            </button>
          </div>
        }
      >
        <p className="text-[hsl(var(--color-ink))] text-sm">
          This is a test modal. If you can see this content properly overlaid on the page,
          the modal is working correctly.
        </p>
      </BaseModal>
    </div>
  );
}
