const {
  app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, screen,
  nativeImage, shell, dialog, Notification,
} = require('electron');
const path = require('path');
const fs = require('fs');
const capture = require('./capture');
const settings = require('./settings');
const helper = require('./helper');
const stitch = require('./stitch');

const PRELOAD = path.join(__dirname, 'preload.js');
const ICON_ICO = path.join(__dirname, '..', 'assets', 'icon.ico');

let tray = null;
let previewWin = null;
let settingsWin = null;
let frozen = null;          // Promise<Map<displayId, {display, image}>> for the open overlay
let overlayMode = 'region'; // region | scroll | window
let capturing = false;

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

function trayIcon() {
  return nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'icon-32.png'));
}

function notify(title, body) {
  if (Notification.isSupported()) new Notification({ title, body, icon: ICON_ICO }).show();
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// Launched without a console, so errors also go to %APPDATA%\bettershxt\bettershxt.log.
function logError(...parts) {
  const text = parts.map((p) => (p instanceof Error ? p.stack : typeof p === 'string' ? p : JSON.stringify(p))).join(' ');
  console.error(text);
  try {
    const file = path.join(app.getPath('userData'), 'bettershxt.log');
    if (fs.existsSync(file) && fs.statSync(file).size > 512 * 1024) fs.writeFileSync(file, '');
    fs.appendFileSync(file, `${new Date().toISOString()} ${text}\n`);
  } catch (_) { /* logging is best-effort */ }
}

// ---------- Preview window ----------
let previewDisplay = null;

// The card strip gets a brand-new window whenever it reappears after emptying: a transparent
// window hidden for hours and shown again could come back drawing nothing (seen after the PC
// sat idle), while never-shown windows are reliable. Windows show only once sized (resize IPC).
function createPreview() {
  const win = new BrowserWindow({
    width: 260,
    height: 200,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    minimizable: false,
    maximizable: false,
    focusable: false,
    webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true);
  win.loaded = new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
  win.webContents.on('did-finish-load', () => sendPreviewConfig(win));
  win.webContents.on('render-process-gone', (_e, details) => {
    logError('preview renderer gone', details);
    if (previewWin === win) retirePreview();
  });
  win.loadFile(path.join(__dirname, 'preview', 'index.html'));
  win.on('closed', () => { if (previewWin === win) previewWin = null; });
  previewWin = win;
}

function retirePreview() {
  const old = previewWin;
  previewWin = null;
  if (old && !old.isDestroyed()) {
    old.hide();
    // Close on a later tick; destroying inside the IPC handler crashed the process.
    setTimeout(() => { if (!old.isDestroyed()) old.close(); }, 300);
  }
  setTimeout(() => { if (!previewWin) createPreview(); }, 400);
}

function sendToPreview(channel, payload) {
  if (!previewWin) createPreview();
  const win = previewWin;
  win.loaded.then(() => { if (!win.isDestroyed()) win.webContents.send(channel, payload); });
}

// Topmost windows raised since this one was created (taskbar, PiP, other always-on-top apps)
// would otherwise cover it.
function showPreviewWindow() {
  if (!previewWin) return;
  if (!previewWin.isVisible()) previewWin.showInactive();
  previewWin.moveTop();
}

function sendPreviewConfig(win = previewWin) {
  if (!win || win.isDestroyed()) return;
  const s = settings.load();
  win.webContents.send('preview:config', { dismissSeconds: s.dismissSeconds, maxCards: s.maxCards });
}

let previewAvoid = null; // screen-DIP rect the preview must stay off (scrolling capture region)

function intersects(a, b) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

function positionPreview(w, h) {
  const display = previewDisplay || screen.getPrimaryDisplay();
  const wa = display.workArea;
  const left = wa.x + 8;
  const center = wa.x + (wa.width - w) / 2;
  const right = wa.x + wa.width - w - 8;
  const top = wa.y + 8;
  const bottom = wa.y + wa.height - h - 8;
  const spots = [[center, bottom], [right, bottom], [left, bottom], [center, top], [right, top], [left, top]];
  // Default bottom-center; while scrolling, the first spot clear of the captured region.
  // If none is clear, grabScrollFrame hides the card around each grab.
  const spot = (previewAvoid && spots.find(([sx, sy]) => !intersects({ x: sx, y: sy, width: w, height: h }, previewAvoid)))
    || spots[0];
  const x = Math.round(spot[0]);
  const y = Math.round(spot[1]);
  previewWin.setMinimumSize(1, 1);
  previewWin.setBounds({ x, y, width: w, height: h });
  previewWin.setSize(w, h);
}

function showShot(shot, display) {
  previewDisplay = display;
  sendToPreview('preview:add', shot);
}

function showProgress(info, display) {
  previewDisplay = display || previewDisplay;
  sendToPreview('preview:progress', info);
}

function fromPreview(e) {
  return !!previewWin && BrowserWindow.fromWebContents(e.sender) === previewWin;
}

ipcMain.on('preview:resize', (e, w, h) => {
  if (!fromPreview(e)) return;
  positionPreview(Math.ceil(w), Math.ceil(h));
  showPreviewWindow();
});

// Last card gone.
ipcMain.on('preview:hide', (e) => {
  if (fromPreview(e)) retirePreview();
});

ipcMain.on('preview:drag', (e, filePath) => {
  if (!filePath || !fs.existsSync(filePath)) return;
  let icon = nativeImage.createFromPath(filePath);
  if (icon.isEmpty()) icon = trayIcon();
  else icon = icon.resize({ width: 160 });
  e.sender.startDrag({ file: filePath, icon });
});

// ---------- Editor ----------
const editors = new Map(); // filePath -> BrowserWindow

function shotFromFile(filePath) {
  const image = nativeImage.createFromPath(filePath);
  const size = image.getSize();
  const thumb = size.width > 640 ? image.resize({ width: 640 }) : image;
  return { path: filePath, dataUrl: thumb.toDataURL(), width: size.width, height: size.height };
}

function bringToFront(win) {
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  win.moveTop();
}

function openEditor(filePath) {
  const existing = editors.get(filePath);
  if (existing && !existing.isDestroyed()) { bringToFront(existing); return; }
  const image = nativeImage.createFromPath(filePath);
  if (image.isEmpty()) {
    notify('BetterShxt', `Can't open ${path.basename(filePath)}: the file was moved or deleted.`);
    return;
  }
  const size = image.getSize();
  // Open on the monitor under the cursor (where the card is); center() would pick the primary one.
  const wa = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const width = Math.min(wa.width - 80, Math.max(1080, size.width + 40));
  const height = Math.min(wa.height - 80, Math.max(560, size.height + 110));
  const win = new BrowserWindow({
    x: Math.round(wa.x + (wa.width - width) / 2),
    y: Math.round(wa.y + (wa.height - height) / 2),
    width,
    height,
    minWidth: 640,
    minHeight: 400,
    frame: false,
    backgroundColor: '#141416',
    show: false,
    icon: ICON_ICO,
    webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false },
  });
  win.loadFile(path.join(__dirname, 'editor', 'index.html'));
  win.webContents.on('did-finish-load', () => {
    win.webContents.send('editor:init', { path: filePath, dataUrl: image.toDataURL() });
  });
  const reveal = () => { if (!win.isDestroyed() && !win.isVisible()) bringToFront(win); };
  win.once('ready-to-show', reveal);
  setTimeout(reveal, 1500); // never leave the editor invisible if ready-to-show doesn't fire
  win.on('closed', () => editors.delete(filePath));
  editors.set(filePath, win);
}

ipcMain.handle('editor:save', (_e, filePath, dataUrl, copyOnly) => {
  const image = nativeImage.createFromDataURL(dataUrl);
  if (image.isEmpty()) return false;
  if (copyOnly) { capture.copyShot(image, filePath); return true; }
  fs.writeFileSync(filePath, image.toPNG());
  capture.copyShot(image, filePath);
  if (previewWin) previewWin.webContents.send('preview:update', shotFromFile(filePath));
  return true;
});

ipcMain.on('editor:close', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (win) win.close();
});

