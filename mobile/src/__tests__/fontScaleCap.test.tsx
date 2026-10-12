/**
 * 第二十八批 S4: both apps follow the system text size, capped at the system's 3rd-largest step.
 * Identifiers, times, amounts and status labels stay on one line; body text, titles and button
 * labels may wrap. The cap and the line rule live in the shared primitives (`Txt`, `Badge`, `Button`).
 */
import { render, screen } from "@testing-library/react-native";

import { Badge, Button, MAX_FONT_SCALE, Txt } from "../ui";

const props = (id: string) => screen.getByTestId(id).props;

describe("S4 text size", () => {
  it("the cap is the 3rd-largest iOS step (AX3, 2.35x) and every primitive passes it", () => {
    expect(MAX_FONT_SCALE).toBe(2.35);
    render(
      <>
        <Txt testID="body">正文</Txt>
        <Txt testID="title" variant="title">标题</Txt>
        <Txt testID="code" variant="value">SL-0001</Txt>
        <Button testID="btn" title="提交" onPress={() => {}} />
      </>
    );
    for (const id of ["body", "title", "code"]) expect(props(id).maxFontSizeMultiplier).toBe(2.35);
    expect(screen.getByText("提交").props.maxFontSizeMultiplier).toBe(2.35);
    expect(props("body").allowFontScaling).not.toBe(false);
  });

  it("identifiers, times and amounts (the mono faces) stay on one line; body, titles and buttons may wrap", () => {
    render(
      <>
        <Txt testID="code" variant="value">SL-0001</Txt>
        <Txt testID="amount" variant="valueLg">1,280</Txt>
        <Txt testID="body">一段会换行的正文</Txt>
        <Txt testID="title" variant="title">标题</Txt>
        <Button title="一个很长很长的按钮文案" onPress={() => {}} />
      </>
    );
    for (const id of ["code", "amount"]) {
      expect(props(id).numberOfLines).toBe(1);
      expect(props(id).adjustsFontSizeToFit).toBe(true);
    }
    for (const id of ["body", "title"]) {
      expect(props(id).numberOfLines).toBeUndefined();
      expect(props(id).adjustsFontSizeToFit).toBeUndefined();
    }
    expect(screen.getByText("一个很长很长的按钮文案").props.numberOfLines).toBe(2);
  });

  it("a caller's own numberOfLines still wins on a one-line face", () => {
    render(<Txt testID="v" variant="value" numberOfLines={3}>x</Txt>);
    expect(props("v").numberOfLines).toBe(3);
  });

  it("a status label stays on one line; the raw member of an unknown status may wrap", () => {
    render(
      <>
        <Badge spec={{ glyph: "●", border: "solid", pending: false, unknown: false }} label="待处理" />
        <Badge spec={{ glyph: "?", border: "dashed", pending: false, unknown: true }} label="未识别" raw="SOME_RAW_MEMBER" />
      </>
    );
    expect(screen.getByText("待处理").props.numberOfLines).toBe(1);
    expect(screen.getByText("待处理").props.maxFontSizeMultiplier).toBe(2.35);
    expect(screen.getByText("未识别").props.numberOfLines).toBeUndefined();
    expect(screen.getByText("SOME_RAW_MEMBER").props.maxFontSizeMultiplier).toBe(2.35);
  });
});
