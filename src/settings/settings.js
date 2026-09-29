const state = {};
const $ = (id) => document.getElementById(id);

// Electron accelerator from a KeyboardEvent.
function accelFrom(e) {
  const mods = [];
  if (e.ctrlKey) mods.push('CommandOrControl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  if (e.metaKey) mods.push('Super');
  let key = e.key;
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(key)) return null;
  if (key === ' ') key = 'Space';
  else if (key.length === 1) key = key.toUpperCase();
  else if (/^F\d+$/.test(key)) { /* keep */ }
  else if (key === 'PrintScreen') key = 'PrintScreen';
  else if (key === 'ArrowUp') key = 'Up';
  else if (key === 'ArrowDown') key = 'Down';
  else if (key === 'ArrowLeft') key = 'Left';
  else if (key === 'ArrowRight') key = 'Right';
  // Digit keys report as the digit even with Shift held; use e.code for reliability.
  if (/^Digit\d$/.test(e.code)) key = e.code.slice(5);
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
  if (mods.length === 0 && !/^F\d+$/.test(key) && key !== 'PrintScreen') return null;
  return [...mods, key].join('+');
}

function pretty(accel) {
  return (accel || '').replace('CommandOrControl', 'Ctrl').replace(/\+/g, ' + ') || '(none)';
}

document.querySelectorAll('.hotkey').forEach((inp) => {
  inp.addEventListener('focus', () => { inp.classList.add('recording'); inp.value = 'Press keys…'; });
  inp.addEventListener('blur', () => { inp.classList.remove('recording'); inp.value = pretty(state[inp.dataset.k]); });
  inp.addEventListener('keydown', (e) => {
    e.preventDefault();
    if (e.key === 'Escape') { inp.blur(); return; }
    if (e.key === 'Backspace') { state[inp.dataset.k] = ''; inp.blur(); return; }
    const a = accelFrom(e);
    if (!a) return;
    state[inp.dataset.k] = a;
    inp.blur();
  });
});

$('dismissSeconds').addEventListener('input', () => {
  const v = Number($('dismissSeconds').value);
  $('dismissLabel').textContent = v === 0 ? 'never' : `${v}s`;
});
$('maxCards').addEventListener('input', () => { $('maxLabel').textContent = $('maxCards').value; });

$('pick').addEventListener('click', async () => {
  const dir = await window.api.settingsPickDir();
  if (dir) { state.saveDir = dir; $('saveDir').value = dir; }
});

function fill(s) {
  Object.assign(state, s);
  document.querySelectorAll('.hotkey').forEach((inp) => { inp.value = pretty(s[inp.dataset.k]); });
  $('saveDir').value = s.saveDir;
  $('copyMode').value = s.copyMode;
  $('dismissSeconds').value = s.dismissSeconds;
  $('dismissSeconds').dispatchEvent(new Event('input'));
  $('maxCards').value = s.maxCards;
  $('maxCards').dispatchEvent(new Event('input'));
  $('launchAtLogin').checked = !!s.launchAtLogin;
}

$('save').addEventListener('click', async () => {
  const patch = {
    hotkeyRegion: state.hotkeyRegion,
    hotkeyFullscreen: state.hotkeyFullscreen,
    hotkeyWindow: state.hotkeyWindow,
    hotkeyScroll: state.hotkeyScroll,
    saveDir: state.saveDir,
    copyMode: $('copyMode').value,
    dismissSeconds: Number($('dismissSeconds').value),
    maxCards: Number($('maxCards').value),
    launchAtLogin: $('launchAtLogin').checked,
  };
  const res = await window.api.settingsSave(patch);
  if (res && res.failed && res.failed.length) {
    alert('Could not register: ' + res.failed.join(', ') + '\nAnother app may own that hotkey.');
    return;
  }
  window.api.settingsClose();
});
$('cancel').addEventListener('click', () => window.api.settingsClose());
$('x').addEventListener('click', () => window.api.settingsClose());
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !e.target.classList.contains('hotkey')) window.api.settingsClose(); });

window.api.settingsGet().then(fill);
