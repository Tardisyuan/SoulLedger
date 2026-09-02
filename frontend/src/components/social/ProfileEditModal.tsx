"use client";

import { useState, useEffect, useId } from "react";
import { BaseModal } from "@/src/components/ui/Modal";
import { useI18n } from "@/src/contexts/I18nContext";
import { useUpdateProfile } from "@/src/hooks/useSocial";
import type { UserProfile } from "@soulledger/core/api";

interface ProfileEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  profile: UserProfile;
}

export function ProfileEditModal({ isOpen, onClose, profile }: ProfileEditModalProps) {
  const { t } = useI18n();
  const updateMutation = useUpdateProfile();

  // Unique prefix so field ids never collide across multiple
  // ProfileEditModal instances mounted at once.
  const formId = useId();
  const bioId = `${formId}-bio`;
  const avatarUrlId = `${formId}-avatar-url`;

  const [bio, setBio] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");

  // Populate form when the profile changes or the modal opens
  useEffect(() => {
    if (isOpen) {
      setBio(profile.bio || "");
      setAvatarUrl(profile.avatar_url || "");
    }
  }, [isOpen, profile]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    updateMutation.mutate(
      { id: profile.id, data: { bio: bio.trim(), avatar_url: avatarUrl.trim() } },
      { onSuccess: () => onClose() }
    );
  }

  const footer = (
    <div className="flex gap-3">
      <button
        type="button"
        onClick={onClose}
        disabled={updateMutation.isPending}
        className="flex-1 px-4 py-2 bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] text-[hsl(var(--color-ink-muted))] hover:bg-[hsl(var(--color-surface-2))] disabled:opacity-50 text-03 transition-colors"
      >
        {t("common.cancel")}
      </button>
      <button
        type="submit"
        form="profile-edit-form"
        disabled={updateMutation.isPending}
        className="flex-1 px-4 py-2 bg-[hsl(var(--color-accent))] hover:bg-[hsl(var(--color-accent))] disabled:opacity-50 text-black text-03 font-medium transition-colors"
      >
        {updateMutation.isPending ? (t("common.loading") || "Loading...") : (t("common.save") || "Save")}
      </button>
    </div>
  );

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title={t("social.edit_profile") || "Edit profile"}
      footer={footer}
    >
      <form id="profile-edit-form" onSubmit={handleSubmit} className="space-y-4">
        {/* Bio */}
        <div className="flex flex-col gap-1">
          <label htmlFor={bioId} className="text-02 text-[hsl(var(--color-ink-subtle))]">
            {t("social.bio_label") || "Bio"}
          </label>
          <textarea
            id={bioId}
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            disabled={updateMutation.isPending}
            rows={3}
            className="bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] px-3 py-2 text-04 text-[hsl(var(--color-ink))] placeholder-[hsl(var(--color-ink-subtle))] focus:outline-hidden focus:border-[hsl(var(--color-accent))] disabled:opacity-50 transition-colors resize-none"
            placeholder={t("social.bio_placeholder") || "Tell others about yourself…"}
          />
        </div>

        {/* Avatar URL */}
        <div className="flex flex-col gap-1">
          <label htmlFor={avatarUrlId} className="text-02 text-[hsl(var(--color-ink-subtle))]">
            {t("social.avatar_url_label") || "Avatar URL"}
          </label>
          <input
            id={avatarUrlId}
            type="url"
            value={avatarUrl}
            onChange={(e) => setAvatarUrl(e.target.value)}
            disabled={updateMutation.isPending}
            className="bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] px-3 py-2 text-02 font-mono text-[hsl(var(--color-ink))] placeholder-[hsl(var(--color-ink-subtle))] focus:outline-hidden focus:border-[hsl(var(--color-accent))] disabled:opacity-50 transition-colors"
            placeholder="https://…"
          />
        </div>
      </form>
    </BaseModal>
  );
}
