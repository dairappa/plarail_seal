// 画像の簡易編集（ロゴ向け）。元画像は変えず、編集内容（edits）を毎回適用して加工済みキャンバスを作る。
//   1. 背景の透明化 … 指定色に近い画素を透明にする（外周からつながった部分のみ / 画像全体）
//   2. 色の置き換え … 指定色に近い画素の色をずらす（陰影・アンチエイリアスを保つ）
//   3. 単色化       … 不透明な部分をすべて 1 色にする（シルエット）
//   4. 余白の切り詰め … 透明な外周を取り除く

export const MAX_IMPORT_PX = 1200;   // 読み込み時の長辺上限（シールには十分、保存容量も抑える）

export function defaultEdits() {
  return {
    removeBg: { enabled: false, color: '#ffffff', tolerance: 12, mode: 'edge', feather: 8 },
    recolors: [],
    mono: { enabled: false, color: '#ffffff' },
    trim: false,
  };
}

export function makeRecolor(from = '#000000', to = '#ffffff') {
  return { from, to, tolerance: 20 };
}

export function normalizeEdits(e) {
  const d = defaultEdits();
  if (!e) return d;
  // 既に整っていれば同じオブジェクトを返す（UI のコールバックが参照を保持しているため）
  if (e.removeBg && Array.isArray(e.recolors) && e.mono && 'trim' in e && 'feather' in e.removeBg) return e;
  return {
    removeBg: { ...d.removeBg, ...(e.removeBg || {}) },
    recolors: Array.isArray(e.recolors) ? e.recolors.map(r => ({ ...makeRecolor(), ...r })) : [],
    mono: { ...d.mono, ...(e.mono || {}) },
    trim: !!e.trim,
  };
}

export function hasEdits(e) {
  if (!e) return false;
  return !!(e.removeBg?.enabled || (e.recolors && e.recolors.length) || e.mono?.enabled || e.trim);
}

export function hexToRgb(hex) {
  const h = String(hex || '#000000').replace('#', '');
  const v = h.length === 3 ? h.split('').map(c => c + c).join('') : h.padEnd(6, '0');
  const n = parseInt(v, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}

const MAXD = Math.sqrt(3 * 255 * 255);
/** 色の距離を 0〜100 で返す */
function dist(d, o, c) {
  const dr = d[o] - c[0], dg = d[o + 1] - c[1], db = d[o + 2] - c[2];
  return Math.sqrt(dr * dr + dg * dg + db * db) / MAXD * 100;
}

/**
 * 外周の画素で最も多い色（背景色の推定）。
 * 外周の半分以上が透明なら「背景はすでに透明」とみなして null を返す
 * （このとき外周の不透明な画素はロゴのはみ出しなので、背景色ではない）。
 */
export function detectBorderColor(img) {
  const { width: w, height: h, data } = img;
  const counts = new Map();
  let total = 0, transparent = 0;
  const add = (x, y) => {
    const o = (y * w + x) * 4;
    total++;
    if (data[o + 3] < 128) { transparent++; return; }
    const k = ((data[o] >> 3) << 10) | ((data[o + 1] >> 3) << 5) | (data[o + 2] >> 3);  // 5bit 量子化
    const c = counts.get(k) || { n: 0, r: 0, g: 0, b: 0 };
    c.n++; c.r += data[o]; c.g += data[o + 1]; c.b += data[o + 2];
    counts.set(k, c);
  };
  for (let x = 0; x < w; x++) { add(x, 0); add(x, h - 1); }
  for (let y = 1; y < h - 1; y++) { add(0, y); add(w - 1, y); }
  if (transparent * 2 >= total) return null;
  let best = null;
  for (const c of counts.values()) if (!best || c.n > best.n) best = c;
  if (!best) return null;
  return rgbToHex(best.r / best.n, best.g / best.n, best.b / best.n);
}

/** 指定位置の色（スポイト） */
export function colorAt(img, x, y) {
  const xi = Math.max(0, Math.min(img.width - 1, Math.floor(x)));
  const yi = Math.max(0, Math.min(img.height - 1, Math.floor(y)));
  const o = (yi * img.width + xi) * 4;
  return rgbToHex(img.data[o], img.data[o + 1], img.data[o + 2]);
}

/** 背景の透明化（ImageData をその場で書き換える） */
export function removeBackground(img, opt) {
  const { width: w, height: h, data } = img;
  const bg = hexToRgb(opt.color);
  const tol = Math.max(0, opt.tolerance ?? 12);
  const fea = Math.max(0, opt.feather ?? 0);
  const n = w * h;
  const removed = new Uint8Array(n);
  const d = new Float32Array(n);
  for (let i = 0; i < n; i++) d[i] = data[i * 4 + 3] < 10 ? 0 : dist(data, i * 4, bg);
  const isBg = i => d[i] <= tol;

  if (opt.mode === 'all') {
    for (let i = 0; i < n; i++) if (isBg(i)) removed[i] = 1;
  } else {
    // 外周から 4 近傍で塗りつぶし
    const stack = new Int32Array(n);
    let sp = 0;
    const push = i => { if (!removed[i] && isBg(i)) { removed[i] = 1; stack[sp++] = i; } };
    for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
    while (sp > 0) {
      const i = stack[--sp];
      const x = i % w, y = (i - x) / w;
      if (x > 0) push(i - 1);
      if (x < w - 1) push(i + 1);
      if (y > 0) push(i - w);
      if (y < h - 1) push(i + w);
    }
  }

  // なじませ: 透明にした領域に接する画素を、背景色からの距離に応じて半透明にし、背景色の混ざりを取り除く
  const partial = new Float32Array(n).fill(1);
  if (fea > 0) {
    for (let i = 0; i < n; i++) {
      if (removed[i] || d[i] > tol + fea) continue;
      const x = i % w, y = (i - x) / w;
      const near = (x > 0 && removed[i - 1]) || (x < w - 1 && removed[i + 1]) || (y > 0 && removed[i - w]) || (y < h - 1 && removed[i + w]);
      if (opt.mode === 'all' || near) partial[i] = Math.max(0, Math.min(1, (d[i] - tol) / fea));
    }
  }
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    if (removed[i]) { data[o + 3] = 0; continue; }
    const a = partial[i];
    if (a < 1) {
      // 色 = 前景 × a + 背景 × (1 - a) とみなして前景色を取り出す
      for (let k = 0; k < 3; k++) data[o + k] = Math.max(0, Math.min(255, Math.round((data[o + k] - bg[k] * (1 - a)) / Math.max(a, 0.05))));
      data[o + 3] = Math.round(data[o + 3] * a);
    }
  }
}

