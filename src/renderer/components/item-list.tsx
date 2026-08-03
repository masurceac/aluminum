import * as React from 'react';
import type { Item } from '@shared/api';
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from '@/components/ui/context-menu';
import { ItemRow } from '@/components/item-row';
import { isMac } from '@/lib/api';
import { sectionOf } from '@/lib/items';
import type { Selection } from '@/lib/selection';
import { cn } from '@/lib/utils';

export interface ItemListActions {
  onSelectClick: (item: Item, event: React.MouseEvent) => void;
  onRowContextMenu: (item: Item) => void;
  onActivate: (item: Item) => void;
  onToggleDone: (item: Item, done: boolean) => void;
  onToggleExpand: (item: Item) => void;
  onCopyItem: (item: Item) => void;
  onDelete: (items: Item[]) => void;
  onDragStart: (item: Item, event: React.DragEvent) => void;
  onCommitEdit: (item: Item, text: string) => void;
  onCancelEdit: () => void;
  onStartEdit: (item: Item) => void;
  onCopySelection: () => void;
  onSetDoneAll: (items: Item[], done: boolean) => void;
  onTogglePin: (item: Item) => void;
  onMerge: (items: Item[]) => void;
  onClearDone: () => void;
  onContextMenuOpenChange: (open: boolean) => void;
  onBackgroundClick: () => void;
  onClampedChange: (id: string, clamped: boolean) => void;
}

interface ItemListProps extends ItemListActions {
  ref: React.RefObject<HTMLUListElement | null>;
  items: Item[];
  visible: Item[];
  selection: Selection;
  selected: Item[];
  expandedId: string | null;
  editingId: string | null;
  enterIds: ReadonlySet<string>;
  clampedIds: ReadonlySet<string>;
  query: string;
  filtering: boolean;
}

export function ItemList({
  ref,
  items,
  visible,
  selection,
  selected,
  expandedId,
  editingId,
  enterIds,
  clampedIds,
  query,
  filtering,
  onBackgroundClick,
  ...actions
}: ItemListProps) {
  const empty = items.length === 0 || visible.length === 0;
  const doneCount = items.filter((i) => i.done).length;

  return (
    <ul
      ref={ref}
      role="listbox"
      aria-label="Captured items"
      // click-away deselect: a click that lands in the list but not on a row
      // (a group header, the empty space below the last item) clears the
      // selection — the mouse counterpart of ArrowUp off the top
      onClick={(e) => {
        if (e.target instanceof Element && e.target.closest('li[role="option"]')) return;
        onBackgroundClick();
      }}
      className={cn(
        'scroll-subtle mx-auto flex w-full max-w-[752px] flex-1 flex-col gap-px overflow-y-auto px-2 pb-2.5 [overscroll-behavior:contain]',
        empty && 'justify-center',
      )}
    >
      {items.length === 0 ? (
        <EmptyState keycaps>
          Hold {isMac ? 'Cmd' : 'Ctrl'} and double-tap Shift in any app to capture selected text
        </EmptyState>
      ) : visible.length === 0 ? (
        <EmptyState>No matches for “{query.trim()}”</EmptyState>
      ) : (
        renderRows()
      )}
    </ul>
  );

  function renderRows(): React.ReactNode {
    const rows: React.ReactNode[] = [];
    let currentSection: string | null = null;

    for (const item of visible) {
      if (!filtering) {
        const section = sectionOf(item);
        if (section !== currentSection) {
          currentSection = section;
          // "Today" as the very first header is noise — everything is today
          // until the list spans days or has pins
          if (!(section === 'Today' && rows.length === 0)) {
            rows.push(
              <li
                key={`section-${section}`}
                role="presentation"
                className="px-3 pt-2.5 pb-1 text-[10.5px] font-semibold tracking-[0.1em] text-muted-foreground/80 uppercase select-none"
              >
                {section}
              </li>,
            );
          }
        }
      }

      rows.push(
        <ItemRow
          key={item.id}
          item={item}
          selected={selection.ids.has(item.id)}
          expanded={expandedId === item.id}
          editing={editingId === item.id}
          clamped={clampedIds.has(item.id)}
          entering={enterIds.has(item.id)}
          query={filtering ? query : ''}
          onClampedChange={actions.onClampedChange}
          onClick={(e) => actions.onSelectClick(item, e)}
          onContextMenu={() => actions.onRowContextMenu(item)}
          onDoubleClick={() => actions.onActivate(item)}
          onToggleDone={(done) => actions.onToggleDone(item, done)}
          onToggleExpand={() => actions.onToggleExpand(item)}
          onCopy={() => actions.onCopyItem(item)}
          onDelete={() => actions.onDelete([item])}
          onDragStart={(e) => actions.onDragStart(item, e)}
          onCommitEdit={(text) => actions.onCommitEdit(item, text)}
          onCancelEdit={actions.onCancelEdit}
          onContextMenuOpenChange={actions.onContextMenuOpenChange}
          menu={renderMenu()}
        />,
      );
    }
    return rows;
  }

  /** The menu acts on the SELECTION, not on the row that was right-clicked —
   * right-clicking an unselected row selects it first (see onSelectClick). */
  function renderMenu(): React.ReactNode {
    const chosen = selected;
    const multi = chosen.length > 1;
    const allDone = chosen.length > 0 && chosen.every((i) => i.done);

    return (
      <ContextMenuContent className="w-48">
        <ContextMenuItem onSelect={actions.onCopySelection}>
          {multi ? `Copy as list (${chosen.length})` : 'Copy'}
        </ContextMenuItem>
        {!multi && chosen[0] && (
          <ContextMenuItem onSelect={() => actions.onStartEdit(chosen[0])}>Edit</ContextMenuItem>
        )}

        <ContextMenuSeparator />

        <ContextMenuItem onSelect={() => actions.onSetDoneAll(chosen, !allDone)}>
          {allDone ? 'Mark not done' : 'Mark as done'}
        </ContextMenuItem>
        {!multi && chosen[0] && (
          <ContextMenuItem onSelect={() => actions.onTogglePin(chosen[0])}>
            {chosen[0].pinned ? 'Unpin' : 'Pin'}
          </ContextMenuItem>
        )}
        {multi && (
          <ContextMenuItem onSelect={() => actions.onMerge(chosen)}>
            Merge {chosen.length} items
          </ContextMenuItem>
        )}

        <ContextMenuSeparator />

        {doneCount > 0 && (
          <ContextMenuItem variant="destructive" onSelect={actions.onClearDone}>
            Clear done ({doneCount})
          </ContextMenuItem>
        )}
        <ContextMenuItem variant="destructive" onSelect={() => actions.onDelete(chosen)}>
          {multi ? `Delete ${chosen.length} items` : 'Delete'}
        </ContextMenuItem>
      </ContextMenuContent>
    );
  }
}

/** hint text, not a choice: kept out of the listbox's option set */
function EmptyState({ children, keycaps }: { children: React.ReactNode; keycaps?: boolean }) {
  return (
    <li
      role="presentation"
      className="flex flex-col items-center gap-3.5 px-8 pb-3.5 text-center text-[13px] leading-relaxed text-balance text-muted-foreground"
    >
      {keycaps && (
        <span className="flex items-center gap-1.5">
          {[isMac ? '⌘ Cmd' : 'Ctrl', '⇧ Shift', '⇧ Shift'].map((key, i) => (
            <kbd
              key={i}
              className="flex h-6 items-center rounded-md border bg-muted px-2.5 font-sans text-xs font-medium"
            >
              {key}
            </kbd>
          ))}
        </span>
      )}
      <span>{children}</span>
    </li>
  );
}
