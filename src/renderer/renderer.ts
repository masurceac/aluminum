import type { AluminumApi, Item, ThemeMode } from '../shared/api';

declare global {
  // optional: the property only exists if the preload script actually ran
  interface Window { aluminum?: AluminumApi; }
}

const bridge = window.aluminum;
const input = document.getElementById('new-item') as HTMLInputElement;
const list = document.getElementById('list') as HTMLUListElement;
const statusLeft = document.getElementById('status-left') as HTMLSpanElement;
const statusRight = document.getElementById('status-right') as HTMLSpanElement;
const clearAllBtn = document.getElementById('clear-all') as HTMLButtonElement;
const maxBtn = document.getElementById('win-max') as HTMLButtonElement;
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
/** scroll the focus row into view only after KEYBOARD navigation — a mouse
 * click elsewhere must not teleport the list */
let scrollToFocus = false;
/** ids that just arrived — they get the enter animation exactly once */
let enterIds = new Set<string>();
let initialLoadSettled = false;

/** the rows currently shown: pinned first, then the stream, with done items
 * sunk to the bottom (completion beats pinning), narrowed by the live filter.
 * Every partition keeps store order, which is newest-first. */
function visibleItems(): Item[] {
  const q = input.value.trim().toLowerCase();
  const base = q ? items.filter((i) => i.text.toLowerCase().includes(q)) : items;
  const undone = base.filter((i) => !i.done);
  return [
    ...undone.filter((i) => i.pinned),
    ...undone.filter((i) => !i.pinned),
    ...base.filter((i) => i.done),
  ];
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

function selectionText(): string {
  return selectedItems()
    .map((i) => i.text)
    .join('\n');
}

/* ── transient status flash ("Copied to clipboard") ── */

let flashTimer: ReturnType<typeof setTimeout> | undefined;
let flashMessage: string | null = null;

function flashStatus(msg: string): void {
  flashMessage = msg;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => {
    flashMessage = null;
    renderStatus();
  }, 1400);
  renderStatus();
}

/** copy without hiding; the footer confirms */
function copyStay(text: string, what: string): void {
  fire(api.copyText(text));
  flashStatus(`Copied ${what}`);
}

/* ── undo (snapshot-based, covers delete / merge / clear-done) ── */

const toast = document.createElement('div');
toast.id = 'toast';
toast.hidden = true;
document.body.appendChild(toast);

let undoSnapshot: Item[] | null = null;
let undoTimer: ReturnType<typeof setTimeout> | undefined;

function dismissToast(): void {
  toast.hidden = true;
  undoSnapshot = null;
  clearTimeout(undoTimer);
}

function undoNow(): void {
  if (!undoSnapshot) return;
  fire(api.restoreItems(undoSnapshot));
  dismissToast();
}

/** call BEFORE a destructive mutation; shows the undo toast for 5s */
function offerUndo(label: string): void {
  undoSnapshot = items.map((i) => ({ ...i }));
  clearTimeout(undoTimer);
  toast.innerHTML = '';
  const msg = document.createElement('span');
  msg.textContent = label;
  const btn = document.createElement('button');
  btn.textContent = 'Undo';
  btn.addEventListener('click', undoNow);
  toast.append(msg, btn);
  toast.hidden = false;
  undoTimer = setTimeout(dismissToast, 5000);
}

