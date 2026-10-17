/** A sheet's fields tell the sheet which one has focus (so it lifts above the keyboard), and a multiline field can finish. */
import { render, screen } from "@testing-library/react-native";

import { InSheetContext, Input } from "../ui";

function Probe({ inSheet, multiline }: { inSheet?: boolean; multiline?: boolean }) {
  const field = <Input label="理由" value="" onChangeText={() => {}} multiline={multiline} />;
  return inSheet ? <InSheetContext.Provider value>{field}</InSheetContext.Provider> : field;
}

describe("Input inside a sheet", () => {
  it("a multiline field in a sheet lets return finish it; outside a sheet it keeps adding lines", () => {
    const { unmount } = render(<Probe inSheet multiline />);
    expect(screen.getByLabelText("理由").props.submitBehavior).toBe("blurAndSubmit");
    unmount();
    render(<Probe multiline />);
    expect(screen.getByLabelText("理由").props.submitBehavior).toBeUndefined();
  });
});
