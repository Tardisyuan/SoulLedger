/**
 * The shared `Input` (both apps; the officer app imports it through `mobile-officer/src/shared.ts`):
 * - a multiline field's line height stays at least 1.8 x its size — under that Android clips the first line's top
 *   of a Noto Serif SC field (Huawei 10-31: 15/24 and 15/26 clip, 15/27 whole);
 * - a single-line field is mono only when it can hold nothing but Latin (`mono`, a password, a Latin-only keyboard);
 *   any other field is in the quote face, so Han and a Han placeholder are not left to the phone's own face.
 */
import { render, screen } from "@testing-library/react-native";
import { StyleSheet } from "react-native";

import { family } from "../fonts";
import { Input } from "../ui";

const noop = () => {};
const style = (id: string) => StyleSheet.flatten(screen.getByTestId(id).props.style);

it("a multiline field's line height is at least 1.8 x its size", () => {
  render(<Input testID="m" label="理由" value="向" onChangeText={noop} multiline />);
  const { fontSize, lineHeight } = style("m");
  expect(typeof fontSize).toBe("number");
  expect(typeof lineHeight).toBe("number");
  expect((lineHeight as number) / (fontSize as number)).toBeGreaterThanOrEqual(1.8);
  expect(style("m").fontFamily).toBe(family.serifHan);
});

it("a plain single-line field is in the quote face: Han text, a Han placeholder, and Latin", () => {
  render(
    <>
      <Input testID="han" label="搜索" value="陈砚舟" onChangeText={noop} />
      <Input testID="ph" label="搜索" value="" placeholder="姓名或编号" onChangeText={noop} />
      <Input testID="latin" label="Name" value="Yan" onChangeText={noop} />
    </>
  );
  for (const id of ["han", "ph"]) {
    expect(style(id).fontFamily).toBe(family.serifHan);
    expect(style(id).fontFamily).not.toBe(family.mono[400]);
  }
  expect(style("latin").fontFamily).toBe(family.serif);
});

it("a code, a password or a Latin-only keyboard stays mono, even with a Han placeholder", () => {
  render(
    <>
      <Input testID="code" label="编号" value="" placeholder="编号" onChangeText={noop} mono />
      <Input testID="pw" label="密码" value="" placeholder="密码" onChangeText={noop} secureTextEntry />
      <Input testID="ascii" label="恢复码" value="" placeholder="恢复码" onChangeText={noop} keyboardType="ascii-capable" />
      <Input testID="digits" label="天数" value="" placeholder="天数" onChangeText={noop} keyboardType="number-pad" />
      <Input testID="email" label="邮箱" value="" placeholder="邮箱" onChangeText={noop} keyboardType="email-address" />
    </>
  );
  expect(style("code").fontFamily).toBe(family.mono[500]);
  for (const id of ["pw", "ascii", "digits", "email"]) expect(style(id).fontFamily).toBe(family.mono[400]);
  for (const id of ["code", "pw", "ascii", "digits", "email"]) expect(style(id).fontFamily).not.toBe(family.serifHan);
});
