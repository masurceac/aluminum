# Aluminum

Copper-style quick-capture list for Windows and macOS. A tray / menu-bar app
with an always-on-top overlay: hold Ctrl and double-tap Shift anywhere to
grab the current text selection into a hybrid to-do / clipboard list, and
copy items back out with one key. Local build — no signing, no auto-update.

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

The app runs fine without a built helper: the gesture then just toggles the
overlay, and a warning is logged at startup.

## Install (standalone build)

    npm run package

builds the helper, bundles the app, and produces a standalone build under
`release/`:

- **Windows** — `release/Aluminum-win32-x64/`, a portable folder; run
  `Aluminum.exe` from wherever you put it (e.g. copy the folder to
  `%LOCALAPPDATA%\Programs\Aluminum`). No installer, nothing touches the
  registry until you opt in below.
- **macOS** — `release/Aluminum-darwin-*/Aluminum.app`; drag it into
  `/Applications`.

**Launch at startup** — right-click the tray icon and tick *Launch at
startup*. This registers the packaged exe/app with the OS login items
(Windows: `HKCU` Run key; macOS: Login Items); untick to remove. The item is
disabled in dev runs, where it would register the bare Electron binary. If
you move the app folder afterwards, re-tick it so the registration points at
the new path.

## Use

Hold **Ctrl** and double-tap **Shift** in any app: Aluminum captures the
current text selection (if there is one) as a new item and shows the overlay
near the cursor. (The Ctrl chord is deliberate — a bare double-Shift is too
easy to hit while typing.) The captured item arrives already selected, so
`Enter` immediately copies it back out. If the overlay is already open **and
focused**, the same gesture hides it instead.

With no selection to capture, Aluminum does not silently insert your
clipboard: if the clipboard holds text that isn't in the list yet, the overlay
offers it in a small **"From clipboard" card** — one click adds it, ✕ (or just
ignoring it) discards it.

In the overlay:

| Key | Action |
|---|---|
| type + `Enter` | add a manual item — typing also **live-filters** the list |
| `ArrowDown` / `ArrowUp` | move the selection (from the input, `ArrowDown` enters the list; `ArrowUp` off the top returns to the input) |
| `ArrowRight` / `ArrowLeft` | expand / collapse the selected row — rows are clamped to 2 lines and never grow on their own; the footer shows "→ more" when there is hidden text (moving the selection collapses again) |
| `Shift+ArrowDown/Up` | extend the selection over multiple items |
| `Space` | toggle done on the selected item(s) |
| `Enter` | copy the selection and hide the overlay — multiple items are joined as lines ("copy as list") |
| `Ctrl+C` / `Cmd+C` | copy the selection but **stay open** — keep grabbing; the footer confirms each copy |
| `Ctrl+V` / `Cmd+V` | add the clipboard as a new item — multi-line text is kept verbatim |
| `F2` | edit the selected item in place (`Enter` saves, `Shift+Enter` newline, `Escape` cancels) |
| `Delete` or `Backspace` | remove the selected item(s) — an **Undo** toast appears for 5 s (`Ctrl+Z` works too) |
| `Escape` | clear the filter if one is typed, otherwise hide the overlay |

The mouse works as well: click to select (`Ctrl+click` toggles membership,
`Shift+click` ranges), click the round check to toggle done (this also selects the row —
done items get a strikethrough), hover a row to reveal its copy and
✕ buttons (plus a ⌄ chevron on rows with hidden text — click to
expand/collapse), double-click a row to copy it out **and mark it done**, or **drag a row (or a
multi-selection) straight into another app** as plain text. Right-click opens
a context menu — Copy / Copy as list, Edit, Mark as done, Pin, Merge
(multi-selection), Clear done, Delete. Clicking away (blur) or clicking the
tray / menu-bar icon also hides the overlay; the tray icon's context menu has
Show / Hide and Quit.

The list groups itself by age — Pinned, Today, Yesterday, Earlier — and
re-capturing text that is already in the list bumps the existing item to the
top instead of duplicating it. Completed items sink to a **Done** group at
the bottom (even pinned ones); unchecking an item floats it back into place. Window size is remembered across launches.

The window itself is a frosted-glass panel: drag it by the titlebar, resize it
from any edge, and use the titlebar buttons to minimize (hide to tray) or
maximize/restore. Rows show their age (and ✦ when pinned). The titlebar's
colored dot opens the **theme popover**: four accent palettes — Copper
(default), Steel, Brass, Patina — plus an Auto / Light / Dark appearance
switch (Auto follows the system). Both choices persist across restarts.

The **pin button** (or `Ctrl+P`) docks the overlay as a normal window: it
stops hiding on click-away, appears in the taskbar, and drops always-on-top —
so you can snap it beside another window (Win+Arrow) and work with both. Pin
again to return to quick-overlay behavior. A **clear all** button lives in the
footer; like every destructive action it is undoable for 5 seconds.

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
  `kAXSelectedTextAttribute`. Chromium-family apps (Chrome, and Electron
  apps like Claude or VS Code) keep their accessibility tree disabled until
  an assistive client announces itself, so the helper sets
  `AXManualAccessibility` on them — a background watcher does it the moment
  such an app gains focus, so the tree is already built by the first
  double-tap.

Fallback, for selections the accessibility tree can never see — above all
xterm.js terminals (VS Code's integrated terminal, Hyper): on macOS the
helper synthesizes Cmd+C and Aluminum reads the clipboard, then puts the
previous contents back (text, HTML and RTF flavors are all restored). Cmd+C
never doubles as interrupt, so this is safe even in terminals. The synthetic
copy is skipped when the clipboard holds a format Aluminum can't restore —
an image or a file list — and when the helper isn't running. (Application-
private formats that Electron can't see, e.g. live Excel ranges, may still
be lost alongside plain text.) On Windows, where Ctrl+C in a terminal can
mean interrupt, no copy is ever synthesized; with no readable selection,
Aluminum instead offers the clipboard's existing text as a one-click
suggestion card.

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

Windows 11 is the primary dev target and is verified end to end. On macOS,
double-tap capture and overlay toggling are verified on macOS 26 (Tahoe).
The helper reads the selection through the frontmost application's
accessibility element; the system-wide element
(`AXUIElementCreateSystemWide`) is only a fallback, because on macOS 26 its
queries fail with `kAXErrorCannotComplete`. Menu-bar behavior and the
first-run permission prompt flow remain lightly tested.
