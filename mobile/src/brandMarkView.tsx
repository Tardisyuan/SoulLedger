import { View } from "react-native";
import Svg, { Path } from "react-native-svg";

import { MARK_HEIGHT, MARK_WIDTH, SHAPE, VIEWBOX } from "./brandMark";

/**
 * The S-and-L balance mark, filled (the cold start writes the same outline in strokes).
 * On the light login page it is set in ink: the brand gold is too faint on v3's light canvas
 * (theme.ts `brand` is for the icon and the cold start's dark ground only).
 */
export function BrandMark({
  size,
  color,
  testID,
}: {
  size: number;
  color: string;
  testID?: string;
}) {
  return (
    <View
      testID={testID}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Svg
        width={size}
        height={(size * MARK_HEIGHT) / MARK_WIDTH}
        viewBox={VIEWBOX}
      >
        {SHAPE.map((d) => (
          <Path key={d.slice(0, 16)} d={d} fill={color} fillRule="evenodd" />
        ))}
      </Svg>
    </View>
  );
}
