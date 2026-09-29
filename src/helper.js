// Thin client for winhelper.ps1: a persistent PowerShell process answering JSON commands.
const { spawn } = require('child_process');
const path = require('path');
const readline = require('readline');

let proc = null;
let queue = [];   // pending resolvers, FIFO
let rl = null;

function start() {
  if (proc) return;
  proc = spawn('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', path.join(__dirname, 'winhelper.ps1').replace('app.asar', 'app.asar.unpacked'),
  ], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  rl = readline.createInterface({ input: proc.stdout });
  rl.on('line', (line) => {
    const next = queue.shift();
    if (!next) return;
    try { next.resolve(JSON.parse(line)); } catch (err) { next.reject(err); }
  });
  proc.stderr.on('data', (d) => console.error('[helper]', d.toString().trim()));
  proc.on('exit', () => {
    proc = null;
    for (const q of queue) q.reject(new Error('helper exited'));
    queue = [];
  });
}

function send(cmd, timeoutMs = 5000) {
  start();
  return new Promise((resolve, reject) => {
    const entry = { resolve, reject };
    queue.push(entry);
    const t = setTimeout(() => {
      const i = queue.indexOf(entry);
      if (i >= 0) queue.splice(i, 1);
      reject(new Error('helper timeout'));
    }, timeoutMs);
    entry.resolve = (v) => { clearTimeout(t); resolve(v); };
    entry.reject = (e) => { clearTimeout(t); reject(e); };
    proc.stdin.write(JSON.stringify(cmd) + '\n');
  });
}

// Returns [{h, title, x, y, width, height}] in physical pixels, z-order top first.
async function listWindows() {
  const res = await send({ cmd: 'windows' });
  return Array.isArray(res) ? res : [];
}

// Physical screen coords.
function scroll(x, y, delta) {
  return send({ cmd: 'scroll', x: Math.round(x), y: Math.round(y), delta });
}

function stop() {
  if (proc) { try { proc.stdin.write('{"cmd":"quit"}\n'); } catch (_) { /* ignore */ } }
}

module.exports = { start, listWindows, scroll, stop };
