<p align="center"><img src="assets/icon-128.png" width="96" alt=""></p>

<h1 align="center">BetterShxt</h1>

<p align="center">A fast screenshot tool for Windows. Region, window, fullscreen and scrolling capture, a drag-and-drop thumbnail, and a built-in annotation editor. Lives in the system tray.</p>

---

## Features

- **Instant selection overlay.** Press the hotkey and start dragging right away; the overlay is up in a few milliseconds.
- **Four capture modes:** region, window, fullscreen, and scrolling (auto-scrolls a page and stitches it into one tall image, handling sticky headers, footers and sidebars).
- **Thumbnail card** after every capture. Drag it straight into any app (browser upload, chat, Explorer, a terminal), or use Edit / Copy / Save / Folder / Delete.
- **Clipboard holds both the image and the file path**, so pasting into an image app gives the picture and pasting into a terminal gives the path.
- **Annotation editor:** arrow, rectangle, oval, line, pen, highlighter, text, blur, with undo/redo.
- Multi-monitor aware. Everything is local; nothing is uploaded anywhere.

## Install

### Option 1: Installer (recommended)

1. Go to the [latest release](https://github.com/oakthekey/bettershxt/releases/latest) and download `BetterShxt-Setup-<version>.exe`.
2. Run it. Windows SmartScreen may say *"Windows protected your PC"* because the installer isn't code-signed. Click **More info → Run anyway**.
3. Pick an install folder (default is per-user, no admin needed). BetterShxt starts when setup finishes and adds Desktop and Start Menu shortcuts.
4. Look for the BetterShxt icon in the system tray (you may need to click the **^** arrow next to the clock).

To start it automatically with Windows: tray icon → **Settings…** → check *Launch BetterShxt at login* → **Save**.

**Uninstall:** Windows Settings → Apps → Installed apps → BetterShxt → Uninstall.

### Option 2: Run from source

Requirements: Windows 10 or 11, [Node.js](https://nodejs.org/) 20 LTS or newer, and [Git](https://git-scm.com/).

```powershell
git clone https://github.com/oakthekey/bettershxt.git
cd bettershxt
npm install
npm start
```

After the first `npm install` you can launch it without a terminal window by double-clicking `BetterShxt.vbs` (or `BetterShxt.bat`). Make a shortcut to `BetterShxt.vbs` on your Desktop if you like.

### Build the installer yourself

```powershell
npm run dist
```

The installer lands in `dist\BetterShxt-Setup-<version>.exe`. `npm run pack` builds the unpacked app folder only (`dist\win-unpacked\BetterShxt.exe`).

## How to use

| Hotkey | Action |
|---|---|
| **Ctrl+Shift+4** | Region: drag a rectangle |
| **Ctrl+Shift+5** | Window: hover to highlight a window, click to capture it |
| **Ctrl+Shift+3** | Fullscreen: the monitor under your cursor |
| **Ctrl+Shift+6** | Scrolling: select the scrollable area; BetterShxt scrolls and stitches it |

- **Esc** or **right-click** cancels a selection. During a scrolling capture, **Esc** stops early and keeps what was captured so far.
- Left-click the tray icon for a quick region capture. Right-click it for the menu (all capture modes, Open Screenshots Folder, Settings, Quit).
- All hotkeys can be changed in Settings.

### After a capture

- The PNG is saved to `Pictures\Screenshots` (changeable) as `Screenshot YYYY-MM-DD at HH.mm.ss.png`.
- A thumbnail card appears at the bottom of the screen:
  - **Drag the image** into another app to drop the file there.
  - **Double-click** it, or press **Edit**, to annotate.
  - **Copy**, **Save** (save as…), **Folder** (show in Explorer), **Del** (delete the file).
  - Cards disappear after 8 seconds (hover to keep one open). Up to 5 stack side by side.

### Scrolling capture tips

- Select an area inside one scrollable thing: a web page, a chat, a document.
- BetterShxt scrolls with the mouse wheel at the center of your selection, so keep the mouse still until it finishes.
- It stops at the end of the page, after 40 steps, or at about 16,000 px tall.

### Editor

| Tool | Key | | Action | Key |
|---|---|---|---|---|
| Arrow | A | | Undo / Redo | Ctrl+Z / Ctrl+Y |
| Rectangle | R | | Copy to clipboard | Ctrl+C |
| Oval | E | | Save (overwrites the file) | Ctrl+S |
| Line | L | | Close | Esc |
| Pen | P | | | |
| Highlighter | H | | | |
| Text | T | | | |
| Blur | B | | | |

## Settings

Tray icon → **Settings…**

- Hotkeys for each capture mode (click a field and press the new combo; Backspace clears it)
- Save folder
- What goes on the clipboard: image + file path, image only, path only, or nothing
- How long thumbnail cards stay, and how many can stack
- Launch at login

Settings are stored in `%APPDATA%\BetterShxt\settings.json`.

## Troubleshooting

- **A hotkey does nothing / "Could not register hotkey".** Another app already uses that combo. Pick a different one in Settings.
- **Nothing happens at all.** Check the tray: BetterShxt runs only in the system tray, with no main window. Starting it a second time just triggers a region capture in the copy that's already running.
- **Something went wrong.** Errors are written to `%APPDATA%\BetterShxt\bettershxt.log`. Please include it when opening an issue.

## Project layout

```
src/main.js            tray, hotkeys, windows, capture flow, scrolling loop
src/capture.js         screen grab, crop, save, clipboard
src/stitch.js          overlap detection and stitching for scrolling capture
src/helper.js          client for winhelper.ps1
src/winhelper.ps1      Win32 helper: window rectangles, mouse wheel
src/settings.js        settings load/save and defaults
src/preload.js         bridge between the app and its windows
src/overlay/           selection overlay (one per monitor)
src/preview/           thumbnail cards
src/editor/            annotation editor
src/settings/          settings window
assets/                icon source (icon.svg) and generated icons (npm run icons)
BetterShxt.vbs / .bat  launch from source without a terminal
```

## License

[MIT](LICENSE)
