import { test, expect, setupAuthenticatedPage, SOCIAL_PROFILE, TEST_USER, type ApiMock } from "./fixtures";

/**
 * /social/profile/[id] — own-profile avatar upload.
 *
 * `ProfileEditModal` fires the upload the moment a file is picked (see the
 * component's comment on `handleAvatarPicked`), separately from the bio's
 * Save button, and the server decides whether the file is acceptable — the
 * `accept` attribute on the `<input>` only filters the OS picker, so a
 * rejected file still reaches the mocked POST and comes back as a DRF field
 * error on `avatar`, exactly like `AvatarUploadSerializer.validate_avatar`
 * (backend/apps/social/serializers.py) sends it.
 */

let api: ApiMock;

test.beforeEach(async ({ page }) => {
  api = await setupAuthenticatedPage(page);
});

test.describe("Profile avatar upload", () => {
  test("uploads a picked image and the profile card shows the new avatar", async ({ page }) => {
    await page.goto(`/social/profile/${TEST_USER.id}`);
    await expect(page).toHaveURL(/\/social\/profile\//);

    // Own profile: SOCIAL_PROFILE.user === TEST_USER.id, so ProfileCard
    // renders "Edit profile" rather than a follow button.
    await page.getByRole("button", { name: "编辑资料" }).click();

    const fileInput = page.getByLabel("头像");
    await fileInput.setInputFiles({
      name: "avatar.png",
      mimeType: "image/png",
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    });

    // The request the app actually sent.
    await expect.poll(() => api.countOf("POST", "/social/profiles/me/avatar/")).toBe(1);
    const call = api.lastCall("POST", "/social/profiles/me/avatar/");
    expect(call?.path).toBe("/social/profiles/me/avatar/");

    // Success toast, then the invalidated GET redraws the card with the
    // avatar the mock now returns (see ApiMock.currentAvatar in fixtures.ts).
    await expect(page.getByRole("status").filter({ hasText: "头像已更新" })).toBeVisible();

    // The card sits behind the still-open modal, which Base UI marks
    // `aria-hidden`/inert — invisible to `getByRole`, so this locates the
    // `<img alt={username}>` by its DOM attribute instead.
    await expect(page.getByAltText(SOCIAL_PROFILE.username)).toHaveAttribute(
      "src",
      "https://soulledger.test/media/avatars/uploaded.png"
    );
  });

  test("shows the server's field error when a non-image file is picked", async ({ page }) => {
    // The frontend does not itself validate the file — only Pillow on the
    // server can tell a real image from a renamed text file — so this drives
    // the exact 400 shape AvatarUploadSerializer.validate_avatar raises.
    api.on("POST", "/social/profiles/me/avatar/", () => ({
      status: 400,
      body: { avatar: ["Upload a PNG, JPEG or WebP image."] },
    }));

    await page.goto(`/social/profile/${TEST_USER.id}`);
    await page.getByRole("button", { name: "编辑资料" }).click();

    const fileInput = page.getByLabel("头像");
    await fileInput.setInputFiles({
      name: "not-an-image.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("this is not an image"),
    });

    await expect.poll(() => api.countOf("POST", "/social/profiles/me/avatar/")).toBe(1);

    // `role="alert"` per Toast.tsx's error mapping; the message is the
    // server's field error verbatim, read by drfFieldErrors, not the generic
    // "avatar_upload_error" fallback.
    await expect(
      page.getByRole("alert").filter({ hasText: "Upload a PNG, JPEG or WebP image." })
    ).toBeVisible();
  });
});
