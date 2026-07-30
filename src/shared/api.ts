export type ItemSource = 'manual' | 'capture';

export interface Item {
  id: string;
  text: string;
  done: boolean;
  source: ItemSource;
  createdAt: number;
}

/** surface exposed to the renderer on window.aluminum */
export interface AluminumApi {
  getItems(): Promise<Item[]>;
  /** state flows back via onItemsChanged — mutations return nothing */
  addItem(text: string): Promise<void>;
  setDone(id: string, done: boolean): Promise<void>;
  removeItem(id: string): Promise<void>;
  /** copy text to system clipboard and hide the overlay */
  copyOut(text: string): Promise<void>;
  hide(): Promise<void>;
  /** titlebar maximize button — expands the overlay in place and back */
  toggleMaximize(): Promise<void>;
  /** returns an unsubscribe function */
  onItemsChanged(cb: (items: Item[]) => void): () => void;
}
