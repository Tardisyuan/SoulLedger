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
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { SoulEditModal } from "@/src/components/souls/SoulEditModal";
import type { Soul } from "@soulledger/core/api";

jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

const mockShowToast = jest.fn();
jest.mock("@/src/contexts/ToastContext", () => ({
  useToast: () => ({ showToast: mockShowToast }),
}));

const mockMutate = jest.fn();
jest.mock("@soulledger/core/hooks/useSouls", () => ({
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
  date_problems: [],
  is_eval_identity: false,
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
    expect(within(stateSelect).getAllByRole("option")).toHaveLength(1);
  });

  it("does not offer SETTLED as a pick for a soul that isn't already settled", () => {
    render(
      <SoulEditModal isOpen={true} onClose={jest.fn()} soul={aliveSoul} onUpdated={jest.fn()} />
    );

    const stateSelect = screen.getByLabelText("souls.form.state_label") as HTMLSelectElement;
    expect(stateSelect).not.toBeDisabled();
    const values = within(stateSelect).getAllByRole("option").map((o) => (o as HTMLOptionElement).value);
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

describe("SoulEditModal · 阳寿 (第五十一批 F-1)", () => {
  beforeEach(() => jest.clearAllMocks());

  const diyuSoul: Soul = {
    ...aliveSoul,
    id: "soul-3",
    civilization: "CHINESE",
    current_state: "JUDGING",
    birth_date: { year: 1472, month: 10, day: 31 },
    death_date: { year: 1529, month: 1, day: 9 },
    fated_death_date: null,
  };
  const fatedBox = () => screen.getByLabelText("souls.fated_death_date · hall_settings.visit.optional");

  it("地府: the fated date sits in the life-dates row, with its explanation", () => {
    render(<SoulEditModal isOpen={true} onClose={jest.fn()} soul={diyuSoul} onUpdated={jest.fn()} />);
    expect(fatedBox()).toHaveAttribute("type", "date");
    expect(screen.getByText("souls.fated_death_help")).toBeInTheDocument();
  });

  it("other civilizations: neither the field nor its explanation, and nothing is sent", async () => {
    render(<SoulEditModal isOpen={true} onClose={jest.fn()} soul={aliveSoul} onUpdated={jest.fn()} />);
    expect(screen.queryByLabelText(/souls\.fated_death_date/)).toBeNull();
    expect(screen.queryByText("souls.fated_death_help")).toBeNull();
    fireEvent.click(screen.getByText("common.save"));
    await waitFor(() => expect(mockMutate).toHaveBeenCalledTimes(1));
    expect(mockMutate.mock.calls[0][0].data).not.toHaveProperty("fated_death_date");
  });

  it("death before the fated date: the preview line appears before saving; on or after it, it does not", () => {
    render(<SoulEditModal isOpen={true} onClose={jest.fn()} soul={diyuSoul} onUpdated={jest.fn()} />);
    expect(screen.queryByTestId("fated-death-preview")).toBeNull();
    fireEvent.change(fatedBox(), { target: { value: "1531-06-18" } });
    expect(screen.getByTestId("fated-death-preview")).toHaveTextContent("souls.fated_death_preview");
    fireEvent.change(fatedBox(), { target: { value: "1529-01-09" } });
    expect(screen.queryByTestId("fated-death-preview")).toBeNull();
  });

  it("sends the fated date only when it changed, and an untouched death date not at all", async () => {
    render(<SoulEditModal isOpen={true} onClose={jest.fn()} soul={diyuSoul} onUpdated={jest.fn()} />);
    fireEvent.change(fatedBox(), { target: { value: "1531-06-18" } });
    fireEvent.click(screen.getByText("common.save"));
    await waitFor(() => expect(mockMutate).toHaveBeenCalledTimes(1));
    const { data } = mockMutate.mock.calls[0][0];
    expect(data.fated_death_date).toBe("1531-06-18");
    expect(data).not.toHaveProperty("death_date");
  });
});

describe("SoulEditModal · 入殿前情形 (review P2-9)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("埃及: the passage is picked and sent; blank is a proper burial", async () => {
    render(<SoulEditModal isOpen={true} onClose={jest.fn()} soul={aliveSoul} onUpdated={jest.fn()} />);
    const box = screen.getByLabelText("souls.duat_passage.label") as HTMLSelectElement;
    expect(box.value).toBe("");
    expect(screen.getByText("souls.duat_passage.help")).toBeInTheDocument();
    fireEvent.change(box, { target: { value: "NAMELESS" } });
    fireEvent.click(screen.getByText("common.save"));
    await waitFor(() => expect(mockMutate).toHaveBeenCalledTimes(1));
    expect(mockMutate.mock.calls[0][0].data.duat_passage).toBe("NAMELESS");
  });

  it("other civilizations: no field, nothing sent", async () => {
    render(<SoulEditModal isOpen={true} onClose={jest.fn()} soul={{ ...aliveSoul, civilization: "GREEK" }} onUpdated={jest.fn()} />);
    expect(screen.queryByLabelText("souls.duat_passage.label")).toBeNull();
    fireEvent.click(screen.getByText("common.save"));
    await waitFor(() => expect(mockMutate).toHaveBeenCalledTimes(1));
    expect(mockMutate.mock.calls[0][0].data).not.toHaveProperty("duat_passage");
  });
});