ipcMain.handle('preview:action', async (_e, name, filePath) => {
  if (!filePath) return false;
  switch (name) {
    case 'annotate':
      openEditor(filePath);
      return true;
    case 'copy': {
      const img = nativeImage.createFromPath(filePath);
      if (!img.isEmpty()) capture.copyShot(img, filePath);
      return true;
    }
    case 'saveas': {
      const res = await dialog.showSaveDialog({
        defaultPath: filePath,
        filters: [{ name: 'PNG', extensions: ['png'] }],
      });
      if (res.canceled || !res.filePath) return false;
      fs.copyFileSync(filePath, res.filePath);
      return true;
    }
    case 'reveal':
      shell.showItemInFolder(filePath);
      return true;
    case 'delete':
      try { fs.unlinkSync(filePath); } catch (_) { /* already gone */ }
      return true;
    default:
      return false;
  }
});

// ---------- Settings window ----------
function openSettings() {
  if (settingsWin) { settingsWin.focus(); return; }
  settingsWin = new BrowserWindow({
    width: 560,
    height: 660,
    frame: false,
    resizable: false,
    backgroundColor: '#141416',
    icon: ICON_ICO,
    show: false,
    webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false },
  });
  settingsWin.loadFile(path.join(__dirname, 'settings', 'index.html'));
  settingsWin.once('ready-to-show', () => settingsWin.show());
  settingsWin.on('closed', () => { settingsWin = null; });
}

