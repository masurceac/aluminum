import type { AluminumApi } from '@shared/api';

declare global {
  // optional: the property only exists if the preload script actually ran
  interface Window {
    aluminum?: AluminumApi;
  }
}

export const bridge = window.aluminum;

/** Nothing but <PreloadError /> renders when the bridge is missing (see
 * main.tsx), so components can treat the API as always-there. */
export const api = bridge as AluminumApi;

/** fire-and-forget an IPC call; a rejection must not surface as an unhandled rejection */
export const fire = (p: Promise<void>): void => void p.catch(console.error);

/** the summon chord's modifier is Cmd on macOS, Ctrl elsewhere (see main.ts) */
export const isMac = navigator.platform.startsWith('Mac');
