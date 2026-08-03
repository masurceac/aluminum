import type { Item } from '@shared/api';

/** code, URLs, and paths read better in mono and must break anywhere */
export const MONO_RE = /^(https?:\/\/|[\w-]+\.[a-z]{2,}\/)|[{}();=><]/;

/** compact age: now, 5m, 3h, 2d — the overlay is glanced at, not studied */
export function age(createdAt: number | undefined): string {
  if (!createdAt) return '';
  const s = Math.max(0, (Date.now() - createdAt) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

/** the section a row belongs to when the list is unfiltered */
export function sectionOf(item: Item): string {
  if (item.done) return 'Done'; // done rows sit at the list's bottom
  if (item.pinned) return 'Pinned';
  const startOfToday = new Date().setHours(0, 0, 0, 0);
  if (!item.createdAt || item.createdAt >= startOfToday) return 'Today';
  if (item.createdAt >= startOfToday - 86_400_000) return 'Yesterday';
  return 'Earlier';
}

/** The rows currently shown: pinned first, then the stream, with done items
 * sunk to the bottom (completion beats pinning), narrowed by the live filter.
 * Every partition keeps store order, which is newest-first. */
export function visibleItems(items: Item[], query: string): Item[] {
  const q = query.trim().toLowerCase();
  const base = q ? items.filter((i) => i.text.toLowerCase().includes(q)) : items;
  const undone = base.filter((i) => !i.done);
  return [
    ...undone.filter((i) => i.pinned),
    ...undone.filter((i) => !i.pinned),
    ...base.filter((i) => i.done),
  ];
}

export interface TextRun {
  text: string;
  /** true when this run is a hit for the live filter, so the row can <mark> it */
  match: boolean;
}

/** split an item's text into alternating plain / filter-match runs */
export function highlight(text: string, query: string): TextRun[] {
  const q = query.trim().toLowerCase();
  if (!q) return [{ text, match: false }];
  const runs: TextRun[] = [];
  let rest = text;
  while (rest.length > 0) {
    const at = rest.toLowerCase().indexOf(q);
    if (at === -1) {
      runs.push({ text: rest, match: false });
      break;
    }
    if (at > 0) runs.push({ text: rest.slice(0, at), match: false });
    runs.push({ text: rest.slice(at, at + q.length), match: true });
    rest = rest.slice(at + q.length);
  }
  return runs;
}
