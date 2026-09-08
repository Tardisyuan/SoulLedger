"use client";

import { useState, useEffect, useId } from "react";
import { BaseModal } from "@/src/components/ui/Modal";
import { Button } from "@/src/components/ui/Button";
import { Field, TextAreaField, fieldControl } from "@/src/components/ui/Field";
import { cn } from "@/lib/utils";
import { useI18n } from "@/src/contexts/I18nContext";
import { useUpdateProfile } from "@soulledger/core/hooks/useSocial";
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

        {/* NOT `TextField`, and the reason is the monospace.
         *
         * `TextField` owns its control's whole `className` — it `Omit`s the prop
         * so a caller cannot bolt classes onto the input, which is what keeps 42
         * signatures from growing back. `font-mono` on a URL field is not
         * decoration though: it is what makes a mistyped character in a pasted
         * link findable. So this one drops to the render-prop `Field` and
         * composes `fieldControl()` with the one class it actually needs —
         * every wiring guarantee (`id`/`htmlFor`, `aria-describedby`,
         * `aria-invalid`, `role="alert"`) still comes from `Field`.
         *
         * Size moves text-02 → text-03: `fieldControl`'s `sm` would give the
         * smaller type but also tighten the padding to `px-2 py-1`, which would
         * leave this control visibly shorter than the bio box above it. The
         * padding is the part that has to match its neighbour. */}
        <Field id={avatarUrlId} label={t("social.avatar_url_label") || "Avatar URL"}>
          {(control) => (
            <input
              {...control}
              type="url"
              value={avatarUrl}
              onChange={(e) => setAvatarUrl(e.target.value)}
              disabled={updateMutation.isPending}
              className={cn(fieldControl(), "font-mono")}
              placeholder="https://…"
            />
          )}
        </Field>
      </form>
    </BaseModal>
  );
}
