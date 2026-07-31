import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  existsSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { ItemStore } from '../src/main/store';

let file: string;

beforeEach(() => {
  file = join(mkdtempSync(join(tmpdir(), 'alum-test-')), 'items.json');
});

afterEach(() => {
  rmSync(dirname(file), { recursive: true, force: true });
});

describe('ItemStore', () => {
  it('starts empty when file does not exist', () => {
    const s = new ItemStore(file);
    expect(s.getAll()).toEqual([]);
  });

  it('adds an item with id, text, done=false, createdAt', () => {
    const s = new ItemStore(file);
    const item = s.add('buy milk', 'manual');
    expect(item.text).toBe('buy milk');
    expect(item.done).toBe(false);
    expect(item.source).toBe('manual');
    expect(typeof item.id).toBe('string');
    expect(typeof item.createdAt).toBe('number');
    expect(s.getAll()).toHaveLength(1);
  });

  it('persists to disk and reloads', () => {
    const s1 = new ItemStore(file);
    s1.add('hello', 'capture');
    expect(existsSync(file)).toBe(true);
    const s2 = new ItemStore(file);
    expect(s2.getAll()).toHaveLength(1);
    expect(s2.getAll()[0].text).toBe('hello');
  });

  it('newest items come first', () => {
    const s = new ItemStore(file);
    s.add('first', 'manual');
    s.add('second', 'manual');
    expect(s.getAll()[0].text).toBe('second');
  });

  it('update() rewrites text and persists', () => {
    const s = new ItemStore(file);
    const item = s.add('typo tex', 'capture');
    s.update(item.id, 'typo text — fixed');
    expect(s.getAll()[0].text).toBe('typo text — fixed');
    expect(s.getAll()[0].source).toBe('capture'); // source survives an edit
    const s2 = new ItemStore(file);
    expect(s2.getAll()[0].text).toBe('typo text — fixed');
  });

  it('update() ignores unknown id and empty text', () => {
    const s = new ItemStore(file);
    const item = s.add('keep me', 'manual');
    s.update('nope', 'other');
    s.update(item.id, '   ');
    expect(s.getAll()[0].text).toBe('keep me');
  });

  it('merge() joins items in list order into one new item, removes originals', () => {
    const s = new ItemStore(file);
    const a = s.add('first', 'manual');
    const b = s.add('second', 'capture');
    const c = s.add('third', 'manual');
    // list order is newest-first: third, second, first
    const merged = s.merge([a.id, c.id]);
    expect(merged?.text).toBe('third\nfirst'); // joined in DISPLAY order, not arg order
    expect(s.getAll()).toHaveLength(2);
    expect(s.getAll().map((i) => i.text)).toEqual(['third\nfirst', 'second']);
    // merged item takes the topmost original's place
    expect(s.getAll()[0].id).not.toBe(b.id);
  });

  it('merge() with fewer than two known ids does nothing', () => {
    const s = new ItemStore(file);
    const a = s.add('solo', 'manual');
    expect(s.merge([a.id])).toBeNull();
    expect(s.merge([a.id, 'ghost'])).toBeNull();
    expect(s.getAll()).toHaveLength(1);
  });

  it('bump() moves an item to the top and refreshes createdAt', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const s = new ItemStore(file);
    const a = s.add('old capture', 'capture');
    vi.setSystemTime(2000);
    s.add('newer', 'manual');
    vi.setSystemTime(9000);
    s.bump(a.id);
    expect(s.getAll()[0].text).toBe('old capture');
    expect(s.getAll()[0].createdAt).toBe(9000); // re-captured = fresh again
    vi.useRealTimers();
  });

  it('bump() with unknown id is a no-op', () => {
    const s = new ItemStore(file);
    s.add('a', 'manual');
    s.add('b', 'manual');
    s.bump('ghost');
    expect(s.getAll().map((i) => i.text)).toEqual(['b', 'a']);
  });

  it('setPinned() sets and clears the flag, and persists', () => {
    const s = new ItemStore(file);
    const a = s.add('keep handy', 'manual');
    s.setPinned(a.id, true);
    expect(s.getAll()[0].pinned).toBe(true);
    const s2 = new ItemStore(file);
    expect(s2.getAll()[0].pinned).toBe(true);
    s2.setPinned(a.id, false);
    expect(s2.getAll()[0].pinned).toBe(false);
  });

  it('replaceAll() swaps the whole list (undo restore path) and persists', () => {
    const s = new ItemStore(file);
    s.add('will be deleted', 'manual');
    const snapshot = s.getAll();
    s.remove(snapshot[0].id);
    expect(s.getAll()).toHaveLength(0);
    s.replaceAll(snapshot);
    expect(s.getAll()).toHaveLength(1);
    expect(s.getAll()[0].text).toBe('will be deleted');
    const s2 = new ItemStore(file);
    expect(s2.getAll()).toHaveLength(1);
  });

  it('replaceAll() rejects malformed entries wholesale', () => {
    const s = new ItemStore(file);
    s.add('survivor', 'manual');
    s.replaceAll([{ id: 'x' } as never]);
    expect(s.getAll()[0].text).toBe('survivor'); // invalid restore is a no-op
  });

  it('toggles done', () => {
    const s = new ItemStore(file);
    const item = s.add('x', 'manual');
    s.setDone(item.id, true);
    expect(s.getAll()[0].done).toBe(true);
  });

  it('removes an item', () => {
    const s = new ItemStore(file);
    const item = s.add('x', 'manual');
    s.remove(item.id);
    expect(s.getAll()).toEqual([]);
  });

  it('ignores setDone/remove for unknown id', () => {
    const s = new ItemStore(file);
    s.add('x', 'manual');
    s.setDone('nope', true);
    s.remove('nope');
    expect(s.getAll()).toHaveLength(1);
    expect(s.getAll()[0].done).toBe(false);
  });

  it('survives a corrupt file by starting empty', () => {
    const s1 = new ItemStore(file);
    s1.add('x', 'manual');
    writeFileSync(file, '{not json');
    const s2 = new ItemStore(file);
    expect(s2.getAll()).toEqual([]);
  });

  it('writes valid JSON to disk', () => {
    const s = new ItemStore(file);
    s.add('x', 'manual');
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    expect(Array.isArray(raw.items)).toBe(true);
  });

  it('persists setDone and remove, not just add', () => {
    const s1 = new ItemStore(file);
    const a = s1.add('a', 'manual');
    const b = s1.add('b', 'manual');
    s1.setDone(a.id, true);
    s1.remove(b.id);
    const s2 = new ItemStore(file);
    expect(s2.getAll()).toHaveLength(1);
    expect(s2.getAll()[0].done).toBe(true);
  });

  it('setDone(false) un-does an item', () => {
    const s = new ItemStore(file);
    const item = s.add('x', 'manual');
    s.setDone(item.id, true);
    s.setDone(item.id, false);
    expect(s.getAll()[0].done).toBe(false);
    expect(new ItemStore(file).getAll()[0].done).toBe(false);
  });

  it('round-trips every field', () => {
    const s1 = new ItemStore(file);
    const item = s1.add('round trip', 'capture');
    const s2 = new ItemStore(file);
    expect(s2.getAll()[0]).toEqual(item);
  });

  it('preserves newest-first order across reload', () => {
    const s1 = new ItemStore(file);
    s1.add('first', 'manual');
    s1.add('second', 'manual');
    const s2 = new ItemStore(file);
    expect(s2.getAll().map((i) => i.text)).toEqual(['second', 'first']);
  });

  it('quarantines a corrupt file instead of overwriting it', () => {
    const s1 = new ItemStore(file);
    s1.add('x', 'manual');
    writeFileSync(file, '{not json');

    const s2 = new ItemStore(file);
    expect(s2.getAll()).toEqual([]);
    s2.add('y', 'manual');

    const quarantined = readdirSync(dirname(file)).filter((n) =>
      n.startsWith('items.json.corrupt-'),
    );
    expect(quarantined).toHaveLength(1);
    expect(readFileSync(join(dirname(file), quarantined[0]), 'utf8')).toBe('{not json');

    const raw = JSON.parse(readFileSync(file, 'utf8'));
    expect(raw.items.map((i: { text: string }) => i.text)).toEqual(['y']);
  });

  it('quarantines a null JSON root', () => {
    writeFileSync(file, 'null');
    const s = new ItemStore(file);
    expect(s.getAll()).toEqual([]);
    const quarantined = readdirSync(dirname(file)).filter((n) =>
      n.startsWith('items.json.corrupt-'),
    );
    expect(quarantined).toHaveLength(1);
    expect(readFileSync(join(dirname(file), quarantined[0]), 'utf8')).toBe('null');
  });

  it('quarantines a root object without an items array', () => {
    writeFileSync(file, '{}');
    const onError = vi.fn();
    const s = new ItemStore(file, { onError });
    expect(s.getAll()).toEqual([]);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBe('load');
    const quarantined = readdirSync(dirname(file)).filter((n) =>
      n.startsWith('items.json.corrupt-'),
    );
    expect(quarantined).toHaveLength(1);
  });

  it('drops malformed entries but keeps a valid root', () => {
    const valid = {
      id: 'abc',
      text: 'keep me',
      done: false,
      source: 'manual',
      createdAt: 1,
    };
    writeFileSync(file, JSON.stringify({ items: [valid, { garbage: 1 }] }));
    const s = new ItemStore(file);
    expect(s.getAll()).toEqual([valid]);
    // a valid root is NOT corrupt: the file stays where it is
    const quarantined = readdirSync(dirname(file)).filter((n) => n.includes('.corrupt-'));
    expect(quarantined).toEqual([]);
  });

  it('rejects non-string or empty text', () => {
    const s = new ItemStore(file);
    expect(() => s.add('', 'manual')).toThrow();
    expect(() => s.add('   ', 'manual')).toThrow();
    expect(() => (s as any).add({}, 'manual')).toThrow();
    expect(s.getAll()).toEqual([]);
  });

  it('leaves an unreadable-but-present file alone (no quarantine)', () => {
    // a directory at the file path makes readFileSync fail with EISDIR —
    // a read failure on data that may be perfectly intact
    mkdirSync(file);
    const onError = vi.fn();
    const s = new ItemStore(file, { onError });

    expect(s.getAll()).toEqual([]);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBe('load');
    expect(existsSync(file)).toBe(true); // not renamed aside
    const quarantined = readdirSync(dirname(file)).filter((n) =>
      n.includes('.corrupt-'),
    );
    expect(quarantined).toEqual([]);
  });

  it('reports save errors via onError instead of throwing', () => {
    // occupy the temp path save() writes through, so writeFileSync fails (EISDIR)
    mkdirSync(`${file}.tmp`);
    const onError = vi.fn();
    const s = new ItemStore(file, { onError });

    expect(() => s.add('x', 'manual')).not.toThrow();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBe('save');
    // the mutation still lives in memory
    expect(s.getAll()).toHaveLength(1);
  });
});
