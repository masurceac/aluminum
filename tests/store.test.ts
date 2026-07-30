import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ItemStore } from '../src/main/store';

let file: string;

beforeEach(() => {
  file = join(mkdtempSync(join(tmpdir(), 'alum-test-')), 'items.json');
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
});
