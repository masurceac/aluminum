# Aluminum — Copper-like Quick-Capture App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A cross-platform (Windows + macOS) tray/menu-bar app with an always-on-top overlay panel that captures the current text selection from any app on double-tap Shift, stores it in a hybrid to-do/clipboard list (local JSON file), and copies items back out to the clipboard.

**Architecture:** Electron main process owns the tray, the frameless overlay window, the JSON store, the global key hook (`uiohook-napi`), and a persistent per-platform native helper process that reads foreign-app text selections — Windows: C# helper using UI Automation `TextPattern.GetSelection`; macOS: Swift helper using the `AXUIElement` accessibility API (`kAXSelectedTextAttribute`). Both helpers speak the same line protocol over stdio, so the Electron side is platform-agnostic apart from the helper path. When the native API fails (app doesn't expose the attribute), the helper synthesizes Ctrl+C / Cmd+C and the main process reads/restores the clipboard (fallback trick). The renderer is a vanilla-TS list UI talking to main over a contextBridge IPC API.

**Tech Stack:** Electron, TypeScript, esbuild (bundling), vitest (unit tests for pure logic), `uiohook-napi` (global key hook, prebuilds for win32 + darwin), C# (.NET Framework 4.8 via built-in `csc.exe`) for the Windows helper, Swift (via `swiftc`, requires Xcode Command Line Tools) for the macOS helper.

**Scope decisions (from spec analysis):**
- Local dev build only — **no** code signing, notarization, auto-update, or installer work. On macOS, locally-built binaries run without Gatekeeper friction; Accessibility permission must be granted manually (System Settings → Privacy & Security → Accessibility).
- Targets: Windows 11 (primary dev machine) and macOS 14+. macOS tasks are written to be executable on a Mac; on the Windows machine they are code-complete but verified later on Mac hardware.
- Native API route (UI Automation / AXUIElement) is primary; clipboard trick is the automatic fallback, not the main path.
- No sync, no account, no telemetry. Data = one JSON file in `app.getPath('userData')`.

**Delegation policy (for the orchestrating agent):**
Each task carries a `**Delegation:**` tag.
- `Opus 5 subagent` — mechanical execution: complete code is provided in the task, low ambiguity. Dispatch with the Agent tool using `model: "opus"`.
- `main model` — heavy reasoning: native/platform integration where build environments, permissions, or OS quirks may require live debugging. Execute with the primary model.
The orchestrator reviews every task's result (tests/verification output) regardless of who executed it.

**File structure:**

```
package.json
tsconfig.json
vitest.config.ts
scripts/build.mjs              # esbuild: main, preload, renderer bundles → dist/
src/main/main.ts               # app lifecycle, tray, overlay window, IPC, wiring
src/main/store.ts              # JSON-file item store (pure, testable)
src/main/double-tap.ts         # double-tap detector state machine (pure, testable)
src/main/selection.ts          # client for the native helpers + capture-with-fallback flow
src/main/preload.ts            # contextBridge API
src/renderer/index.html
src/renderer/renderer.ts       # list UI, keyboard handling
src/renderer/style.css
helper/SelectionHelper.cs      # Windows: UIA capture + Ctrl+C synth, line protocol on stdio
helper/build-helper.ps1        # compiles Windows helper with built-in csc.exe (no SDK needed)
helper/SelectionHelper.swift   # macOS: AXUIElement capture + Cmd+C synth, same protocol
helper/build-helper.sh         # compiles macOS helper with swiftc (Xcode CLT)
tests/double-tap.test.ts
tests/store.test.ts
```

---

### Task 1: Project scaffold

**Delegation:** Opus 5 subagent (mechanical — all file contents provided)

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `scripts/build.mjs`, `.gitignore` (modify existing)

- [ ] **Step 1: Init npm project and install dependencies**

```bash
npm init -y
npm install --save-dev electron typescript esbuild vitest @types/node
npm install uiohook-napi
```

- [ ] **Step 2: Write `package.json` fields** (merge into generated file)

```json
{
  "name": "aluminum",
  "version": "0.1.0",
  "private": true,
  "main": "dist/main.js",
  "scripts": {
    "build": "node scripts/build.mjs",
    "start": "npm run build && electron .",
    "test": "vitest run",
    "helper": "node -e \"require('child_process').execSync(process.platform==='win32' ? 'powershell -ExecutionPolicy Bypass -File helper/build-helper.ps1' : 'bash helper/build-helper.sh', {stdio:'inherit'})\""
  }
}
```

- [ ] **Step 3: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src", "tests"]
}
```

- [ ] **Step 4: Write `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
```

- [ ] **Step 5: Write `scripts/build.mjs`**

```js
import { build } from 'esbuild';
import { cpSync, mkdirSync } from 'node:fs';

mkdirSync('dist', { recursive: true });

