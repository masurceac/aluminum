import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface SuggestionBarProps {
  text: string;
  onAccept: () => void;
  onDismiss: () => void;
}

/** The fallback capture path offers the clipboard instead of inserting it —
 * an offer, never an insertion. */
export function SuggestionBar({ text, onAccept, onDismiss }: SuggestionBarProps) {
  return (
    <div className="mx-auto mb-2 flex w-[calc(100%-1rem)] max-w-[736px] shrink-0 items-center gap-2 rounded-lg border border-primary/25 bg-primary/[0.07] py-1.5 pr-1.5 pl-3 animate-in fade-in slide-in-from-top-1 duration-200">
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-[10.5px] font-semibold tracking-[0.09em] text-primary uppercase">
          From clipboard
        </span>
        {/* single-line preview; the row it becomes will clamp properly anyway */}
        <span className="truncate text-xs leading-relaxed">{text.replace(/\s+/g, ' ').trim()}</span>
      </div>
      <Button size="sm" className="h-6.5 px-3 text-xs" onClick={onAccept}>
        Add
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-6.5"
        aria-label="Dismiss suggestion"
        onClick={onDismiss}
      >
        <X className="size-3.5" />
      </Button>
    </div>
  );
}
