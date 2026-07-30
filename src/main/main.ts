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
} from 'electron';
import { join } from 'node:path';
import { ItemStore } from './store';

// a stray exception must not kill the resident tray process
process.on('uncaughtException', (err) => console.error('uncaughtException', err));
process.on('unhandledRejection', (err) => console.error('unhandledRejection', err));

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let store: ItemStore;
let isQuitting = false;
/** when the overlay last hid itself on blur — guards the tray-click race */
let lastHiddenAt = 0;

const WIN_W = 360;
const WIN_H = 480;
/** clicking the tray blurs (and hides) the overlay before the click handler
 * runs; a show within this window would make tray-click unable to hide */
const TRAY_BLUR_RACE_MS = 300;

// 16x16 solid-color tray icon (base64 PNG) — placeholder, any icon works
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

function createWindow(): void {
  win = new BrowserWindow({
    width: WIN_W,
    height: WIN_H,
    show: false,
    frame: false,
    resizable: false,
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
  win.on('blur', () => {
    if (!win?.isVisible()) return; // already hidden explicitly — not a blur-hide
    lastHiddenAt = Date.now();
    win.hide();
  });
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
  // when the area is smaller than the window, so the top-left stays reachable)
  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  const wa = display.workArea;
  const x = Math.max(wa.x, Math.min(cursor.x - WIN_W / 2, wa.x + wa.width - WIN_W));
  const y = Math.max(wa.y, Math.min(cursor.y + 16, wa.y + wa.height - WIN_H));
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
  ipcMain.handle('items:add', (_e, text: unknown) => {
    // IPC payloads are untyped; a malformed message must not become a renderer rejection
    if (typeof text !== 'string' || !text.trim()) return;
    store.add(text, 'manual');
    pushItems(); // items:changed is the single source of truth for state
  });
  ipcMain.handle('items:setDone', (_e, id: unknown, done: unknown) => {
    if (typeof id !== 'string' || typeof done !== 'boolean') return;
    store.setDone(id, done);
    pushItems();
  });
  ipcMain.handle('items:remove', (_e, id: unknown) => {
    if (typeof id !== 'string') return;
    store.remove(id);
    pushItems();
  });
  ipcMain.handle('clipboard:copyOut', (_e, text: unknown) => {
    if (typeof text !== 'string') return;
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
  // the click that reaches us after a blur-hide was meant to hide, not re-show
  tray.on('click', () => {
    if (!win?.isVisible() && Date.now() - lastHiddenAt < TRAY_BLUR_RACE_MS) return;
    toggleOverlay();
  });
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
  });

  // tray app: don't quit when the window is hidden/closed
  app.on('window-all-closed', () => {
    /* keep running */
  });
}
