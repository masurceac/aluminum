import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface StatusBarProps {
  left: string;
  right: string;
  /** transient confirmations ("Copied item") read in the accent color */
  flashing: boolean;
  showClearAll: boolean;
  onClearAll: () => void;
}

export function StatusBar({ left, right, flashing, showClearAll, onClearAll }: StatusBarProps) {
  return (
    <footer className="flex h-7 shrink-0 items-center gap-3 border-t px-3 text-xs text-muted-foreground">
      <span className={cn('flex-1 truncate', flashing && 'text-primary')}>{left}</span>
      <span className="truncate">{right}</span>
      {showClearAll && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onClearAll}
          className="-mr-1.5 h-5 px-1.5 text-xs font-normal text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        >
          clear all
        </Button>
      )}
    </footer>
  );
}
