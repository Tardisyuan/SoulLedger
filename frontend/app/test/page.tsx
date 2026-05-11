"use client";

import { useState } from "react";
import { BaseModal } from "@/src/components/ui/Modal";
import { useI18n } from "@/src/contexts/I18nContext";

export default function TestPage() {
  const { t } = useI18n();
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <div className="pt-14">
        <div className="max-w-4xl mx-auto p-8">
          <h1 className="text-2xl font-bold text-amber-400 mb-4">Modal Test</h1>
          <p className="text-ink-muted mb-6">
            Click the button below to test if the modal displays correctly on top of everything.
          </p>
          <button
            onClick={() => setIsModalOpen(true)}
            className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-black rounded font-medium transition-colors"
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
              className="flex-1 px-4 py-2 bg-surface-1 border border-hairline text-ink-muted hover:bg-surface-3 rounded text-sm transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => setIsModalOpen(false)}
              className="flex-1 px-4 py-2 bg-amber-500 hover:bg-amber-400 text-black rounded text-sm font-medium transition-colors"
            >
              Confirm
            </button>
          </div>
        }
      >
        <p className="text-ink text-sm">
          This is a test modal. If you can see this content properly overlaid on the page,
          the modal is working correctly.
        </p>
      </BaseModal>
    </div>
  );
}
