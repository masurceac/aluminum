import type { Item } from '@shared/api';

/** A set of ids plus a focus row (the one keyboard ops move from) and an anchor
 * (where a Shift-range started). Ids, not indexes: the store unshifts new items,
 * so an index silently slides onto a different row. */
export interface Selection {
  ids: ReadonlySet<string>;
  focusId: string | null;
  anchorId: string | null;
}

export const NO_SELECTION: Selection = { ids: new Set(), focusId: null, anchorId: null };

export function selectSingle(id: string | null): Selection {
  return {
    ids: new Set(id === null ? [] : [id]),
    focusId: id,
    anchorId: id,
  };
}

export function selectRange(vis: Item[], sel: Selection, toId: string): Selection {
  const from = sel.anchorId ?? toId;
  const a = vis.findIndex((i) => i.id === from);
  const b = vis.findIndex((i) => i.id === toId);
  if (a === -1 || b === -1) return selectSingle(toId);
  const ids = new Set<string>();
  for (let i = Math.min(a, b); i <= Math.max(a, b); i++) ids.add(vis[i].id);
  return { ids, focusId: toId, anchorId: sel.anchorId ?? toId };
}

/** Ctrl/Cmd-click: toggle membership; focus and anchor follow the click */
export function toggleSelected(sel: Selection, id: string): Selection {
  const ids = new Set(sel.ids);
  if (ids.has(id)) ids.delete(id);
  else ids.add(id);
  return { ids, focusId: id, anchorId: id };
}

/** drop ids that no longer exist in the store */
export function pruneSelection(sel: Selection, alive: ReadonlySet<string>): Selection {
  const ids = new Set([...sel.ids].filter((id) => alive.has(id)));
  return {
    ids,
    focusId: sel.focusId !== null && alive.has(sel.focusId) ? sel.focusId : null,
    anchorId: sel.anchorId !== null && alive.has(sel.anchorId) ? sel.anchorId : null,
  };
}

/** selected items in display order — Copy as List and Merge depend on it */
export function selectedItems(vis: Item[], sel: Selection): Item[] {
  return vis.filter((i) => sel.ids.has(i.id));
}

export function selectionText(vis: Item[], sel: Selection): string {
  return selectedItems(vis, sel)
    .map((i) => i.text)
    .join('\n');
}
