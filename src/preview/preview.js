const strip = document.getElementById('strip');
let MAX = 5;
let TTL = 8000;
const cards = [];
let progressCard = null;

window.api.onConfig((cfg) => {
  MAX = cfg.maxCards || 5;
  TTL = (cfg.dismissSeconds || 0) * 1000;
});

function syncSize() {
  if (cards.length === 0) { window.api.hide(); return; }
  const CARD_W = 240, CARD_H = 176, GAP = 12, PAD = 16;
  const n = cards.length;
  window.api.resize(n * CARD_W + (n - 1) * GAP + PAD * 2, CARD_H + PAD * 2);
}

function remove(card) {
  const i = cards.indexOf(card);
  if (i >= 0) cards.splice(i, 1);
  clearTimeout(card.timer);
  card.el.classList.add('leaving');
  setTimeout(() => { card.el.remove(); syncSize(); }, 250);
}

function armTimer(card) {
  clearTimeout(card.timer);
  const bar = card.el.querySelector('.progress');
  if (TTL <= 0) { bar.style.transition = 'none'; bar.style.transform = 'scaleX(0)'; return; }
  bar.style.transition = 'none';
  bar.style.transform = 'scaleX(1)';
  requestAnimationFrame(() => requestAnimationFrame(() => {
    bar.style.transition = `transform ${TTL}ms linear`;
    bar.style.transform = 'scaleX(0)';
  }));
  card.timer = setTimeout(() => remove(card), TTL);
}

function pauseTimer(card) {
  clearTimeout(card.timer);
  const bar = card.el.querySelector('.progress');
  bar.style.transition = 'none';
  bar.style.transform = 'scaleX(1)';
}

function toast(card, text) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = text;
  card.el.appendChild(t);
  setTimeout(() => t.remove(), 900);
}

function add(shot) {
  const el = document.createElement('div');
  el.className = 'card';
  el.innerHTML = `
    <div class="close" title="Dismiss">&times;</div>
    <div class="drag" draggable="true"><img><span class="dims"></span></div>
    <div class="bar">
      <div class="actions">
        <button data-a="annotate" title="Annotate">Edit</button>
        <button data-a="copy" title="Copy image">Copy</button>
        <button data-a="saveas" title="Save as">Save</button>
        <button data-a="reveal" title="Show in folder">Folder</button>
        <button data-a="delete" class="danger" title="Delete file">Del</button>
      </div>
    </div>
    <div class="progress"></div>`;
  el.querySelector('img').src = shot.dataUrl;
  el.querySelector('.dims').textContent = `${shot.width} × ${shot.height}`;

  const card = { el, shot, timer: null };

  const dragEl = el.querySelector('.drag');
  dragEl.addEventListener('dragstart', (e) => {
    e.preventDefault();
    window.api.startDrag(shot.path);
  });
  dragEl.addEventListener('dblclick', () => window.api.action('annotate', shot.path));
  // Buttons must never start a native drag; stop mousedown from bubbling.
  el.querySelector('.bar').addEventListener('mousedown', (e) => e.stopPropagation());
  el.querySelector('.close').addEventListener('mousedown', (e) => e.stopPropagation());
  el.addEventListener('mouseenter', () => pauseTimer(card));
  el.addEventListener('mouseleave', () => armTimer(card));
  el.querySelector('.close').addEventListener('click', () => remove(card));
  el.querySelectorAll('.actions button').forEach((b) => {
    b.addEventListener('click', async (e) => {
      e.stopPropagation();
      const a = b.dataset.a;
      const res = await window.api.action(a, shot.path);
      if (a === 'delete') { remove(card); return; }
      if (a === 'annotate') { pauseTimer(card); return; }
      if (a === 'copy') toast(card, 'Copied');
      if (a === 'saveas' && res) toast(card, 'Saved');
    });
  });

  strip.appendChild(el);
  cards.push(card);
  while (cards.length > MAX) remove(cards[0]);
  syncSize();
  armTimer(card);
}

window.api.onScreenshot(add);

// Scrolling capture progress: a placeholder card that gets replaced by the real shot.
window.api.onProgress((info) => {
  if (info.done) {
    if (progressCard) { remove(progressCard); progressCard = null; }
    return;
  }
  if (!progressCard) {
    const el = document.createElement('div');
    el.className = 'card';
    el.innerHTML = `<div class="drag"><img></div><div class="bar"><span class="status"></span></div><div class="progress"></div>`;
    progressCard = { el, shot: { path: null }, timer: null };
    strip.appendChild(el);
    cards.push(progressCard);
    syncSize();
  }
  progressCard.el.querySelector('img').src = info.dataUrl || '';
  progressCard.el.querySelector('.status').textContent = info.text || '';
});
window.api.onUpdate((shot) => {
  const card = cards.find((c) => c.shot.path === shot.path);
  if (!card) return;
  card.shot = shot;
  card.el.querySelector('img').src = shot.dataUrl;
  card.el.querySelector('.dims').textContent = `${shot.width} × ${shot.height}`;
  toast(card, 'Updated');
  armTimer(card);
});
