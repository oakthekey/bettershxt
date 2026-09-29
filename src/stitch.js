// Vertical stitching for scrolling capture. Works on BGRA bitmaps from nativeImage.toBitmap().
//
// Real pages rarely scroll as a whole: sticky headers/footers, fixed sidebars and the
// scrollbar stay put while the content moves. So each frame pair is compared only on what
// actually moved: columns that never change (sidebars, margins) are dropped, rows that are
// unchanged in place at the top/bottom (sticky header/footer) are trimmed, and the offset is
// found on the remaining body.
const { nativeImage } = require('electron');

const lumaCache = new WeakMap();

function lumaOf(image) {
  let l = lumaCache.get(image);
  if (l) return l;
  const { width, height } = image.getSize();
  const buf = image.toBitmap();
  const luma = new Uint8Array(width * height);
  for (let i = 0, p = 0; p < luma.length; i += 4, p++) {
    luma[p] = (buf[i] * 29 + buf[i + 1] * 150 + buf[i + 2] * 77) >> 8; // BGRA
  }
  l = { width, height, luma };
  lumaCache.set(image, l);
  return l;
}

const STATIC_PX = 12;  // luma change below this counts as "unchanged"
const BINS = 24;       // row signature resolution
const ROW_CAP = 10;    // max score contribution of one row
const ROW_OK = 4;      // mean luma diff under which two rows count as the same

// Columns (sampled) whose pixels change anywhere between A and B at the same position.
function movingColumns(A, B) {
  const { width: W, height: H } = A;
  const cstep = Math.max(1, Math.floor(W / 480));
  const rstep = Math.max(1, Math.floor(H / 240));
  const cols = [];
  for (let x = 0; x < W; x += cstep) {
    for (let y = 0; y < H; y += rstep) {
      const p = y * W + x;
      if (Math.abs(A.luma[p] - B.luma[p]) > STATIC_PX) { cols.push(x); break; }
    }
  }
  return cols;
}

function rowDiff(A, ya, B, yb, cols) {
  const oa = ya * A.width;
  const ob = yb * B.width;
  let sum = 0;
  for (const x of cols) sum += Math.abs(A.luma[oa + x] - B.luma[ob + x]);
  return sum / cols.length;
}

// Per-row signature: mean luma of the moving columns in BINS horizontal buckets.
function signatures(L, cols, y0, y1) {
  const per = Math.max(1, Math.ceil(cols.length / BINS));
  const nb = Math.ceil(cols.length / per);
  const sig = new Float32Array((y1 - y0) * nb);
  for (let y = y0; y < y1; y++) {
    const o = y * L.width;
    for (let b = 0; b < nb; b++) {
      let s = 0;
      const end = Math.min(cols.length, (b + 1) * per);
      for (let c = b * per; c < end; c++) s += L.luma[o + cols[c]];
      sig[(y - y0) * nb + b] = s / (end - b * per);
    }
  }
  return { sig, nb };
}