/** 色の置き換え: 元色に近いほど強く、新しい色の方向へずらす */
export function recolor(img, rule) {
  const { data } = img;
  const from = hexToRgb(rule.from), to = hexToRgb(rule.to);
  const tol = Math.max(0.1, rule.tolerance ?? 20);
  const shift = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
  for (let o = 0; o < data.length; o += 4) {
    if (data[o + 3] === 0) continue;
    const dd = dist(data, o, from);
    if (dd > tol) continue;
    const wgt = dd <= tol * 0.5 ? 1 : (tol - dd) / (tol * 0.5);
    for (let k = 0; k < 3; k++) data[o + k] = Math.max(0, Math.min(255, Math.round(data[o + k] + shift[k] * wgt)));
  }
}

/** 単色化: 透明度だけを残して 1 色にする */
export function monochrome(img, color) {
  const { data } = img;
  const c = hexToRgb(color);
  for (let o = 0; o < data.length; o += 4) {
    if (data[o + 3] === 0) continue;
    data[o] = c[0]; data[o + 1] = c[1]; data[o + 2] = c[2];
  }
}

/** 不透明な画素の割合（0〜1） */
export function opaqueRatio(img, threshold = 8) {
  const d = img.data; let n = 0;
  for (let o = 3; o < d.length; o += 4) if (d[o] > threshold) n++;
  return n / (img.width * img.height);
}

/** 不透明部分の外接矩形。すべて透明なら null */
export function opaqueBounds(img, threshold = 8) {
  const { width: w, height: h, data } = img;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > threshold) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/**
 * 元画像（HTMLImageElement / Canvas）に編集を適用したキャンバスを返す
 */
export function applyEdits(source, edits) {
  const sw = source.naturalWidth || source.width, sh = source.naturalHeight || source.height;
  const c = document.createElement('canvas');
  c.width = sw; c.height = sh;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0);
  const e = normalizeEdits(edits);
  if (!hasEdits(e)) return c;
  const img = ctx.getImageData(0, 0, sw, sh);
  if (e.removeBg.enabled) removeBackground(img, e.removeBg);
  for (const r of e.recolors) recolor(img, r);
  if (e.mono.enabled) monochrome(img, e.mono.color);
  ctx.putImageData(img, 0, 0);
  if (e.trim) {
    const b = opaqueBounds(img);
    if (b && (b.w < sw || b.h < sh)) {
      const t = document.createElement('canvas');
      t.width = b.w; t.height = b.h;
      t.getContext('2d').drawImage(c, b.x, b.y, b.w, b.h, 0, 0, b.w, b.h);
      return t;
    }
  }
  return c;
}

/** 読み込み時に長辺を MAX_IMPORT_PX までに縮小した PNG dataURL を作る（SVG もここでラスタ化） */
export function downscaleDataURL(dataURL, maxPx = MAX_IMPORT_PX) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth || 512, h = img.naturalHeight || 512;
      const k = Math.min(1, maxPx / Math.max(w, h));
      const isSvg = /^data:image\/svg/.test(dataURL);
      if (k === 1 && !isSvg) { resolve({ src: dataURL, w, h }); return; }
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
      const ctx = c.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, c.width, c.height);
      resolve({ src: c.toDataURL('image/png'), w: c.width, h: c.height });
    };
    img.onerror = () => reject(new Error('画像を読み込めませんでした'));
    img.src = dataURL;
  });
}
