import type { ThemeMode } from '@shared/api';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { MODES, SWATCH, THEMES, type Theme } from '@/hooks/use-theme';
import { cn } from '@/lib/utils';
import { TitlebarButton } from '@/components/titlebar-button';

const MODE_LABEL: Record<ThemeMode, string> = {
  system: 'Auto',
  light: 'Light',
  dark: 'Dark',
};

interface ThemeMenuProps {
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  mode: ThemeMode;
  onModeChange: (mode: ThemeMode) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ThemeMenu({
  theme,
  onThemeChange,
  mode,
  onModeChange,
  open,
  onOpenChange,
}: ThemeMenuProps) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <TitlebarButton label="Theme" tooltip={false}>
          <span
            className="size-3 rounded-full shadow-[inset_0_0_0_0.5px_rgba(0,0,0,0.2)]"
            style={{ background: SWATCH[theme] }}
          />
        </TitlebarButton>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={4} className="w-52 p-3">
        <p className="text-[10.5px] font-semibold tracking-[0.09em] text-muted-foreground uppercase">
          Theme
        </p>
        <div className="mt-2 flex gap-2">
          {THEMES.map((t) => (
            <button
              key={t}
              type="button"
              title={t[0].toUpperCase() + t.slice(1)}
              aria-label={t}
              aria-pressed={t === theme}
              onClick={() => onThemeChange(t)}
              style={{ background: SWATCH[t] }}
              className={cn(
                'size-6 rounded-full transition-transform outline-none',
                'shadow-[inset_0_0_0_0.5px_rgba(0,0,0,0.2),inset_0_1px_0_rgba(255,255,255,0.35)]',
                'hover:scale-110 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-popover',
                t === theme && 'ring-2 ring-ring ring-offset-2 ring-offset-popover',
              )}
            />
          ))}
        </div>

        <p className="mt-4 text-[10.5px] font-semibold tracking-[0.09em] text-muted-foreground uppercase">
          Appearance
        </p>
        <ToggleGroup
          type="single"
          value={mode}
          // Radix emits '' when the active item is pressed again; appearance is
          // never "unset", so ignore that instead of falling back to a default
          onValueChange={(next) => next && onModeChange(next as ThemeMode)}
          variant="outline"
          size="sm"
          className="mt-2 w-full"
        >
          {MODES.map((m) => (
            <ToggleGroupItem
              key={m}
              value={m}
              className="flex-1 text-xs data-[state=on]:bg-primary/15 data-[state=on]:font-semibold data-[state=on]:text-primary"
            >
              {MODE_LABEL[m]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </PopoverContent>
    </Popover>
  );
}
