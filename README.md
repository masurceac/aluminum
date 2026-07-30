# Aluminum

Copper-style quick-capture list for Windows and macOS. A tray / menu-bar app
with an always-on-top overlay: double-tap Shift anywhere to grab the current
text selection into a hybrid to-do / clipboard list, and copy items back out
with one key. Local dev build — no signing, no installer, no auto-update.

## Setup

    npm install
    npm run helper   # builds the native selection helper for your platform
    npm start

`npm start` runs a typecheck, bundles with esbuild, and launches Electron.

**Windows** — the helper compiles with the `csc.exe` that ships with every
Windows install; there is nothing extra to install.

**macOS** — requires Xcode Command Line Tools (`xcode-select --install`). You
must also grant Accessibility permission under System Settings → Privacy &
Security → Accessibility, then restart the app. In dev, macOS attributes the
request to the process that launched Electron, so grant it to your terminal
app. Without it the global Shift hook stays silent and capture returns nothing.

The app runs fine without a built helper: double-tap Shift then just toggles
the overlay, and a warning is logged at startup.

## Use

Double-tap Shift in any app: Aluminum captures the current text selection (if
there is one) as a new item and shows the overlay near the cursor. If the
overlay is already open **and focused**, double-tap Shift hides it instead.

In the overlay:

| Key | Action |
|---|---|
| type + `Enter` | add a manual item |
| `ArrowDown` / `ArrowUp` | move the selection (from the input, `ArrowDown` enters the list; `ArrowUp` off the top returns to the input) |
| `Space` | toggle done on the selected item |
| `Enter`, `Ctrl+C` / `Cmd+C` | copy the selected item to the clipboard and hide the overlay |
| `Delete` or `Backspace` | remove the selected item (Backspace too — Mac laptops have no forward-delete) |
| `Escape` | hide the overlay |

The mouse works as well: click to select, click the checkbox to toggle done,
click ✕ to remove, double-click a row to copy it out. Clicking away (blur) or
clicking the tray / menu-bar icon also hides the overlay; the tray icon's
context menu has Show / Hide and Quit.

Newest items are at the top. Deleting the selected row keeps the selection on
whatever slides into its place, so repeated `Delete` clears down the list.

## How capture works

The helper has one more job on Windows: handing the overlay real keyboard
focus. Windows only grants foreground to a process that received the last
input event, which a global hotkey never does — without this the overlay
appears on top but keystrokes still go to the app you came from until you
click it.

Primary path — a small native helper per platform, both speaking the same
line protocol over stdio:

- Windows: C# (`helper/SelectionHelper.exe`), UI Automation
  `TextPattern.GetSelection()`.
- macOS: Swift (`helper/SelectionHelper`), Accessibility API
  `kAXSelectedTextAttribute`.

Fallback, for apps that don't expose their selection to the accessibility tree:
the helper synthesizes Ctrl+C / Cmd+C and Aluminum reads the clipboard, then
puts the previous contents back (text, HTML and RTF flavors are all restored).
The fallback is skipped when the clipboard holds a format Aluminum can't
restore — an image or a file list. (Application-private formats that Electron
can't see, e.g. live Excel ranges, may still be lost alongside plain text.)
It is also skipped when the helper isn't running.

Captured text is capped at 10,000 characters. A helper that dies is restarted
automatically, up to three times in a row.

Known gaps: elevated (admin) windows are invisible to a non-elevated process,
so capture from them returns nothing and the overlay just opens; the first
capture inside a Chromium app on Windows may fall back before UI Automation
activates.

## Data

Everything lives in one JSON file:

- Windows: `%APPDATA%\aluminum\items.json`
- macOS: `~/Library/Application Support/aluminum/items.json`

No sync, no account, no telemetry. Writes go through a temp file and an atomic
rename, so a crash mid-save can't leave a half-written list.

If the file can't be parsed, or its contents aren't a recognizable list, it is
renamed aside to `items.json.corrupt-<timestamp>` and Aluminum starts empty —
your data is kept for inspection rather than overwritten on the next save. A
readable file with individual malformed entries keeps the good ones and drops
the rest.

## Development

    npm run typecheck   # main + renderer projects
    npm test            # vitest: double-tap detector, store, helper client
    npm run build       # typecheck + esbuild bundles into dist/

Main-process code lives in `src/main`, the overlay UI in `src/renderer`, and
types crossing the IPC boundary in `src/shared`. `app_plan.md` is the
task-by-task build plan and carries the as-built notes.

## Status

Windows 11 is the primary dev target and is verified end to end. The macOS
helper, permission prompts, and menu-bar behavior are code-complete but
**deferred verification** — they have not yet been run on Mac hardware.
