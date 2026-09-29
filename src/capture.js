const { desktopCapturer, screen, clipboard, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');
const settings = require('./settings');

function saveDir() { return settings.get('saveDir'); }

function ensureDir() {
  const dir = saveDir();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function timestampName() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `Screenshot ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} at ${p(d.getHours())}.${p(d.getMinutes())}.${p(d.getSeconds())}.png`;
}

// Returns Map<displayId, { display, image }> with image at physical pixel size.
async function grabAllDisplays() {
  const displays = screen.getAllDisplays();
  let maxW = 0;
  let maxH = 0;
  for (const d of displays) {
    maxW = Math.max(maxW, Math.round(d.size.width * d.scaleFactor));
    maxH = Math.max(maxH, Math.round(d.size.height * d.scaleFactor));
  }
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: maxW, height: maxH },
  });

  const result = new Map();
  displays.forEach((display, i) => {
    let src = sources.find((s) => String(s.display_id) === String(display.id));
    if (!src) src = sources[i];
    if (!src) return;
    result.set(display.id, { display, image: src.thumbnail });
  });
  return result;
}

// Grab one display only (used repeatedly by scrolling capture).
async function grabDisplay(display) {
  const all = await grabAllDisplays();
  const entry = all.get(display.id);
  return entry ? entry.image : null;
}

// rect is in DIPs relative to the display's top-left.
function cropDip(image, display, rect) {
  const sf = display.scaleFactor;
  const { width: physW, height: physH } = image.getSize();
  const x = Math.max(0, Math.round(rect.x * sf));
  const y = Math.max(0, Math.round(rect.y * sf));
  const w = Math.min(physW - x, Math.round(rect.width * sf));
  const h = Math.min(physH - y, Math.round(rect.height * sf));
  if (w <= 0 || h <= 0) return null;
  return image.crop({ x, y, width: w, height: h });
}

// Clipboard per settings. Cropped nativeImages crash clipboard.write; round-trip through PNG first.
function copyShot(image, filePath) {
  const mode = settings.get('copyMode');
  if (mode === 'none') return;
  const safe = nativeImage.createFromBuffer(image.toPNG());
  if (mode === 'image') clipboard.writeImage(safe);
  else if (mode === 'path') clipboard.writeText(filePath);
  else clipboard.write({ image: safe, text: filePath });
}

function finalize(image) {
  ensureDir();
  const filePath = path.join(saveDir(), timestampName());
  const png = image.toPNG();
  fs.writeFileSync(filePath, png);
  image = nativeImage.createFromBuffer(png);
  copyShot(image, filePath);
  const size = image.getSize();
  const thumb = size.width > 640 ? image.resize({ width: 640 }) : image;
  return { path: filePath, dataUrl: thumb.toDataURL(), width: size.width, height: size.height };
}

module.exports = { grabAllDisplays, grabDisplay, cropDip, finalize, copyShot, ensureDir, saveDir };