// Main process — CJS, keep native/electron modules external
await build({
  entryPoints: ['src/main/main.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: 'dist/main.js',
  external: ['electron', 'uiohook-napi'],
});

// Preload — CJS (sandboxed preload requires CJS)
await build({
  entryPoints: ['src/main/preload.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: 'dist/preload.js',
  external: ['electron'],
});

// Renderer — browser bundle
await build({
  entryPoints: ['src/renderer/renderer.ts'],
  bundle: true,
  platform: 'browser',
  format: 'iife',
  outfile: 'dist/renderer.js',
});

cpSync('src/renderer/index.html', 'dist/index.html');
cpSync('src/renderer/style.css', 'dist/style.css');
console.log('build ok');
```

- [ ] **Step 6: Append to `.gitignore`**

```
node_modules/
dist/
helper/SelectionHelper.exe
helper/SelectionHelper
```

- [ ] **Step 7: Verify build tooling runs** (no entry files yet — create placeholder stubs so the build passes)

Create minimal placeholder files:

`src/main/main.ts`:
```ts
console.log('placeholder');
```

`src/main/preload.ts`:
```ts
export {};
```

`src/renderer/renderer.ts`:
```ts
export {};
```

`src/renderer/index.html`:
```html
<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Aluminum</title></head><body></body></html>
```

`src/renderer/style.css`:
```css
/* placeholder */
```

Run: `npm run build`
Expected: prints `build ok`, files appear in `dist/`.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: scaffold electron + esbuild + vitest project"
```

---

### Task 2: Double-tap Shift detector (pure logic, TDD)

The detector is a state machine fed raw keydown/keyup events from uiohook. It fires when: Shift is pressed and released cleanly (no other key in between), then pressed again within the time window. Holding Shift (auto-repeat keydowns without keyup) must NOT fire. Shift used as a modifier (Shift+A) must NOT fire.

**Delegation:** Opus 5 subagent (mechanical — tests and implementation provided verbatim)

**Files:**
- Create: `src/main/double-tap.ts`
- Test: `tests/double-tap.test.ts`

- [ ] **Step 1: Write the failing tests**

`tests/double-tap.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { DoubleTapDetector } from '../src/main/double-tap';

const SHIFT_L = 42;
const SHIFT_R = 54;
const KEY_A = 30;

function makeDetector() {
  let t = 0;
  const det = new DoubleTapDetector({
    codes: [SHIFT_L, SHIFT_R],
    windowMs: 300,
    now: () => t,
  });
  return { det, tick: (ms: number) => { t += ms; } };
}

describe('DoubleTapDetector', () => {
  it('fires on two clean shift taps within the window', () => {
    const { det, tick } = makeDetector();
    expect(det.keydown(SHIFT_L)).toBe(false);
    det.keyup(SHIFT_L);
    tick(100);
    expect(det.keydown(SHIFT_L)).toBe(true);
  });

  it('does not fire when taps are too slow', () => {
    const { det, tick } = makeDetector();
    det.keydown(SHIFT_L);
    det.keyup(SHIFT_L);
    tick(500);
    expect(det.keydown(SHIFT_L)).toBe(false);
  });

  it('does not fire when another key interleaves (shift used as modifier)', () => {
    const { det, tick } = makeDetector();
    det.keydown(SHIFT_L);
    det.keydown(KEY_A); // Shift+A
    det.keyup(KEY_A);
    det.keyup(SHIFT_L);
    tick(50);
    expect(det.keydown(SHIFT_L)).toBe(false);
  });

  it('does not fire on held-key auto-repeat (keydown repeats, no keyup)', () => {
    const { det, tick } = makeDetector();
    det.keydown(SHIFT_L);
    tick(50);
    expect(det.keydown(SHIFT_L)).toBe(false);
    tick(50);
    expect(det.keydown(SHIFT_L)).toBe(false);
  });

  it('treats left and right shift as the same tap target', () => {
    const { det, tick } = makeDetector();
    det.keydown(SHIFT_L);
    det.keyup(SHIFT_L);
    tick(100);
    expect(det.keydown(SHIFT_R)).toBe(true);
  });

  it('resets after firing (third tap starts a fresh sequence)', () => {
    const { det, tick } = makeDetector();
    det.keydown(SHIFT_L);
    det.keyup(SHIFT_L);
    tick(100);
    expect(det.keydown(SHIFT_L)).toBe(true);
    det.keyup(SHIFT_L);
    tick(100);
    expect(det.keydown(SHIFT_L)).toBe(false); // needs a full new tap first
  });

  it('non-shift keydown alone never fires', () => {
    const { det } = makeDetector();
    expect(det.keydown(KEY_A)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/double-tap.test.ts`
Expected: FAIL — cannot resolve `../src/main/double-tap`.

- [ ] **Step 3: Write the implementation**

`src/main/double-tap.ts`:
```ts
export interface DoubleTapOptions {
  /** uiohook keycodes that count as the tap key (e.g. left + right shift) */
  codes: number[];
  /** max ms between first tap's keyup and second tap's keydown */
  windowMs: number;
  /** clock injection for tests; defaults to Date.now */
  now?: () => number;
}

/**
 * Detects a double-tap of a (modifier) key from raw keydown/keyup events.
 * A "clean tap" = keydown then keyup with no other key pressed in between.
 * Fires on the keydown of the press that follows a clean tap, when it arrives
 * within windowMs of that tap's keyup.
 */
export class DoubleTapDetector {
  private readonly codes: Set<number>;
  private readonly windowMs: number;
  private readonly now: () => number;

  /** timestamp of the keyup that completed the last clean tap, or null */
  private lastCleanTapUp: number | null = null;
  /** which target keycode is currently down, or null */
  private downCode: number | null = null;
  /** another key was pressed while target key was down */
  private sawOtherKey = false;
  /** the current press already fired; its keyup must not seed a new sequence */
  private firedOnThisPress = false;

  constructor(opts: DoubleTapOptions) {
    this.codes = new Set(opts.codes);
    this.windowMs = opts.windowMs;
    this.now = opts.now ?? Date.now;
  }

  /** Feed a keydown. Returns true when the double-tap fires. */
  keydown(code: number): boolean {
    if (!this.codes.has(code)) {
      // some other key: taints an in-progress tap and kills any pending first tap
      if (this.downCode !== null) this.sawOtherKey = true;
      this.lastCleanTapUp = null;
      return false;
    }
    if (this.downCode !== null) {
      // a target key is already held: this is either auto-repeat of that key,
      // or the other shift being tapped while it is held — neither can fire,
      // and a second target key during this press means it is not a clean tap
      if (code !== this.downCode) this.sawOtherKey = true;
      return false;
    }
    const fired =
      this.lastCleanTapUp !== null &&
      this.now() - this.lastCleanTapUp <= this.windowMs;
    this.downCode = code;
    this.sawOtherKey = false;
    this.firedOnThisPress = fired;
    this.lastCleanTapUp = null; // pending tap is now either consumed or expired
    return fired;
  }

  /** Feed a keyup. */
  keyup(code: number): void {
    // ignore unmatched/stray keyups so they cannot destroy a pending tap
    if (code !== this.downCode) return;
    if (!this.sawOtherKey && !this.firedOnThisPress) {
      this.lastCleanTapUp = this.now();
    } else {
      this.lastCleanTapUp = null;
    }
    this.downCode = null;
    this.sawOtherKey = false;
    this.firedOnThisPress = false;
  }

  /** Drop all state (escape hatch for hook restarts). */
  reset(): void {
    this.lastCleanTapUp = null;
    this.downCode = null;
    this.sawOtherKey = false;
    this.firedOnThisPress = false;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/double-tap.test.ts`
Expected: all tests PASS. (The shipped suite grew during review to 13 tests — the 7 above plus: between-taps key cancel, 300/301 ms window boundary pair, other-shift-tapped-while-held, both-shifts-overlap release order, and reset(). See `tests/double-tap.test.ts` for the authoritative set.)

- [ ] **Step 5: Commit**

```bash
git add src/main/double-tap.ts tests/double-tap.test.ts
git commit -m "feat: double-tap shift detector state machine"
```

---

### Task 3: Item store (JSON file, TDD)

**Delegation:** Opus 5 subagent (mechanical — tests and implementation provided verbatim)

**Files:**
- Create: `src/main/store.ts`
- Test: `tests/store.test.ts`

- [ ] **Step 1: Write the failing tests**

`tests/store.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
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
    require('node:fs').writeFileSync(file, '{not json');
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
```

Review hardened the shipped suite — see `tests/store.test.ts` for the authoritative set.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/store.test.ts`
Expected: FAIL — cannot resolve `../src/main/store`.

- [ ] **Step 3: Write the implementation**

`src/main/store.ts`:
```ts
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  renameSync,
  existsSync,
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
    try {
      const raw = JSON.parse(readFileSync(this.filePath, 'utf8'));
      this.items = Array.isArray(raw.items) ? raw.items : [];
    } catch (err) {
      // keep unreadable data around instead of overwriting it on the next save
      if (existsSync(this.filePath)) {
        try {
          renameSync(this.filePath, `${this.filePath}.corrupt-${Date.now()}`);
        } catch {
          /* best effort */
        }
        this.opts.onError?.('load', err);
      }
      this.items = [];
    }
  }

  private save(): void {
    try {
      const tmp = `${this.filePath}.tmp`;
      writeFileSync(tmp, JSON.stringify({ items: this.items }, null, 2), 'utf8');
      renameSync(tmp, this.filePath); // atomic swap: readers see old or new, never half
    } catch (err) {
      this.opts.onError?.('save', err); // never throw into an IPC handler
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/store.test.ts`
Expected: all tests PASS. (The shipped suite grew during review to 16 tests — the 9 above plus: setDone/remove persistence, setDone(false), full-field round-trip, newest-first across reload, corrupt-file quarantine, empty/non-string text rejection, and save errors surfacing via `onError`.)

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: all tests PASS (double-tap + store).

- [ ] **Step 6: Commit**

```bash
git add src/main/store.ts tests/store.test.ts
git commit -m "feat: JSON-file item store"
```

---

### Task 4: Tray + overlay window + IPC (Electron main)

Main-process behavior can't be meaningfully unit-tested; verify manually per step.

**Delegation:** main model (cross-platform window/tray behavior — blur timing, always-on-top levels, dock/menu-bar quirks may need live debugging)

**Files:**
- Modify: `src/main/main.ts` (replace placeholder)
- Modify: `src/main/preload.ts` (replace placeholder)

- [ ] **Step 1: Write `src/main/preload.ts`**

```ts
import { contextBridge, ipcRenderer } from 'electron';
import type { Item } from './store';

const api = {
  getItems: (): Promise<Item[]> => ipcRenderer.invoke('items:get'),
  addItem: (text: string): Promise<Item> => ipcRenderer.invoke('items:add', text),
  setDone: (id: string, done: boolean): Promise<void> =>
    ipcRenderer.invoke('items:setDone', id, done),
  removeItem: (id: string): Promise<void> => ipcRenderer.invoke('items:remove', id),
  /** copy text to system clipboard and hide the overlay */
  copyOut: (text: string): Promise<void> => ipcRenderer.invoke('clipboard:copyOut', text),
  hide: (): Promise<void> => ipcRenderer.invoke('overlay:hide'),
  onItemsChanged: (cb: (items: Item[]) => void) => {
    ipcRenderer.on('items:changed', (_e, items: Item[]) => cb(items));
  },
};

export type AluminumApi = typeof api;

contextBridge.exposeInMainWorld('aluminum', api);
```

- [ ] **Step 2: Write `src/main/main.ts`**

```ts
import {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  ipcMain,
  clipboard,
  screen,
} from 'electron';
import { join } from 'node:path';
import { ItemStore } from './store';

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let store: ItemStore;

const WIN_W = 360;
const WIN_H = 480;

// 16x16 solid-color tray icon (base64 PNG) — placeholder, any icon works
const TRAY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAKUlEQVR4nGNgYGD4' +
  'z0AswK4SlwHYFTMwMDAwMTAwMFCsmYGBgQEA98cBBQ1qXO4AAAAASUVORK5CYII=';

function createWindow(): void {
  win = new BrowserWindow({
    width: WIN_W,
    height: WIN_H,
    show: false,
    frame: false,
    resizable: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); // macOS spaces
  win.loadFile(join(__dirname, 'index.html'));
  win.on('blur', () => win?.hide());
}

export function showOverlay(): void {
  if (!win) return;
  // position near the cursor, clamped to the work area
  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  const wa = display.workArea;
  const x = Math.min(Math.max(cursor.x - WIN_W / 2, wa.x), wa.x + wa.width - WIN_W);
  const y = Math.min(Math.max(cursor.y + 16, wa.y), wa.y + wa.height - WIN_H);
  win.setPosition(Math.round(x), Math.round(y));
  win.show();
  win.focus();
}

function toggleOverlay(): void {
  if (!win) return;
  if (win.isVisible()) win.hide();
  else showOverlay();
}

function pushItems(): void {
  win?.webContents.send('items:changed', store.getAll());
}

function setupIpc(): void {
  ipcMain.handle('items:get', () => store.getAll());
  ipcMain.handle('items:add', (_e, text: string) => {
    const item = store.add(text, 'manual');
    pushItems();
    return item;
  });
  ipcMain.handle('items:setDone', (_e, id: string, done: boolean) => {
    store.setDone(id, done);
    pushItems();
  });
  ipcMain.handle('items:remove', (_e, id: string) => {
    store.remove(id);
    pushItems();
  });
  ipcMain.handle('clipboard:copyOut', (_e, text: string) => {
    clipboard.writeText(text);
    win?.hide();
  });
  ipcMain.handle('overlay:hide', () => win?.hide());
}

function setupTray(): void {
  const icon = nativeImage.createFromBuffer(Buffer.from(TRAY_PNG, 'base64'));
  tray = new Tray(icon);
  tray.setToolTip('Aluminum');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Show / Hide', click: toggleOverlay },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]),
  );
  tray.on('click', toggleOverlay);
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => showOverlay());

  app.whenReady().then(() => {
    app.setAppUserModelId('com.aluminum.app'); // Windows tray/notification identity
    if (process.platform === 'darwin') app.dock.hide(); // menu-bar app, no Dock icon
    store = new ItemStore(join(app.getPath('userData'), 'items.json'));
    setupIpc();
    createWindow();
    setupTray();
  });

  // tray app: don't quit when the window is hidden/closed
  app.on('window-all-closed', () => {
    /* keep running */
  });
}
```

- [ ] **Step 3: Verify manually**

Run: `npm start`
Expected:
- No window appears at launch; a tray icon appears in the system tray (macOS: menu bar icon, no Dock icon).
- Clicking the tray icon shows an empty frameless always-on-top window near the cursor; clicking it again (or clicking elsewhere → blur) hides it.
- Tray right-click menu has Show/Hide and Quit; Quit exits the app.

- [ ] **Step 4: Commit**

```bash
git add src/main/main.ts src/main/preload.ts
git commit -m "feat: tray app with always-on-top overlay window and IPC"
```

---

### Task 5: Renderer list UI

**Delegation:** Opus 5 subagent (mechanical — all file contents provided)

> **As-built note:** Task 5 also delivered a review carry-forward from Task 1: cross-boundary
> types (`Item`, `ItemSource`, `AluminumApi`) moved to a new `src/shared/api.ts` (store.ts and
> preload.ts import from it; store re-exports for tests), and typecheck split into
> `tsconfig.main.json` (node types; src/main + src/shared + tests) and `tsconfig.renderer.json`
> (no node types, DOM lib; src/renderer + src/shared) via `tsconfig.base.json`. The root
> `tsconfig.json` remains a loose editor-facing config — only `npm run typecheck` enforces the
> renderer/node boundary. The renderer must import types ONLY from `../shared/api`.

**Files:**
- Modify: `src/renderer/index.html`, `src/renderer/renderer.ts`, `src/renderer/style.css` (replace placeholders)

- [ ] **Step 1: Write `src/renderer/index.html`**

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self'">
  <title>Aluminum</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <input id="new-item" type="text" placeholder="Type and press Enter…" autofocus>
  <ul id="list"></ul>
  <script src="renderer.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write `src/renderer/style.css`**

```css
* { box-sizing: border-box; margin: 0; }

body {
  font-family: "Segoe UI", system-ui, sans-serif;
  font-size: 13px;
  background: #1e1e24;
  color: #e8e8ec;
  height: 100vh;
  display: flex;
  flex-direction: column;
  border: 1px solid #3a3a44;
  overflow: hidden;
}

#new-item {
  padding: 10px 12px;
  border: none;
  border-bottom: 1px solid #3a3a44;
  background: #26262e;
  color: inherit;
  font: inherit;
  outline: none;
}

#list {
  list-style: none;
  padding: 4px 0;
  overflow-y: auto;
  flex: 1;
}

