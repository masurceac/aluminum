export type ItemSource = 'manual' | 'capture';

/** appearance override — 'system' follows the OS light/dark setting */
export type ThemeMode = 'system' | 'light' | 'dark';

export interface Item {
  id: string;
  text: string;
  done: boolean;
  source: ItemSource;
  createdAt: number;
  /** pinned items sort above the stream; absent = false */
  pinned?: boolean;
}

/** surface exposed to the renderer on window.aluminum */
export interface AluminumApi {
  getItems(): Promise<Item[]>;
  /** state flows back via onItemsChanged — mutations return nothing */
  addItem(text: string): Promise<void>;
  setDone(id: string, done: boolean): Promise<void>;
  removeItem(id: string): Promise<void>;
  /** rewrite an item's text (inline edit) */
  updateItem(id: string, text: string): Promise<void>;
  /** join the given items into one (display order, newline-joined) */
  mergeItems(ids: string[]): Promise<void>;
  /** pin/unpin — pinned items sort above the stream */
  setPinned(id: string, pinned: boolean): Promise<void>;
  /** accept a clipboard suggestion — adds (or bumps) it as a capture */
  acceptSuggestion(text: string): Promise<void>;
  /** restore a full snapshot — the undo path for delete/merge */
  restoreItems(items: Item[]): Promise<void>;
  /** copy text to system clipboard and hide the overlay */
  copyOut(text: string): Promise<void>;
  /** copy text to system clipboard WITHOUT hiding (copy-and-stay) */
  copyText(text: string): Promise<void>;
  hide(): Promise<void>;
  /** titlebar maximize button — expands the overlay in place and back */
  toggleMaximize(): Promise<void>;
  /** pin the overlay as a normal window: no blur-hide, taskbar entry,
   * not always-on-top — for snapping beside other windows */
  setDocked(docked: boolean): Promise<void>;
  /** force light/dark or follow the OS — routed through nativeTheme so the
   * acrylic/vibrancy backdrop switches with the CSS */
  setThemeMode(mode: ThemeMode): Promise<void>;
  /** returns an unsubscribe function */
  onItemsChanged(cb: (items: Item[]) => void): () => void;
  /** fires on every real summon (not on mere refocus) — reset transient UI */
  onShown(cb: () => void): () => void;
  /** fires after a summon when the clipboard held text worth offering */
  onSuggest(cb: (text: string) => void): () => void;
  /** fires after a summon that captured (or bumped) a selection — carries the
   * item's id so the overlay can open with it selected */
  onCaptured(cb: (id: string) => void): () => void;
  /** fires when the window enters/leaves the maximized state */
  onMaximizedChanged(cb: (maximized: boolean) => void): () => void;
}
