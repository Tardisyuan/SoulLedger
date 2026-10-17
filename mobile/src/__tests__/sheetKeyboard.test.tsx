/** A sheet's fields tell the sheet which one has focus (so it lifts above the keyboard), and a multiline field can finish. */
import { render, screen } from "@testing-library/react-native";
import { TextInput } from "react-native";

import { FieldComponentContext, Input } from "../ui";

function Probe({ comp, multiline }: { comp?: typeof TextInput; multiline?: boolean }) {
  const field = <Input label="理由" value="" onChangeText={() => {}} multiline={multiline} />;
  return comp ? <FieldComponentContext.Provider value={comp}>{field}</FieldComponentContext.Provider> : field;
}

describe("Input inside a sheet", () => {
  it("renders the component the sheet supplies", () => {
    const Sheeted = Object.assign((p: object) => <TextInput {...p} testID="sheeted" />, {}) as unknown as typeof TextInput;
    render(<Probe comp={Sheeted} />);
    expect(screen.getByTestId("sheeted")).toBeTruthy();
  });

  it("a multiline field in a sheet lets return finish it; outside a sheet it keeps adding lines", () => {
    const Sheeted = ((p: object) => <TextInput {...p} testID="sheeted" />) as unknown as typeof TextInput;
    const { unmount } = render(<Probe comp={Sheeted} multiline />);
    expect(screen.getByTestId("sheeted").props.submitBehavior).toBe("blurAndSubmit");
    unmount();
    render(<Probe multiline />);
    expect(screen.getByLabelText("理由").props.submitBehavior).toBeUndefined();
  });
});
