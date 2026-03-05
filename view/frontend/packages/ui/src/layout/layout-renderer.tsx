"use no memo";

import { useContext } from "react";

import { AnimatedSplit } from "./animated-split";
import { LeafRendererContext } from "./contexts";
import type { LayoutNode, NodePath } from "./types";

const EMPTY_PATH: NodePath = [];

export function LayoutRenderer({ node, path = EMPTY_PATH }: { node: LayoutNode; path?: NodePath }) {
  const LeafComponent = useContext(LeafRendererContext);

  if (node.type === "pane") {
    if (!LeafComponent) return null;
    const key =
      node.content.type === "component" ? node.content.componentId : `${path.join("-")}:${node.id}`;
    return <LeafComponent key={key} id={node.id} path={path} content={node.content} />;
  }

  return (
    <AnimatedSplit
      path={path}
      direction={node.direction}
      targetRatio={node.ratio}
      first={<LayoutRenderer node={node.first} path={[...path, "first"]} />}
      second={<LayoutRenderer node={node.second} path={[...path, "second"]} />}
    />
  );
}
