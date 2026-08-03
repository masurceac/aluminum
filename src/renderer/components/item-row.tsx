import * as React from 'react';
import { ChevronDown, Copy, Pin, X } from 'lucide-react';
import type { Item } from '@shared/api';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu';
import { Textarea } from '@/components/ui/textarea';
import { MONO_RE, age, highlight } from '@/lib/items';
import { cn } from '@/lib/utils';

interface ItemRowProps {
  item: Item;
  selected: boolean;
  expanded: boolean;
  editing: boolean;
  /** true once the text is measured as actually cut off (see the effect below) */
  clamped: boolean;
  entering: boolean;
  query: string;
  onClampedChange: (id: string, clamped: boolean) => void;
  onClick: (event: React.MouseEvent) => void;
  onContextMenu: () => void;
  onDoubleClick: () => void;
  onToggleDone: (done: boolean) => void;
  onToggleExpand: () => void;
  onCopy: () => void;
  onDelete: () => void;
  onDragStart: (event: React.DragEvent) => void;
  onCommitEdit: (text: string) => void;
  onCancelEdit: () => void;
  onContextMenuOpenChange: (open: boolean) => void;
  menu: React.ReactNode;
}

export function ItemRow({
  item,
  selected,
  expanded,
  editing,
  clamped,
  entering,
  query,
  onClampedChange,
  onClick,
  onContextMenu,
  onDoubleClick,
  onToggleDone,
  onToggleExpand,
  onCopy,
  onDelete,
  onDragStart,
  onCommitEdit,
  onCancelEdit,
  onContextMenuOpenChange,
  menu,
}: ItemRowProps) {
  const textRef = React.useRef<HTMLDivElement>(null);
  const mono = MONO_RE.test(item.text);

  // A row advertises the peek affordance only when its text is genuinely cut
  // off. That is a measurement, not something the text can be asked for:
  // scrollHeight sees the full content, clientHeight sees the clamp. Runs on
  // every render because expanding, filtering, or a resize all change it.
  React.useLayoutEffect(() => {
    const el = textRef.current;
    if (el) onClampedChange(item.id, el.scrollHeight > el.clientHeight + 1);
  });

  // stop clicks on the controls from also selecting / activating the row
  const swallow = {
    onClick: (e: React.MouseEvent) => e.stopPropagation(),
    onDoubleClick: (e: React.MouseEvent) => e.stopPropagation(),
  };

  return (
    <ContextMenu modal={false} onOpenChange={onContextMenuOpenChange}>
      <ContextMenuTrigger asChild>
        <li
          role="option"
          aria-selected={selected}
          data-id={item.id}
          draggable={!editing}
          onDragStart={onDragStart}
          onClick={onClick}
          // runs before Radix opens the menu, so the menu that appears is
          // already the one for this row's selection
          onContextMenu={onContextMenu}
          onDoubleClick={onDoubleClick}
          className={cn(
            'group relative flex min-h-10 shrink-0 cursor-default items-start gap-2.5 rounded-lg py-2 pr-1.5 pl-3 transition-colors',
            'hover:bg-accent/60',
            selected && 'bg-primary/10 hover:bg-primary/10',
            entering && 'animate-row-enter',
          )}
        >
          {/* accent rail — the selection indicator that hover alone never gets */}
          <span
            aria-hidden
            className={cn(
              'absolute top-2 bottom-2 left-1 w-[2.5px] rounded-full bg-primary opacity-0 transition-opacity',
              selected && 'opacity-100',
            )}
          />

          {/* A CIRCLE, deliberately: a square checkbox reads as "select this
            * row" (mail clients, file managers); the ring that fills with a
            * check is the task-complete idiom (Reminders, Todoist). */}
          <Checkbox
            checked={item.done}
            aria-label={item.done ? 'Mark not done' : 'Mark as done'}
            className="mt-0.5 size-[17px] rounded-full border-[1.5px] data-[state=checked]:animate-in data-[state=checked]:zoom-in-75"
            onCheckedChange={(checked) => onToggleDone(checked === true)}
            {...swallow}
          />

          {editing ? (
            <RowEditor
              defaultValue={item.text}
              mono={mono}
              onCommit={onCommitEdit}
              onCancel={onCancelEdit}
            />
          ) : (
            <div
              ref={textRef}
              className={cn(
                'min-w-0 flex-1 pt-px leading-[1.42] break-words select-none',
                // rows never grow on mere selection, so arrowing through the
                // list can't reflow it — only an explicit peek does
                expanded ? 'line-clamp-8' : 'line-clamp-2',
                mono && 'font-mono text-xs break-all',
                item.done && 'text-muted-foreground line-through decoration-muted-foreground/55',
              )}
            >
              {highlight(item.text, query).map((run, i) =>
                run.match ? (
                  <mark key={i} className="rounded-[3px] bg-primary/25 px-px text-inherit">
                    {run.text}
                  </mark>
                ) : (
                  <React.Fragment key={i}>{run.text}</React.Fragment>
                ),
              )}
            </div>
          )}

          {/* trailing column: meta (pin + age) at rest, actions when live */}
          <span
            className={cn('relative -mt-px h-6 shrink-0', clamped || expanded ? 'w-21' : 'w-15')}
          >
            <span
              className={cn(
                'pointer-events-none absolute inset-0 flex items-center justify-end gap-1.5 pr-1.5 text-xs text-muted-foreground tabular-nums transition-opacity',
                'group-hover:opacity-0',
                selected && 'opacity-0',
              )}
            >
              {item.pinned && <Pin className="size-3" />}
              {age(item.createdAt)}
            </span>

            <span
              className={cn(
                'pointer-events-none absolute inset-0 flex items-center justify-end opacity-0 transition-opacity',
                'group-hover:pointer-events-auto group-hover:opacity-100',
                selected && 'pointer-events-auto opacity-100',
              )}
              {...swallow}
            >
              {(clamped || expanded) && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6 text-muted-foreground hover:text-primary"
                  aria-label={expanded ? 'Show less' : 'Show more'}
                  aria-expanded={expanded}
                  onClick={onToggleExpand}
                >
                  <ChevronDown className={cn('size-3.5 transition-transform', expanded && 'rotate-180')} />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="size-6 text-muted-foreground hover:text-primary"
                aria-label="Copy item"
                onClick={onCopy}
              >
                <Copy className="size-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-6 text-muted-foreground hover:text-destructive"
                aria-label="Delete item"
                onClick={onDelete}
              >
                <X className="size-3.5" />
              </Button>
            </span>
          </span>
        </li>
      </ContextMenuTrigger>
      {menu}
    </ContextMenu>
  );
}

interface RowEditorProps {
  defaultValue: string;
  mono: boolean;
  onCommit: (text: string) => void;
  onCancel: () => void;
}

/** Replaces the text block in place, at the same metrics. Uncontrolled on
 * purpose: the list re-renders on a 30s timer to refresh ages, and an
 * uncontrolled textarea keeps the caret and the half-typed text through it. */
function RowEditor({ defaultValue, mono, onCommit, onCancel }: RowEditorProps) {
  const ref = React.useRef<HTMLTextAreaElement>(null);
  // Escape is a real cancel; every other exit (blur, Enter) saves. The ref
  // keeps the blur handler from re-committing what Escape just discarded.
  const cancelled = React.useRef(false);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  return (
    <Textarea
      ref={ref}
      defaultValue={defaultValue}
      rows={Math.min(6, defaultValue.split('\n').length)}
      className={cn(
        'min-h-0 flex-1 resize-none border-0 bg-transparent p-0 text-[13.5px] leading-[1.42] shadow-none caret-primary focus-visible:ring-0 dark:bg-transparent',
        mono && 'font-mono text-xs',
      )}
      onKeyDown={(e) => {
        e.stopPropagation(); // typing must not trigger the list shortcuts
        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
          e.preventDefault();
          onCommit(e.currentTarget.value);
        } else if (e.key === 'Escape') {
          cancelled.current = true;
          onCancel();
        }
      }}
      // click-away saves; explicit Escape is the cancel path
      onBlur={(e) => {
        if (!cancelled.current) onCommit(e.currentTarget.value);
      }}
    />
  );
}
