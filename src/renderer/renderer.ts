import type { AluminumApi, Item } from '../shared/api';

declare global {
  interface Window { aluminum: AluminumApi; }
}

const api = window.aluminum;
const input = document.getElementById('new-item') as HTMLInputElement;
const list = document.getElementById('list') as HTMLUListElement;

/** fire-and-forget an IPC call; a rejection must not surface as an unhandled rejection */
const fire = (p: Promise<void>): void => void p.catch(console.error);

let items: Item[] = [];
// selection is tracked by id, not index: the store unshifts new items, so an
// index silently slides onto a different row and Delete destroys the wrong one
let selectedId: string | null = null;

function indexOfSelected(): number {
  return selectedId === null ? -1 : items.findIndex((i) => i.id === selectedId);
}

function selectedItem(): Item | undefined {
  return selectedId === null ? undefined : items.find((i) => i.id === selectedId);
}

function selectAt(index: number): void {
  const item = items[index];
  selectedId = item ? item.id : null;
}

function render(): void {
  const selectedIndex = indexOfSelected();
  list.innerHTML = '';

  if (items.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'Double-tap Shift in any app to capture selected text';
    list.appendChild(li);
  } else {
    items.forEach((item, i) => {
      const li = document.createElement('li');
      li.className = 'item' + (item.done ? ' done' : '') + (i === selectedIndex ? ' selected' : '');

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = item.done;
      cb.addEventListener('change', () => fire(api.setDone(item.id, cb.checked)));

      const text = document.createElement('span');
      text.className = 'text';
      text.textContent = item.text;

      const del = document.createElement('button');
      del.className = 'del';
      del.textContent = '✕';
      del.addEventListener('click', () => fire(api.removeItem(item.id)));

      li.addEventListener('click', (e) => {
        if (e.target === cb || e.target === del) return;
        selectedId = item.id;
        render();
      });
      li.addEventListener('dblclick', () => fire(api.copyOut(item.text)));

      li.append(cb, text, del);
      list.appendChild(li);
    });
    const sel = list.children[selectedIndex] as HTMLElement | undefined;
    sel?.scrollIntoView({ block: 'nearest' });
  }

  // no selection means the list has no keyboard claim — clicking a row control
  // otherwise strands focus on <body> and every shortcut goes dead
  if (selectedIndex === -1) input.focus();
}

function setItems(next: Item[]): void {
  items = next;
  if (selectedId !== null && !items.some((i) => i.id === selectedId)) selectedId = null;
  render();
}

input.addEventListener('keydown', (e) => {
  // isComposing: Enter that commits an IME candidate must not add an item
  if (e.key === 'Enter' && !e.isComposing && input.value.trim()) {
    fire(api.addItem(input.value.trim()));
    input.value = '';
  }
  if (e.key === 'ArrowDown' && items.length > 0) {
    selectAt(0);
    render();
    e.preventDefault();
    e.stopPropagation(); // keep the document handler from re-incrementing
    input.blur();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    fire(api.hide());
    return;
  }
  if (document.activeElement === input) return;
  // a focused checkbox or button owns its own key handling: acting here would
  // suppress the native toggle and mutate a different row
  if (document.activeElement !== document.body) return;

  if (e.key === 'ArrowDown') {
    selectAt(Math.min(indexOfSelected() + 1, items.length - 1));
    render();
    e.preventDefault();
  } else if (e.key === 'ArrowUp') {
    const i = indexOfSelected();
    if (i <= 0) {
      selectedId = null;
      render(); // render() returns focus to the input when nothing is selected
    } else {
      selectAt(i - 1);
      render();
    }
    e.preventDefault();
  } else if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') || e.key === 'Enter') {
    const item = selectedItem();
    if (item) fire(api.copyOut(item.text));
  } else if (e.key === ' ') {
    const item = selectedItem();
    if (item) fire(api.setDone(item.id, !item.done));
    e.preventDefault();
  } else if (e.key === 'Delete' || e.key === 'Backspace') {
    // Backspace too: Mac laptop keyboards have no forward-delete
    const item = selectedItem();
    if (item) fire(api.removeItem(item.id));
  }
});

// the overlay is long-lived and only hidden, so every show must start clean
window.addEventListener('focus', () => {
  selectedId = null;
  render(); // render() refocuses the input when nothing is selected
});

// ignore pushed updates until the initial snapshot settles, so a mutation
// landing mid-load can't be overwritten by the older getItems() result
let initialLoadDone = false;
api.onItemsChanged((next) => {
  if (initialLoadDone) setItems(next);
});
api.getItems()
  .then((next) => {
    initialLoadDone = true;
    setItems(next);
  })
  .catch(() => {
    // a failed first read must not wedge the UI: accept pushes from here on
    initialLoadDone = true;
    render();
  });
