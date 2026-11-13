import { screen } from "@testing-library/react";
import { ActorCell } from "@/src/components/events/ActorCell";
import { renderWithProviders } from "./support/render";

describe("ActorCell", () => {
  it("shows display name and localized role, raw role in title", () => {
    renderWithProviders(<ActorCell actor="cui (JUDGE)" displayName="崔判官" role="JUDGE" />);
    expect(screen.getByText(/崔判官/)).toBeInTheDocument();
    expect(screen.getByTitle("JUDGE")).toBeInTheDocument();
  });
  it("falls back to the username parsed from the stored string", () => {
    renderWithProviders(<ActorCell actor="tester (JUDGE)" />);
    expect(screen.getByText(/tester/)).toBeInTheDocument();
    expect(screen.queryByText(/\(JUDGE\)/)).toBeNull();
  });
  it("leaves a bare username alone", () => {
    renderWithProviders(<ActorCell actor="alice" />);
    expect(screen.getByText("alice")).toBeInTheDocument();
  });
});
