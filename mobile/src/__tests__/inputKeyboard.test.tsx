/**
 * A password field is typed in Latin letters. Revealed, the system (pinyin) keyboard would put a candidate bar on it and
 * compose the letters, so `Input` defaults a secure field to `ascii-capable`; a caller's own keyboardType still wins.
 */
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
