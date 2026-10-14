import type { Edge, Node } from "@xyflow/react";
import type { GraphDirection } from "./graph-direction";
import { siblingLevels } from "./graph-levels";
import type { GraphBox } from "./graph-routing";
import { type ReadableLink, readableLinks, routeReadableLinks } from "./readable-connections";
import { readableGraph } from "./readable-graph";
import type { Bead } from "./schema";

export type FlowBead = Node<
  {
    bead: Bead;
    direction: GraphDirection;
    group: boolean;
    collapsed: boolean;
    count: number;
    toggle?: () => void;
  },
  "bead"
>;
export type FlowDependency = Edge<{ path?: string }, "dependency">;
type Tile = { bead: Bead; width: number; height: number; children: Placed[] };
type Placed = Tile & { x: number; y: number };
const WIDTH = 220;
const HEIGHT = 72;
const HEADER = 40;
const PADDING = 20;
const GAP = 40;

function placeLevels(levels: Tile[][], direction: GraphDirection) {
  const down = direction === "down";
  const extent = (tile: Tile) => (down ? tile.width : tile.height);
  const depth = (tile: Tile) => (down ? tile.height : tile.width);
  const spans = levels.map((level) => level.reduce((sum, tile) => sum + extent(tile) + GAP, -GAP));
  const span = Math.max(down ? WIDTH : HEIGHT, ...spans);
  const children: Placed[] = [];
  let cursor = 0;
  levels.forEach((level, index) => {
    let lane = (span - spans[index]) / 2;
    for (const tile of level) {
      children.push({ ...tile, x: down ? lane : cursor, y: down ? cursor : lane });
      lane += extent(tile) + GAP;
    }
    cursor += Math.max(0, ...level.map(depth)) + GAP * 2;
  });
  const length = Math.max(HEIGHT, cursor - GAP * 2);
  return { children, width: down ? span : length, height: down ? length : span };
}

/** Collapsed groups represent their hidden descendants only for aggregate dependency edges. */
function projectedLinks(
  visible: Bead[],
  owners: Map<string, string>,
  present: Set<string>,
  includeRelated: boolean,
) {
  const representative = (id: string): string | undefined => {
    let current: string | undefined = id;
    while (current && !present.has(current)) current = owners.get(current);
    return current;
  };
  const links = new Map<string, ReadableLink>();
  for (const link of readableLinks(visible, includeRelated)) {
    const source = representative(link.source),
      target = representative(link.target);
    if (!source || !target || source === target) continue;
    const key = JSON.stringify([source, target]);
    const previous = links.get(key);
    links.set(key, {
      source,
      target,
      types: [...new Set([...(previous?.types ?? []), ...link.types])],
    });
  }
  return [...links.values()];
}

export function buildFlowGraph(
  visible: Bead[],
  all: Bead[],
  outsideIds: ReadonlySet<string>,
  collapsed: ReadonlySet<string>,
  direction: GraphDirection,
  includeRelated = false,
) {
  const model = readableGraph(visible, all, outsideIds);
  const arrange = (items: Bead[]): ReturnType<typeof placeLevels> => {
    const tiles = new Map(
      items.map((bead) => {
        const members = model.children.get(bead.id) ?? [];
        if (bead.issue_type !== "epic" || collapsed.has(bead.id) || !members.length) {
          return [bead.id, { bead, width: WIDTH, height: HEIGHT, children: [] } satisfies Tile];
        }
        const inside = arrange(members);
        return [
          bead.id,
          {
            bead,
            width: inside.width + PADDING * 2,
            height: inside.height + HEADER + PADDING * 2,
            children: inside.children.map((child) => ({
              ...child,
              x: child.x + PADDING,
              y: child.y + HEADER + PADDING,
            })),
          } satisfies Tile,
        ];
      }),
    );
    return placeLevels(
      siblingLevels(items, visible, model.owners).map((level) =>
        level.map((b) => tiles.get(b.id)!),
      ),
      direction,
    );
  };
  const layout = arrange([...(model.children.get("") ?? []), ...model.outside]);
  const nodes: FlowBead[] = [];
  const boxes = new Map<string, GraphBox>();
  const visit = (tiles: Placed[], parentId?: string, offset = { x: 0, y: 0 }) => {
    for (const tile of tiles) {
      const group = tile.children.length > 0;
      nodes.push({
        id: tile.bead.id,
        type: "bead",
        parentId,
        extent: parentId ? "parent" : undefined,
        position: { x: tile.x, y: tile.y },
        width: tile.width,
        height: tile.height,
        style: { width: tile.width, height: tile.height },
        draggable: false,
        data: {
          bead: tile.bead,
          direction,
          group,
          collapsed: collapsed.has(tile.bead.id),
          count: model.progress.get(tile.bead.id)?.total ?? 0,
        },
      });
      const absolute = { x: offset.x + tile.x, y: offset.y + tile.y };
      boxes.set(tile.bead.id, {
        ...absolute,
        width: tile.width,
        height: group ? HEADER : tile.height,
      });
      visit(tile.children, tile.bead.id, absolute);
    }
  };
  visit(layout.children);
  const links = projectedLinks(
    visible,
    model.owners,
    new Set(nodes.map((node) => node.id)),
    includeRelated,
  );
  const key = (link: ReadableLink) => JSON.stringify([link.source, link.target]);
  const paths = new Map(
    routeReadableLinks(links, boxes, [], direction).map((link) => [key(link), link.path]),
  );
  const edges: FlowDependency[] = links.map((link) => ({
    id: key(link),
    type: "dependency",
    source: link.source,
    target: link.target,
    data: { path: paths.get(key(link)) },
    ariaLabel: `${link.source} → ${link.target}: ${link.types.join(", ")}`,
  }));
  return { nodes, edges };
}
