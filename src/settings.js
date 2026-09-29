const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const FILE = path.join(app.getPath('userData'), 'settings.json');

const DEFAULTS = {
  hotkeyRegion: 'CommandOrControl+Shift+4',
  hotkeyFullscreen: 'CommandOrControl+Shift+3',
  hotkeyWindow: 'CommandOrControl+Shift+5',
  hotkeyScroll: 'CommandOrControl+Shift+6',
  saveDir: path.join(app.getPath('pictures'), 'Screenshots'),
  dismissSeconds: 8,
  copyMode: 'both',        // both | image | path | none
  maxCards: 5,
  launchAtLogin: false,
};

let current = null;

function load() {
  if (current) return current;
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (_) { /* first run */ }
  current = { ...DEFAULTS, ...saved };
  return current;
}

function save(patch) {
  current = { ...load(), ...patch };
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(current, null, 2));
  return current;
}

function get(key) { return load()[key]; }

module.exports = { load, save, get, DEFAULTS, FILE };
