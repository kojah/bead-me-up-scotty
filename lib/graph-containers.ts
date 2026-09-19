import type { Node } from '@xyflow/react';
import type { Bead } from './schema';
import { graphDependencyLayers } from './graph-epic';

// A tree needs one owner. Resolve malformed multi-parent/cyclic input
// deterministically, including tasks parented through another ordinary task.
export function epicOwners(beads: Bead[]): Map<string, string> {
  const byId = new Map(beads.map(b => [b.id, b]));
  const owners = new Map<string, string>();
  for (const bead of [...byId.values()].sort((a,b) => a.id.localeCompare(b.id))) {
    const seen = new Set([bead.id]);
    const pending = [bead.id];
    while (pending.length) {
      const current = byId.get(pending.shift()!)!;
      const parents = (current.dependencies ?? []).filter(d => d.type === 'parent-child')
        .map(d => d.depends_on_id).sort();
      for (const id of parents) {
        if (seen.has(id) || !byId.has(id)) continue;
        seen.add(id);
        if (byId.get(id)!.issue_type !== 'epic') { pending.push(id); continue; }
        let ancestor: string | undefined = id;
        const path = new Set([bead.id]);
        while (ancestor && !path.has(ancestor)) { path.add(ancestor); ancestor = owners.get(ancestor); }
        if (ancestor) continue;
        owners.set(bead.id, id);
        pending.length = 0;
        break;
      }
    }
  }
  return owners;
}

export function hideCompletedBeads(beads: Bead[]): Bead[] {
  const owners = epicOwners(beads);
  const keep = new Set(beads.filter(b => b.status !== 'closed').map(b => b.id));
  for (const id of [...keep]) {
    let parent = owners.get(id);
    while (parent && !keep.has(parent)) { keep.add(parent); parent = owners.get(parent); }
  }
  return beads.filter(b => keep.has(b.id));
}

export function containerLayout(beads: Bead[], allBeads: Bead[], onOpen: (id: string) => void,
  outsideIds = new Set<string>(), heights: ReadonlyMap<string, number> = new Map()): Node[] {
  const fullOwners = epicOwners(allBeads);
  const visibleIds = new Set(beads.map(b => b.id));
  const owners = new Map([...fullOwners].filter(([id, owner]) => visibleIds.has(id) && visibleIds.has(owner)));
  // Hierarchy is expressed by containment, not a dependency execution layer.
  const layers = graphDependencyLayers(beads.map(b => ({ ...b,
    dependencies: (b.dependencies ?? []).filter(d => d.type !== 'parent-child') })));
  const children = new Map<string, Bead[]>();
  for (const b of beads) {
    const owner = owners.get(b.id) ?? '';
    children.set(owner, [...(children.get(owner) ?? []), b]);
  }
  const boxes = new Map<string, { x: number; y: number; width: number; height: number }>();
  const order: Bead[] = [];
  function place(owner: string, startY: number): number {
    const members = (children.get(owner) ?? []).sort((a,b) => a.priority-b.priority || a.id.localeCompare(b.id));
    const colY = new Map<number, number>();
    for (const b of members.filter(b => b.issue_type !== 'epic')) {
      const layer = layers.get(b.id) ?? 0;
      const y = colY.get(layer) ?? startY;
      // Only a first-render placeholder. ResizeObserver supplies actual card
      // heights, independent of font metrics, title length, and wrapping.
      const height = heights.get(b.id) ?? 120;
      boxes.set(b.id, { x: layer * 290, y, width: 170, height });
      colY.set(layer, y + height + 24);
      order.push(b);
    }
    let y = Math.max(startY, ...colY.values());
    for (const epic of members.filter(b => b.issue_type === 'epic')) {
      order.push(epic); // React Flow requires parents before descendants.
      place(epic.id, y + 120);
      const childBoxes = (children.get(epic.id) ?? []).map(b => boxes.get(b.id)!);
      const x = childBoxes.length ? Math.min(...childBoxes.map(b => b.x)) - 28 : (layers.get(epic.id) ?? 0) * 290;
      const right = Math.max(x + 340, ...childBoxes.map(b => b.x + b.width + 28));
      const bottom = Math.max(y + 170, ...childBoxes.map(b => b.y + b.height + 28));
      boxes.set(epic.id, { x, y, width: right-x, height: bottom-y });
      y = bottom + 48;
    }
    return y;
  }
  place('', 0);
  return order.map(bead => {
    const box = boxes.get(bead.id)!;
    const parentId = owners.get(bead.id);
    const parent = parentId ? boxes.get(parentId)! : undefined;
    const descendants = allBeads.filter(b => {
      if (b.issue_type === 'epic') return false;
      let owner = fullOwners.get(b.id);
      while (owner) { if (owner === bead.id) return true; owner = fullOwners.get(owner); }
      return false;
    });
    const epic = bead.issue_type === 'epic';
    return { id: bead.id, type: epic ? 'epic' : 'bead', parentId,
      position: { x: box.x-(parent?.x ?? 0), y: box.y-(parent?.y ?? 0) },
      draggable: false,
      ...(epic ? { style: { width: box.width, height: box.height }, zIndex: -1 } : {}),
      data: { bead, onOpen, horizontal: true, outsideEpic: outsideIds.has(bead.id),
        total: descendants.length, completed: descendants.filter(b => b.status === 'closed').length } };
  });
}