.item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 6px 12px;
  cursor: default;
  white-space: pre-wrap;
  word-break: break-word;
}

.item.selected { background: #33334a; }
.item.done .text { text-decoration: line-through; opacity: 0.45; }
.item .text { flex: 1; max-height: 70px; overflow: hidden; }
.item input[type="checkbox"] { margin-top: 2px; }
.item .del {
  background: none;
  border: none;
  color: #777;
  cursor: pointer;
  visibility: hidden;
  font: inherit;
}
.item:hover .del, .item.selected .del { visibility: visible; }

.empty { padding: 24px 12px; text-align: center; opacity: 0.4; }
```

- [ ] **Step 3: Write `src/renderer/renderer.ts`**

```ts
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
  const prevIndex = indexOfSelected(); // index in the OLD list
  items = next;
  if (selectedId !== null && !items.some((i) => i.id === selectedId)) {
    // the selected row was removed: keep the slot so repeat-Delete works
    selectAt(Math.min(prevIndex, items.length - 1));
  }
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
```

Note: `api.addItem` returns `Promise<void>` — state always flows back via `onItemsChanged` (which returns an unsubscribe function; the single long-lived subscription here doesn't need it).

- [ ] **Step 4: Verify manually**

Run: `npm start`, open overlay from tray.
Expected:
- Empty state shows the hint text.
- Typing text + Enter adds an item at the top; it persists across app restarts (check `%APPDATA%\aluminum\items.json` exists).
- Checkbox strikes item through; ✕ removes it.
- ArrowDown from the input moves selection into the list; ArrowUp/Down navigate; Space toggles done; Delete (or Backspace) removes — and the selection stays on the row that slides into the deleted slot, so repeat-Delete clears down the list.
- Clicking a checkbox or ✕ never strands the keyboard: focus returns to the input whenever nothing is selected.
- Hiding and re-showing the overlay resets the selection and focuses the input.
- Enter or Ctrl+C (Cmd+C on macOS) on a selected item hides the overlay; pasting in Notepad/TextEdit yields the item text.
- Escape hides the overlay.

- [ ] **Step 5: Commit**

```bash
git add src/renderer
git commit -m "feat: hybrid list UI with keyboard navigation and copy-out"
```

---

### Task 6: Global double-Shift hook (uiohook-napi)

**Delegation:** main model (native module load, macOS Accessibility permission flow)

**Files:**
- Modify: `src/main/main.ts`

- [ ] **Step 1: Add the hook wiring to `src/main/main.ts`**

Add imports at the top:

```ts
import { uIOhook, UiohookKey } from 'uiohook-napi';
import { DoubleTapDetector } from './double-tap';
```

Also add `systemPreferences` to the existing `electron` import.

Add below `setupTray()`:

```ts
function setupGlobalHook(): void {
  if (process.platform === 'darwin') {
    // prompts the user via System Settings on first run; hook is silent without it
    const trusted = systemPreferences.isTrustedAccessibilityClient(true);
    if (!trusted) {
      console.warn(
        'Aluminum needs Accessibility permission (System Settings → Privacy & Security → Accessibility). Grant it, then restart.',
      );
    }
  }
  const detector = new DoubleTapDetector({
    codes: [UiohookKey.Shift, UiohookKey.ShiftRight],
    windowMs: 300,
  });
  uIOhook.on('keydown', (e) => {
    if (detector.keydown(e.keycode)) {
      onDoubleShift();
    }
  });
  uIOhook.on('keyup', (e) => detector.keyup(e.keycode));
  uIOhook.start();
}

function onDoubleShift(): void {
  // Task 9 replaces this with capture-then-show
  toggleOverlay();
}
```

Call `setupGlobalHook()` inside `app.whenReady().then(...)` after `setupTray()`, and stop the hook on quit:

```ts
app.on('will-quit', () => uIOhook.stop());
```

- [ ] **Step 2: Verify manually**

Run: `npm start`
Expected:
- Double-tap Shift while ANY app is focused (Notepad, browser) → overlay toggles.
- **Confirm the overlay takes keyboard focus when shown from the global hook while another app is foreground** — type a character and check it lands in the overlay input, not the other app. (Windows restricts SetForegroundWindow from a process that owns neither the foreground window nor the last input event; if focus doesn't take, try `win.showInactive()` + `win.moveTop()` or the alwaysOnTop toggle-cycle workaround. If `showInactive` ends up being the path, the renderer's reset-on-show hangs on the window `focus` event, which then never fires — switch it to `document.addEventListener('visibilitychange', ...)` gated on `visibilityState === 'visible'`.)
- Shift+letter typing in other apps does NOT trigger it.
- Holding Shift does NOT trigger it.
- Quit from tray exits cleanly (process does not hang — if it hangs, the uIOhook.stop() call is missing).

- [ ] **Step 3: Commit**

```bash
git add src/main/main.ts
git commit -m "feat: global double-shift hook toggles overlay"
```

---

### Task 7: Windows selection helper (C# / UI Automation)

Persistent console process. Line protocol on stdio (shared by BOTH platform helpers — Task 8 implements the same protocol on macOS):
- stdin `CAPTURE\n` → stdout `OK <base64-utf8-text>\n` or `ERR <reason>\n`
- stdin `COPYKEY\n` → synthesizes Ctrl+C (Cmd+C on macOS) into the foreground app → `OK\n`
- stdin `EXIT\n` → exits

**Delegation:** main model (csc/GAC build environment may need live debugging)

Base64 payload avoids all quoting/newline/encoding issues in captured text. Compiled with the `csc.exe` that ships in every Windows install (no .NET SDK required). C# 5 syntax only (that compiler's ceiling) — no string interpolation, no `?.`.

**Files:**
- Create: `helper/SelectionHelper.cs`, `helper/build-helper.ps1`

- [ ] **Step 1: Write `helper/SelectionHelper.cs`**

```csharp
using System;
using System.Text;
using System.Windows.Automation;
using System.Windows.Automation.Text;
using System.Windows.Forms;

class SelectionHelper
{
    [STAThread]
    static void Main()
    {
        string line;
        while ((line = Console.ReadLine()) != null)
        {
            line = line.Trim();
            if (line == "CAPTURE")
            {
                Console.WriteLine(Capture());
            }
            else if (line == "COPYKEY")
            {
                try
                {
                    SendKeys.SendWait("^c");
                    Console.WriteLine("OK");
                }
                catch (Exception e)
                {
                    Console.WriteLine("ERR sendkeys:" + e.GetType().Name);
                }
            }
            else if (line == "EXIT")
            {
                return;
            }
            else
            {
                Console.WriteLine("ERR unknown-command");
            }
            Console.Out.Flush();
        }
    }

    static string Capture()
    {
        try
        {
            AutomationElement el = AutomationElement.FocusedElement;
            if (el == null) return "ERR no-focused-element";

            object patObj;
            if (!el.TryGetCurrentPattern(TextPattern.Pattern, out patObj))
                return "ERR no-text-pattern";

            TextPattern tp = (TextPattern)patObj;
            TextPatternRange[] ranges = tp.GetSelection();
            if (ranges == null || ranges.Length == 0) return "ERR no-selection";

            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < ranges.Length; i++)
            {
                sb.Append(ranges[i].GetText(-1));
            }
            string text = sb.ToString();
            if (text.Length == 0) return "ERR empty-selection";

            return "OK " + Convert.ToBase64String(Encoding.UTF8.GetBytes(text));
        }
        catch (Exception e)
        {
            return "ERR exception:" + e.GetType().Name;
        }
    }
}
```

- [ ] **Step 2: Write `helper/build-helper.ps1`**

```powershell
$ErrorActionPreference = "Stop"