// How far `next` scrolled relative to `prev`.
// Returns { offset, footer, body }: offset > 0 = rows scrolled, 0 = nothing moved, -1 = no match.
// footer = rows at the bottom that stayed put (sticky footer), needed by compose();
// body = height of the moving area, used to size the next scroll step.
// `hint` (previous offset) breaks ties on repetitive content.
function findOffset(prev, next, hint = 0) {
  const A = lumaOf(prev);
  const B = lumaOf(next);
  if (A.width !== B.width || A.height !== B.height) return { offset: -1, footer: 0 };
  const H = A.height;

  const cols = movingColumns(A, B);
  if (!cols.length) return { offset: 0, footer: 0 };

  // Sticky header/footer: leading/trailing rows unchanged in place.
  let top = 0;
  while (top < H && rowDiff(A, top, B, top, cols) < 2) top++;
  let footer = 0;
  while (footer < H - top && rowDiff(A, H - 1 - footer, B, H - 1 - footer, cols) < 2) footer++;
  const bodyH = H - top - footer;
  const MIN_OVERLAP = Math.max(16, Math.floor(bodyH * 0.1));
  if (bodyH < MIN_OVERLAP * 2) return { offset: 0, footer }; // only a blinking caret or similar changed

  const sa = signatures(A, cols, top, H - footer);
  const sb = signatures(B, cols, top, H - footer);
  const nb = sa.nb;

  // Score every shift k: body row y+k of A should equal body row y of B. Each row's
  // contribution is capped so rows that don't follow the scroll (translucent/blurred
  // sticky bars, animated backgrounds) can't outweigh the content that does.
  const scores = new Float32Array(bodyH - MIN_OVERLAP + 1);
  for (let k = 0; k < scores.length; k++) {
    const overlap = bodyH - k;
    const ystep = Math.max(1, Math.floor(overlap / 160));
    let sum = 0;
    let n = 0;
    for (let y = 0; y < overlap; y += ystep) {
      const oa = (y + k) * nb;
      const ob = y * nb;
      let d = 0;
      for (let b = 0; b < nb; b++) d += Math.abs(sa.sig[oa + b] - sb.sig[ob + b]);
      sum += Math.min(ROW_CAP, d / nb);
      n++;
    }
    scores[k] = sum / n;
  }

  let best = 0;
  for (let k = 1; k < scores.length; k++) if (scores[k] < scores[best]) best = k;
  if (best === 0) return { offset: 0, footer };

  // Repetitive content (lists, tables) can match at several shifts: prefer the one
  // closest to the previous step's scroll distance.
  if (hint > 0) {
    const tol = scores[best] * 1.15 + 0.3;
    let pick = best;
    for (let k = 1; k < scores.length; k++) {
      if (scores[k] <= tol && Math.abs(k - hint) < Math.abs(pick - hint)) pick = k;
    }
    best = pick;
  }

  if (scores[best] > scores[0] * 0.5) return { offset: -1, footer }; // not clearly better than "didn't move"

  // Pixel check at the chosen shift. Rows that don't match at the start/end of the overlap
  // are a translucent sticky header/footer; everything between must match.
  const y0 = top;
  const y1 = H - footer - best; // overlap rows in B coordinates: [y0, y1)
  const ok = new Uint8Array(y1 - y0);
  for (let y = y0; y < y1; y++) ok[y - y0] = rowDiff(A, y + best, B, y, cols) < ROW_OK ? 1 : 0;
  const lead = bandLength(ok, 0, 1);
  const trail = bandLength(ok, ok.length - 1, -1);
  let good = 0;
  for (let i = lead; i < ok.length - trail; i++) good += ok[i];
  const mid = ok.length - lead - trail;
  if (mid < MIN_OVERLAP || good < mid * 0.85) return { offset: -1, footer };
  return { offset: best, footer: footer + trail, body: bodyH - lead - trail };
}

// Rows from one end of `ok` until a run of RUN matching rows starts.
function bandLength(ok, from, dir) {
  const RUN = 6;
  let run = 0;
  for (let i = from, n = 0; i >= 0 && i < ok.length; i += dir, n++) {
    run = ok[i] ? run + 1 : 0;
    if (run === RUN) return n + 1 - RUN;
  }
  return ok.length;
}

// frames[0] up to the footer, then from each later frame the `offsets[i]` newly revealed
// rows just above the footer, then the last frame's footer once.
function compose(frames, offsets, footer = 0) {
  const { width: W, height: H } = frames[0].getSize();
  const stride = W * 4;
  const parts = [{ image: frames[0], from: 0, rows: H - footer }];
  for (let i = 1; i < frames.length; i++) {
    const off = offsets[i];
    if (off > 0) parts.push({ image: frames[i], from: H - footer - off, rows: off });
  }
  if (footer > 0) parts.push({ image: frames[frames.length - 1], from: H - footer, rows: footer });
  const total = parts.reduce((t, p) => t + p.rows, 0);
  const out = Buffer.alloc(stride * total);
  let y = 0;
  for (const p of parts) {
    p.image.toBitmap().copy(out, y * stride, p.from * stride, (p.from + p.rows) * stride);
    y += p.rows;
  }
  return nativeImage.createFromBitmap(out, { width: W, height: total });
}

module.exports = { findOffset, compose };
