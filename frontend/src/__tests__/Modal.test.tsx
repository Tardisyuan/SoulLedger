/**
 * Tests for Modal component
 */
import { render, screen, fireEvent } from "@testing-library/react";
import { BaseModal, ConfirmDialog } from "@/src/components/ui/Modal";

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

/**
 * ConfirmDialog is an ALERT dialog, and that is a behaviour, not a label.
 *
 * It used to be @headlessui's generic `Dialog`, which dismisses on an outside
 * click. Every call site is a confirmation before something consequential —
 * delete a user, delete a soul, move a menu to the recycle bin, log out — and
 * a stray click on the backdrop silently choosing "cancel" is the friendlier
 * half of the wrong pair: it teaches that these are dismissible, which is the
 * habit you least want at the moment the answer matters.
 *
 * @headlessui had no alert-dialog primitive. Base UI does.
 */
describe("ConfirmDialog answers only when answered", () => {
  const setup = () => {
    const onConfirm = jest.fn();
    const onCancel = jest.fn();
    render(
      <ConfirmDialog
        isOpen
        title="Delete this soul?"
        message="This moves it to the recycle bin."
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );
    return { onConfirm, onCancel };
  };

  it("announces itself as an alert dialog, not a plain one", () => {
    setup();
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    // Asserted as an absence too: a plain `dialog` role here would mean the
    // primitive silently went back to the dismissible kind.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("does not cancel when the backdrop is clicked", () => {
    const { onCancel, onConfirm } = setup();

    // The backdrop is the element behind the popup. Clicking it on a plain
    // Dialog would have fired onCancel.
    const popup = screen.getByRole("alertdialog");
    fireEvent.pointerDown(document.body);
    fireEvent.click(document.body);

    expect(onCancel).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(popup).toBeInTheDocument();
  });

  it("still cancels from the Cancel button", () => {
    const { onCancel } = setup();

    fireEvent.click(screen.getByText("common.cancel"));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("carries the message as the dialog's description, not loose text", () => {
    setup();
    // `aria-describedby` is what makes a screen reader read the consequence
    // along with the question. Base UI wires it from AlertDialog.Description.
    const dialog = screen.getByRole("alertdialog");
    const describedBy = dialog.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)?.textContent).toContain(
      "This moves it to the recycle bin."
    );
  });
});
