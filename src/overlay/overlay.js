const bg = document.getElementById('bg');
const sel = document.getElementById('sel');
const label = document.getElementById('label');
const hint = document.getElementById('hint');
let start = null;
let mode = 'region';     // region | scroll | window
let windows = [];        // window mode: [{title, x, y, width, height}] in DIPs relative to this display
let hovered = null;
let last = null;          // latest pointer position while dragging
const HINTS = {
  region: hint.innerHTML,
  window: 'Click a window to capture it · Esc to cancel',
  scroll: 'Select the scrollable area · BetterShxt scrolls it for you · Esc to cancel',
};

// Until the frozen screen arrives the body is "pending": fully transparent (so the screen
// grab behind it is pixel-exact) but already taking input, so a drag started the instant the
// hotkey fires is tracked and simply becomes visible once the image lands.
window.api.onOverlayStart(({ mode: m }) => {
  mode = m || 'region';
  sel.classList.toggle('win', mode === 'window');
  sel.classList.toggle('scroll', mode === 'scroll');
  document.body.classList.toggle('win', mode === 'window');
  if (mode === 'region') hint.innerHTML = HINTS.region;
  else hint.textContent = HINTS[mode];
  if (mode === 'window' && start) reset(); // an early press in window mode is not a drag
});

window.api.onOverlayImage(({ image, windows: wins }) => {
  windows = wins || [];
  bg.src = image;
  sel.style.backgroundImage = `url(${image})`;
  bg.decode().catch(() => {}).then(() => document.body.classList.remove('pending'));
});

function rectFrom(a, b) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}

function draw(r, text) {
  sel.style.display = 'block';
  sel.style.left = r.x + 'px';
  sel.style.top = r.y + 'px';
  sel.style.width = r.width + 'px';
  sel.style.height = r.height + 'px';
  sel.style.backgroundSize = `${window.innerWidth}px ${window.innerHeight}px`;
  sel.style.backgroundPosition = `-${r.x + 1}px -${r.y + 1}px`;
  label.style.display = 'block';
  label.textContent = text || `${r.width} × ${r.height}`;
  let ly = r.y + r.height + 8;
  if (ly + 24 > window.innerHeight) ly = r.y - 28;
  if (ly < 0) ly = r.y + 8;
  label.style.left = Math.max(0, r.x) + 'px';
  label.style.top = ly + 'px';
}

function reset() {
  start = null;
  last = null;
  sel.style.display = 'none';
  label.style.display = 'none';
  hint.style.display = '';
}

function windowAt(x, y) {
  return windows.find((w) => x >= w.x && y >= w.y && x < w.x + w.width && y < w.y + w.height) || null;
}

function finish(end) {
  const r = rectFrom(start, end);
  start = null;
  last = null;
  if (r.width < 2 || r.height < 2) { reset(); return; }
  window.api.overlaySelect(r);
}

// Pointer capture keeps the drag alive even if the cursor crosses onto another display's overlay.
window.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  if (mode === 'window') return;
  e.preventDefault();
  try { document.documentElement.setPointerCapture(e.pointerId); } catch (_) { /* capture is best-effort */ }
  start = { x: e.clientX, y: e.clientY };
  last = start;
  hint.style.display = 'none';
  draw(rectFrom(start, start));
});

window.addEventListener('pointermove', (e) => {
  if (mode === 'window') {
    const w = windowAt(e.clientX, e.clientY);
    if (w !== hovered) {
      hovered = w;
      if (w) {
        draw({ x: w.x, y: w.y, width: w.width, height: w.height }, `${w.title}  —  ${w.width} × ${w.height}`);
      } else {
        sel.style.display = 'none';
        label.style.display = 'none';
      }
    }
    return;
  }
  if (!start) return;
  // Button already up but the release never reached us: finish where the cursor last was.
  if ((e.buttons & 1) === 0) { finish(last); return; }
  last = { x: e.clientX, y: e.clientY };
  draw(rectFrom(start, last));
});

window.addEventListener('pointerup', (e) => {
  if (e.button !== 0) return;
  if (mode === 'window') {
    const w = windowAt(e.clientX, e.clientY);
    if (w) window.api.overlaySelect({ x: w.x, y: w.y, width: w.width, height: w.height, title: w.title });
    return;
  }
  if (!start) return;
  finish({ x: e.clientX, y: e.clientY });
});

window.addEventListener('dragstart', (e) => e.preventDefault());

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.api.overlayCancel();
});
window.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  window.api.overlayCancel();
});