function deleteItems(chosen: Item[]): void {
  if (chosen.length === 0) return;
  offerUndo(chosen.length === 1 ? 'Item deleted' : `${chosen.length} items deleted`);
  for (const i of chosen) fire(api.removeItem(i.id));
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
  const doneCount = items.filter((i) => i.done).length;
  menu.innerHTML = '';
  const entry = (label: string, act: () => void, cls = ''): void => {
    const b = document.createElement('button');
    b.textContent = label;
    if (cls) b.className = cls;
    b.addEventListener('click', () => {
      closeMenu();
      act();
    });
    menu.appendChild(b);
  };
  const separator = (): void => {
    const hr = document.createElement('div');
    hr.className = 'sep';
    menu.appendChild(hr);
  };

  entry(multi ? `Copy as list (${chosen.length})` : 'Copy', () =>
    copyStay(selectionText(), multi ? `${chosen.length} items` : 'item'),
  );
  if (!multi) entry('Edit', () => startEdit(chosen[0].id));
  separator();
  entry(allDone ? 'Mark not done' : 'Mark as done', () => {
    for (const i of chosen) fire(api.setDone(i.id, !allDone));
  });
  if (!multi)
    entry(chosen[0].pinned ? 'Unpin' : 'Pin', () =>
      fire(api.setPinned(chosen[0].id, !chosen[0].pinned)),
    );
  if (multi)
    entry(`Merge ${chosen.length} items`, () => {
      offerUndo(`${chosen.length} items merged`);
      fire(api.mergeItems(chosen.map((i) => i.id)));
    });
  separator();
  if (doneCount > 0)
    entry(`Clear done (${doneCount})`, () => deleteItems(items.filter((i) => i.done)), 'danger');
  entry(multi ? `Delete ${chosen.length} items` : 'Delete', () => deleteItems(chosen), 'danger');

  menu.hidden = false;
  // clamp inside the window once real dimensions exist
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(x, window.innerWidth - r.width - 6)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - r.height - 6)}px`;
}

document.addEventListener('mousedown', (e) => {
  if (!menu.hidden && e.target instanceof Node && !menu.contains(e.target)) closeMenu();
});

/* ── theme — accent palette (CSS) + appearance mode (nativeTheme via IPC) ── */

const THEMES = ['copper', 'steel', 'brass', 'patina'] as const;
const MODES = ['system', 'light', 'dark'] as const;
const themesPop = document.getElementById('themes') as HTMLDivElement;
const themeBtn = document.getElementById('win-theme') as HTMLButtonElement;

function applyTheme(theme: string): void {
  // copper = no attribute: the base tokens ARE the copper palette
  if (theme === 'copper') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  localStorage.setItem('theme', theme);
  for (const b of themesPop.querySelectorAll<HTMLButtonElement>('.swatch')) {
    b.setAttribute('aria-pressed', String(b.dataset.theme === theme));
  }
}

function applyMode(mode: ThemeMode): void {
  fire(api.setThemeMode(mode));
  localStorage.setItem('themeMode', mode);
  for (const b of themesPop.querySelectorAll<HTMLButtonElement>('#mode-seg button')) {
    b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
  }
}

function closeThemes(): void {
  themesPop.hidden = true;
  themeBtn.setAttribute('aria-expanded', 'false');
}

function toggleThemes(): void {
  themesPop.hidden = !themesPop.hidden;
  themeBtn.setAttribute('aria-expanded', String(!themesPop.hidden));
}

document.addEventListener('mousedown', (e) => {
  if (themesPop.hidden || !(e.target instanceof Node)) return;
  if (!themesPop.contains(e.target) && !themeBtn.contains(e.target)) closeThemes();
});

/* ── clipboard suggestion — the fallback capture offers instead of inserting ── */

const suggestEl = document.getElementById('suggest') as HTMLDivElement;
const suggestText = document.getElementById('suggest-text') as HTMLSpanElement;
let suggestion: string | null = null;

function showSuggestion(text: string): void {
  suggestion = text;
  // single-line preview; the row it becomes will clamp properly anyway
  suggestText.textContent = text.replace(/\s+/g, ' ').trim();
  suggestEl.hidden = false;
}

function hideSuggestion(): void {
  suggestion = null;
  suggestEl.hidden = true;
}

function acceptSuggestion(): void {
  if (suggestion === null) return;
  fire(api.acceptSuggestion(suggestion));
  hideSuggestion();
}

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
  clearAllBtn.hidden = items.length === 0;
  if (flashMessage) {
    statusLeft.textContent = flashMessage;
    statusLeft.classList.add('flash');
    statusRight.textContent = '';
    return;
  }
  statusLeft.classList.remove('flash');
  if (selectedIds.size > 1) {
    statusLeft.textContent = `${selectedIds.size} selected`;
    statusRight.textContent = '↵ copy list · ⌫ delete';
    return;
  }
  if (selectedIds.size === 1) {
    statusLeft.textContent = 'F2 edit · ⇧↓ extend';
    statusRight.textContent = 'space done · ↵ copy';
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
  statusRight.textContent = '↑↓ move · space done · ↵ copy';
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

function groupHeader(label: string): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'group';
  li.setAttribute('role', 'presentation');
  li.textContent = label;
  return li;
}

/** the section a row belongs to when the list is unfiltered */
function sectionOf(item: Item): string {
  if (item.done) return 'Done'; // done rows sit at the list's bottom
  if (item.pinned) return 'Pinned';
  const startOfToday = new Date().setHours(0, 0, 0, 0);
  if (!item.createdAt || item.createdAt >= startOfToday) return 'Today';
  if (item.createdAt >= startOfToday - 86_400_000) return 'Yesterday';
  return 'Earlier';
}

/** row text with the current filter match highlighted */
function textNodeFor(item: Item): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = 'text';
  const q = input.value.trim().toLowerCase();
  if (!q) {
    span.textContent = item.text;
    return span;
  }
  let rest = item.text;
  while (rest.length > 0) {
    const at = rest.toLowerCase().indexOf(q);
    if (at === -1) {
      span.appendChild(document.createTextNode(rest));
      break;
    }
    if (at > 0) span.appendChild(document.createTextNode(rest.slice(0, at)));
    const mark = document.createElement('mark');
    mark.textContent = rest.slice(at, at + q.length);
    span.appendChild(mark);
    rest = rest.slice(at + q.length);
  }
  return span;
}

function render(): void {
  const vis = visibleItems();
  const filtering = input.value.trim().length > 0;

  // an in-progress edit must survive re-renders (e.g. the 30s age refresh):
  // carry the live textarea text and caret across the rebuild
  let editDraft: { value: string; caret: number } | null = null;
  const liveTa = list.querySelector('textarea.edit') as HTMLTextAreaElement | null;
  if (liveTa && editingId !== null) {
    editDraft = { value: liveTa.value, caret: liveTa.selectionStart ?? liveTa.value.length };
  }

  list.innerHTML = '';

  if (items.length === 0) {
    list.appendChild(emptyRow('Double-tap Shift in any app to capture selected text', true));
  } else if (vis.length === 0) {
    list.appendChild(emptyRow(`No matches for “${input.value.trim()}”`, false));
  } else {
    let currentSection: string | null = null;
    vis.forEach((item) => {
      if (!filtering) {
        const section = sectionOf(item);
        if (section !== currentSection) {
          currentSection = section;
          // "Today" as the first header is noise — everything is today until
          // the list spans days or has pins
          if (!(section === 'Today' && list.children.length === 0)) {
            list.appendChild(groupHeader(section));
          }
        }
      }

      const isSelected = selectedIds.has(item.id);
      const li = document.createElement('li');
      li.className =
        'item' +
        (item.done ? ' done' : '') +
        (isSelected ? ' selected' : '') +
        (MONO_RE.test(item.text) ? ' mono' : '') +
        (enterIds.has(item.id) ? ' enter' : '');
      li.dataset.id = item.id;
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', String(isSelected));

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = item.done;
      cb.title = item.done ? 'Mark not done' : 'Mark as done';
      cb.setAttribute('aria-label', cb.title);
      cb.addEventListener('change', () => {
        // acting on a row makes it the active row — Delete right after works.
        // No immediate render(): it would rebuild from the not-yet-updated
        // items and visually revert the check until the store push lands.
        selectSingle(item.id);
        // focus back to <body>: a focused checkbox swallows the very Delete
        // (and arrows) the fresh selection is for
        cb.blur();
        fire(api.setDone(item.id, cb.checked));
      });

      let body: HTMLElement;
      if (editingId === item.id) {
        const ta = document.createElement('textarea');
        ta.className = 'edit';
        ta.value = editDraft ? editDraft.value : item.text;
        ta.rows = Math.min(6, ta.value.split('\n').length);
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
        body = textNodeFor(item);
      }

      const tail = document.createElement('span');
      tail.className = 'tail';

      const meta = document.createElement('span');
      meta.className = 'meta';
      if (item.pinned) {
        const glyph = document.createElement('span');
        glyph.className = 'glyph';
        glyph.textContent = '✦';
        meta.append(glyph);
      }
      const when = document.createElement('span');
      when.className = 'age';
      when.textContent = age(item.createdAt);
      meta.append(when);

      const actions = document.createElement('span');
      actions.className = 'actions';
      const copy = document.createElement('button');
      copy.className = 'copy';
      copy.setAttribute('aria-label', 'Copy item');
      copy.title = 'Copy';
      copy.appendChild(document.createElement('i'));
      copy.addEventListener('click', (e) => {
        e.stopPropagation();
        copyStay(item.text, 'item');
      });
      const del = document.createElement('button');
      del.className = 'del';
      del.textContent = '✕';
      del.title = 'Delete';
      del.setAttribute('aria-label', 'Delete item');
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteItems([item]);
      });
      actions.append(copy, del);

      tail.append(meta, actions);

      // drag a row (or the whole selection) out into any other app
      if (editingId !== item.id) {
        li.draggable = true;
        li.addEventListener('dragstart', (e) => {
          const text =
            selectedIds.has(item.id) && selectedIds.size > 1 ? selectionText() : item.text;
          e.dataTransfer?.setData('text/plain', text);
          if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
        });
      }

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
        } else if (selectedIds.size === 1 && selectedIds.has(item.id)) {
          // clicking the sole selected row again deselects it
          selectSingle(null);
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

    if (scrollToFocus && focusId !== null) {
      (list.querySelector(`[data-id="${CSS.escape(focusId)}"]`) as HTMLElement | null)
        ?.scrollIntoView({ block: 'nearest' });
    }
    scrollToFocus = false;
    if (editingId !== null) {
      const ta = list.querySelector('textarea.edit') as HTMLTextAreaElement | null;
      if (ta) {
        ta.focus();
        const caret = editDraft ? editDraft.caret : ta.value.length;
        ta.setSelectionRange(caret, caret);
      }
    }
  }

  enterIds = new Set(); // enter animation plays exactly once

  renderStatus();

  // no selection means the list has no keyboard claim — clicking a row control
  // otherwise strands focus on <body> and every shortcut goes dead
  if (focusId === null && editingId === null && menu.hidden) input.focus();
}

function setItems(next: Item[]): void {
  const prevIndex = visibleIndexOf(focusId); // index in the OLD visible list
  const prevIds = new Set(items.map((i) => i.id));
  items = next;
  if (initialLoadSettled) {
    enterIds = new Set(next.filter((i) => !prevIds.has(i.id)).map((i) => i.id));
  }
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
  clearAllBtn.addEventListener('click', () => {
    if (items.length === 0) return;
    offerUndo(`All ${items.length} items cleared`);
    fire(api.restoreItems([])); // one shot; the toast can bring everything back
  });
  document.getElementById('suggest-add')?.addEventListener('click', acceptSuggestion);
  document.getElementById('suggest-dismiss')?.addEventListener('click', hideSuggestion);
  api.onSuggest(showSuggestion);
  // a fresh capture arrives pre-selected: Enter right after double-shift
  // copies it back out with no arrowing. Blur the input so the keyboard
  // claim sits on the list — while the input is focused the list shortcuts
  // (Enter/Space/Delete) are inert.
  api.onCaptured((id) => {
    selectSingle(id);
    scrollToFocus = true;
    input.blur();
    render();
  });

  // restore the saved theme/mode before first paint settles; defaults apply
  // when storage is empty or holds a name from a since-removed palette
  const savedTheme = localStorage.getItem('theme') ?? 'copper';
  applyTheme((THEMES as readonly string[]).includes(savedTheme) ? savedTheme : 'copper');
  const savedMode = localStorage.getItem('themeMode') as ThemeMode | null;
  applyMode(savedMode !== null && (MODES as readonly string[]).includes(savedMode) ? savedMode : 'system');
  themeBtn.addEventListener('click', toggleThemes);
  for (const b of themesPop.querySelectorAll<HTMLButtonElement>('.swatch')) {
    b.addEventListener('click', () => applyTheme(b.dataset.theme ?? 'copper'));
  }
  for (const b of themesPop.querySelectorAll<HTMLButtonElement>('#mode-seg button')) {
    b.addEventListener('click', () => applyMode(b.dataset.mode as ThemeMode));
  }

  let dockedState = false;
  const pinBtn = document.getElementById('win-pin') as HTMLButtonElement;
  pinBtn.addEventListener('click', () => {
    dockedState = !dockedState;
    fire(api.setDocked(dockedState));
    pinBtn.classList.toggle('docked', dockedState);
    pinBtn.setAttribute('aria-pressed', String(dockedState));
    pinBtn.title = dockedState
      ? 'Unpin (back to quick overlay)'
      : 'Pin as window (stay open, show in taskbar)';
    flashStatus(dockedState ? 'Pinned — stays open' : 'Overlay mode');
  });
  document.getElementById('win-min')?.addEventListener('click', () => fire(api.hide()));
  maxBtn.addEventListener('click', () => fire(api.toggleMaximize()));
  api.onMaximizedChanged((maximized) => {
    maxBtn.classList.toggle('maximized', maximized);
    maxBtn.title = maximized ? 'Restore' : 'Maximize';
    maxBtn.setAttribute('aria-label', maxBtn.title);
  });
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
      scrollToFocus = true;
      render();
      e.preventDefault();
      e.stopPropagation(); // keep the document handler from re-incrementing
      input.blur();
    }
  });

  // paste is capture too: multi-line text pasted anywhere becomes an item
  // verbatim (an <input> would silently flatten the newlines)
  document.addEventListener('paste', (e) => {
    const text = e.clipboardData?.getData('text/plain') ?? '';
    if (!text.trim()) return;
    const inInput = document.activeElement === input;
    if (inInput && !text.includes('\n')) return; // ordinary single-line paste
    if (!inInput && document.activeElement !== document.body) return;
    e.preventDefault();
    fire(api.addItem(text));
    flashStatus('Added from clipboard');
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!themesPop.hidden) {
        closeThemes();
        return;
      }
      if (!menu.hidden) {
        closeMenu();
        return;
      }
      // an open editor handles its own Escape (stopPropagation) — reaching
      // here means nothing is mid-edit, so Escape dismisses the overlay
      fire(api.hide());
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      if (undoSnapshot) {
        undoNow();
        e.preventDefault();
      }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
      // pin toggle works from anywhere, even while the input is focused
      (document.getElementById('win-pin') as HTMLButtonElement).click();
      e.preventDefault();
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
          scrollToFocus = true;
          render();
        }
      }
      e.preventDefault();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
      // copy-and-stay: keep grabbing without re-summoning
      const chosen = selectedItems();
      if (chosen.length > 0)
        copyStay(selectionText(), chosen.length > 1 ? `${chosen.length} items` : 'item');
    } else if (e.key === 'Enter') {
      // copy-and-go: the classic grab-and-paste flow
      if (selectedIds.size > 0) fire(api.copyOut(selectionText()));
    } else if (e.key === 'F2') {
      if (focusId !== null && selectedIds.size === 1) startEdit(focusId);
    } else if (e.key === ' ') {
      const chosen = selectedItems();
      const allDone = chosen.length > 0 && chosen.every((i) => i.done);
      for (const item of chosen) fire(api.setDone(item.id, !allDone));
      e.preventDefault();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      // Backspace too: Mac laptop keyboards have no forward-delete
      deleteItems(selectedItems());
    }
  });

  // a real summon (main-process signal) resets transient UI; a mere refocus
  // (alt-tab back) must NOT wipe the user's filter/selection/edit
  api.onShown(() => {
    selectSingle(null);
    editingId = null;
    input.value = '';
    closeMenu();
    closeThemes();
    dismissToast();
    hideSuggestion(); // each summon brings its own (the suggest event follows)
    summon();
    render(); // render() refocuses the input when nothing is selected
  });

  // ages drift while the overlay sits open; refresh them quietly
  setInterval(() => {
    if (document.visibilityState === 'visible' && editingId === null && menu.hidden) render();
  }, 30_000);

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
      initialLoadSettled = true;
    })
    .catch(() => {
      // a failed first read must not wedge the UI: accept pushes from here on
      initialLoadDone = true;
      initialLoadSettled = true;
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
