const base = document.getElementById('base');
const draw = document.getElementById('draw');
const bctx = base.getContext('2d');
const dctx = draw.getContext('2d');
const textInput = document.getElementById('textInput');
const sizeInput = document.getElementById('size');

const COLORS = ['#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#4c9aff', '#af52de', '#ffffff', '#000000'];
let color = COLORS[0];
let tool = 'arrow';
let filePath = null;
let img = null;
let shapes = [];      // committed shapes
let redoStack = [];
let current = null;   // shape being drawn
let dpr = 1;

// ---------- Setup ----------
const colorsEl = document.getElementById('colors');
COLORS.forEach((c, i) => {
  const s = document.createElement('span');
  s.className = 'swatch' + (i === 0 ? ' active' : '');
  s.style.background = c;
  s.addEventListener('click', () => {
    color = c;
    document.querySelectorAll('.swatch').forEach((x) => x.classList.remove('active'));
    s.classList.add('active');
  });
  colorsEl.appendChild(s);
});
colorsEl.style.display = 'flex';
colorsEl.style.gap = '4px';

document.querySelectorAll('.tool').forEach((b) => {
  b.addEventListener('click', () => setTool(b.dataset.t));
});
function setTool(t) {
  tool = t;
  document.querySelectorAll('.tool').forEach((x) => x.classList.toggle('active', x.dataset.t === t));
}

window.api.onEditorInit(({ path, dataUrl }) => {
  filePath = path;
  img = new Image();
  img.onload = () => {
    base.width = draw.width = img.naturalWidth;
    base.height = draw.height = img.naturalHeight;
    fitToWindow();
    bctx.drawImage(img, 0, 0);
    render();
  };
  img.src = dataUrl;
});

function fitToWindow() {
  const wrap = document.getElementById('wrap');
  wrap.style.top = document.getElementById('toolbar').offsetHeight + 'px';
  const availW = wrap.clientWidth - 32;
  const availH = wrap.clientHeight - 32;
  const scale = Math.min(1, availW / img.naturalWidth, availH / img.naturalHeight);
  const w = Math.round(img.naturalWidth * scale);
  const h = Math.round(img.naturalHeight * scale);
  [base, draw].forEach((c) => { c.style.width = w + 'px'; c.style.height = h + 'px'; });
  document.getElementById('stage').style.width = w + 'px';
  document.getElementById('stage').style.height = h + 'px';
  dpr = img.naturalWidth / w;
}
window.addEventListener('resize', () => { if (img) fitToWindow(); });

// ---------- Drawing ----------
function pos(e) {
  const r = draw.getBoundingClientRect();
  return { x: (e.clientX - r.left) * dpr, y: (e.clientY - r.top) * dpr };
}

function drawShape(ctx, s) {
  ctx.save();
  ctx.strokeStyle = s.color;
  ctx.fillStyle = s.color;
  ctx.lineWidth = s.size * dprScale();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const lw = ctx.lineWidth;
  switch (s.type) {
    case 'pen':
      ctx.beginPath();
      s.points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.stroke();
      break;
    case 'highlight':
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = lw * 4;
      ctx.lineCap = 'butt';
      ctx.beginPath();
      s.points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.stroke();
      break;
    case 'line':
      ctx.beginPath(); ctx.moveTo(s.x1, s.y1); ctx.lineTo(s.x2, s.y2); ctx.stroke();
      break;
    case 'arrow': {
      const ang = Math.atan2(s.y2 - s.y1, s.x2 - s.x1);
      const head = Math.max(12, lw * 4);
      ctx.beginPath(); ctx.moveTo(s.x1, s.y1); ctx.lineTo(s.x2, s.y2); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(s.x2, s.y2);
      ctx.lineTo(s.x2 - head * Math.cos(ang - Math.PI / 6), s.y2 - head * Math.sin(ang - Math.PI / 6));
      ctx.lineTo(s.x2 - head * Math.cos(ang + Math.PI / 6), s.y2 - head * Math.sin(ang + Math.PI / 6));
      ctx.closePath(); ctx.fill();
      break;
    }
    case 'rect':
      ctx.strokeRect(Math.min(s.x1, s.x2), Math.min(s.y1, s.y2), Math.abs(s.x2 - s.x1), Math.abs(s.y2 - s.y1));
      break;
    case 'ellipse':
      ctx.beginPath();
      ctx.ellipse((s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2, Math.abs(s.x2 - s.x1) / 2, Math.abs(s.y2 - s.y1) / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
    case 'text': {
      const fs = Math.max(12, s.size * 5 * dprScale());
      ctx.font = `600 ${fs}px "Segoe UI", sans-serif`;
      ctx.lineWidth = Math.max(2, fs / 8);
      ctx.strokeStyle = s.color === '#ffffff' ? '#000' : 'rgba(0,0,0,0.6)';
      ctx.strokeText(s.text, s.x, s.y);
      ctx.fillText(s.text, s.x, s.y);
      break;
    }
    case 'blur': {
      const x = Math.min(s.x1, s.x2), y = Math.min(s.y1, s.y2);
      const w = Math.abs(s.x2 - s.x1), h = Math.abs(s.y2 - s.y1);
      if (w < 2 || h < 2) break;
      // Pixelate: downscale then upscale the region from the base image.
      const block = 12 * dprScale();
      const tmp = document.createElement('canvas');
      tmp.width = Math.max(1, Math.round(w / block));
      tmp.height = Math.max(1, Math.round(h / block));
      const tctx = tmp.getContext('2d');
      tctx.imageSmoothingEnabled = true;
      tctx.drawImage(img, x, y, w, h, 0, 0, tmp.width, tmp.height);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(tmp, 0, 0, tmp.width, tmp.height, x, y, w, h);
      break;
    }
    default:
      break;
  }
  ctx.restore();
}

// Scale stroke sizes relative to a 1000px-wide reference so they look consistent on huge captures.
function dprScale() {
  return Math.max(1, img ? img.naturalWidth / 1400 : 1);
}

function render() {
  dctx.clearRect(0, 0, draw.width, draw.height);
  shapes.forEach((s) => drawShape(dctx, s));
  if (current) drawShape(dctx, current);
}

draw.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  if (textInput.style.display === 'block') { commitText(); return; }
  const p = pos(e);
  const size = Number(sizeInput.value);
  if (tool === 'text') {
    textInput.style.display = 'block';
    textInput.style.left = (p.x / dpr) + 'px';
    textInput.style.top = (p.y / dpr - 12) + 'px';
    textInput.style.color = color;
    textInput.style.fontSize = Math.max(12, size * 5 * dprScale() / dpr) + 'px';
    textInput.value = '';
    textInput.dataset.x = p.x;
    textInput.dataset.y = p.y;
    setTimeout(() => textInput.focus(), 0);
    return;
  }
  if (tool === 'pen' || tool === 'highlight') {
    current = { type: tool, color, size, points: [p] };
  } else {
    current = { type: tool, color, size, x1: p.x, y1: p.y, x2: p.x, y2: p.y };
  }
  render();
});

