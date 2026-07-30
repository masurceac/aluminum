import type { AluminumApi, Item } from '../shared/api';

declare global {
  interface Window { aluminum: AluminumApi; }
}

const api = window.aluminum;
const input = document.getElementById('new-item') as HTMLInputElement;
const list = document.getElementById('list') as HTMLUListElement;

let items: Item[] = [];
let selectedIndex = -1;

function render(): void {
  list.innerHTML = '';
  if (items.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'Double-tap Shift in any app to capture selected text';
    list.appendChild(li);
    return;
  }
  items.forEach((item, i) => {
    const li = document.createElement('li');
    li.className = 'item' + (item.done ? ' done' : '') + (i === selectedIndex ? ' selected' : '');

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = item.done;
    cb.addEventListener('change', () => api.setDone(item.id, cb.checked));

    const text = document.createElement('span');
    text.className = 'text';
    text.textContent = item.text;

    const del = document.createElement('button');
    del.className = 'del';
    del.textContent = '✕';
    del.addEventListener('click', () => api.removeItem(item.id));

    li.addEventListener('click', (e) => {
      if (e.target === cb || e.target === del) return;
      selectedIndex = i;
      render();
    });
    li.addEventListener('dblclick', () => api.copyOut(item.text));

    li.append(cb, text, del);
    list.appendChild(li);
  });
  const sel = list.children[selectedIndex] as HTMLElement | undefined;
  sel?.scrollIntoView({ block: 'nearest' });
}

function setItems(next: Item[]): void {
  items = next;
  if (selectedIndex >= items.length) selectedIndex = items.length - 1;
  render();
}

input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && input.value.trim()) {
    api.addItem(input.value.trim());
    input.value = '';
  }
  if (e.key === 'ArrowDown' && items.length > 0) {
    selectedIndex = 0;
    render();
    e.preventDefault();
    e.stopPropagation(); // keep the document handler from re-incrementing
    input.blur();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    api.hide();
    return;
  }
  if (document.activeElement === input) return;

  if (e.key === 'ArrowDown') {
    selectedIndex = Math.min(selectedIndex + 1, items.length - 1);
    render();
    e.preventDefault();
  } else if (e.key === 'ArrowUp') {
    if (selectedIndex <= 0) {
      selectedIndex = -1;
      render();
      input.focus();
    } else {
      selectedIndex--;
      render();
    }
    e.preventDefault();
  } else if (((e.ctrlKey || e.metaKey) && e.key === 'c') || e.key === 'Enter') {
    const item = items[selectedIndex];
    if (item) api.copyOut(item.text);
  } else if (e.key === ' ') {
    const item = items[selectedIndex];
    if (item) api.setDone(item.id, !item.done);
    e.preventDefault();
  } else if (e.key === 'Delete') {
    const item = items[selectedIndex];
    if (item) api.removeItem(item.id);
  }
});

// ignore pushed updates until the initial snapshot settles, so a mutation
// landing mid-load can't be overwritten by the older getItems() result
let initialLoadDone = false;
api.onItemsChanged((next) => {
  if (initialLoadDone) setItems(next);
});
api.getItems().then((next) => {
  initialLoadDone = true;
  setItems(next);
});
