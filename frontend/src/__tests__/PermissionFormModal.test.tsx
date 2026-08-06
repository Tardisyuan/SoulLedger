/**
 * Tests for PermissionFormModal component
 */
import { render, screen, fireEvent } from "@testing-library/react";
import { PermissionFormModal } from "@/src/components/permissions/PermissionFormModal";
import type { Permission } from "@/lib/api";

jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        "common.cancel": "取消",
        "permissions.submit": "提交",
        "permissions.submitting": "提交中...",
        "permissions.codename_label": "权限代码",
        "permissions.codename_placeholder": "请输入权限代码",
        "permissions.name_label": "权限名称",
        "permissions.name_placeholder": "请输入权限名称",
        "permissions.category_label": "分类",
        "permissions.category_placeholder": "如：soul（或输入新分类）",
        "permissions.category_hint": "从现有分类中选择，或输入一个新分类",
      };
      return map[key] ?? key;
    },
    locale: "en",
    hydrated: true,
  }),
}));

// The real, current categories (apps/perm/models.py::DEFAULT_PERMISSIONS has
// 14 today) — not the 5-entry hardcoded list this component used to ship
// with, one of which ("karma") stopped existing when that app was renamed to
// "ledger". These tests exist specifically to keep that regression from
// coming back, so the fixture deliberately does NOT include "karma".
const EXISTING_CATEGORIES = ["soul", "judgment", "ledger", "reincarnation", "system", "dispatch"];

const defaultProps = {
  isOpen: true,
  onClose: jest.fn(),
  onSubmit: jest.fn(),
  isPending: false,
  error: null,
  title: "新建权限",
  existingCategories: EXISTING_CATEGORIES,
};

describe("PermissionFormModal", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders nothing when isOpen is false", () => {
    const { container } = render(
      <PermissionFormModal {...defaultProps} isOpen={false} />
    );
    expect(container.querySelector("[role='dialog']")).not.toBeInTheDocument();
  });

  it("renders the dialog when isOpen is true", () => {
    render(<PermissionFormModal {...defaultProps} />);
    expect(screen.getByText("新建权限")).toBeInTheDocument();
  });

  it("renders form labels and inputs", () => {
    render(<PermissionFormModal {...defaultProps} />);
    expect(screen.getByText("权限代码")).toBeInTheDocument();
    expect(screen.getByText("权限名称")).toBeInTheDocument();
    expect(screen.getByText("分类")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("请输入权限代码")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("请输入权限名称")).toBeInTheDocument();
  });

  it("renders cancel and submit buttons", () => {
    render(<PermissionFormModal {...defaultProps} />);
    expect(screen.getByText("取消")).toBeInTheDocument();
    expect(screen.getByText("提交")).toBeInTheDocument();
  });

  it("calls onClose when cancel button is clicked", () => {
    const onClose = jest.fn();
    render(<PermissionFormModal {...defaultProps} onClose={onClose} />);
    fireEvent.click(screen.getByText("取消"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders error message when error is provided", () => {
    render(<PermissionFormModal {...defaultProps} error="权限代码已存在" />);
    expect(screen.getByText("权限代码已存在")).toBeInTheDocument();
  });

  it("does not render error when error is null", () => {
    render(<PermissionFormModal {...defaultProps} error={null} />);
    expect(screen.queryByText("权限代码已存在")).not.toBeInTheDocument();
  });

  it("disables submit button when isPending is true", () => {
    render(<PermissionFormModal {...defaultProps} isPending={true} />);
    expect(screen.getByText("提交中...")).toBeInTheDocument();
  });

  it("populates form fields with initialData", () => {
    const initialData: Permission = {
      id: 1,
      codename: "soul.view",
      name: "查看灵魂",
      category: "soul",
    };
    render(<PermissionFormModal {...defaultProps} initialData={initialData} />);
    expect(screen.getByDisplayValue("soul.view")).toBeInTheDocument();
    expect(screen.getByDisplayValue("查看灵魂")).toBeInTheDocument();
  });

  it("defaults the category field to the first live category, and offers the rest as suggestions", () => {
    render(<PermissionFormModal {...defaultProps} />);
    const categoryInput = screen.getByDisplayValue("soul");
    expect(categoryInput).toBeInTheDocument();
    expect(categoryInput).toHaveAttribute("list");
    // <option> elements inside a <datalist> are suggestions for a free-text
    // <input>, not a closed set like <select> options — jsdom/testing-library
    // don't expose them via getByRole("option"), so query the DOM directly.
    // BaseModal renders through a portal into document.body, outside
    // render()'s `container` — query the document, not the container.
    const suggestionValues = Array.from(document.querySelectorAll("datalist option")).map(
      (o) => o.getAttribute("value")
    );
    expect(suggestionValues.sort()).toEqual([...EXISTING_CATEGORIES].sort());
  });

  it("does not offer 'karma' as a category — that app was renamed to 'ledger'", () => {
    render(<PermissionFormModal {...defaultProps} />);
    // BaseModal renders through a portal into document.body, outside
    // render()'s `container` — query the document, not the container.
    const suggestionValues = Array.from(document.querySelectorAll("datalist option")).map(
      (o) => o.getAttribute("value")
    );
    expect(suggestionValues).not.toContain("karma");
  });

  it("accepts a category not in the suggestion list — creating the first codename in a new category must be possible", () => {
    render(<PermissionFormModal {...defaultProps} />);
    const categoryInput = screen.getByDisplayValue("soul");
    fireEvent.change(categoryInput, { target: { value: "org" } });
    expect(categoryInput).toHaveValue("org");
  });

  it("updates input values when user types", () => {
    render(<PermissionFormModal {...defaultProps} />);
    const codenameInput = screen.getByPlaceholderText("请输入权限代码");
    const nameInput = screen.getByPlaceholderText("请输入权限名称");

    fireEvent.change(codenameInput, { target: { value: "soul.create" } });
    fireEvent.change(nameInput, { target: { value: "创建灵魂" } });

    expect(codenameInput).toHaveValue("soul.create");
    expect(nameInput).toHaveValue("创建灵魂");
  });

  it("resets form fields when modal closes and reopens", () => {
    const { rerender } = render(<PermissionFormModal {...defaultProps} isOpen={false} />);

    // Open modal with initial data
    rerender(<PermissionFormModal {...defaultProps} isOpen={true} />);
    const codenameInput = screen.getByPlaceholderText("请输入权限代码");
    fireEvent.change(codenameInput, { target: { value: "test.codename" } });

    // Close modal
    rerender(<PermissionFormModal {...defaultProps} isOpen={false} />);

    // Reopen modal
    rerender(<PermissionFormModal {...defaultProps} isOpen={true} />);
    expect(screen.getByPlaceholderText("请输入权限代码")).toHaveValue("");
  });
});
