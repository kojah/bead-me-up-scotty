import type { Node } from "@xyflow/react";
import { siblingLevels } from "./graph-levels";
import type { GraphBox } from "./graph-routing";
import type { Bead } from "./schema";

/** Measured rows, bounded parallel columns, and recursive epic containment. */
export function topDownLayout(nodes: Node[], beads: Bead[], columns: number): Node[] {
  const byId = new Map(beads.map((b) => [b.id, b]));
  const owners = new Map(nodes.filter((n) => n.parentId).map((n) => [n.id, n.parentId!]));
  const children = new Map<string, Node[]>();
  const boxes = new Map<string, GraphBox>();
  for (const node of nodes) {
    const parent = node.parentId ?? "";
    children.set(parent, [...(children.get(parent) ?? []), node]);
  }
  function size(node: Node): { width: number; height: number } {
    if (node.type !== "epic") {
      const box = node.data.graphBox as GraphBox;
      return { width: box.width, height: box.height };
    }
    const group = place(node.id);
    return { width: Math.max(340, group.width + 56), height: Math.max(170, group.height + 148) };
  }
  function place(parent: string) {
    const members = children.get(parent) ?? [];
    const memberNodes = new Map(members.map((n) => [n.id, n]));
    const levels = siblingLevels(
      members.map((n) => byId.get(n.id)!),
      beads,
      owners,
    );
    const inset = parent ? 28 : 0,
      top = parent ? 120 : 0;
    let y = top,
      width = 0;
    for (const level of levels) {
      for (let offset = 0; offset < level.length; offset += columns) {
        const row = placeRow(
          level.slice(offset, offset + columns).map((b) => memberNodes.get(b.id)!),
          inset,
          y,
        );
        width = Math.max(width, row.width);
        y += row.height + 64;
      }
    }
    return { width, height: Math.max(0, y - 64 - top) };
  }
  function placeRow(members: Node[], inset: number, y: number) {
    let x = inset,
      height = 0;
    for (const node of members) {
      const dimensions = size(node);
      boxes.set(node.id, { x, y, ...dimensions });
      x += dimensions.width + 48;
      height = Math.max(height, dimensions.height);
    }
    return { width: x - 48 - inset, height };
  }
  place("");
  const absolute = new Map<string, GraphBox>();
  return nodes.map((node) => {
    const box = boxes.get(node.id)!;
    const parent = node.parentId ? absolute.get(node.parentId) : undefined;
    const graphBox = { ...box, x: box.x + (parent?.x ?? 0), y: box.y + (parent?.y ?? 0) };
    absolute.set(node.id, graphBox);
    return {
      ...node,
      position: { x: box.x, y: box.y },
      ...(node.type === "epic"
        ? { style: { ...node.style, width: box.width, height: box.height } }
        : {}),
      data: { ...node.data, graphBox, horizontal: false },
    };
  });
}
