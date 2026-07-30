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

  it('rejects non-string or empty text', () => {
    const s = new ItemStore(file);
    expect(() => s.add('', 'manual')).toThrow();
    expect(() => s.add('   ', 'manual')).toThrow();
    expect(() => (s as any).add({}, 'manual')).toThrow();
    expect(s.getAll()).toEqual([]);
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
