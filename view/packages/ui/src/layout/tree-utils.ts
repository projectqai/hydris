import type { LayoutNode, NodePath, PaneContent, PaneId, PaneLayout } from "./types";

let nextCounter = 0;

const VALID_CONTENT_TYPES = new Set(["component", "iframe", "camera", "empty"]);
const VALID_DIRECTIONS = new Set(["horizontal", "vertical"]);
const MAX_TREE_DEPTH = 10;

export function validateLayoutNode(
  node: unknown,
  validComponentIds?: Set<string>,
  depth = 0,
): LayoutNode | null {
  if (!node || typeof node !== "object" || depth > MAX_TREE_DEPTH) return null;
  const n = node as Record<string, unknown>;

  if (n.type === "pane") {
    if (typeof n.id !== "string") return null;
    const c = n.content;
    if (!c || typeof c !== "object") return null;
    const content = c as Record<string, unknown>;
    if (!VALID_CONTENT_TYPES.has(content.type as string)) return null;

    let paneContent: PaneContent;
    switch (content.type) {
      case "component": {
        if (typeof content.componentId !== "string") return null;
        if (validComponentIds && !validComponentIds.has(content.componentId)) return null;
        paneContent = { type: "component", componentId: content.componentId };
        break;
      }
      case "iframe": {
        if (typeof content.url !== "string") return null;
        paneContent = { type: "iframe", url: content.url };
        break;
      }
      case "camera": {
        if (typeof content.entityId !== "string") return null;
        paneContent = { type: "camera", entityId: content.entityId };
        break;
      }
      case "empty":
        paneContent = { type: "empty" };
        break;
      default:
        return null;
    }

    return { type: "pane", id: n.id, content: paneContent };
  }

  if (n.type === "split") {
    if (!VALID_DIRECTIONS.has(n.direction as string)) return null;
    const ratio = typeof n.ratio === "number" ? Math.min(0.95, Math.max(0.05, n.ratio)) : 0.5;
    const first = validateLayoutNode(n.first, validComponentIds, depth + 1);
    const second = validateLayoutNode(n.second, validComponentIds, depth + 1);
    if (!first || !second) return null;
    return {
      type: "split",
      direction: n.direction as "horizontal" | "vertical",
      ratio,
      first,
      second,
    };
  }

  return null;
}

export function collectPaneIds(node: LayoutNode): PaneId[] {
  if (node.type === "pane") return [node.id];
  if (!node.first || !node.second) return [];
  return [...collectPaneIds(node.first), ...collectPaneIds(node.second)];
}

export function getNextPaneId(tree: LayoutNode): PaneId {
  const used = new Set(collectPaneIds(tree));
  nextCounter = Math.max(nextCounter, used.size);
  while (used.has(`pane-${++nextCounter}`));
  return `pane-${nextCounter}`;
}

export function cloneTree(node: LayoutNode): LayoutNode {
  if (node.type === "pane") return { ...node };
  if (!node.first || !node.second) return node;
  return { ...node, first: cloneTree(node.first), second: cloneTree(node.second) };
}

export function replaceAtPath(
  root: LayoutNode,
  path: NodePath,
  replacement: LayoutNode,
): LayoutNode {
  if (path.length === 0) return replacement;
  if (root.type === "pane") return root;
  if (!root.first || !root.second) return root;
  const [step, ...rest] = path;
  return {
    ...root,
    first: step === "first" ? replaceAtPath(root.first, rest, replacement) : root.first,
    second: step === "second" ? replaceAtPath(root.second, rest, replacement) : root.second,
  };
}

export function getNodeAtPath(root: LayoutNode, path: NodePath): LayoutNode {
  if (path.length === 0) return root;
  if (root.type === "pane") return root;
  if (!root.first || !root.second) return root;
  const [step, ...rest] = path;
  return getNodeAtPath(step === "first" ? root.first : root.second, rest);
}

export function findPaneById(node: LayoutNode, id: PaneId): PaneLayout | null {
  if (node.type === "pane") return node.id === id ? node : null;
  if (!node.first || !node.second) return null;
  return findPaneById(node.first, id) ?? findPaneById(node.second, id);
}

export function swapPaneIds(root: LayoutNode, a: PaneId, b: PaneId): LayoutNode {
  const paneA = findPaneById(root, a);
  const paneB = findPaneById(root, b);
  if (!paneA || !paneB) return root;

  const snapA: PaneLayout = { ...paneA };
  const snapB: PaneLayout = { ...paneB };

  function replace(node: LayoutNode): LayoutNode {
    if (node.type === "pane") {
      if (node.id === a) return snapB;
      if (node.id === b) return snapA;
      return node;
    }
    if (!node.first || !node.second) return node;
    return { ...node, first: replace(node.first), second: replace(node.second) };
  }
  return replace(root);
}

export function countPanes(node: LayoutNode): number {
  if (node.type === "pane") return 1;
  if (!node.first || !node.second) return 0;
  return countPanes(node.first) + countPanes(node.second);
}

export function getStructureKey(node: LayoutNode): string {
  if (node.type === "pane") {
    const c = node.content;
    if (c.type === "component") return `p:${c.componentId}`;
    if (c.type === "camera") return `p:cam(${c.entityId})`;
    if (c.type === "iframe") return `p:url(${c.url})`;
    return "p:empty";
  }
  if (!node.first || !node.second) return "p:empty";
  return `s:${node.direction}(${getStructureKey(node.first)},${getStructureKey(node.second)})`;
}
