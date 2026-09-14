/**
 * Tests for ProfileCard's "Edit profile" entry point — the wiring for
 * UserProfileUpdateSerializer (backend/apps/social/serializers.py), which
 * already had a working PATCH /social/profiles/{id}/ endpoint and an unused
 * useUpdateProfile hook but no UI caller.
 *
 * Since 2026-09-14 the avatar is an upload, not a link: the form has a file
 * control that posts to /social/profiles/me/avatar/, and no URL field at all.
 */
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { ProfileCard } from "@/src/components/social/ProfileCard";
import type { UserProfile } from "@soulledger/core/api";

jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    locale: "en",
    hydrated: true,
  }),
}));

let mockUser: { id: string | number } | null = { id: "user-1" };
jest.mock("@/src/contexts/TenantContext", () => ({
  useTenant: () => ({ user: mockUser }),
}));

const mockUpdateMutate = jest.fn();
const mockUploadMutate = jest.fn();
jest.mock("@soulledger/core/hooks/useSocial", () => ({
  useUpdateProfile: () => ({ mutate: mockUpdateMutate, isPending: false }),
  useUploadAvatar: () => ({ mutate: mockUploadMutate, isPending: false }),
  useToggleFollow: () => ({ mutate: jest.fn(), isPending: false }),
  useFollowing: () => ({ data: [] }),
}));

const ownProfile: UserProfile = {
  id: "profile-1",
  user: "user-1",
  username: "selfuser",
  bio: "Existing bio",
  avatar: "http://localhost:8000/media/avatars/2026/09/abc.png",
  followers_count: 3,
  following_count: 5,
  post_count: 10,
};

const otherProfile: UserProfile = { ...ownProfile, id: "profile-2", user: "user-2", username: "otheruser" };

describe("ProfileCard edit profile UI", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUser = { id: "user-1" };
  });

  it("shows an edit-profile entry point on the current user's own profile", () => {
    render(<ProfileCard profile={ownProfile} />);
    expect(screen.getByText("social.edit_profile")).toBeInTheDocument();
  });

  it("does not show the edit entry point on someone else's profile, showing follow instead", () => {
    render(<ProfileCard profile={otherProfile} />);
    expect(screen.queryByText("social.edit_profile")).not.toBeInTheDocument();
  });

  it("renders the uploaded avatar, and the initial when there is none", () => {
    const { rerender } = render(<ProfileCard profile={ownProfile} />);
    expect(screen.getByAltText("selfuser")).toHaveAttribute("src", ownProfile.avatar);
    rerender(<ProfileCard profile={{ ...ownProfile, avatar: null }} />);
    expect(screen.queryByAltText("selfuser")).not.toBeInTheDocument();
    expect(screen.getByText("S")).toBeInTheDocument();
  });

  it("opens the edit form with the bio and an image upload control — no URL field", () => {
    render(<ProfileCard profile={ownProfile} />);
    fireEvent.click(screen.getByText("social.edit_profile"));
    const dialog = screen.getByRole("dialog");
    expect(screen.getByDisplayValue("Existing bio")).toBeInTheDocument();
    const file = within(dialog).getByLabelText("social.avatar_upload_label");
    expect(file).toHaveAttribute("type", "file");
    expect(file).toHaveAttribute("accept", "image/png,image/jpeg,image/webp");
    expect(dialog.querySelector('input[type="url"]')).toBeNull();
    expect(screen.queryByDisplayValue(ownProfile.avatar as string)).not.toBeInTheDocument();
  });

  it("uploads a chosen image as multipart field `avatar`", () => {
    render(<ProfileCard profile={ownProfile} />);
    fireEvent.click(screen.getByText("social.edit_profile"));
    const picked = new File([new Uint8Array([137, 80, 78, 71])], "me.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("social.avatar_upload_label"), { target: { files: [picked] } });
    expect(mockUploadMutate).toHaveBeenCalledTimes(1);
    const body = mockUploadMutate.mock.calls[0][0];
    expect(body).toBeInstanceOf(FormData);
    expect((body as FormData).get("avatar")).toBe(picked);
    expect(mockUpdateMutate).not.toHaveBeenCalled();
  });

  it("submits only the bio via useUpdateProfile", async () => {
    render(<ProfileCard profile={ownProfile} />);
    fireEvent.click(screen.getByText("social.edit_profile"));

    const bioInput = screen.getByDisplayValue("Existing bio");
    fireEvent.change(bioInput, { target: { value: "Updated bio" } });

    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByText("common.save"));

    await waitFor(() => expect(mockUpdateMutate).toHaveBeenCalledWith(
      { id: "profile-1", data: { bio: "Updated bio" } },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    ));
  });
});
