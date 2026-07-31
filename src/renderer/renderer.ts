import type { AluminumApi, Item } from '../shared/api';

declare global {
  // optional: the property only exists if the preload script actually ran
  interface Window { aluminum?: AluminumApi; }
}

const bridge = window.aluminum;
const input = document.getElementById('new-item') as HTMLInputElement;
const list = document.getElementById('list') as HTMLUListElement;
const statusLeft = document.getElementById('status-left') as HTMLSpanElement;
const statusRight = document.getElementById('status-right') as HTMLSpanElement;
// nothing below runs unless `bridge` is present (see the bootstrap at the
// bottom), so the handlers can treat the API as always-there
const api = bridge as AluminumApi;

/** fire-and-forget an IPC call; a rejection must not surface as an unhandled rejection */
const fire = (p: Promise<void>): void => void p.catch(console.error);

/** code, URLs, and paths read better in mono and must break anywhere */
const MONO_RE = /^(https?:\/\/|[\w-]+\.[a-z]{2,}\/)|[{}();=><]/;

/** compact age: now, 5m, 3h, 2d — the overlay is glanced at, not studied */
function age(createdAt: number | undefined): string {
  if (!createdAt) return '';
  const s = Math.max(0, (Date.now() - createdAt) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

let items: Item[] = [];
// selection is a set of ids plus a focus row (the one keyboard ops move from)
// and an anchor (where a Shift-range started). Ids, not indexes: the store
// unshifts new items, so an index silently slides onto a different row.
const selectedIds = new Set<string>();
let focusId: string | null = null;
let anchorId: string | null = null;
let editingId: string | null = null;

/** the rows currently shown — the master list narrowed by the live filter */
function visibleItems(): Item[] {
  const q = input.value.trim().toLowerCase();
  if (!q) return items;
  return items.filter((i) => i.text.toLowerCase().includes(q));
}

function visibleIndexOf(id: string | null): number {
  return id === null ? -1 : visibleItems().findIndex((i) => i.id === id);
}

function selectSingle(id: string | null): void {
  selectedIds.clear();
  if (id !== null) selectedIds.add(id);
  focusId = id;
  anchorId = id;
}

function selectRange(toId: string): void {
  const vis = visibleItems();
  const a = visibleIndexOf(anchorId === null ? toId : anchorId);
  const b = vis.findIndex((i) => i.id === toId);
  if (a === -1 || b === -1) return selectSingle(toId);
  selectedIds.clear();
  for (let i = Math.min(a, b); i <= Math.max(a, b); i++) selectedIds.add(vis[i].id);
  focusId = toId;
}

/** selected items in display order — Copy as List and Merge depend on it */
function selectedItems(): Item[] {
  return visibleItems().filter((i) => selectedIds.has(i.id));
}

function copySelection(): void {
  const chosen = selectedItems();
  if (chosen.length === 0) return;
  fire(api.copyOut(chosen.map((i) => i.text).join('\n')));
}

/* ── context menu ── */

const menu = document.createElement('div');
menu.id = 'menu';
menu.hidden = true;
document.body.appendChild(menu);

function closeMenu(): void {
  menu.hidden = true;
}

function openMenu(x: number, y: number): void {
  const chosen = selectedItems();
  if (chosen.length === 0) return;
  const multi = chosen.length > 1;
  const allDone = chosen.every((i) => i.done);
  menu.innerHTML = '';
  const entry = (label: string, act: () => void, danger = false): void => {
    const b = document.createElement('button');
    b.textContent = label;
    if (danger) b.className = 'danger';
    b.addEventListener('click', () => {
      closeMenu();
      act();
    });
    menu.appendChild(b);
  };
  entry(multi ? `Copy as list (${chosen.length})` : 'Copy', copySelection);
  if (!multi) entry('Edit', () => startEdit(chosen[0].id));
  entry(allDone ? 'Mark not done' : 'Mark as done', () => {
    for (const i of chosen) fire(api.setDone(i.id, !allDone));
  });
  if (multi)
    entry(`Merge ${chosen.length} items`, () =>
      fire(api.mergeItems(chosen.map((i) => i.id))),
    );
  entry('Delete', () => {
    for (const i of chosen) fire(api.removeItem(i.id));
  }, true);

  menu.hidden = false;
  // clamp inside the window once real dimensions exist
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(x, window.innerWidth - r.width - 6)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - r.height - 6)}px`;
}

document.addEventListener('mousedown', (e) => {
  if (!menu.hidden && e.target instanceof Node && !menu.contains(e.target)) closeMenu();
});

/* ── inline edit ── */

function startEdit(id: string): void {
  editingId = id;
  render();
}

function commitEdit(id: string, text: string): void {
  editingId = null;
  if (text.trim()) fire(api.updateItem(id, text));
  else render(); // blank edit = cancel, not delete
}

function cancelEdit(): void {
  editingId = null;
  render();
}

/* ── rendering ── */

function renderStatus(): void {
  const vis = visibleItems();
  const filtering = input.value.trim().length > 0 && document.activeElement === input;
  if (selectedIds.size > 1) {
    statusLeft.textContent = `${selectedIds.size} selected`;
    statusRight.textContent = '↵ copy list · ⌫ delete';
    return;
  }
  if (filtering) {
    statusLeft.textContent = `${vis.length} of ${items.length}`;
    statusRight.textContent = '↵ add · esc clear';
    return;
  }
  if (items.length === 0) {
    statusLeft.textContent = '0 items';
    statusRight.textContent = '↵ add';
    return;
  }
  const done = items.filter((i) => i.done).length;
  statusLeft.textContent =
    `${items.length} ${items.length === 1 ? 'item' : 'items'}` + (done ? ` · ${done} done` : '');
  statusRight.textContent = '↑↓ move · ␣ done · ↵ copy';
}

function emptyRow(text: string, keycaps: boolean): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'empty';
  // hint text, not a choice: keep it out of the listbox's option set
  li.setAttribute('role', 'presentation');
  if (keycaps) {
    const keys = document.createElement('div');
    keys.className = 'keys';
    for (let k = 0; k < 2; k++) {
      const key = document.createElement('span');
      key.className = 'key';
      key.textContent = '⇧ Shift';
      keys.appendChild(key);
    }
    li.appendChild(keys);
  }
  const hint = document.createElement('div');
  hint.textContent = text;
  li.appendChild(hint);
  return li;
}

function render(): void {
  const vis = visibleItems();
  list.innerHTML = '';

  if (items.length === 0) {
    list.appendChild(emptyRow('Double-tap Shift in any app to capture selected text', true));
  } else if (vis.length === 0) {
    list.appendChild(emptyRow(`No matches for “${input.value.trim()}”`, false));
  } else {
    vis.forEach((item) => {
      const isSelected = selectedIds.has(item.id);
      const li = document.createElement('li');
      li.className =
        'item' +
        (item.done ? ' done' : '') +
        (isSelected ? ' selected' : '') +
        (MONO_RE.test(item.text) ? ' mono' : '');
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', String(isSelected));

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = item.done;
      cb.addEventListener('change', () => fire(api.setDone(item.id, cb.checked)));

      let body: HTMLElement;
      if (editingId === item.id) {
        const ta = document.createElement('textarea');
        ta.className = 'edit';
        ta.value = item.text;
        ta.rows = Math.min(6, item.text.split('\n').length);
        ta.addEventListener('keydown', (e) => {
          e.stopPropagation(); // typing must not trigger list shortcuts
          if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
            e.preventDefault();
            commitEdit(item.id, ta.value);
          } else if (e.key === 'Escape') {
            cancelEdit();
          }
        });
        ta.addEventListener('blur', () => {
          // click-away saves; explicit Escape is the cancel path
          if (editingId === item.id) commitEdit(item.id, ta.value);
        });
        body = ta;
      } else {
        const text = document.createElement('span');
        text.className = 'text';
        text.textContent = item.text;
        body = text;
      }

      const tail = document.createElement('span');
      tail.className = 'tail';

      const meta = document.createElement('span');
      meta.className = 'meta';
      const glyph = document.createElement('span');
      glyph.className = 'glyph';
      glyph.textContent = item.source === 'capture' ? '⇧' : '↵';
      const when = document.createElement('span');
      when.className = 'age';
      when.textContent = age(item.createdAt);
      meta.append(glyph, when);

      const actions = document.createElement('span');
      actions.className = 'actions';
      const copy = document.createElement('button');
      copy.className = 'copy';
      copy.setAttribute('aria-label', 'Copy item');
      copy.title = 'Copy';
      copy.appendChild(document.createElement('i'));
      copy.addEventListener('click', (e) => {
        e.stopPropagation();
        fire(api.copyOut(item.text));
      });
      const del = document.createElement('button');
      del.className = 'del';
      del.textContent = '✕';
      del.title = 'Delete';
      del.setAttribute('aria-label', 'Delete item');
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        fire(api.removeItem(item.id));
      });
      actions.append(copy, del);

      tail.append(meta, actions);

      li.addEventListener('click', (e) => {
        if (e.target instanceof Node && (cb.contains(e.target) || actions.contains(e.target)))
          return;
        if (editingId === item.id) return;
        if (e.ctrlKey || e.metaKey) {
          // toggle membership; focus follows the click
          if (selectedIds.has(item.id)) selectedIds.delete(item.id);
          else selectedIds.add(item.id);
          focusId = item.id;
          anchorId = item.id;
        } else if (e.shiftKey) {
          selectRange(item.id);
        } else {
          selectSingle(item.id);
        }
        render();
      });
      li.addEventListener('dblclick', () => {
        if (editingId !== item.id) fire(api.copyOut(item.text));
      });
      li.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (!selectedIds.has(item.id)) selectSingle(item.id);
        render();
        openMenu(e.clientX, e.clientY);
      });

      li.append(cb, body, tail);
      list.appendChild(li);
    });

    const focusIndex = visibleIndexOf(focusId);
    const sel = list.children[focusIndex] as HTMLElement | undefined;
    sel?.scrollIntoView({ block: 'nearest' });
    if (editingId !== null) {
      const ta = list.querySelector('textarea.edit') as HTMLTextAreaElement | null;
      if (ta) {
        ta.focus();
        ta.setSelectionRange(ta.value.length, ta.value.length);
      }
    }
  }

  renderStatus();

  // no selection means the list has no keyboard claim — clicking a row control
  // otherwise strands focus on <body> and every shortcut goes dead
  if (focusId === null && editingId === null && menu.hidden) input.focus();
}

function setItems(next: Item[]): void {
  const prevIndex = visibleIndexOf(focusId); // index in the OLD visible list
  items = next;
  const alive = new Set(items.map((i) => i.id));
  for (const id of [...selectedIds]) if (!alive.has(id)) selectedIds.delete(id);
  if (editingId !== null && !alive.has(editingId)) editingId = null;
  if (focusId !== null && !alive.has(focusId)) {
    // the focus row was removed: keep the slot so repeat-Delete works
    const vis = visibleItems();
    const slot = vis[Math.min(prevIndex, vis.length - 1)];
    selectSingle(slot ? slot.id : null);
  }
  render();
}

/** replay the summon animation on every show */
function summon(): void {
  document.body.classList.remove('summon');
  // force a reflow so removing+adding the class restarts the animation
  void document.body.offsetWidth;
  document.body.classList.add('summon');
}

function start(): void {
  document.getElementById('win-min')?.addEventListener('click', () => fire(api.hide()));
  document
    .getElementById('win-max')
    ?.addEventListener('click', () => fire(api.toggleMaximize()));
  document.body.addEventListener('animationend', (e) => {
    if (e.animationName === 'summon') document.body.classList.remove('summon');
  });

  // the input is both "add" and live filter: every keystroke re-narrows
  input.addEventListener('input', () => {
    selectedIds.clear();
    focusId = null;
    anchorId = null;
    render();
  });

  input.addEventListener('keydown', (e) => {
    // isComposing: Enter that commits an IME candidate must not add an item
    if (e.key === 'Enter' && !e.isComposing && input.value.trim()) {
      fire(api.addItem(input.value.trim()));
      input.value = '';
    }
    if (e.key === 'Escape' && input.value) {
      // first Escape clears the filter; the document handler never sees it
      e.stopPropagation();
      input.value = '';
      render();
    }
    if (e.key === 'ArrowDown' && visibleItems().length > 0) {
      selectSingle(visibleItems()[0].id);
      render();
      e.preventDefault();
      e.stopPropagation(); // keep the document handler from re-incrementing
      input.blur();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!menu.hidden) {
        closeMenu();
        return;
      }
      // an open editor handles its own Escape (stopPropagation) — reaching
      // here means nothing is mid-edit, so Escape dismisses the overlay
      fire(api.hide());
      return;
    }
    if (document.activeElement === input) return;
    // a focused checkbox, button, or editor owns its own key handling: acting
    // here would suppress the native behavior and mutate a different row
    if (document.activeElement !== document.body) return;

    const vis = visibleItems();
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const dir = e.key === 'ArrowDown' ? 1 : -1;
      const i = visibleIndexOf(focusId);
      if (dir === -1 && i <= 0) {
        selectSingle(null);
        render(); // render() returns focus to the input when nothing is selected
      } else {
        const next = vis[Math.max(0, Math.min(i + dir, vis.length - 1))];
        if (next) {
          if (e.shiftKey) selectRange(next.id);
          else selectSingle(next.id);
          render();
        }
      }
      e.preventDefault();
    } else if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') || e.key === 'Enter') {
      copySelection();
    } else if (e.key === 'F2') {
      if (focusId !== null && selectedIds.size === 1) startEdit(focusId);
    } else if (e.key === ' ') {
      const chosen = selectedItems();
      const allDone = chosen.length > 0 && chosen.every((i) => i.done);
      for (const item of chosen) fire(api.setDone(item.id, !allDone));
      e.preventDefault();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      // Backspace too: Mac laptop keyboards have no forward-delete
      for (const item of selectedItems()) fire(api.removeItem(item.id));
    }
  });

  // the overlay is long-lived and only hidden, so every show must start clean
  window.addEventListener('focus', () => {
    selectSingle(null);
    editingId = null;
    input.value = '';
    closeMenu();
    summon();
    render(); // render() refocuses the input when nothing is selected
  });

  summon();

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
}

if (bridge) {
  start();
} else {
  // no preload = no IPC at all: every handler below would throw on the bridge.
  // Say so instead of presenting a list that silently does nothing.
  list.innerHTML = '';
  const li = document.createElement('li');
  li.className = 'empty error';
  li.setAttribute('role', 'presentation');
  const bang = document.createElement('div');
  bang.className = 'bang';
  bang.textContent = '!';
  const headline = document.createElement('div');
  headline.className = 'headline';
  headline.textContent = 'Preload failed — restart Aluminum';
  const detail = document.createElement('div');
  detail.className = 'detail';
  detail.textContent = 'Quit from the tray icon and reopen.';
  li.append(bang, headline, detail);
  list.appendChild(li);
  input.disabled = true;
  input.placeholder = '';
  statusLeft.textContent = 'Capture unavailable';
  statusLeft.className = 'error';
  statusRight.textContent = '';
}