$csc = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path $csc)) { throw "csc.exe not found at $csc" }

$gac = Join-Path $env:WINDIR "Microsoft.NET\assembly\GAC_MSIL"

function Find-Asm([string]$name) {
    $dll = Get-ChildItem (Join-Path $gac $name) -Recurse -Filter "$name.dll" -ErrorAction SilentlyContinue |
        Where-Object { $_.Directory.Name -like "v4.0_*" } |
        Sort-Object FullName -Descending |
        Select-Object -First 1
    if ($null -eq $dll) { throw "Assembly $name not found in GAC" }
    return $dll.FullName
}

# System.Windows.Forms comes free via csc's default response file (csc.rsp);
# referencing it again from the GAC trips CS1703 (duplicate identity).
# ASCII only in this file: PowerShell 5.1 reads BOM-less files as ANSI.
$refs = @("UIAutomationClient", "UIAutomationTypes", "WindowsBase") |
    ForEach-Object { "/r:`"$(Find-Asm $_)`"" }

$src = Join-Path $PSScriptRoot "SelectionHelper.cs"
$out = Join-Path $PSScriptRoot "SelectionHelper.exe"

& $csc /nologo /target:exe /out:"$out" @refs "$src"
if ($LASTEXITCODE -ne 0) { throw "csc failed" }
Write-Host "built $out"
```

- [ ] **Step 3: Build the helper**

Run: `npm run helper`
Expected: prints `built ...\helper\SelectionHelper.exe`; the exe exists.

- [ ] **Step 4: Verify the helper standalone**

Open Notepad, type some text, select a few words, keep Notepad focused. Then from a terminal (this steals focus, so instead test via a piped delay):

```powershell
# gives you 5 seconds to click into Notepad and select text before CAPTURE fires
powershell -Command "Start-Sleep 5; 'CAPTURE'; 'EXIT'" | helper\SelectionHelper.exe
```

Expected: `OK <base64>` line. Decode to confirm:

```powershell
[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String("<paste base64 here>"))
```

Expected: the text you selected in Notepad. (If Notepad on this Windows 11 build doesn't expose TextPattern, try WordPad or a browser URL bar — and note the fallback path in Task 9 covers such apps.)

- [ ] **Step 5: Commit**

```bash
git add helper/SelectionHelper.cs helper/build-helper.ps1
git commit -m "feat: C# UIA selection-capture helper with Ctrl+C fallback command"
```

---

### Task 8: macOS selection helper (Swift / AXUIElement)

Same stdio protocol as Task 7. Primary: `kAXFocusedUIElementAttribute` → `kAXSelectedTextAttribute`. Fallback command synthesizes Cmd+C via CGEvent. Requires Accessibility permission (attributed to the responsible process — when launched from a terminal via `npm start`, granting the terminal app works for dev).

**Delegation:** main model (macOS permissions/attribution quirks). Note: code is authored now; build + verification steps require Mac hardware — if executing on Windows, write the files, commit, and mark the verify steps as deferred-to-Mac.

**Files:**
- Create: `helper/SelectionHelper.swift`, `helper/build-helper.sh`

- [ ] **Step 1: Write `helper/SelectionHelper.swift`**

```swift
import Foundation
import ApplicationServices
import CoreGraphics

func capture() -> String {
    let systemWide = AXUIElementCreateSystemWide()

    var focusedRef: CFTypeRef?
    let focusErr = AXUIElementCopyAttributeValue(
        systemWide, kAXFocusedUIElementAttribute as CFString, &focusedRef)
    guard focusErr == .success, let focusedRef = focusedRef else {
        return "ERR no-focused-element:\(focusErr.rawValue)"
    }
    let focused = focusedRef as! AXUIElement

    var selectedRef: CFTypeRef?
    let selErr = AXUIElementCopyAttributeValue(
        focused, kAXSelectedTextAttribute as CFString, &selectedRef)
    guard selErr == .success, let text = selectedRef as? String else {
        return "ERR no-selected-text:\(selErr.rawValue)"
    }
    guard !text.isEmpty else { return "ERR empty-selection" }

    return "OK " + Data(text.utf8).base64EncodedString()
}

func sendCmdC() -> String {
    guard let src = CGEventSource(stateID: .hidSystemState) else {
        return "ERR no-event-source"
    }
    let kVK_ANSI_C: CGKeyCode = 8
    guard
        let down = CGEvent(keyboardEventSource: src, virtualKey: kVK_ANSI_C, keyDown: true),
        let up = CGEvent(keyboardEventSource: src, virtualKey: kVK_ANSI_C, keyDown: false)
    else { return "ERR event-create-failed" }
    down.flags = .maskCommand
    up.flags = .maskCommand
    down.post(tap: .cghidEventTap)
    up.post(tap: .cghidEventTap)
    return "OK"
}

while let line = readLine() {
    switch line.trimmingCharacters(in: .whitespaces) {
    case "CAPTURE": print(capture())
    case "COPYKEY": print(sendCmdC())
    case "EXIT": exit(0)
    default: print("ERR unknown-command")
    }
    fflush(stdout)
}
```

- [ ] **Step 2: Write `helper/build-helper.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
swiftc -O SelectionHelper.swift -o SelectionHelper
echo "built $(pwd)/SelectionHelper"
```

- [ ] **Step 3 (Mac only): Build the helper**

Run: `npm run helper` (dispatches to `build-helper.sh` on darwin)
Expected: prints `built .../helper/SelectionHelper`; executable exists. Requires Xcode Command Line Tools (`xcode-select --install` if `swiftc` missing).

- [ ] **Step 4 (Mac only): Verify standalone**

Grant Accessibility permission to your terminal app first (System Settings → Privacy & Security → Accessibility). Open TextEdit, type and select a few words, then:

```bash
(sleep 5; echo CAPTURE; echo EXIT) | helper/SelectionHelper
```

Click into TextEdit during the 5-second window and re-select the text.
Expected: `OK <base64>` line. Decode: `echo "<base64>" | base64 -d` → the selected text.

- [ ] **Step 5: Commit**

```bash
git add helper/SelectionHelper.swift helper/build-helper.sh
git commit -m "feat: Swift AXUIElement selection-capture helper for macOS"
```

---

### Task 9: Helper client + capture flow integration

Flow on double-Shift: capture selection from the still-focused foreign app FIRST (native API primary, clipboard trick fallback), add it as an item, THEN show the overlay. If nothing is selected, just toggle the overlay. The `SelectionCapturer` is platform-agnostic — both helpers speak the same protocol; only the binary path differs.

**Delegation:** main model (end-to-end native integration, timing-sensitive fallback flow)

**Files:**
- Create: `src/main/selection.ts`
- Modify: `src/main/main.ts`

- [ ] **Step 1: Write `src/main/selection.ts`**

```ts
import { spawn, ChildProcessWithoutNullStreams } from 'node:child_process';
import { clipboard } from 'electron';

const REQUEST_TIMEOUT_MS = 1500;
const CLIPBOARD_SETTLE_MS = 200;

export class SelectionCapturer {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private pending: ((line: string) => void)[] = [];
  private buf = '';

  constructor(private helperPath: string) {}

  start(): void {
    this.proc = spawn(this.helperPath, [], { windowsHide: true });
    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', (chunk: string) => {
      this.buf += chunk;
      let nl: number;
      while ((nl = this.buf.indexOf('\n')) !== -1) {
        const line = this.buf.slice(0, nl).replace(/\r$/, '');
        this.buf = this.buf.slice(nl + 1);
        this.pending.shift()?.(line);
      }
    });
    this.proc.on('exit', () => {
      this.proc = null;
      // flush waiters so callers don't hang
      this.pending.splice(0).forEach((r) => r('ERR helper-exited'));
    });
  }

  stop(): void {
    this.proc?.stdin.write('EXIT\n');
    this.proc?.kill();
    this.proc = null;
  }

  private request(cmd: string): Promise<string> {
    if (!this.proc) return Promise.resolve('ERR helper-not-running');
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const i = this.pending.indexOf(handler);
        if (i !== -1) this.pending.splice(i, 1);
        resolve('ERR timeout');
      }, REQUEST_TIMEOUT_MS);
      const handler = (line: string) => {
        clearTimeout(timer);
        resolve(line);
      };
      this.pending.push(handler);
      this.proc!.stdin.write(cmd + '\n');
    });
  }

  /**
   * Returns the selected text of the focused foreign app, or null.
   * Primary: UIA TextPattern. Fallback: synthesized Ctrl+C + clipboard
   * save/restore (for apps that don't expose TextPattern).
   */
  async capture(): Promise<string | null> {
    const res = await this.request('CAPTURE');
    if (res.startsWith('OK ')) {
      const text = Buffer.from(res.slice(3), 'base64').toString('utf8');
      if (text.trim()) return text;
    }

    // fallback: clipboard trick
    const saved = clipboard.readText();
    clipboard.clear();
    const copyRes = await this.request('COPYKEY');
    if (!copyRes.startsWith('OK')) {
      clipboard.writeText(saved);
      return null;
    }
    await new Promise((r) => setTimeout(r, CLIPBOARD_SETTLE_MS));
    const grabbed = clipboard.readText();
    clipboard.writeText(saved); // restore user's clipboard
    return grabbed.trim() ? grabbed : null;
  }
}
```

- [ ] **Step 2: Wire it into `src/main/main.ts`**

Add import:

```ts
import { SelectionCapturer } from './selection';
```

Add a module-level variable next to `store`:

```ts
let capturer: SelectionCapturer;
```

In `app.whenReady().then(...)`, after `setupGlobalHook()`:

```ts
const helperBinary =
  process.platform === 'win32' ? 'SelectionHelper.exe' : 'SelectionHelper';
capturer = new SelectionCapturer(join(app.getAppPath(), 'helper', helperBinary));
capturer.start();
```

In `app.on('will-quit', ...)`, also stop the capturer:

```ts
app.on('will-quit', () => {
  uIOhook.stop();
  capturer?.stop();
});
```

Replace `onDoubleShift()`:

```ts
let capturing = false;

async function onDoubleShift(): Promise<void> {
  if (capturing) return;
  // if the overlay itself is focused, double-shift just hides it
  if (win?.isVisible() && win.isFocused()) {
    win.hide();
    return;
  }
  capturing = true;
  try {
    const text = await capturer.capture();
    if (text) {
      store.add(text, 'capture');
      pushItems();
    }
  } finally {
    capturing = false;
  }
  showOverlay();
}
```

- [ ] **Step 3: Verify manually — the full Copper loop**

Run: `npm start`
Expected:
1. In a browser or editor, select a sentence, double-tap Shift → overlay appears with the sentence as the newest item.
2. Copy something to the clipboard first (e.g. "sentinel"), then capture from an app WITHOUT native selection support — after capture, paste in Notepad/TextEdit still yields "sentinel" (clipboard restored).
3. Double-tap Shift with nothing selected → overlay appears/toggles, no junk item added.
4. Select an item in the overlay, press Enter → overlay hides; Ctrl+V in the other app pastes it. Full loop works.

- [ ] **Step 4: Run full test suite (regression check)**

Run: `npm test`
Expected: all tests still PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/selection.ts src/main/main.ts
git commit -m "feat: selection capture via UIA helper with clipboard fallback"
```

---

### Task 10: Final polish + docs

**Delegation:** Opus 5 subagent (mechanical — all file contents provided; final regression pass is a checklist)

**Files:**
- Create: `README.md`
- Modify: `src/main/main.ts`

> **As-built note (Task 9):** Step 1 below was pulled forward into Task 9's commit — do not
> add it twice. Task 9 also shipped these approved deltas beyond the plan snippet:
> `MAX_CAPTURE_CHARS` 10k cap (slice-then-trim), spawn/stdin/stderr error listeners with
> `buf` reset on exit, timeout tombstones (a timed-out request's late reply is swallowed in
> place, never misdelivered to the next request), fallback skipped entirely when the helper
> isn't running or the clipboard holds non-text formats (readText/writeText can only restore
> text), `copyRes === 'OK'` exact match, clipboard restore in `finally`.
> Still open for this task's polish: bounded helper respawn policy, unit tests for
> SelectionCapturer framing/pairing against a fake child process, defensive `﻿` strip.

- [x] **Step 1: Guard against a missing helper exe** *(done in Task 9 — see note above)*

In `main.ts`, wrap capturer startup so the app still works (fallback-less) when the helper wasn't built:

```ts
import { existsSync } from 'node:fs';
```

```ts
const helperBinary =
  process.platform === 'win32' ? 'SelectionHelper.exe' : 'SelectionHelper';
const helperPath = join(app.getAppPath(), 'helper', helperBinary);
capturer = new SelectionCapturer(helperPath);
if (existsSync(helperPath)) {
  capturer.start();
} else {
  console.warn(`${helperBinary} not built — run \`npm run helper\`. Capture disabled.`);
}
```

(`SelectionCapturer.capture()` already returns null when the process isn't running, so double-shift degrades to plain overlay toggle.)

(The global `uncaughtException`/`unhandledRejection` handlers originally planned here were pulled forward into Task 4's `main.ts` — do not add them a second time.)

- [ ] **Step 1a: Renderer polish** (deferred from Task 5 review)

- Contrast: `.item.selected` needs a ≥3:1 state indicator (add a left accent border), `.done` opacity and `.del` color fall below 4.5:1, and `#new-item { outline: none }` needs a `:focus-visible` replacement ring.
- Accessibility: `aria-label="Delete item"` on `.del`, `aria-selected` on rows, `lang` on `<html>`.
- `.text` clip → `-webkit-line-clamp: 4`; `user-select: none` on `.item .text` (dblclick both selects a word and copies); consider `:root` CSS custom properties for the palette.
- Guard `window.aluminum` being undefined (preload failure) with a visible "preload failed" list message.

- [x] **Step 1b: IPC sender validation + stored-item shape validation** (deferred from Task 4 review)

In every `ipcMain.handle` callback, reject events from unexpected frames:

```ts
function isTrustedSender(e: Electron.IpcMainInvokeEvent): boolean {
  return e.senderFrame === win?.webContents.mainFrame;
}
```

Guard each handler with `if (!isTrustedSender(e)) return;` (change the ignored `_e` parameter to `e`).

In `store.ts` `load()`, validate item shape instead of trusting `Array.isArray(parsed.items)` alone, and treat a `null`/non-object JSON root as corrupt (quarantine) rather than throwing through property access:

```ts
const parsed: unknown = JSON.parse(raw);
const items =
  parsed !== null && typeof parsed === 'object' && Array.isArray((parsed as { items?: unknown }).items)
    ? ((parsed as { items: unknown[] }).items).filter(
        (i): i is Item =>
          i !== null &&
          typeof i === 'object' &&
          typeof (i as Item).id === 'string' &&
          typeof (i as Item).text === 'string' &&
          typeof (i as Item).done === 'boolean',
      )
    : null;
if (items === null) throw new SyntaxError('unrecognized store shape'); // caught by the quarantine branch below
this.items = items;
```

(Restructure so the quarantine catch wraps this shape check; add tests: `null` root quarantines, `{}` root quarantines, valid root with one malformed item drops just that item.)

- [ ] **Step 2: Write `README.md`**

```markdown
# Aluminum

Copper-style quick-capture list for Windows and macOS. Local dev build — no
signing, no installer.

## Setup

    npm install
    npm run helper   # builds the native selection helper for your platform
    npm start

Windows: the helper compiles with the built-in `csc.exe` — nothing to install.
macOS: requires Xcode Command Line Tools (`xcode-select --install`), and you
must grant Accessibility permission to your terminal (or the Electron app)
under System Settings → Privacy & Security → Accessibility, then restart the app.

## Use

- **Double-tap Shift** in any app: captures the current text selection (if any)
  into the list and shows the overlay.
- **Type + Enter** in the overlay: add a manual item.
- **Arrows** navigate, **Space** toggles done, **Delete** removes,
  **Enter / Ctrl+C (Cmd+C)** copies the item to the clipboard and hides the overlay.
- **Escape** or clicking away hides the overlay. Tray / menu-bar icon toggles it too.

## Data

All items live in `%APPDATA%/aluminum/items.json` (Windows) or
`~/Library/Application Support/aluminum/items.json` (macOS).
No sync, no telemetry.

## How capture works

Primary — a small native helper per platform, same stdio protocol:
- Windows: C# (`helper/SelectionHelper.exe`), UI Automation
  `TextPattern.GetSelection()`.
- macOS: Swift (`helper/SelectionHelper`), Accessibility API
  `kAXSelectedTextAttribute`.

Fallback (apps without native selection support): the helper synthesizes
Ctrl+C / Cmd+C and the app reads the clipboard, then restores the previous
clipboard contents.
```

- [ ] **Step 3: Full manual regression pass**

Run: `npm start`, then verify the checklist:
- App launches to tray only (no window, no taskbar entry).
- Double-shift capture from browser works; overlay appears near cursor.
- Manual add, toggle, delete, copy-out, Escape, blur-hide all work.
- Restart app → items persisted.
- Quit from tray → process exits fully (check no stray `SelectionHelper.exe` in Task Manager / `SelectionHelper` in Activity Monitor).
- macOS (when Mac hardware available): repeat the checklist there — menu-bar icon, no Dock icon, Cmd+C copy-out, capture from TextEdit and Safari.

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add README.md src/main/main.ts
git commit -m "feat: graceful degradation without helper + README"
```

---

## Known risks and mitigations

| Risk | Mitigation |
|---|---|
| `uiohook-napi` prebuild vs Electron ABI mismatch | It ships N-API prebuilds (ABI-stable) — should load without rebuild. If it fails: `npx electron-rebuild -f -w uiohook-napi`. |
| Windows 11 Notepad / some apps lack TextPattern | Clipboard-trick fallback handles them automatically (Task 9). |
| Elevated (admin) windows ignore hooks and UIA from a non-elevated process | Accept for v1: capture from elevated apps silently returns nothing; overlay still opens. |
| Synthesized copy keystroke collides with Shift still held | Detector fires on second keydown; by the time fallback runs (~ms later) the user has released Shift. If flaky, add a 50ms delay before `COPYKEY`. |
| Chromium apps only enable UIA when queried (Windows) | First capture in a Chromium app may fail and use the fallback; subsequent captures typically succeed via UIA once accessibility activates. |
| macOS Accessibility permission not granted / attributed to wrong process | `isTrustedAccessibilityClient(true)` prompts on first run. In dev (launched from a terminal), macOS attributes trust to the terminal app — grant it there. Helper `ERR` codes include the raw `AXError` value for diagnosis. |
| Some macOS apps don't expose `kAXSelectedTextAttribute` (Chromium/Electron apps without AXManualAccessibility, some Catalyst apps) | Cmd+C clipboard-trick fallback handles them automatically (Task 9). |
| macOS tasks authored on Windows can't be verified until run on Mac hardware | Tasks 8's build/verify steps and the macOS half of regression are explicitly marked deferred-to-Mac; code compiles from a clean checkout with `npm run helper`. |
| Synthesized Ctrl+C lands in apps where Ctrl+C isn't copy (console windows → interrupt) | Fallback only fires when the native API found no selection; consoles rarely have one selected. Accept for v1; a foreground-window class check could gate it later. |

## Explicitly out of scope (v1)

- Code signing, notarization, Gatekeeper hardening
- Installer / auto-update / auto-launch at login
- Multi-line rich text, images, or file clips
- Settings UI (window size, shortcut choice, theme)
- Linux support
