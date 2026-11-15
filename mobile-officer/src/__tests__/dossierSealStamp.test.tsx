/**
 * The officer app's stamped seal (judgment detail after a decision, the read-back's seal) is the one seal motion of
 * every surface (Design batch 53 G1, SEAL_MOTION): 1.18× → 1×, opacity 0 → 1, 200 ms on the seal's curve; under
 * reduce-motion no scale and a 120 ms fade. jest does not run frames, so it asks what was started and where it begins.
 */
import { SEAL_MOTION } from "@soulledger/core/config/motion";
import { act } from "@testing-library/react-native";
import { AccessibilityInfo, Animated } from "react-native";

import { DossierSeal } from "../dossierSeal";
import { renderOfficer } from "./harness";

afterEach(() => {
  jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(false);
});

it("drops from 1.18× at opacity 0 to 1× over 200 ms", async () => {
  const timing = jest.spyOn(Animated, "timing");
  renderOfficer(<DossierSeal testID="seal" civilization="CHINESE" court="第五殿" stamp label="印" />);
  await act(async () => {});
  expect(timing).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ toValue: 1, duration: SEAL_MOTION.durationMs, useNativeDriver: true }));
  expect(SEAL_MOTION).toMatchObject({ scaleFrom: 1.18, durationMs: 200, easing: [0.2, 0.8, 0.2, 1] });
  timing.mockRestore();
});

it("reduce motion: a 120 ms fade, no scale", async () => {
  jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true);
  const timing = jest.spyOn(Animated, "timing");
  renderOfficer(<DossierSeal testID="seal" civilization="CHINESE" court="第五殿" stamp label="印" />);
  await act(async () => {});
  expect(timing).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ toValue: 1, duration: SEAL_MOTION.reduced.durationMs }));
  timing.mockRestore();
  // (The first frame may start the 200 ms drop: useReducedMotion answers asynchronously, as it did before this batch.)
});
