import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  renameSync,
  rmSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export type ItemSource = 'manual' | 'capture';

export interface Item {
  id: string;
  text: string;
  done: boolean;
  source: ItemSource;
  createdAt: number;
}

export interface ItemStoreOptions {
  /** called when a read/write fails; the mutation stays in memory */
  onError?: (op: 'load' | 'save', err: unknown) => void;
}

export class ItemStore {
  private items: Item[] = [];

  constructor(
    private filePath: string,
    private opts: ItemStoreOptions = {},
  ) {
    mkdirSync(dirname(this.filePath), { recursive: true });
    this.load();
  }

  getAll(): Item[] {
    return [...this.items];
  }

  add(text: string, source: ItemSource): Item {
    // IPC hands over untyped data; the store is the persistence boundary
    if (typeof text !== 'string' || !text.trim()) {
      throw new TypeError('item text must be a non-empty string');
    }
    const item: Item = {
      id: randomUUID(),
      text,
      done: false,
      source,
      createdAt: Date.now(),
    };
    this.items.unshift(item); // newest first
    this.save();
    return item;
  }

  setDone(id: string, done: boolean): void {
    const item = this.items.find((i) => i.id === id);
    if (!item) return;
    item.done = done;
    this.save();
  }

  remove(id: string): void {
    const idx = this.items.findIndex((i) => i.id === id);
    if (idx === -1) return;
    this.items.splice(idx, 1);
    this.save();
  }

  private load(): void {
    let raw: string;
    try {
      raw = readFileSync(this.filePath, 'utf8');
    } catch (err) {
      // unreadable ≠ corrupt: leave the file alone, it may read fine next launch
      if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        this.opts.onError?.('load', err);
      }
      this.items = [];
      return;
    }
    try {
      const parsed = JSON.parse(raw);
      this.items = Array.isArray(parsed.items) ? parsed.items : [];
    } catch (err) {
      // unparseable bytes: keep them aside instead of overwriting on the next save
      try {
        renameSync(this.filePath, `${this.filePath}.corrupt-${Date.now()}`);
      } catch {
        /* best effort */
      }
      this.opts.onError?.('load', err);
      this.items = [];
    }
  }

  private save(): void {
    const tmp = `${this.filePath}.tmp`;
    try {
      writeFileSync(tmp, JSON.stringify({ items: this.items }, null, 2), 'utf8');
      renameSync(tmp, this.filePath); // atomic swap: readers see old or new, never half
    } catch (err) {
      try {
        rmSync(tmp, { force: true }); // don't leave a stale tmp behind
      } catch {
        /* best effort — tmp may be a directory or locked */
      }
      this.opts.onError?.('save', err); // never throw into an IPC handler
    }
  }
}