// In dev (unpackaged) execPath is electron.exe; without the app dir it opens
// the default Electron window. Pass the project dir as an argument.
function applyLoginItem(enabled) {
  const opts = { openAtLogin: enabled };
  if (!app.isPackaged) {
    opts.path = process.execPath;
    opts.args = [path.resolve(__dirname, '..')];
  }
  app.setLoginItemSettings(opts);
}

ipcMain.handle('settings:get', () => settings.load());

ipcMain.handle('settings:save', (_e, patch) => {
  settings.save(patch);
  applyLoginItem(!!patch.launchAtLogin);
  const failed = registerHotkeys();
  sendPreviewConfig();
  buildTrayMenu();
  return { ok: failed.length === 0, failed };
});

ipcMain.handle('settings:pickDir', async () => {
  const res = await dialog.showOpenDialog(settingsWin, {
    defaultPath: settings.get('saveDir'),
    properties: ['openDirectory', 'createDirectory'],
  });
  return res.canceled ? null : res.filePaths[0];
});

ipcMain.on('settings:close', () => { if (settingsWin) settingsWin.close(); });

// ---------- Overlay (region / scroll / window) ----------
// One pre-loaded overlay window per display, ready before the hotkey. Creating windows per
// hotkey (plus grabbing and PNG-encoding the screens first) took 1-3 s, so users started
// dragging on the live desktop and the overlay appeared mid-drag, cutting the selection short.
//
// Overlays are focusable:false (WS_EX_NOACTIVATE): focusing each one as it appeared stole
// activation from the overlay being dragged on, which also broke its mouse capture.
// Esc is therefore a temporary global hotkey while an overlay is open.
//
// The overlay shows instantly but stays fully transparent (so the screen grab behind it is
// pixel-exact) while already tracking the drag; it reveals the dim + selection once the
// frozen image arrives. Don't use setContentProtection here: Electron adds WS_EX_LAYERED
// for it, and fully transparent pixels of a layered window are click-through.

const overlayPool = new Map(); // displayId -> BrowserWindow
let overlayOpen = false;
let overlaySession = 0;

function overlayKey(display) {
  const b = display.bounds;
  return `${b.x},${b.y},${b.width},${b.height}@${display.scaleFactor}`;
}

function createOverlay(display) {
  const b = display.bounds;
  const win = new BrowserWindow({
    x: b.x, y: b.y, width: b.width, height: b.height,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    resizable: false,
    movable: false,
    fullscreenable: false,
    enableLargerThanScreen: true,
    webPreferences: {
      preload: PRELOAD, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false,
    },
  });
  win.displayId = display.id;
  win.displayKey = overlayKey(display);
  win.loaded = new Promise((resolve) => win.webContents.once('did-finish-load', () => {
    win.isLoaded = true;
    resolve();
  }));
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setBounds({ x: b.x, y: b.y, width: b.width, height: b.height });
  win.loadFile(path.join(__dirname, 'overlay', 'index.html'));
  win.on('closed', () => {
    if (overlayPool.get(win.displayId) === win) overlayPool.delete(win.displayId);
  });
  return win;
}

// Make the pool match the current displays. Never called while an overlay is open.
function syncOverlayPool() {
  const displays = screen.getAllDisplays();
  const wanted = new Map(displays.map((d) => [d.id, d]));
  for (const [id, win] of overlayPool) {
    const d = wanted.get(id);
    if (!d || win.isDestroyed() || win.displayKey !== overlayKey(d)) {
      overlayPool.delete(id);
      if (!win.isDestroyed()) win.close();
    }
  }
  for (const d of displays) {
    if (!overlayPool.has(d.id)) overlayPool.set(d.id, createOverlay(d));
  }
}

function onDisplaysChanged() {
  if (!overlayOpen) syncOverlayPool();
}

function hwndOf(win) {
  const buf = win.getNativeWindowHandle();
  return buf.length >= 8 ? Number(buf.readBigUInt64LE(0)) : buf.readUInt32LE(0);
}

