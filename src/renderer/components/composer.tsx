import type * as React from 'react';
import { Plus, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

export type InputMode = 'add' | 'search';

/* The mode decides what Enter does, so which half is active has to be legible
 * at a glance. shadcn's default "on" state is a muted grey that all but
 * disappears over the dark surface — the accent tint is the readable one. */
const MODE_ITEM =
  'h-9 w-9 data-[state=on]:bg-primary/15 data-[state=on]:text-primary hover:text-foreground';

interface ComposerProps {
  mode: InputMode;
  onModeChange: (mode: InputMode) => void;
  value: string;
  onValueChange: (value: string) => void;
  onKeyDown: React.KeyboardEventHandler<HTMLInputElement>;
  onFocus: () => void;
  onBlur: () => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  disabled?: boolean;
}

/** One input, two jobs, explicit mode: the segmented toggle beside it decides
 * whether typing drafts a new item (default) or live-filters the list — so
 * search can never accidentally create an item, and vice versa. */
export function Composer({
  mode,
  onModeChange,
  value,
  onValueChange,
  onKeyDown,
  onFocus,
  onBlur,
  inputRef,
  disabled,
}: ComposerProps) {
  return (
    <div className="mx-auto flex w-full max-w-[752px] shrink-0 gap-1.5 px-2 pb-2">
      <ToggleGroup
        type="single"
        value={mode}
        // '' arrives when the active item is pressed again; the input always
        // has a mode, so ignore it rather than falling back to a default
        onValueChange={(next) => next && onModeChange(next as InputMode)}
        variant="outline"
        className="h-9 shrink-0"
      >
        {/* Deliberately NOT wrapped in <Tooltip>: TooltipTrigger and
          * ToggleGroupItem both write data-state to the same node through
          * asChild, and the tooltip's "closed" wins — which silently kills the
          * item's own on/off state and with it every data-[state=on] style.
          * A title attribute carries the hint instead. */}
        <ToggleGroupItem
          value="add"
          aria-label="Add mode"
          title="Add mode — Enter adds a note"
          className={MODE_ITEM}
        >
          <Plus className="size-4" />
        </ToggleGroupItem>
        <ToggleGroupItem
          value="search"
          aria-label="Search mode"
          title="Search mode — typing filters the list (Ctrl+F)"
          className={MODE_ITEM}
        >
          <Search className="size-4" />
        </ToggleGroupItem>
      </ToggleGroup>

      <Input
        ref={inputRef}
        value={value}
        disabled={disabled}
        onChange={(e) => onValueChange(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={onFocus}
        onBlur={onBlur}
        placeholder={disabled ? '' : mode === 'add' ? 'Add a note…' : 'Search…'}
        className="h-9 flex-1 text-sm caret-primary"
      />
    </div>
  );
}
