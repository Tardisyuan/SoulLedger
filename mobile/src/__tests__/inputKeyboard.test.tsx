/**
 * A password field is typed in Latin letters. Revealed, the system (pinyin) keyboard would put a candidate bar on it and
 * compose the letters, so `Input` defaults a secure field to `ascii-capable`; a caller's own keyboardType still wins.
 */
import { Platform } from "react-native";
import { render, screen } from "@testing-library/react-native";

import { Input } from "../ui";

const noop = () => {};

it("a secure field defaults to the ascii keyboard", () => {
  render(<Input testID="pw" label="密码" value="" onChangeText={noop} secureTextEntry />);
  expect(screen.getByTestId("pw").props.keyboardType).toBe("ascii-capable");
});

it("a caller's keyboardType wins, and a plain field is left alone", () => {
  render(
    <>
      <Input testID="pin" label="PIN" value="" onChangeText={noop} secureTextEntry keyboardType="number-pad" />
      <Input testID="plain" label="名字" value="" onChangeText={noop} />
    </>
  );
  expect(screen.getByTestId("pin").props.keyboardType).toBe("number-pad");
  expect(screen.getByTestId("plain").props.keyboardType).toBeUndefined();
});

describe("on Android, which has no ascii-capable keyboard", () => {
  beforeEach(() => jest.replaceProperty(Platform, "OS", "android"));
  afterEach(() => jest.restoreAllMocks());

  it("a Latin-only field asks for visible-password, or a pinyin keyboard composes its letters", () => {
    render(<Input testID="code" label="编号" value="" onChangeText={noop} keyboardType="ascii-capable" />);
    expect(screen.getByTestId("code").props.keyboardType).toBe("visible-password");
  });

  it("a masked field does not, because that keyboard type would drop the mask", () => {
    render(<Input testID="pw" label="密码" value="" onChangeText={noop} secureTextEntry />);
    expect(screen.getByTestId("pw").props.keyboardType).not.toBe("visible-password");
  });

  it("another keyboard type is left alone", () => {
    render(<Input testID="n" label="数" value="" onChangeText={noop} keyboardType="number-pad" />);
    expect(screen.getByTestId("n").props.keyboardType).toBe("number-pad");
  });
});