function bindOverlayEscape() {
  try { globalShortcut.register('Escape', cancelOverlay); } catch (_) { /* right-click still cancels */ }
}

function unbindOverlayEscape() {
  try { globalShortcut.unregister('Escape'); } catch (_) { /* not registered */ }
}

// Synchronous for already-loaded windows so the overlay is up on the very next frame.
function showOverlays(session, mode) {
  for (const win of overlayPool.values()) {
    const show = () => {
      if (!overlayOpen || session !== overlaySession || win.isDestroyed()) return;
      win.webContents.send('overlay:start', { mode });
      win.showInactive();
      // Showing keeps the z-order from creation time; topmost windows raised since then
      // (taskbar, PiP players, other always-on-top apps) would sit above the overlay.
      win.moveTop();
    };
    if (win.isLoaded) show();
    else win.loaded.then(show);
  }
}

// Each overlay window serves one capture: once hidden and re-shown, a window swallows the
// first mouse-down (only the release arrives), so retire it and pre-load a fresh one.
function hideOverlays() {
  overlayOpen = false;
  unbindOverlayEscape();
  const used = [...overlayPool.values()];
  overlayPool.clear();
  for (const win of used) {
    if (win.isDestroyed()) continue;
    win.hide();
    // Close on a later tick; destroying inside the IPC handler crashed the process.
    setTimeout(() => { if (!win.isDestroyed()) win.close(); }, 300);
  }
  setTimeout(() => { if (!overlayOpen) syncOverlayPool(); }, 400);
}

function cancelOverlay() {
  if (!overlayOpen) return;
  hideOverlays();
  frozen = null;
  restorePreview(previewWasVisible);
  capturing = false;
}

async function hidePreviewForCapture() {
  const wasVisible = previewWin && previewWin.isVisible();
  if (wasVisible) { previewWin.hide(); await sleep(60); }
  return wasVisible;
}

function restorePreview(wasVisible) {
  if (wasVisible) showPreviewWindow();
}

let previewWasVisible = false;

async function beginOverlayCapture(mode) {
  if (capturing) return;
  capturing = true;
  overlayMode = mode;
  const session = ++overlaySession;
  overlayOpen = true;
  // No awaits before the overlay is shown.
  previewWasVisible = !!(previewWin && previewWin.isVisible());
  if (previewWasVisible) previewWin.hide();
  syncOverlayPool();
  bindOverlayEscape();
  showOverlays(session, mode);

  const grab = (async () => {
    // getSources hogs the main thread for ~300 ms; yield first so overlay:start reaches the
    // renderer now (else early clicks run with a stale mode). 60 ms lets a hidden thumbnail leave the screen.
    await sleep(previewWasVisible ? 60 : 16);
    return Promise.all([
      mode === 'window' ? helper.listWindows().catch(() => []) : [],
      capture.grabAllDisplays(),
    ]);
  })();
  frozen = grab.then(([, all]) => all);
  frozen.catch(() => { /* reported below */ });

  let windowsPhys;
  let all;
  try {
    [windowsPhys, all] = await grab;
  } catch (err) {
    logError('capture failed', err);
    if (session === overlaySession && overlayOpen) {
      notify('BetterShxt', 'Screen capture failed: ' + err.message);
      cancelOverlay();
    }
    return;
  }
  if (session !== overlaySession || !overlayOpen) return; // cancelled or already selected

  const own = new Set([...overlayPool.values()].filter((w) => !w.isDestroyed()).map(hwndOf));
  windowsPhys = windowsPhys.filter((w) => !own.has(Number(w.h)));

  for (const [id, { display, image }] of all) {
    const win = overlayPool.get(id);
    if (!win || win.isDestroyed()) continue;
    const b = display.bounds;
    const sf = display.scaleFactor;
    // Windows intersecting this display, converted to DIPs relative to the display origin.
    const wins = windowsPhys.map((w) => ({
      title: w.title,
      x: Math.round(w.x / sf) - b.x,
      y: Math.round(w.y / sf) - b.y,
      width: Math.round(w.width / sf),
      height: Math.round(w.height / sf),
    })).filter((w) => w.x < b.width && w.y < b.height && w.x + w.width > 0 && w.y + w.height > 0);
    // JPEG is only the on-screen backdrop (~7 ms vs ~55 ms for PNG); the saved shot is cropped from the lossless image.
    const backdrop = 'data:image/jpeg;base64,' + image.toJPEG(92).toString('base64');
    await win.loaded;
    if (session !== overlaySession || !overlayOpen || win.isDestroyed()) return;
    win.webContents.send('overlay:image', { image: backdrop, windows: wins });
  }
}

