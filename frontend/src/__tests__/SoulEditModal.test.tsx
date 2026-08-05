/**
 * Tests for SoulEditModal, specifically the SETTLED case.
 *
 * SETTLED is a terminal soul state (see lib/validations/schemas.ts) that
 * nothing transitions out of — not even LOST — so an operator must not be
 * able to pick it manually. But the edit form still needs to round-trip a
 * soul that is already SETTLED: before soulUpdateSchema accepted SETTLED,
 * opening this modal on a settled soul made validation fail and the
 * operator couldn't even change the name. That is the bug these tests
 * guard against.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SoulEditModal } from "@/src/components/souls/SoulEditModal";
import type { Soul } from "@/lib/api";

jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

const mockShowToast = jest.fn();
jest.mock("@/src/contexts/ToastContext", () => ({
  useToast: () => ({ showToast: mockShowToast }),
}));

const mockMutate = jest.fn();
jest.mock("@/src/hooks/useSouls", () => ({
  useUpdateSoul: () => ({ mutate: mockMutate, isPending: false }),
}));

const settledSoul: Soul = {
  id: "soul-1",
  name: "Ammit's Ward",
  civilization: "EGYPTIAN",
  current_state: "SETTLED",
  birth_date: null,
  death_date: null,
  origin_location: "Duat",
  description: "",
  merit_score: 0,
  demerit_score: 0,
};

const aliveSoul: Soul = { ...settledSoul, id: "soul-2", current_state: "ALIVE" };

describe("SoulEditModal", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders the state control disabled and showing the settled label for a SETTLED soul", () => {
    render(
      <SoulEditModal isOpen={true} onClose={jest.fn()} soul={settledSoul} onUpdated={jest.fn()} />
    );

    const stateSelect = screen.getByLabelText("souls.form.state_label") as HTMLSelectElement;
    expect(stateSelect).toBeDisabled();
    expect(stateSelect.value).toBe("SETTLED");
    // Only the settled option is offered — SETTLED is not appended to the
    // normal pick-list, it replaces it once the soul is already settled.
    expect(screen.getAllByRole("option")).toHaveLength(1);
  });

  it("does not offer SETTLED as a pick for a soul that isn't already settled", () => {
    render(
      <SoulEditModal isOpen={true} onClose={jest.fn()} soul={aliveSoul} onUpdated={jest.fn()} />
    );

    const stateSelect = screen.getByLabelText("souls.form.state_label") as HTMLSelectElement;
    expect(stateSelect).not.toBeDisabled();
    const values = screen.getAllByRole("option").map((o) => (o as HTMLOptionElement).value);
    expect(values).not.toContain("SETTLED");
  });

  it("submits a name change on a SETTLED soul without failing validation, round-tripping current_state", async () => {
    render(
      <SoulEditModal isOpen={true} onClose={jest.fn()} soul={settledSoul} onUpdated={jest.fn()} />
    );

    fireEvent.change(screen.getByLabelText("souls.form.name_label"), {
      target: { value: "Renamed Ward" },
    });
    fireEvent.click(screen.getByText("common.save"));

    await waitFor(() => expect(mockMutate).toHaveBeenCalledTimes(1));
    const [{ id, data }] = mockMutate.mock.calls[0];
    expect(id).toBe("soul-1");
    expect(data.name).toBe("Renamed Ward");
    // Round-trips the existing state rather than sending undefined or ALIVE.
    expect(data.current_state).toBe("SETTLED");
  });
});