window.addEventListener('mousemove', (e) => {
  if (!current) return;
  const p = pos(e);
  if (current.points) current.points.push(p);
  else { current.x2 = p.x; current.y2 = p.y; }
  render();
});

window.addEventListener('mouseup', () => {
  if (!current) return;
  const s = current;
  current = null;
  const tiny = s.points ? s.points.length < 2 : (Math.abs(s.x2 - s.x1) < 2 && Math.abs(s.y2 - s.y1) < 2);
  if (!tiny) { shapes.push(s); redoStack = []; }
  render();
});

function commitText() {
  const text = textInput.value.trim();
  textInput.style.display = 'none';
  if (!text) return;
  shapes.push({
    type: 'text', color, size: Number(sizeInput.value), text,
    x: Number(textInput.dataset.x), y: Number(textInput.dataset.y) + Number(sizeInput.value) * 4 * dprScale(),
  });
  redoStack = [];
  render();
}
textInput.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Enter') commitText();
  if (e.key === 'Escape') { textInput.value = ''; textInput.style.display = 'none'; }
});

// ---------- Undo/redo/save ----------
function undo() { if (shapes.length) { redoStack.push(shapes.pop()); render(); } }
function redo() { if (redoStack.length) { shapes.push(redoStack.pop()); render(); } }
document.getElementById('undo').addEventListener('click', undo);
document.getElementById('redo').addEventListener('click', redo);

function compose() {
  const out = document.createElement('canvas');
  out.width = base.width; out.height = base.height;
  const ctx = out.getContext('2d');
  ctx.drawImage(base, 0, 0);
  ctx.drawImage(draw, 0, 0);
  return out.toDataURL('image/png');
}

async function save(copyOnly) {
  if (textInput.style.display === 'block') commitText();
  await window.api.editorSave(filePath, compose(), !!copyOnly);
  if (!copyOnly) window.api.editorClose();
  else flash('Copied');
}
document.getElementById('save').addEventListener('click', () => save(false));
document.getElementById('copy').addEventListener('click', () => save(true));
document.getElementById('close').addEventListener('click', () => window.api.editorClose());

function flash(text) {
  const b = document.getElementById('copy');
  const old = b.textContent;
  b.textContent = text;
  setTimeout(() => { b.textContent = old; }, 900);
}

const KEYS = { a: 'arrow', r: 'rect', e: 'ellipse', l: 'line', p: 'pen', h: 'highlight', t: 'text', b: 'blur' };
window.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
  if (e.ctrlKey && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
  if (e.ctrlKey && e.key.toLowerCase() === 's') { e.preventDefault(); save(false); return; }
  if (e.ctrlKey && e.key.toLowerCase() === 'c') { e.preventDefault(); save(true); return; }
  if (e.key === 'Escape') { window.api.editorClose(); return; }
  if (!e.ctrlKey && KEYS[e.key.toLowerCase()]) setTool(KEYS[e.key.toLowerCase()]);
});