ipcMain.on('overlay:select', async (e, rect) => {
  if (!overlayOpen) return;
  const win = BrowserWindow.fromWebContents(e.sender);
  const displayId = win ? win.displayId : null;
  const mode = overlayMode;
  const pending = frozen;
  frozen = null;
  hideOverlays();
  try {
    // A fast drag can finish before the screens have been grabbed.
    const all = pending ? await pending : null;
    const entry = all ? all.get(displayId) : null;
    if (!entry) { restorePreview(previewWasVisible); return; }
    if (mode === 'scroll') {
      await runScrollCapture(entry.display, rect);
      return;
    }
    const cropped = capture.cropDip(entry.image, entry.display, rect);
    if (!cropped) { restorePreview(previewWasVisible); return; }
    const shot = capture.finalize(cropped);
    restorePreview(previewWasVisible);
    showShot(shot, entry.display);
  } catch (err) {
    logError('select failed', err);
    notify('BetterShxt', 'Capture failed: ' + err.message);
    showProgress({ done: true });
    restorePreview(previewWasVisible);
  } finally {
    capturing = false;
  }
});

ipcMain.on('overlay:cancel', () => cancelOverlay());

// ---------- Fullscreen capture ----------
async function beginFullscreenCapture() {
  if (capturing) return;
  capturing = true;
  const wasVisible = await hidePreviewForCapture();
  try {
    const all = await capture.grabAllDisplays();
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const entry = all.get(display.id) || all.values().next().value;
    if (!entry) throw new Error('no display captured');
    const shot = capture.finalize(entry.image);
    restorePreview(wasVisible);
    showShot(shot, entry.display);
  } catch (err) {
    logError('fullscreen capture failed', err);
    notify('BetterShxt', 'Screen capture failed: ' + err.message);
    restorePreview(wasVisible);
  } finally {
    capturing = false;
  }
}

// ---------- Scrolling capture ----------
const SCROLL_MAX_FRAMES = 40;
const SCROLL_MAX_HEIGHT = 16000;

// Grab the region without BetterShxt's own progress card in it.
async function grabScrollFrame(display, rect, region) {
  const inTheWay = previewWin && previewWin.isVisible() && intersects(previewWin.getBounds(), region);
  if (inTheWay) { previewWin.hide(); await sleep(80); }
  const img = await capture.grabDisplay(display);
  if (inTheWay) showPreviewWindow();
  return img && capture.cropDip(img, display, rect);
}

async function runScrollCapture(display, rect) {
  const sf = display.scaleFactor;
  const region = { x: display.bounds.x + rect.x, y: display.bounds.y + rect.y, width: rect.width, height: rect.height };
  const centerX = (region.x + rect.width / 2) * sf;
  const centerY = (region.y + rect.height / 2) * sf;
  let stopped = false;
  previewAvoid = region;
  try { globalShortcut.register('Escape', () => { stopped = true; }); } catch (_) { /* runs to the end */ }
  try {
    await sleep(350); // let the overlay go and the target repaint
    const first = await grabScrollFrame(display, rect, region);
    if (!first) { restorePreview(previewWasVisible); return; }
    const frames = [first];
    const offsets = [0];
    let footer = Infinity;
    let total = first.getSize().height;
    let lastOff = 0;
    let pxPerNotch = 0;
    showProgress({ text: 'Scrolling… Esc to stop', dataUrl: first.resize({ width: 240 }).toDataURL() }, display);

    // Browsers scroll ~100 DIP per wheel notch; re-measured after every step and aimed at
    // ~55% of the moving area so consecutive frames always overlap.
    let notches = Math.max(1, Math.round((rect.height * 0.4) / 100));
    for (let i = 1; i < SCROLL_MAX_FRAMES && total < SCROLL_MAX_HEIGHT && !stopped; i++) {
      await helper.scroll(centerX, centerY, -120 * notches);
      await sleep(320);
      // A frame grabbed mid smooth-scroll can miss or show no movement yet; look again
      // rather than scrolling further away from the last good frame.
      let next = null;
      let res = null;
      for (let attempt = 0; attempt < 3 && !stopped; attempt++) {
        if (attempt) await sleep(250);
        next = await grabScrollFrame(display, rect, region);
        if (!next) break;
        res = stitch.findOffset(frames[frames.length - 1], next, lastOff);
        if (res.offset > 0) break;
      }
      if (!next || !res || res.offset <= 0) break; // bottom reached (0) or lost track (-1)
      frames.push(next);
      offsets.push(res.offset);
      footer = Math.min(footer, res.footer);
      total += res.offset;
      lastOff = res.offset;
      // Max, not latest: a step that only partly landed (smooth scroll lag, page end) under-reads the rate.
      pxPerNotch = Math.max(pxPerNotch, res.offset / notches);
      notches = Math.min(notches * 2, Math.max(1, Math.round((res.body * 0.55) / pxPerNotch)));
      showProgress({ text: `Scrolling… ${Math.round(total / sf)}px · Esc to stop` }, display);
    }

    const composed = frames.length > 1 ? stitch.compose(frames, offsets, footer === Infinity ? 0 : footer) : frames[0];
    const shot = capture.finalize(composed);
    showProgress({ done: true }, display);
    restorePreview(previewWasVisible);
    showShot(shot, display);
  } finally {
    previewAvoid = null;
    try { globalShortcut.unregister('Escape'); } catch (_) { /* not registered */ }
  }
}

