import {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  ipcMain,
  clipboard,
  dialog,
  screen,
  systemPreferences,
  nativeTheme,
} from 'electron';
import { join } from 'node:path';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { uIOhook, UiohookKey } from 'uiohook-napi';
import { DoubleTapDetector } from './double-tap';
import { ItemStore } from './store';
import { SelectionCapturer } from './selection';

// a stray exception must not kill the resident tray process
process.on('uncaughtException', (err) => console.error('uncaughtException', err));
process.on('unhandledRejection', (err) => console.error('unhandledRejection', err));

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let store: ItemStore;
let capturer: SelectionCapturer;
let isQuitting = false;
/** pinned/docked: behave like a normal app window — no blur-hide, taskbar
 * entry, not always-on-top — so it can live snapped beside other windows */
let docked = false;
/** the last text WE wrote to the clipboard (copy-out). The capture fallback
 * reads the clipboard, so without this the app re-captures its own output on
 * the next double-Shift and bumps it back to the top — a copy/paste loop. */
let lastSelfCopied: string | null = null;
/** when the overlay last hid itself on blur — guards the tray-click race */
let lastHiddenAt = 0;
/** when the overlay was last shown — guards the foreground-handoff blur bounce */
let shownAt = 0;

const WIN_W = 360;
const WIN_H = 480;
/** max gap between the taps of a double-Shift (unrelated to TRAY_BLUR_RACE_MS) */
const DOUBLE_TAP_MS = 300;
/** clicking the tray blurs (and hides) the overlay before the click handler
 * runs; a show within this window would make tray-click unable to hide */
const TRAY_BLUR_RACE_MS = 300;
/** how long the OS foreground handoff may take to stop bouncing focus */
const SHOW_SETTLE_MS = 400;

// 16x16 fallback tray icon (base64 PNG) — used only if assets/ went missing
const TRAY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAKUlEQVR4nGNgYGD4' +
  'z0AswK4SlwHYFTMwMDAwMTAwMFCsmYGBgQEA98cBBQ1qXO4AAAAASUVORK5CYII=';

