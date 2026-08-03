import { CircleAlert } from 'lucide-react';

/** No preload = no IPC at all: every handler in the app would throw on the
 * bridge. Say so instead of presenting a list that silently does nothing. */
export function PreloadError() {
  return (
    <div className="flex h-full flex-col">
      <header className="flex h-9 shrink-0 items-center px-3 select-none [-webkit-app-region:drag]">
        <span className="text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
          Aluminum
        </span>
      </header>
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
        <CircleAlert className="size-6 text-destructive" />
        <p className="text-[13.5px] font-semibold">Preload failed — restart Aluminum</p>
        <p className="text-xs text-muted-foreground">Quit from the tray icon and reopen.</p>
      </div>
      <footer className="flex h-7 shrink-0 items-center border-t px-3 text-xs text-destructive">
        Capture unavailable
      </footer>
    </div>
  );
}
