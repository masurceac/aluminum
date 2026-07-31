import { contextBridge, ipcRenderer } from 'electron';
import type { AluminumApi, Item, ThemeMode } from '../shared/api';

const api: AluminumApi = {
  getItems: (): Promise<Item[]> => ipcRenderer.invoke('items:get'),
  /** state flows back via onItemsChanged — mutations return nothing */
  addItem: (text: string): Promise<void> => ipcRenderer.invoke('items:add', text),
  setDone: (id: string, done: boolean): Promise<void> =>
    ipcRenderer.invoke('items:setDone', id, done),
  removeItem: (id: string): Promise<void> => ipcRenderer.invoke('items:remove', id),
  /** rewrite an item's text (inline edit) */
  updateItem: (id: string, text: string): Promise<void> =>
    ipcRenderer.invoke('items:update', id, text),
  /** join the given items into one (display order, newline-joined) */
  mergeItems: (ids: string[]): Promise<void> => ipcRenderer.invoke('items:merge', ids),
  /** pin/unpin — pinned items sort above the stream */
  setPinned: (id: string, pinned: boolean): Promise<void> =>
    ipcRenderer.invoke('items:setPinned', id, pinned),
  /** accept a clipboard suggestion — adds (or bumps) it as a capture */
  acceptSuggestion: (text: string): Promise<void> =>
    ipcRenderer.invoke('items:acceptSuggestion', text),
  /** restore a full snapshot — the undo path for delete/merge */
  restoreItems: (items: Item[]): Promise<void> => ipcRenderer.invoke('items:restore', items),
  /** copy text to system clipboard and hide the overlay */
  copyOut: (text: string): Promise<void> => ipcRenderer.invoke('clipboard:copyOut', text),
  /** copy text to system clipboard WITHOUT hiding (copy-and-stay) */
  copyText: (text: string): Promise<void> => ipcRenderer.invoke('clipboard:copy', text),
  hide: (): Promise<void> => ipcRenderer.invoke('overlay:hide'),
  /** titlebar maximize button — expands the overlay in place and back */
  toggleMaximize: (): Promise<void> => ipcRenderer.invoke('overlay:toggleMaximize'),
  /** pin the overlay as a normal window: no blur-hide, taskbar entry,
   * not always-on-top — for snapping beside other windows */
  setDocked: (docked: boolean): Promise<void> => ipcRenderer.invoke('overlay:setDocked', docked),
  /** force light/dark or follow the OS */
  setThemeMode: (mode: ThemeMode): Promise<void> => ipcRenderer.invoke('theme:setMode', mode),
  /** returns an unsubscribe function */
  onItemsChanged: (cb: (items: Item[]) => void): (() => void) => {
    const handler = (_e: unknown, items: Item[]) => cb(items);
    ipcRenderer.on('items:changed', handler);
    return () => ipcRenderer.removeListener('items:changed', handler);
  },
  /** fires on every real summon (not on mere refocus) — reset transient UI */
  onShown: (cb: () => void): (() => void) => {
    const handler = () => cb();
    ipcRenderer.on('overlay:shown', handler);
    return () => ipcRenderer.removeListener('overlay:shown', handler);
  },
  /** fires after a summon when the clipboard held text worth offering */
  onSuggest: (cb: (text: string) => void): (() => void) => {
    const handler = (_e: unknown, text: string) => cb(text);
    ipcRenderer.on('capture:suggest', handler);
    return () => ipcRenderer.removeListener('capture:suggest', handler);
  },
  /** fires when the window enters/leaves the maximized state */
  onMaximizedChanged: (cb: (maximized: boolean) => void): (() => void) => {
    const handler = (_e: unknown, maximized: boolean) => cb(maximized);
    ipcRenderer.on('overlay:maximized', handler);
    return () => ipcRenderer.removeListener('overlay:maximized', handler);
  },
};

contextBridge.exposeInMainWorld('aluminum', api);
