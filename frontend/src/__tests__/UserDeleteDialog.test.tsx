/**
 * Tests for UserDeleteDialog component.
 *
 * A REAL QueryClient, not a stubbed `useMutation`. Until 2026-09-12 this file
 * mocked `@tanstack/react-query` with a `mutate` that ignored `mutationFn` and
 * called `onSuccess` unconditionally — so the dialog could delete the wrong
 * user (`mutate("0")`) or never call the API at all and all eight tests stayed
 * green (FT-04). The doubles here are the API and the toast; what sits between
 * the click and `usersApi.delete` is the code under test.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { UserDeleteDialog } from "@/src/components/users/UserDeleteDialog";
import { usersApi, type User } from "@soulledger/core/api";
import { showToast } from "@/src/components/ui/Toast";
import { tZh, zh } from "./support/zhBundle";

const mockTranslate = jest.fn(tZh);

jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) => mockTranslate(key, params),
    locale: "zh-Hans",
    hydrated: true,
  }),
}));

jest.mock("@soulledger/core/api", () => ({
  usersApi: {
    delete: jest.fn(),
  },
}));

jest.mock("@soulledger/core/query_keys", () => ({
  userKeys: { all: ["users"] },
}));

jest.mock("@/src/components/ui/Toast", () => ({
  showToast: jest.fn(),
}));

const mockedDelete = usersApi.delete as jest.Mock;
const mockedToast = showToast as jest.Mock;

const mockUser: User = {
  id: 1,
  username: "testuser",
  email: "test@example.com",
  role: "ADMIN",
  is_active: true,
};

type Props = Parameters<typeof UserDeleteDialog>[0];

function renderDialog(props: Partial<Props> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidate = jest.spyOn(queryClient, "invalidateQueries");
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <UserDeleteDialog user={mockUser} isOpen={true} onClose={jest.fn()} {...props} />
    </QueryClientProvider>
  );
  return { ...utils, invalidate };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedDelete.mockResolvedValue({ data: undefined });
});

describe("UserDeleteDialog", () => {
  it("renders nothing when isOpen is false", () => {
    const { container } = renderDialog({ isOpen: false });
    expect(container.querySelector("[role='dialog']")).not.toBeInTheDocument();
  });

  it("renders the dialog when isOpen is true", () => {
    renderDialog();
    expect(screen.getByText(zh("users.delete_title"))).toBeInTheDocument();
  });

  it("renders the confirmation message", () => {
    renderDialog();
    expect(screen.getByText(zh("users.delete_confirm"))).toBeInTheDocument();
  });

  it("renders user details, with the role translated and the raw member only in title", () => {
    renderDialog();
    expect(screen.getByText("testuser")).toBeInTheDocument();
    expect(screen.getByText("test@example.com")).toBeInTheDocument();
    // §4.6: `{user.role}` used to print the member verbatim, and this test
    // pinned it (`admin`) as correct.
    expect(screen.getByText(zh("users.roles.ADMIN"))).toBeInTheDocument();
    expect(screen.getByTitle("ADMIN")).toBeInTheDocument();
    expect(screen.queryByText("ADMIN")).not.toBeInTheDocument();
  });

  it("renders cancel and delete buttons", () => {
    renderDialog();
    expect(screen.getByText(zh("common.cancel"))).toBeInTheDocument();
    expect(screen.getByText(zh("common.delete"))).toBeInTheDocument();
  });

  it("calls onClose when cancel button is clicked", () => {
    const onClose = jest.fn();
    renderDialog({ onClose });
    fireEvent.click(screen.getByText(zh("common.cancel")));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockedDelete).not.toHaveBeenCalled();
  });

  it("deletes THIS user: the id the dialog was given is what reaches usersApi.delete", async () => {
    const onClose = jest.fn();
    const onConfirm = jest.fn();
    const { invalidate } = renderDialog({ user: { ...mockUser, id: 42 }, onClose, onConfirm });

    fireEvent.click(screen.getByText(zh("common.delete")));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(mockedDelete).toHaveBeenCalledTimes(1);
    expect(mockedDelete).toHaveBeenCalledWith("42");
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(mockedToast).toHaveBeenCalledWith(zh("users.delete_success"), "success");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["users"] });
  });

  it("stays open and says so when the delete fails", async () => {
    mockedDelete.mockRejectedValue(new Error("500"));
    const onClose = jest.fn();
    const onConfirm = jest.fn();
    const { invalidate } = renderDialog({ onClose, onConfirm });

    fireEvent.click(screen.getByText(zh("common.delete")));

    await waitFor(() => expect(mockedToast).toHaveBeenCalledWith(zh("users.delete_error"), "error"));
    expect(mockedDelete).toHaveBeenCalledWith("1");
    expect(onClose).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("renders nothing about the user when user is null", () => {
    renderDialog({ user: null });
    expect(screen.getByText(zh("users.delete_title"))).toBeInTheDocument();
    expect(screen.queryByText(`${zh("users.username")}:`)).not.toBeInTheDocument();
  });
});
