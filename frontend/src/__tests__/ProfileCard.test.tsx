/**
 * Tests for ProfileCard's "Edit profile" entry point — the wiring for
 * UserProfileUpdateSerializer (backend/apps/social/serializers.py), which
 * already had a working PATCH /social/profiles/{id}/ endpoint and an unused
 * useUpdateProfile hook but no UI caller.
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
jest.mock("@soulledger/core/hooks/useSocial", () => ({
  useUpdateProfile: () => ({ mutate: mockUpdateMutate, isPending: false }),
  useToggleFollow: () => ({ mutate: jest.fn(), isPending: false }),
  useFollowing: () => ({ data: [] }),
}));

const ownProfile: UserProfile = {
  id: "profile-1",
  user: "user-1",
  username: "selfuser",
  bio: "Existing bio",
  avatar_url: "https://example.com/avatar.png",
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

  it("opens the edit form pre-filled with the current bio and avatar url", () => {
    render(<ProfileCard profile={ownProfile} />);
    fireEvent.click(screen.getByText("social.edit_profile"));
    expect(screen.getByDisplayValue("Existing bio")).toBeInTheDocument();
    expect(screen.getByDisplayValue("https://example.com/avatar.png")).toBeInTheDocument();
  });

  it("submits the edited bio and avatar url via useUpdateProfile", async () => {
    render(<ProfileCard profile={ownProfile} />);
    fireEvent.click(screen.getByText("social.edit_profile"));

    const bioInput = screen.getByDisplayValue("Existing bio");
    fireEvent.change(bioInput, { target: { value: "Updated bio" } });

    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByText("common.save"));

    await waitFor(() => expect(mockUpdateMutate).toHaveBeenCalledWith(
      {
        id: "profile-1",
        data: { bio: "Updated bio", avatar_url: "https://example.com/avatar.png" },
      },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    ));
  });
});
