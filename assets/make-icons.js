// npx electron assets/make-icons.js  -> writes icon-*.png and icon.ico from icon.svg
const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');
const sizes = [16, 24, 32, 48, 64, 128, 256];

app.whenReady().then(async () => {
  const svg = fs.readFileSync(path.join(__dirname, 'icon.svg')).toString('base64');
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html,<body></body>');
  const results = await win.webContents.executeJavaScript(`
    new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        resolve(${JSON.stringify(sizes)}.map((s) => {
          const c = document.createElement('canvas'); c.width = s; c.height = s;
          c.getContext('2d').drawImage(img, 0, 0, s, s);
          return c.toDataURL('image/png');
        }));
      };
      img.src = 'data:image/svg+xml;base64,${svg}';
    })`);
  const pngs = results.map((dataUrl, i) => {
    const png = nativeImage.createFromDataURL(dataUrl).toPNG();
    fs.writeFileSync(path.join(__dirname, `icon-${sizes[i]}.png`), png);
    return { s: sizes[i], png };
  });
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(pngs.length, 4);
  const entries = []; const datas = [];
  let offset = 6 + 16 * pngs.length;
  for (const { s, png } of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(s === 256 ? 0 : s, 0); e.writeUInt8(s === 256 ? 0 : s, 1);
    e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
    e.writeUInt32LE(png.length, 8); e.writeUInt32LE(offset, 12);
    entries.push(e); datas.push(png); offset += png.length;
  }
  fs.writeFileSync(path.join(__dirname, 'icon.ico'), Buffer.concat([header, ...entries, ...datas]));
  console.log('icons written');
  app.quit();
});
