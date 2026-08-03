import * as React from 'react';
import { toast } from 'sonner';
import type { Item, ThemeMode } from '@shared/api';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Composer, type InputMode } from '@/components/composer';
import { ItemList } from '@/components/item-list';
import { StatusBar } from '@/components/status-bar';
import { SuggestionBar } from '@/components/suggestion-bar';
import { Titlebar } from '@/components/titlebar';
import { useDocumentListener } from '@/hooks/use-event-listener';
import { useTheme } from '@/hooks/use-theme';
import { api, fire } from '@/lib/api';
import { visibleItems } from '@/lib/items';
import {
  NO_SELECTION,
  pruneSelection,
  selectRange,
  selectSingle,
  selectedItems,
  selectionText,
  toggleSelected,
  type Selection,
} from '@/lib/selection';

/** keep a ref pointed at the newest render's values, so the IPC subscriptions
 * (registered once, fired much later) never reconcile against stale state */
function useLatest<T>(value: T): React.RefObject<T> {
  const ref = React.useRef(value);
  React.useEffect(() => {
    ref.current = value;
  });
  return ref;
}

export function App() {
  const [items, setItems] = React.useState<Item[]>([]);
  const [selection, setSelection] = React.useState<Selection>(NO_SELECTION);
  const [expandedId, setExpandedId] = React.useState<string | null>(null);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  /** ids that just arrived — they get the enter animation exactly once */
  const [enterIds, setEnterIds] = React.useState<ReadonlySet<string>>(new Set());
  /** rows measured as actually cut off; drives the peek affordance and hint */
  const [clampedIds, setClampedIds] = React.useState<ReadonlySet<string>>(new Set());

  const [mode, setModeState] = React.useState<InputMode>('add');
  const [input, setInput] = React.useState('');
  const [inputFocused, setInputFocused] = React.useState(false);
  const [suggestion, setSuggestion] = React.useState<string | null>(null);
  const [flash, setFlash] = React.useState<string | null>(null);

  const [docked, setDocked] = React.useState(false);
  const [maximized, setMaximized] = React.useState(false);
  const [themeMenuOpen, setThemeMenuOpen] = React.useState(false);
  const [contextMenuOpen, setContextMenuOpen] = React.useState(false);
  /** bumped on every real summon: remounts the panel, which replays the scale-in
   * animation and closes any context menu left open from last time */
  const [summonKey, setSummonKey] = React.useState(0);
  /** ages drift while the overlay sits open; this forces the quiet refresh */
  const [, setAgeTick] = React.useState(0);

  const theme = useTheme();

  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLUListElement>(null);
  /** scroll the focus row into view only after KEYBOARD navigation — a mouse
   * click elsewhere must not teleport the list */
  const scrollToFocus = React.useRef(false);
  const flashTimer = React.useRef<ReturnType<typeof setTimeout>>(undefined);
  const undoSnapshot = React.useRef<Item[] | null>(null);
  const initialLoadDone = React.useRef(false);
  const initialLoadSettled = React.useRef(false);

  // in add mode the input is a draft, not a filter — the list stays whole
  const query = mode === 'search' ? input : '';
  const filtering = mode === 'search' && input.trim().length > 0;
  const visible = React.useMemo(() => visibleItems(items, query), [items, query]);
  const selected = React.useMemo(
    () => selectedItems(visible, selection),
    [visible, selection],
  );

  const latest = useLatest({ items, visible, selection, editingId, expandedId, query });

  /* ── store reconciliation ─────────────────────────────────────────────── */

  const applyItems = React.useCallback(
    (next: Item[]): void => {
      const prev = latest.current;
      const prevIndex =
        prev.selection.focusId === null
          ? -1
          : prev.visible.findIndex((i) => i.id === prev.selection.focusId);
      const prevIds = new Set(prev.items.map((i) => i.id));
      const alive = new Set(next.map((i) => i.id));

      setItems(next);
      if (initialLoadSettled.current) {
        setEnterIds(new Set(next.filter((i) => !prevIds.has(i.id)).map((i) => i.id)));
      }
      if (prev.editingId !== null && !alive.has(prev.editingId)) setEditingId(null);
      if (prev.expandedId !== null && !alive.has(prev.expandedId)) setExpandedId(null);

      if (prev.selection.focusId !== null && !alive.has(prev.selection.focusId)) {
        // the focus row was removed: keep the slot so repeat-Delete works
        const nextVisible = visibleItems(next, prev.query);
        const slot = nextVisible[Math.min(prevIndex, nextVisible.length - 1)];
        setSelection(selectSingle(slot ? slot.id : null));
      } else {
        setSelection((s) => pruneSelection(s, alive));
      }
    },
    [latest],
  );

  /* ── transient status flash ("Copied to clipboard") ───────────────────── */

  const flashStatus = React.useCallback((message: string): void => {
    setFlash(message);
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 1400);
  }, []);

  /** copy without hiding; the footer confirms */
  const copyStay = (text: string, what: string): void => {
    fire(api.copyText(text));
    flashStatus(`Copied ${what}`);
  };

  /* ── undo (snapshot-based; covers delete / merge / clear-all) ─────────── */

  const undoNow = React.useCallback((): void => {
    if (!undoSnapshot.current) return;
    fire(api.restoreItems(undoSnapshot.current));
    undoSnapshot.current = null;
    toast.dismiss('undo');
  }, []);

  /** call BEFORE a destructive mutation */
  const offerUndo = (label: string): void => {
    undoSnapshot.current = latest.current.items.map((i) => ({ ...i }));
    toast(label, {
      id: 'undo',
      duration: 5000,
      action: { label: 'Undo', onClick: undoNow },
      onDismiss: () => void (undoSnapshot.current = null),
      onAutoClose: () => void (undoSnapshot.current = null),
    });
  };

  const deleteItems = (chosen: Item[]): void => {
    if (chosen.length === 0) return;
    offerUndo(chosen.length === 1 ? 'Item deleted' : `${chosen.length} items deleted`);
    for (const i of chosen) fire(api.removeItem(i.id));
  };

  /* ── input mode ───────────────────────────────────────────────────────── */

  // the draft text survives a switch (type first, decide later), but the filter
  // it may imply has to be applied or lifted immediately
  const setMode = (next: InputMode): void => {
    if (mode === next) return;
    setModeState(next);
    // entering search with text already typed = that text becomes the filter now
    if (next === 'search' && input.trim()) setSelection(NO_SELECTION);
  };

  /* ── effects ──────────────────────────────────────────────────────────── */

  // the enter animation plays exactly once per newly captured row
  React.useEffect(() => {
    if (enterIds.size === 0) return;
    const t = setTimeout(() => setEnterIds(new Set()), 700);
    return () => clearTimeout(t);
  }, [enterIds]);

  React.useLayoutEffect(() => {
    if (!scrollToFocus.current) return;
    scrollToFocus.current = false;
    const id = selection.focusId;
    if (id === null) return;
    listRef.current
      ?.querySelector(`[data-id="${CSS.escape(id)}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  });

  React.useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === 'visible' && editingId === null && !contextMenuOpen) {
        setAgeTick((n) => n + 1);
      }
    }, 30_000);
    return () => clearInterval(t);
  }, [editingId, contextMenuOpen]);

  // IPC wiring: registered once, reconciling through `latest`
  React.useEffect(() => {
    const offSuggest = api.onSuggest(setSuggestion);
    // a fresh capture arrives pre-selected: Enter right after double-shift
    // copies it back out with no arrowing. Blur the input so the keyboard claim
    // sits on the list — while the input is focused the list shortcuts are inert.
    const offCaptured = api.onCaptured((id) => {
      setSelection(selectSingle(id));
      scrollToFocus.current = true;
      inputRef.current?.blur();
    });
    const offMaximized = api.onMaximizedChanged(setMaximized);
    // a real summon resets transient UI; a mere refocus (alt-tab back) must NOT
    // wipe the user's filter, selection, or in-progress edit
    const offShown = api.onShown(() => {
      setSelection(NO_SELECTION);
      setEditingId(null);
      setExpandedId(null);
      setInput('');
      setModeState('add'); // each summon starts in the default capture-and-add stance
      setSuggestion(null); // each summon brings its own (the suggest event follows)
      setThemeMenuOpen(false);
      toast.dismiss();
      undoSnapshot.current = null;
      // a fresh summon starts with nothing focused; Tab reaches the fields
      (document.activeElement as HTMLElement | null)?.blur?.();
      setSummonKey((k) => k + 1);
    });
    // ignore pushed updates until the initial snapshot settles, so a mutation
    // landing mid-load can't be overwritten by the older getItems() result
    const offItems = api.onItemsChanged((next) => {
      if (initialLoadDone.current) applyItems(next);
    });

    api
      .getItems()
      .then((next) => {
        initialLoadDone.current = true;
        applyItems(next);
        initialLoadSettled.current = true;
      })
      .catch(() => {
        // a failed first read must not wedge the UI: accept pushes from here on
        initialLoadDone.current = true;
        initialLoadSettled.current = true;
      });

    return () => {
      offSuggest();
      offCaptured();
      offMaximized();
      offShown();
      offItems();
    };
  }, [applyItems]);

  /* ── keyboard ─────────────────────────────────────────────────────────── */

  // paste is capture too: multi-line text pasted anywhere becomes an item
  // verbatim (an <input> would silently flatten the newlines)
  useDocumentListener('paste', (e) => {
    const text = e.clipboardData?.getData('text/plain') ?? '';
    if (!text.trim()) return;
    const inInput = document.activeElement === inputRef.current;
    if (inInput && !text.includes('\n')) return; // ordinary single-line paste
    if (!inInput && document.activeElement !== document.body) return;
    e.preventDefault();
    fire(api.addItem(text));
    flashStatus('Added from clipboard');
  });

  useDocumentListener('keydown', (e) => {
    // Nothing is focused on summon; Tab toggles between the input and "nothing
    // focused" (which is what arms the list shortcuts). Handled here so Tab
    // never wanders into titlebar buttons. The inline editor stops propagation,
    // so it is unaffected.
    if (e.key === 'Tab') {
      const active = document.activeElement;
      if (active === inputRef.current) inputRef.current?.blur();
      else if (active === document.body) inputRef.current?.focus();
      else return; // some other control legitimately holds focus — native Tab
      e.preventDefault();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
      // the universal "find" gesture: flip to search mode and start typing
      setMode('search');
      inputRef.current?.focus();
      e.preventDefault();
      return;
    }
    if (e.key === 'Escape') {
      // an open menu or popover owns its own Escape (Radix closes it); an open
      // editor stops propagation. Reaching here means Escape dismisses.
      if (themeMenuOpen || contextMenuOpen) return;
      fire(api.hide());
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      if (undoSnapshot.current) {
        undoNow();
        e.preventDefault();
      }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
      // pin toggle works from anywhere, even while the input is focused
      toggleDocked();
      e.preventDefault();
      return;
    }
    if (document.activeElement === inputRef.current) return;
    // a focused checkbox, button, or editor owns its own key handling: acting
    // here would suppress the native behavior and mutate a different row
    if (document.activeElement !== document.body) return;

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const dir = e.key === 'ArrowDown' ? 1 : -1;
      const i = selection.focusId === null ? -1 : visible.findIndex((v) => v.id === selection.focusId);
      if (dir === -1 && i <= 0) {
        selectRow(null); // off the top: back to no selection, nothing focused
      } else {
        const next = visible[Math.max(0, Math.min(i + dir, visible.length - 1))];
        if (next) {
          if (e.shiftKey) {
            setExpandedId(null); // a multi-selection has no single row to peek at
            setSelection((s) => selectRange(visible, s, next.id));
          } else {
            selectRow(next.id);
          }
          scrollToFocus.current = true;
        }
      }
      e.preventDefault();
    } else if (e.key === 'ArrowRight') {
      // expand-on-demand: the ONLY way a row grows — never on mere selection
      const id = selection.focusId;
      if (id !== null && selection.ids.size === 1 && expandedId !== id && clampedIds.has(id)) {
        setExpandedId(id);
      }
      e.preventDefault();
    } else if (e.key === 'ArrowLeft') {
      setExpandedId(null);
      e.preventDefault();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
      // copy-and-stay: keep grabbing without re-summoning
      if (selected.length > 0) copySelection();
    } else if (e.key === 'Enter') {
      // copy-and-go: the classic grab-and-paste flow
      if (selection.ids.size > 0) fire(api.copyOut(selectionText(visible, selection)));
    } else if (e.key === 'F2') {
      if (selection.focusId !== null && selection.ids.size === 1) setEditingId(selection.focusId);
    } else if (e.key === ' ') {
      const allDone = selected.length > 0 && selected.every((i) => i.done);
      for (const item of selected) fire(api.setDone(item.id, !allDone));
      e.preventDefault();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      // Backspace too: Mac laptop keyboards have no forward-delete
      deleteItems(selected);
    }
  });

  /* ── actions ──────────────────────────────────────────────────────────── */

  /** select one row; leaving a row collapses its peek */
  function selectRow(id: string | null): void {
    if (id !== expandedId) setExpandedId(null);
    setSelection(selectSingle(id));
  }

  function copySelection(): void {
    copyStay(
      selectionText(visible, selection),
      selected.length > 1 ? `${selected.length} items` : 'item',
    );
  }

  function toggleDocked(): void {
    const next = !docked;
    setDocked(next);
    fire(api.setDocked(next));
    flashStatus(next ? 'Pinned — stays open' : 'Overlay mode');
  }

  const status = describeStatus();

  return (
    <TooltipProvider delayDuration={600}>
      <div key={summonKey} className="flex h-full animate-summon flex-col">
        <Titlebar
          docked={docked}
          onToggleDocked={toggleDocked}
          maximized={maximized}
          onToggleMaximize={() => fire(api.toggleMaximize())}
          onHide={() => fire(api.hide())}
          theme={theme.theme}
          onThemeChange={theme.setTheme}
          mode={theme.mode}
          onModeChange={(m: ThemeMode) => theme.setMode(m)}
          themeMenuOpen={themeMenuOpen}
          onThemeMenuOpenChange={setThemeMenuOpen}
        />

        <Composer
          mode={mode}
          onModeChange={(next) => {
            setMode(next);
            inputRef.current?.focus();
          }}
          value={input}
          onValueChange={(value) => {
            setInput(value);
            // in search mode every keystroke re-narrows; in add mode it's a draft
            if (mode === 'search') setSelection(NO_SELECTION);
          }}
          onFocus={() => setInputFocused(true)}
          onBlur={() => setInputFocused(false)}
          inputRef={inputRef}
          onKeyDown={(e) => {
            // isComposing: Enter that commits an IME candidate must not add an
            // item. The input keeps focus so several adds chain naturally.
            if (e.key === 'Enter' && mode === 'add' && !e.nativeEvent.isComposing && input.trim()) {
              fire(api.addItem(input.trim()));
              setInput('');
            }
            if (e.key === 'Escape' && input) {
              // first Escape clears the draft/filter; an empty second one hides
              e.stopPropagation();
              setInput('');
            }
            if (e.key === 'ArrowDown' && visible.length > 0) {
              selectRow(visible[0].id);
              scrollToFocus.current = true;
              e.preventDefault();
              e.stopPropagation(); // keep the document handler from re-moving
              inputRef.current?.blur();
            }
          }}
        />

        {suggestion !== null && (
          <SuggestionBar
            text={suggestion}
            onAccept={() => {
              fire(api.acceptSuggestion(suggestion));
              setSuggestion(null);
            }}
            onDismiss={() => setSuggestion(null)}
          />
        )}

        <ItemList
          ref={listRef}
          items={items}
          visible={visible}
          selection={selection}
          selected={selected}
          expandedId={expandedId}
          editingId={editingId}
          enterIds={enterIds}
          clampedIds={clampedIds}
          query={query}
          filtering={filtering}
          onClampedChange={(id, clamped) =>
            setClampedIds((prev) => {
              if (prev.has(id) === clamped) return prev; // no churn on re-measure
              const next = new Set(prev);
              if (clamped) next.add(id);
              else next.delete(id);
              return next;
            })
          }
          onSelectClick={(item, e) => {
            if (editingId === item.id) return;
            if (e.ctrlKey || e.metaKey) {
              // toggle membership; focus follows the click
              setSelection((s) => toggleSelected(s, item.id));
            } else if (e.shiftKey) {
              setExpandedId(null);
              setSelection((s) => selectRange(visible, s, item.id));
            } else {
              // re-clicking a selected row keeps it selected (click ≠ toggle);
              // Ctrl+click is the explicit deselect
              selectRow(item.id);
            }
          }}
          onRowContextMenu={(item) => {
            if (!selection.ids.has(item.id)) selectRow(item.id);
          }}
          onActivate={(item) => {
            // double-click = "take this one": copy it out AND mark it handled
            if (!item.done) fire(api.setDone(item.id, true));
            fire(api.copyOut(item.text));
          }}
          onToggleDone={(item, done) => {
            // acting on a row makes it the active row — Delete right after works
            selectRow(item.id);
            // a focused checkbox swallows the very Delete (and arrows) the fresh
            // selection is for, so hand focus back to <body>
            (document.activeElement as HTMLElement | null)?.blur?.();
            fire(api.setDone(item.id, done));
          }}
          onToggleExpand={(item) => {
            const next = expandedId === item.id ? null : item.id;
            setSelection(selectSingle(item.id)); // expanding a row also focuses it
            setExpandedId(next);
          }}
          onCopyItem={(item) => copyStay(item.text, 'item')}
          onDelete={deleteItems}
          onDragStart={(item, e) => {
            // drag a row (or the whole selection) out into any other app
            const text =
              selection.ids.has(item.id) && selection.ids.size > 1
                ? selectionText(visible, selection)
                : item.text;
            e.dataTransfer.setData('text/plain', text);
            e.dataTransfer.effectAllowed = 'copy';
          }}
          onCommitEdit={(item, text) => {
            setEditingId(null);
            if (text.trim()) fire(api.updateItem(item.id, text)); // blank = cancel
          }}
          onCancelEdit={() => setEditingId(null)}
          onStartEdit={(item) => setEditingId(item.id)}
          onCopySelection={copySelection}
          onSetDoneAll={(chosen, done) => {
            for (const i of chosen) fire(api.setDone(i.id, done));
          }}
          onTogglePin={(item) => fire(api.setPinned(item.id, !item.pinned))}
          onMerge={(chosen) => {
            offerUndo(`${chosen.length} items merged`);
            fire(api.mergeItems(chosen.map((i) => i.id)));
          }}
          onClearDone={() => deleteItems(items.filter((i) => i.done))}
          onContextMenuOpenChange={setContextMenuOpen}
          onBackgroundClick={() => {
            if (selection.ids.size > 0) selectRow(null);
          }}
        />

        <StatusBar
          left={status.left}
          right={status.right}
          flashing={flash !== null}
          showClearAll={items.length > 0}
          onClearAll={() => {
            if (items.length === 0) return;
            offerUndo(`All ${items.length} items cleared`);
            fire(api.restoreItems([])); // one shot; the toast brings it all back
          }}
        />
      </div>

      <Toaster position="bottom-center" offset={40} />
    </TooltipProvider>
  );

  function describeStatus(): { left: string; right: string } {
    if (flash !== null) return { left: flash, right: '' };
    if (selection.ids.size > 1) {
      return { left: `${selection.ids.size} selected`, right: '↵ copy list · ⌫ delete' };
    }
    if (selection.ids.size === 1) {
      // advertise the peek only when there is hidden text to peek at
      const id = selection.focusId;
      const peek =
        id !== null && expandedId === id ? '← less' : id !== null && clampedIds.has(id) ? '→ more' : null;
      return {
        left: peek ? `${peek} · F2 edit` : 'F2 edit · ⇧↓ extend',
        right: 'space done · ↵ copy',
      };
    }
    if (filtering && inputFocused) {
      return { left: `${visible.length} of ${items.length}`, right: 'esc clear' };
    }
    if (items.length === 0) return { left: '0 items', right: '⇥ add' };
    const done = items.filter((i) => i.done).length;
    return {
      left: `${items.length} ${items.length === 1 ? 'item' : 'items'}${done ? ` · ${done} done` : ''}`,
      right: '↑↓ move · space done · ↵ copy',
    };
  }
}
