/**
 * 审批流连线的方向箭头(p3b 遗留:marker 里 `oklch(var())` 解析不到,于是没箭头)。
 * 现在是 route 边里内联的 `<polygon>`:尖端在目标端口,填充 = 边的 stroke(ink3 token),
 * 不经 `<marker>` / `<defs>`。
 */
import { render } from "@testing-library/react";
import type { ComponentType } from "react";
import { Position } from "@xyflow/react";
import { edgeTypes } from "@/src/components/workflow/EditableNode";
import { edgeArrow } from "@/src/components/workflow/workflowEditorGraph";

jest.mock("@xyflow/react", () => {
  const actual = jest.requireActual("@xyflow/react");
  return {
    ...actual,
    BaseEdge: ({ path, style }: { path: string; style?: Record<string, unknown> }) => (
      <path data-edge-line="" d={path} style={style} />
    ),
    EdgeLabelRenderer: () => null,
  };
});
jest.mock("@/src/contexts/I18nContext", () => ({ useI18n: () => ({ t: (k: string) => k }) }));

const Route = edgeTypes.route as ComponentType<Record<string, unknown>>;

function draw(targetPosition: Position) {
  const { container } = render(
    <svg>
      <Route
        id="e1"
        source="a"
        target="b"
        sourceX={100}
        sourceY={0}
        targetX={100}
        targetY={80}
        sourcePosition={Position.Bottom}
        targetPosition={targetPosition}
        style={edgeArrow().style}
        data={{}}
      />
    </svg>
  );
  return container;
}

describe("route edge arrowhead", () => {
  it("draws an inline arrow whose tip is the target port, filled with the edge's own token", () => {
    const svg = draw(Position.Top);
    const arrow = svg.querySelector("polygon[data-edge-arrow]") as SVGPolygonElement;
    expect(arrow).not.toBeNull();
    expect(arrow.getAttribute("points")).toBe("96,74 104,74 100,80");
    expect(arrow.getAttribute("transform")).toBe("rotate(0 100 80)");
    expect(arrow.style.fill).toBe(edgeArrow().style.stroke);
    // Absence: no <marker>/<defs> — that is where the var() stopped resolving.
    expect(svg.querySelector("marker, defs")).toBeNull();
    expect(svg.querySelector("[data-edge-line]")?.getAttribute("marker-end")).toBeNull();
  });

  it("turns to face the side it enters from", () => {
    const at = (p: Position) => draw(p).querySelector("polygon[data-edge-arrow]")?.getAttribute("transform");
    expect([Position.Right, Position.Bottom, Position.Left].map(at)).toEqual([
      "rotate(90 100 80)",
      "rotate(180 100 80)",
      "rotate(270 100 80)",
    ]);
  });
});
