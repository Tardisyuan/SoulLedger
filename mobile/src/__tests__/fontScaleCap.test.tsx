/**
 * 第二十八批 S4: both apps follow the system text size, capped at the system's 3rd-largest step.
 * The one-line rule is opt-in per field (`OneLine`, the badge label; see layout.test.tsx), not a
 * default of the mono faces — the absence tests below keep it that way.
 */
import { render, screen } from "@testing-library/react-native";

import { Badge, Button, MAX_FONT_SCALE, Txt } from "../ui";

const props = (id: string) => screen.getByTestId(id).props;

describe("S4 text size", () => {
  it("the cap is the 3rd-largest step (iOS AX3, 2.35x) and every primitive passes it", () => {
    expect(MAX_FONT_SCALE).toBe(2.35);
    render(
      <>
        <Txt testID="body">正文</Txt>
        <Txt testID="title" variant="title">标题</Txt>
        <Txt testID="code" variant="value">SL-0001</Txt>
        <Button title="提交" onPress={() => {}} />
      </>
    );
    for (const id of ["body", "title", "code"]) expect(props(id).maxFontSizeMultiplier).toBe(2.35);
    expect(screen.getByText("提交").props.maxFontSizeMultiplier).toBe(2.35);
    expect(props("body").allowFontScaling).not.toBe(false);
  });

  it("the mono value faces do not set a line count by default; nothing shrinks to fit", () => {
    render(
      <>
        <Txt testID="code" variant="value">SL-0001</Txt>
        <Txt testID="amount" variant="valueLg">1,280</Txt>
        <Badge spec={{ glyph: "●", border: "solid" }} label="待处理" />
      </>
    );
    for (const p of [props("code"), props("amount")]) expect(p.numberOfLines).toBeUndefined();
    // S4: a status label keeps to one line.
    expect(screen.getByText("待处理").props.numberOfLines).toBe(1);
    for (const p of [props("code"), props("amount"), screen.getByText("待处理").props]) {
      expect(p.adjustsFontSizeToFit).toBeUndefined();
      expect(p.minimumFontScale).toBeUndefined();
      expect(p.maxFontSizeMultiplier).toBe(2.35);
    }
  });

  it("a caller's own numberOfLines passes through", () => {
    render(<Txt testID="v" variant="value" numberOfLines={3}>x</Txt>);
    expect(props("v").numberOfLines).toBe(3);
  });
});
