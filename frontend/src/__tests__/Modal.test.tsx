/**
 * Tests for Modal component
 */
import { render, screen, fireEvent } from "@testing-library/react";
import { BaseModal } from "@/src/components/ui/Modal";

jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        "icon_picker.select": "Select Icon",
        "icon_picker.clear": "Clear",
        "icon_picker.search": "Search icons...",
        "icon_picker.no_results": "No results found",
      };
      return map[key] || key;
    },
    locale: "en",
    hydrated: true,
  }),
}));

describe("BaseModal", () => {
  it("renders children when isOpen is true", () => {
    render(
      <BaseModal isOpen={true} onClose={() => {}} title="Test Modal">
        <div>Modal Content</div>
      </BaseModal>
    );
    expect(screen.getByText("Modal Content")).toBeInTheDocument();
  });

  it("does not render children when isOpen is false", () => {
    render(
      <BaseModal isOpen={false} onClose={() => {}} title="Test Modal">
        <div>Modal Content</div>
      </BaseModal>
    );
    expect(screen.queryByText("Modal Content")).not.toBeInTheDocument();
  });

  it("calls onClose when close button is clicked", () => {
    const onClose = jest.fn();
    render(
      <BaseModal isOpen={true} onClose={onClose} title="Test Modal">
        <div>Content</div>
      </BaseModal>
    );
    const closeBtn = screen.getByLabelText("Close");
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders title", () => {
    render(
      <BaseModal isOpen={true} onClose={() => {}} title="My Modal">
        <div>Content</div>
      </BaseModal>
    );
    expect(screen.getByText("My Modal")).toBeInTheDocument();
  });
});