// ---------- Tray & hotkeys ----------
// globalShortcut/tray callbacks run outside Node's callback scope, so promise continuations
// started there can stall until some unrelated event wakes the loop (measured 0.2-0.9 s).
// Hop onto a real Node tick first.
function onTick(fn) { return () => setImmediate(fn); }

function accelLabel(a) { return (a || '').replace('CommandOrControl', 'Ctrl'); }

function buildTrayMenu() {
  const s = settings.load();
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: `Capture Region\t${accelLabel(s.hotkeyRegion)}`, click: onTick(() => beginOverlayCapture('region')) },
    { label: `Capture Window\t${accelLabel(s.hotkeyWindow)}`, click: onTick(() => beginOverlayCapture('window')) },
    { label: `Capture Fullscreen\t${accelLabel(s.hotkeyFullscreen)}`, click: onTick(() => beginFullscreenCapture()) },
    { label: `Scrolling Capture\t${accelLabel(s.hotkeyScroll)}`, click: onTick(() => beginOverlayCapture('scroll')) },
    { type: 'separator' },
    { label: 'Open Screenshots Folder', click: () => shell.openPath(capture.ensureDir()) },
    { label: 'Settings…', click: () => openSettings() },
    { type: 'separator' },
    { label: 'Quit BetterShxt', click: () => app.quit() },
  ]));
}

function buildTray() {
  tray = new Tray(trayIcon());
  tray.setToolTip('BetterShxt');
  buildTrayMenu();
  tray.on('click', onTick(() => beginOverlayCapture('region')));
}

// Returns list of human-readable hotkeys that failed to register.
function registerHotkeys() {
  globalShortcut.unregisterAll();
  const s = settings.load();
  const map = [
    [s.hotkeyRegion, () => beginOverlayCapture('region')],
    [s.hotkeyFullscreen, () => beginFullscreenCapture()],
    [s.hotkeyWindow, () => beginOverlayCapture('window')],
    [s.hotkeyScroll, () => beginOverlayCapture('scroll')],
  ];
  const failed = [];
  for (const [accel, fn] of map) {
    if (!accel) continue;
    let ok = false;
    try { ok = globalShortcut.register(accel, onTick(fn)); } catch (_) { ok = false; }
    if (!ok) failed.push(accelLabel(accel));
  }
  return failed;
}

process.on('uncaughtException', (err) => logError('uncaught', err));
app.on('render-process-gone', (_e, wc, details) => logError('renderer gone', details));
app.on('child-process-gone', (_e, details) => logError('child gone', details));

app.whenReady().then(() => {
  app.setAppUserModelId('com.bettershxt.app');
  settings.load();
  capture.ensureDir();
  createPreview();
  syncOverlayPool();
  for (const ev of ['display-added', 'display-removed', 'display-metrics-changed']) screen.on(ev, onDisplaysChanged);
  buildTray();
  const failed = registerHotkeys();
  if (failed.length) notify('BetterShxt', `Could not register hotkey: ${failed.join(', ')}. Another app may own it.`);
  helper.start(); // warm up the PowerShell helper so window/scroll capture is instant
});

app.on('second-instance', onTick(() => beginOverlayCapture('region')));
app.on('window-all-closed', (e) => e.preventDefault());
app.on('will-quit', () => { globalShortcut.unregisterAll(); helper.stop(); });
