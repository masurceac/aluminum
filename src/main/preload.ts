import { contextBridge, ipcRenderer } from 'electron';
import type { AluminumApi, Item } from '../shared/api';

const api: AluminumApi = {
  getItems: (): Promise<Item[]> => ipcRenderer.invoke('items:get'),
  /** state flows back via onItemsChanged — mutations return nothing */
  addItem: (text: string): Promise<void> => ipcRenderer.invoke('items:add', text),
  setDone: (id: string, done: boolean): Promise<void> =>
    ipcRenderer.invoke('items:setDone', id, done),
  removeItem: (id: string): Promise<void> => ipcRenderer.invoke('items:remove', id),
  /** copy text to system clipboard and hide the overlay */
  copyOut: (text: string): Promise<void> => ipcRenderer.invoke('clipboard:copyOut', text),
  hide: (): Promise<void> => ipcRenderer.invoke('overlay:hide'),
  /** titlebar maximize button — expands the overlay in place and back */
  toggleMaximize: (): Promise<void> => ipcRenderer.invoke('overlay:toggleMaximize'),
  /** returns an unsubscribe function */
  onItemsChanged: (cb: (items: Item[]) => void): (() => void) => {
    const handler = (_e: unknown, items: Item[]) => cb(items);
    ipcRenderer.on('items:changed', handler);
    return () => ipcRenderer.removeListener('items:changed', handler);
  },
};

contextBridge.exposeInMainWorld('aluminum', api);
