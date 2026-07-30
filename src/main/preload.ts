import { contextBridge, ipcRenderer } from 'electron';
import type { Item } from './store';

const api = {
  getItems: (): Promise<Item[]> => ipcRenderer.invoke('items:get'),
  addItem: (text: string): Promise<Item | null> => ipcRenderer.invoke('items:add', text),
  setDone: (id: string, done: boolean): Promise<void> =>
    ipcRenderer.invoke('items:setDone', id, done),
  removeItem: (id: string): Promise<void> => ipcRenderer.invoke('items:remove', id),
  /** copy text to system clipboard and hide the overlay */
  copyOut: (text: string): Promise<void> => ipcRenderer.invoke('clipboard:copyOut', text),
  hide: (): Promise<void> => ipcRenderer.invoke('overlay:hide'),
  onItemsChanged: (cb: (items: Item[]) => void) => {
    ipcRenderer.on('items:changed', (_e, items: Item[]) => cb(items));
  },
};

export type AluminumApi = typeof api;

contextBridge.exposeInMainWorld('aluminum', api);
