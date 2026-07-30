import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
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

export class ItemStore {
  private items: Item[] = [];

  constructor(private filePath: string) {
    this.load();
  }

  getAll(): Item[] {
    return [...this.items];
  }

  add(text: string, source: ItemSource): Item {
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
    try {
      const raw = JSON.parse(readFileSync(this.filePath, 'utf8'));
      this.items = Array.isArray(raw.items) ? raw.items : [];
    } catch {
      this.items = []; // missing or corrupt file → start fresh
    }
  }

  private save(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify({ items: this.items }, null, 2), 'utf8');
  }
}
