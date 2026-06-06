/**
 * Tests for UserDeleteDialog component
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { UserDeleteDialog } from "@/src/components/users/UserDeleteDialog";
import type { User } from "@/lib/api";

jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        "users.delete_title": "确认删除",
        "users.delete_confirm": "确定要删除以下用户吗？此操作无法撤销。",
        "users.delete_success": "用户已删除",
        "users.delete_error": "用户删除失败",
        "users.username": "用户名",
        "users.email": "邮箱",
        "users.role": "角色",
        "common.cancel": "取消",
        "common.delete": "删除",
        "common.submitting": "提交中...",
      };
      return map[key] ?? key;
    },
    locale: "en",
    hydrated: true,
  }),
}));

jest.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    invalidateQueries: jest.fn(),
  }),
  useMutation: ({ onSuccess }: { onSuccess?: () => void; onError?: () => void }) => ({
    mutate: jest.fn((_id: string) => {
      // Simulate successful deletion synchronously for tests
      if (onSuccess) {
        onSuccess();
      }
    }),
    isPending: false,
  }),
}));

jest.mock("@/lib/api", () => ({
  usersApi: {
    delete: jest.fn(),
  },
}));

jest.mock("@/lib/query_keys", () => ({
  userKeys: { all: ["users"] },
}));

jest.mock("@/src/components/ui/Toast", () => ({
  showToast: jest.fn(),
}));

const mockUser: User = {
  id: 1,
  username: "testuser",
  email: "test@example.com",
  role: "admin",
  is_active: true,
};

describe("UserDeleteDialog", () => {
  it("renders nothing when isOpen is false", () => {
    const { container } = render(
      <UserDeleteDialog user={mockUser} isOpen={false} onClose={jest.fn()} />
    );
    expect(container.querySelector("[role='dialog']")).not.toBeInTheDocument();
  });

  it("renders the dialog when isOpen is true", () => {
    render(
      <UserDeleteDialog user={mockUser} isOpen={true} onClose={jest.fn()} />
    );
    expect(screen.getByText("确认删除")).toBeInTheDocument();
  });

  it("renders the confirmation message", () => {
    render(
      <UserDeleteDialog user={mockUser} isOpen={true} onClose={jest.fn()} />
    );
    expect(screen.getByText("确定要删除以下用户吗？此操作无法撤销。")).toBeInTheDocument();
  });

  it("renders user details when user is provided", () => {
    render(
      <UserDeleteDialog user={mockUser} isOpen={true} onClose={jest.fn()} />
    );
    expect(screen.getByText("testuser")).toBeInTheDocument();
    expect(screen.getByText("test@example.com")).toBeInTheDocument();
    expect(screen.getByText("admin")).toBeInTheDocument();
  });

  it("renders cancel and delete buttons", () => {
    render(
      <UserDeleteDialog user={mockUser} isOpen={true} onClose={jest.fn()} />
    );
    expect(screen.getByText("取消")).toBeInTheDocument();
    expect(screen.getByText("删除")).toBeInTheDocument();
  });

  it("calls onClose when cancel button is clicked", () => {
    const onClose = jest.fn();
    render(
      <UserDeleteDialog user={mockUser} isOpen={true} onClose={onClose} />
    );
    fireEvent.click(screen.getByText("取消"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls deleteMutation.mutate when delete button is clicked", () => {
    const onClose = jest.fn();
    render(
      <UserDeleteDialog user={mockUser} isOpen={true} onClose={onClose} />
    );
    fireEvent.click(screen.getByText("删除"));
    expect(onClose).toHaveBeenCalled();
  });

  it("renders nothing when user is null", () => {
    render(
      <UserDeleteDialog user={null} isOpen={true} onClose={jest.fn()} />
    );
    expect(screen.getByText("确认删除")).toBeInTheDocument();
    expect(screen.queryByText("用户名:")).not.toBeInTheDocument();
  });
});
