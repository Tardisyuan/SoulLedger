/**
 * The scanner (expo-camera) and the photo picker (expo-image-picker) both write the camera permission.
 * The picker's `cameraPermission: false` REMOVES it -- NSCameraUsageDescription on iOS, android.permission.CAMERA
 * on Android -- whatever expo-camera asked for. With that in app.json, tapping 「扫码」 crashed the iOS app
 * ("This app is missing NSCameraUsageDescription", iPhone 17 simulator, 2026-10-11); jest mocks the camera and
 * saw nothing. Both plugins must state the same reason.
 */
import { readFileSync } from "fs";
import { join } from "path";

type Plugin = string | [string, Record<string, unknown>?];
const plugins: Plugin[] = JSON.parse(readFileSync(join(__dirname, "..", "..", "app.json"), "utf8")).expo.plugins;
const optionsOf = (name: string) => {
  const found = plugins.find((p) => (Array.isArray(p) ? p[0] : p) === name);
  return Array.isArray(found) ? (found[1] ?? {}) : found ? {} : null;
};

test("the photo picker does not take away the camera permission the scanner needs", () => {
  const camera = optionsOf("expo-camera");
  const picker = optionsOf("expo-image-picker");
  expect(camera).not.toBeNull();
  expect(typeof camera!.cameraPermission).toBe("string");
  if (picker) expect(picker.cameraPermission).toBe(camera!.cameraPermission);
});