function createStore(): ItemStore {
  let saveErrorShown = false;
  return new ItemStore(join(app.getPath('userData'), 'items.json'), {
    onError: (op, err) => {
      console.error(`store ${op} failed`, err);
      // surface data-loss risk once, not on every keystroke
      if (op === 'save' && !saveErrorShown) {
        saveErrorShown = true;
        dialog.showErrorBox(
          'Aluminum — could not save your list',
          'Changes are kept in memory but could not be written to disk.\n' +
            `${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
  });
}

/** last user-chosen window size, persisted across launches (position always
 * follows the cursor, so only the size is worth remembering) */
function sizeFilePath(): string {
  return join(app.getPath('userData'), 'window.json');
}

function loadSavedSize(): { width: number; height: number } {
  try {
    const raw = JSON.parse(readFileSync(sizeFilePath(), 'utf8')) as {
      width?: unknown;
      height?: unknown;
    };
    if (typeof raw.width === 'number' && typeof raw.height === 'number') {
      return { width: Math.max(320, raw.width), height: Math.max(400, raw.height) };
    }
  } catch {
    /* first run or unreadable — use defaults */
  }
  return { width: WIN_W, height: WIN_H };
}

function saveSize(): void {
  if (!win || win.isMaximized()) return;
  const { width, height } = win.getBounds();
  try {
    writeFileSync(sizeFilePath(), JSON.stringify({ width, height }), 'utf8');
  } catch {
    /* best effort */
  }
}

function createWindow(): void {
  const size = loadSavedSize();
  win = new BrowserWindow({
    width: size.width,
    height: size.height,
    minWidth: 320,
    minHeight: 400,
    show: false,
    frame: false,
    // taskbar / Alt-Tab identity (dev builds otherwise show Electron's icon)
    icon: join(app.getAppPath(), 'assets', 'icon.ico'),
    resizable: true, // titlebar is a drag region; edges resize
    skipTaskbar: true,
    alwaysOnTop: true,
    // frosted-glass panel: the renderer paints a translucent surface over the
    // OS material; where the material is unavailable (e.g. Windows 10) the
    // backgroundColor below shows through instead and the UI reads as solid
    ...(process.platform === 'win32'
      ? { backgroundMaterial: 'acrylic' as const, backgroundColor: '#00000000' }
      : {}),
    ...(process.platform === 'darwin'
      ? { vibrancy: 'under-window' as const, visualEffectState: 'active' as const }
      : {}),
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); // macOS spaces
  win.loadFile(join(__dirname, 'index.html'));
  win.on('blur', () => {
    if (docked) return; // a docked window stays put when focus leaves
    if (!win?.isVisible()) return; // already hidden explicitly — not a blur-hide
    // Handing us the foreground bounces focus once on its way in, and that
    // bounce arrives as a blur — hiding on it makes the first double-Shift
    // flash the overlay and vanish. Let the handoff settle, then re-check.
    if (Date.now() - shownAt < SHOW_SETTLE_MS) {
      setTimeout(() => {
        if (win?.isVisible() && !win.isFocused()) {
          lastHiddenAt = Date.now();
          win.hide();
        }
      }, SHOW_SETTLE_MS);
      return;
    }
    lastHiddenAt = Date.now();
    win.hide();
  });
  // renderer mirrors the maximize state (restore icon, layout hints)
  win.on('maximize', () => win?.webContents.send('overlay:maximized', true));
  win.on('unmaximize', () => win?.webContents.send('overlay:maximized', false));
  win.on('resized', saveSize);
  // a tray app's window must never be destroyed (Alt+F4 / Cmd+W send close);
  // a destroyed window would leave every later win.* call throwing forever
  win.on('close', (e) => {
    if (isQuitting) return;
    e.preventDefault();
    win?.hide();
  });
}

function showOverlay(): void {
  if (!win) return;
  // position near the cursor, clamped to the work area (work-area origin wins
  // when the area is smaller than the window, so the top-left stays reachable).
  // The window is user-resizable, so clamp with its CURRENT size, and leave a
  // maximized window — or one the user parked somewhere while docked — alone.
  if (!win.isMaximized() && !docked) {
    const { width: w, height: h } = win.getBounds();
    const cursor = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(cursor);
    const wa = display.workArea;
    const x = Math.max(wa.x, Math.min(cursor.x - w / 2, wa.x + wa.width - w));
    const y = Math.max(wa.y, Math.min(cursor.y + 16, wa.y + wa.height - h));
    win.setPosition(Math.round(x), Math.round(y));
  }
  shownAt = Date.now();
  win.show();
  // a real summon (vs mere refocus): the renderer resets its transient UI —
  // selection, filter, pending edit — only on this signal
  win.webContents.send('overlay:shown');
  win.focus();
  app.focus({ steal: true }); // macOS: activate the app, not just the window
  // Windows: show()/focus() only draw us on top — the OS keeps keyboard focus
  // with whichever app owns the foreground lock. The native helper borrows it.
  if (process.platform === 'win32') {
    const handle = win.getNativeWindowHandle();
    const hwnd =
      handle.length === 8 ? handle.readBigUInt64LE().toString() : String(handle.readUInt32LE());
    void capturer?.forceForeground(hwnd).then((ok) => {
      if (ok) win?.webContents.focus();
    });
  }
}

function toggleOverlay(): void {
  if (!win) return;
  if (win.isVisible()) win.hide();
  else showOverlay();
}

function pushItems(): void {
  win?.webContents.send('items:changed', store.getAll());
}

/** the overlay's main frame is the only legitimate caller — anything else
 * (a subframe, a stale webContents) must not reach the store or clipboard */
function isTrustedSender(e: Electron.IpcMainInvokeEvent): boolean {
  return e.senderFrame === win?.webContents.mainFrame;
}

function setupIpc(): void {
  ipcMain.handle('items:get', (e) => {
    if (!isTrustedSender(e)) return []; // keep the Promise<Item[]> contract total
    return store.getAll();
  });
  ipcMain.handle('items:add', (e, text: unknown) => {
    if (!isTrustedSender(e)) return;
    // IPC payloads are untyped; a malformed message must not become a renderer rejection
    if (typeof text !== 'string' || !text.trim()) return;
    store.add(text, 'manual');
    pushItems(); // items:changed is the single source of truth for state
  });
  ipcMain.handle('items:setDone', (e, id: unknown, done: unknown) => {
    if (!isTrustedSender(e)) return;
    if (typeof id !== 'string' || typeof done !== 'boolean') return;
    store.setDone(id, done);
    pushItems();
  });
  ipcMain.handle('items:remove', (e, id: unknown) => {
    if (!isTrustedSender(e)) return;
    if (typeof id !== 'string') return;
    store.remove(id);
    pushItems();
  });
  ipcMain.handle('items:update', (e, id: unknown, text: unknown) => {
    if (!isTrustedSender(e)) return;
    if (typeof id !== 'string' || typeof text !== 'string' || !text.trim()) return;
    store.update(id, text);
    pushItems();
  });
  ipcMain.handle('items:merge', (e, ids: unknown) => {
    if (!isTrustedSender(e)) return;
    if (!Array.isArray(ids) || !ids.every((i): i is string => typeof i === 'string')) return;
    store.merge(ids);
    pushItems();
  });
  ipcMain.handle('items:acceptSuggestion', (e, text: unknown) => {
    if (!isTrustedSender(e)) return;
    if (typeof text !== 'string' || !text.trim()) return;
    // same semantics as a real capture, just human-approved
    const existing = store.getAll().find((i) => i.text === text);
    if (existing) store.bump(existing.id);
    else store.add(text, 'capture');
    pushItems();
  });
  ipcMain.handle('items:setPinned', (e, id: unknown, pinned: unknown) => {
    if (!isTrustedSender(e)) return;
    if (typeof id !== 'string' || typeof pinned !== 'boolean') return;
    store.setPinned(id, pinned);
    pushItems();
  });
  ipcMain.handle('items:restore', (e, items: unknown) => {
    if (!isTrustedSender(e)) return;
    // shape validation lives in the store — a bad payload is a no-op there
    store.replaceAll(items as never);
    pushItems();
  });
  ipcMain.handle('clipboard:copy', (e, text: unknown) => {
    if (!isTrustedSender(e)) return;
    if (typeof text !== 'string') return;
    lastSelfCopied = text;
    clipboard.writeText(text); // copy-and-stay: no hide
  });
  ipcMain.handle('clipboard:copyOut', (e, text: unknown) => {
    if (!isTrustedSender(e)) return;
    if (typeof text !== 'string') return;
    lastSelfCopied = text;
    clipboard.writeText(text);
    win?.hide();
  });
  ipcMain.handle('overlay:hide', (e) => {
    if (!isTrustedSender(e)) return;
    win?.hide();
  });
  ipcMain.handle('overlay:toggleMaximize', (e) => {
    if (!isTrustedSender(e)) return;
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  ipcMain.handle('overlay:setDocked', (e, next: unknown) => {
    if (!isTrustedSender(e)) return;
    if (typeof next !== 'boolean' || !win) return;
    docked = next;
    win.setSkipTaskbar(!docked);
    win.setAlwaysOnTop(!docked, 'screen-saver');
  });
  ipcMain.handle('theme:setMode', (e, mode: unknown) => {
    if (!isTrustedSender(e)) return;
    // themeSource drives both the renderer's prefers-color-scheme and the
    // acrylic/vibrancy backdrop tint — one switch, whole panel follows
    if (mode === 'system' || mode === 'light' || mode === 'dark') nativeTheme.themeSource = mode;
  });
}

function setupTray(): void {
  // brand icon; createFromPath picks up the @2x variant for hidpi trays
  let icon = nativeImage.createFromPath(join(app.getAppPath(), 'assets', 'tray.png'));
  if (icon.isEmpty()) icon = nativeImage.createFromBuffer(Buffer.from(TRAY_PNG, 'base64'));
  tray = new Tray(icon);
  tray.setToolTip('Aluminum');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Show / Hide', click: toggleOverlay },
      {
        label: 'Launch at startup',
        type: 'checkbox',
        // dev would register the bare electron.exe, which launches without the
        // app — only a packaged build can meaningfully self-start
        enabled: app.isPackaged,
        checked: app.getLoginItemSettings().openAtLogin,
        click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }),
      },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]),
  );
  // the click that reaches us after a blur-hide was meant to hide, not re-show
  tray.on('click', () => {
    if (!win?.isVisible() && Date.now() - lastHiddenAt < TRAY_BLUR_RACE_MS) return;
    toggleOverlay();
  });
}

function setupGlobalHook(): void {
  if (process.platform === 'darwin' && !systemPreferences.isTrustedAccessibilityClient(true)) {
    // the permission prompt above resolves in the user's hands; start() would
    // throw AXAPI_DISABLED right now, so name the real cause and bail instead
    dialog.showErrorBox(
      'Aluminum needs Accessibility permission',
      'System Settings → Privacy & Security → Accessibility, then restart Aluminum.',
    );
    return;
  }
  // the chord modifier: Cmd on macOS, Ctrl elsewhere
  const chordCodes: number[] =
    process.platform === 'darwin'
      ? [UiohookKey.Meta, UiohookKey.MetaRight]
      : [UiohookKey.Ctrl, UiohookKey.CtrlRight];
  const detector = new DoubleTapDetector({
    codes: [UiohookKey.Shift, UiohookKey.ShiftRight],
    // the held modifier must not break the tap sequence: Mod+Shift,Shift IS the
    // gesture (the chord keeps typing-shift double-taps from summoning)
    ignoreCodes: chordCodes,
    windowMs: DOUBLE_TAP_MS,
  });
  // the modifier is tracked from raw keycodes because the event's own modifier
  // flags are unreliable (observed always-false from uiohook-napi on Windows)
  const modHeld = new Set<number>();
  const isChordMod = (code: number): boolean => chordCodes.includes(code);
  // the listener is the error boundary: a throw here would unwind into the
  // N-API threadsafe callback while the hook keeps reporting "armed"
  uIOhook.on('keydown', (e) => {
    try {
      if (isChordMod(e.keycode)) modHeld.add(e.keycode);
      if (detector.keydown(e.keycode)) {
        // a bare double-Shift is too easy to hit while typing — only the
        // chorded Mod+Shift,Shift acts
        if (modHeld.size > 0) {
          void onDoubleShift().catch((err) => console.error('double-shift failed', err));
        }
      }
    } catch (err) {
      console.error('double-shift handler failed', err);
    }
  });
  uIOhook.on('keyup', (e) => {
    modHeld.delete(e.keycode);
    detector.keyup(e.keycode);
  });
  try {
    uIOhook.start();
  } catch (err) {
    // e.g. SetWindowsHookEx failure — the app must still come up without the hotkey
    console.error('global hook failed to start', err);
    dialog.showErrorBox('Aluminum — double-Shift is not available', String(err));
  }
}

let capturing = false;

/** Mod+Shift,Shift (Cmd on macOS, Ctrl elsewhere): capture the current
 * selection (if any), then summon. */
async function onDoubleShift(): Promise<void> {
  // if the overlay itself is focused, the gesture just hides it — this must
  // work even while a capture is still in flight
  if (win?.isVisible() && win.isFocused()) {
    win.hide();
    return;
  }
  if (capturing) return;
  capturing = true;
  /** clipboard-fallback text offered to the user AFTER the overlay shows */
  let suggestion: string | null = null;
  /** the item this capture added or bumped — arrives pre-selected in the overlay */
  let capturedId: string | null = null;
  // The AX read must finish before the overlay steals focus (frontmost-app
  // queries would start answering "Aluminum"), but the slow branch — the
  // clipboard poll after a synthesized Cmd+C — must not hold the summon
  // back: show as soon as the chord is posted and let the item pop in.
  let shown = false;
  const showNow = (): void => {
    if (shown) return;
    shown = true;
    showOverlay();
  };
  try {
    // capture (at least the focus-dependent part) BEFORE showing the overlay
    const captured = await capturer.capture({ onCopyPosted: showNow });
    // our own copy-out echoing back through the clipboard fallback is not a
    // capture — treating it as one bumps the just-copied item to the top and
    // the next Enter copies it again
    if (captured && captured.text !== lastSelfCopied) {
      const existing = store.getAll().find((i) => i.text === captured.text);
      if (captured.from === 'selection') {
        // a real selection is unambiguous intent: add it, or bump the existing
        // duplicate to the top instead of stacking another copy
        if (existing) {
          store.bump(existing.id);
          capturedId = existing.id;
        } else {
          capturedId = store.add(captured.text, 'capture').id;
        }
        pushItems();
      } else if (!existing) {
        // clipboard fallback is a guess — offer it as a one-click suggestion
        // instead of silently inserting stale clipboard contents
        suggestion = captured.text;
      }
    }
  } catch (err) {
    // a capture failure must never swallow the overlay — the invariant is
    // "double-shift always opens the panel"; capture merely degrades to null
    console.error('capture failed', err);
  } finally {
    capturing = false;
  }
  showNow();
  // after overlay:shown, so the renderer's summon reset can't clear these
  if (suggestion) win?.webContents.send('capture:suggest', suggestion);
  if (capturedId) win?.webContents.send('capture:captured', capturedId);
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => showOverlay());
  app.on('before-quit', () => {
    isQuitting = true;
  });

  app.whenReady().then(() => {
    app.setAppUserModelId('com.aluminum.app'); // Windows tray/notification identity
    if (process.platform === 'darwin') app.dock?.hide(); // menu-bar app, no Dock icon
    store = createStore();
    setupIpc();
    createWindow();
    setupTray();
    setupGlobalHook();

    const helperBinary =
      process.platform === 'win32' ? 'SelectionHelper.exe' : 'SelectionHelper';
    const helperPath = join(app.getAppPath(), 'helper', helperBinary);
    capturer = new SelectionCapturer(helperPath);
    if (existsSync(helperPath)) {
      capturer.start();
    } else {
      // capture() degrades to null; double-shift still toggles the overlay
      console.warn(`${helperBinary} not built — run \`npm run helper\`. Capture disabled.`);
    }
  });

  app.on('will-quit', () => {
    uIOhook.stop();
    capturer?.stop();
  });

  // tray app: don't quit when the window is hidden/closed
  app.on('window-all-closed', () => {
    /* keep running */
  });
}
