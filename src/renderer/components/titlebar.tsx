import { ChevronsUp, Copy, Minus, Pin, Square, X } from 'lucide-react';
import type { ThemeMode } from '@shared/api';
import { TitlebarButton } from '@/components/titlebar-button';
import { ThemeMenu } from '@/components/theme-menu';
import type { Theme } from '@/hooks/use-theme';
import { cn } from '@/lib/utils';

interface TitlebarProps {
  docked: boolean;
  onToggleDocked: () => void;
  maximized: boolean;
  onToggleMaximize: () => void;
  onHide: () => void;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  mode: ThemeMode;
  onModeChange: (mode: ThemeMode) => void;
  themeMenuOpen: boolean;
  onThemeMenuOpenChange: (open: boolean) => void;
}

export function Titlebar({
  docked,
  onToggleDocked,
  maximized,
  onToggleMaximize,
  onHide,
  theme,
  onThemeChange,
  mode,
  onModeChange,
  themeMenuOpen,
  onThemeMenuOpenChange,
}: TitlebarProps) {
  return (
    <header className="flex h-9 shrink-0 items-center gap-0.5 pr-1.5 pl-3 select-none [-webkit-app-region:drag]">
      <div className="flex flex-1 items-center gap-2">
        <div className="flex size-[18px] items-center justify-center rounded-md bg-primary text-primary-foreground shadow-sm">
          <ChevronsUp className="size-3" strokeWidth={2.4} />
        </div>
        <span className="text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
          Aluminum
        </span>
      </div>

      <ThemeMenu
        theme={theme}
        onThemeChange={onThemeChange}
        mode={mode}
        onModeChange={onModeChange}
        open={themeMenuOpen}
        onOpenChange={onThemeMenuOpenChange}
      />

      <TitlebarButton
        label={
          docked ? 'Unpin (back to quick overlay)' : 'Pin as window (stay open, show in taskbar)'
        }
        aria-pressed={docked}
        onClick={onToggleDocked}
        className={cn(docked && 'bg-primary/12 text-primary hover:bg-primary/20')}
      >
        <Pin className={cn('size-3.5 transition-transform', !docked && 'rotate-[35deg]')} />
      </TitlebarButton>

      <TitlebarButton label="Minimize" onClick={onHide}>
        <Minus className="size-3.5" />
      </TitlebarButton>

      <TitlebarButton label={maximized ? 'Restore' : 'Maximize'} onClick={onToggleMaximize}>
        {maximized ? <Copy className="size-3" /> : <Square className="size-3" />}
      </TitlebarButton>

      {/* close = hide to tray, exactly like minimize: a tray app never quits
        * from the titlebar (quit lives in the tray menu). The red hover still
        * follows the OS convention so the button reads as "close". */}
      <TitlebarButton
        label="Close (hide to tray)"
        onClick={onHide}
        className="hover:bg-destructive/15 hover:text-destructive"
      >
        <X className="size-3.5" />
      </TitlebarButton>
    </header>
  );
}
