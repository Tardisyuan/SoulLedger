"use client";

import { useState, useEffect, useId } from "react";
import { BaseModal } from "@/src/components/ui/Modal";
import { Button } from "@/src/components/ui/Button";
import { Field, TextAreaField, fieldControl } from "@/src/components/ui/Field";
import { useI18n } from "@/src/contexts/I18nContext";
import { useUpdateProfile, useUploadAvatar } from "@soulledger/core/hooks/useSocial";
import type { UserProfile } from "@soulledger/core/api";

interface ProfileEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  profile: UserProfile;
}

export function ProfileEditModal({ isOpen, onClose, profile }: ProfileEditModalProps) {
  const { t } = useI18n();
  const updateMutation = useUpdateProfile();
  const uploadMutation = useUploadAvatar();

  // Unique prefix so field ids never collide across multiple
  // ProfileEditModal instances mounted at once.
  const formId = useId();
  const bioId = `${formId}-bio`;
  const avatarId = `${formId}-avatar`;

  const [bio, setBio] = useState("");

  // Populate form when the profile changes or the modal opens
  useEffect(() => {
    if (isOpen) {
      setBio(profile.bio || "");
    }
  }, [isOpen, profile]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    updateMutation.mutate(
      { id: profile.id, data: { bio: bio.trim() } },
      { onSuccess: () => onClose() }
    );
  }

  /**
   * The avatar uploads the moment a file is picked, separately from Save: it
   * is its own endpoint writing the account's avatar, and the card behind the
   * modal refreshes with it (the hook invalidates the profile queries). The
   * input is cleared afterwards so picking the same file again still fires.
   */
  function handleAvatarPicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const body = new FormData();
    body.append("avatar", file);
    uploadMutation.mutate(body);
    e.target.value = "";
  }

  /**
   * The save button's hand-copy of the primary recipe had lost the hover state
   * outright: `bg-[oklch(var(--color-accent))] hover:bg-[oklch(var(--color-accent))]`
   * — the same value on both sides, so the button did not react to the pointer
   * at all. That is the failure mode of copying a recipe rather than calling
   * it: the copy is a plausible-looking string and nothing compares it to the
   * original. `Button variant="primary"` restores hover (accent → accent-hover)
   * and adds the `active:` nudge and `aria-busy` this never had.
   */
  const footer = (
    <div className="flex gap-3">
      <Button
        type="button"
        variant="secondary"
        onClick={onClose}
        disabled={updateMutation.isPending}
        className="flex-1"
      >
        {t("common.cancel")}
      </Button>
      <Button
        type="submit"
        form="profile-edit-form"
        variant="primary"
        loading={updateMutation.isPending}
        className="flex-1"
      >
        {updateMutation.isPending ? (t("common.loading") || "Loading...") : (t("common.save") || "Save")}
      </Button>
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
        {/* `TextAreaField` brings one behaviour change worth naming: the bio box
            was `resize-none` and the primitive is `resize-y`. That is the
            primitive's call, and it is the right one here — a bio is exactly the
            free-text field someone wants taller. The `rows={3}` starting height
            is unchanged. */}
        <TextAreaField
          id={bioId}
          label={t("social.bio_label") || "Bio"}
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          disabled={updateMutation.isPending}
          rows={3}
          placeholder={t("social.bio_placeholder") || "Tell others about yourself…"}
        />

        {/* An upload, not a link (2026-09-14). This was a URL field, and the
         * production CSP (`img-src 'self' data:`) blocked every avatar it could
         * produce. The render-prop `Field` still supplies the label wiring and
         * `aria-describedby` for the format/size hint; `accept` only filters
         * the picker — the server decodes the file and is the actual check. */}
        <Field
          id={avatarId}
          label={t("social.avatar_upload_label") || "Avatar"}
          description={t("social.avatar_upload_hint") || "PNG, JPEG or WebP, up to 5 MB"}
        >
          {(control) => (
            <input
              {...control}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={handleAvatarPicked}
              disabled={uploadMutation.isPending}
              aria-busy={uploadMutation.isPending || undefined}
              className={fieldControl()}
            />
          )}
        </Field>
      </form>
    </BaseModal>
  );
}
