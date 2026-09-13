// キャンバス描画（プレビュー・書き出し共通）。座標は mm、s = px/mm。
import { layoutSheet, MARK_LEN, MARK_GAP } from './layout.js';
import { fillOf } from './model.js';

const imageCache = new Map();
let onImageLoaded = null;
export function setImageLoadedCallback(fn) { onImageLoaded = fn; }

function getImage(src) {
  if (!src) return null;
  let img = imageCache.get(src);
  if (!img) {
    img = new Image();
    img.onload = () => onImageLoaded && onImageLoaded();
    img.src = src;
    imageCache.set(src, img);
  }
  return img.complete && img.naturalWidth > 0 ? img : null;
}

/** すべての項目で使うフォント指定を列挙（プリロード用） */
export function fontsInUse(project) {
  const set = new Set();
  for (const it of project.items) {
    if (it.type === 'sign' || it.type === 'text') set.add(`${it.weight || 400} 20px "${it.font}"`);
  }
  set.add('400 20px "Noto Sans JP"');
  return [...set];
}

/**
 * シート全体を描画する
 * @param ctx  CanvasRenderingContext2D（キャンバスサイズは呼び出し側で設定済み）
 * @param project
 * @param s   px/mm
 * @param opts { mode: 'preview'|'export' }
 */
export function renderSheet(ctx, project, s, opts = {}) {
  const mode = opts.mode || 'preview';
  const lay = layoutSheet(project);
  const W = project.paper.w, H = project.paper.h;
  const k = (project.scaleK || 100) / 100;

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W * s, H * s);

  if (mode === 'export' && Math.abs(k - 1) > 1e-6) {
    // 中央を基準に事前拡大（プリンタ側の縮小を打ち消す）
    ctx.translate(W * s / 2, H * s / 2);
    ctx.scale(k, k);
    ctx.translate(-W * s / 2, -H * s / 2);
  }

  if (lay.ruler) drawRuler(ctx, lay.ruler, s);

  for (const p of lay.placed) {
    drawItem(ctx, p.item, p.x, p.y, s, project);
    drawMarks(ctx, p, s, project);
  }

  if (mode === 'preview' && project.showUnprintable) {
    drawUnprintable(ctx, lay, W, H, s);
  }
  ctx.restore();
  return lay;
}

function drawUnprintable(ctx, lay, W, H, s) {
  const u = lay.usable;
  ctx.save();
  ctx.fillStyle = 'rgba(120,120,120,0.35)';
  // 用紙のうち有効領域の外側
  ctx.beginPath();
  ctx.rect(0, 0, W * s, H * s);
  ctx.rect(u.x * s, u.y * s, u.w * s, u.h * s);
  ctx.fill('evenodd');
  // 配置領域（余白の内側）を破線で
  ctx.strokeStyle = 'rgba(29,95,209,0.6)';
  ctx.lineWidth = Math.max(1, 0.15 * s);
  ctx.setLineDash([4, 4]);
  ctx.strokeRect(lay.area.x * s, lay.area.y * s, lay.area.w * s, lay.area.h * s);
  ctx.restore();
}

function drawMarks(ctx, p, s, project) {
  if (project.marks === 'none') return;
  const b = Math.max(0, project.bleed || 0);
  ctx.save();
  ctx.strokeStyle = '#444';
  ctx.lineWidth = Math.max(0.6, 0.08 * s);
  if (project.marks === 'outline') {
    ctx.strokeRect(p.x * s, p.y * s, p.w * s, p.h * s);
  } else {
    const o = (b + MARK_GAP) * s, L = MARK_LEN * s;
    const x0 = p.x * s, y0 = p.y * s, x1 = (p.x + p.w) * s, y1 = (p.y + p.h) * s;
    ctx.beginPath();
    for (const [x, y, dx, dy] of [[x0, y0, -1, -1], [x1, y0, 1, -1], [x0, y1, -1, 1], [x1, y1, 1, 1]]) {
      // 水平
      ctx.moveTo(x + dx * o, y); ctx.lineTo(x + dx * (o + L), y);
      // 垂直
      ctx.moveTo(x, y + dy * o); ctx.lineTo(x, y + dy * (o + L));
    }
    ctx.stroke();
  }
  ctx.restore();
}

function drawRuler(ctx, r, s) {
  ctx.save();
  ctx.strokeStyle = '#000';
  ctx.fillStyle = '#000';
  ctx.lineWidth = Math.max(0.6, 0.12 * s);
  const y = r.y * s;
  ctx.beginPath();
  ctx.moveTo(r.x * s, y); ctx.lineTo((r.x + r.len) * s, y);
  for (let i = 0; i <= r.len; i++) {
    const t = i % 10 === 0 ? 2.6 : i % 5 === 0 ? 1.8 : 1.0;
    ctx.moveTo((r.x + i) * s, y); ctx.lineTo((r.x + i) * s, y + t * s);
  }
  ctx.stroke();
  ctx.font = `400 ${2 * s}px "Noto Sans JP", sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (let i = 0; i <= r.len; i += 10) ctx.fillText(String(i), (r.x + i) * s, y + 3 * s);
  ctx.textAlign = 'left';
  ctx.font = `400 ${1.8 * s}px "Noto Sans JP", sans-serif`;
  ctx.fillText(`← ${r.len} mm を実測`, (r.x + r.len + 2) * s, y - 0.2 * s);
  ctx.restore();
}

// ---------------------------------------------------------------- 項目描画

export function drawItem(ctx, item, x, y, s, project) {
  const b = Math.max(0, project?.bleed || 0);
  ctx.save();
  paintBackground(ctx, item, x, y, s, b);

  if (item.type === 'sign') {
    if (item.ledDots) drawSignLED(ctx, item, x, y, s);
    else drawSignContent(ctx, item, x, y, s);
  } else if (item.type === 'text') {
    drawTextItem(ctx, item, x, y, s);
  } else if (item.type === 'image') {
    drawImageItem(ctx, item, x, y, s, b);
  }
  ctx.restore();
}

/**
 * 背景を塗る（単色 / ストライプ / グラデーション）。帯の割合はシール本体 (x,y,w,h) に対して決め、
 * 外側の帯だけを塗り足し分だけ外へ伸ばす。
 */
export function paintBackground(ctx, item, x, y, s, bleed = 0) {
  const f = fillOf(item);
  const bands = f.mode === 'solid' ? [f.bands[0]] : f.bands.filter(b => (b.weight ?? 0) > 0);
  const total = bands.reduce((a, b) => a + (Number(b.weight) || 0), 0) || 1;
  const rows = f.mode !== 'cols';                      // rows: 帯が上下に並ぶ（横縞） / cols: 左右に並ぶ（縦縞）
  const len = rows ? item.h : item.w;                  // 帯を積む方向の長さ
  let pos = 0;
  bands.forEach((band, i) => {
    const w = len * ((Number(band.weight) || 0) / total);
    let a = pos, e = pos + w;
    if (i === 0) a -= bleed;
    if (i === bands.length - 1) e += bleed;
    pos += w;
    const rx = rows ? x - bleed : x + a, ry = rows ? y + a : y - bleed;
    const rw = rows ? item.w + 2 * bleed : e - a, rh = rows ? e - a : item.h + 2 * bleed;
    ctx.fillStyle = bandStyle(ctx, band, rx * s, ry * s, rw * s, rh * s);
    // 帯の継ぎ目に隙間が出ないよう 0.5px 重ねる
    ctx.fillRect(rx * s - 0.25, ry * s - 0.25, rw * s + 0.5, rh * s + 0.5);
  });
}

function bandStyle(ctx, band, px, py, pw, ph) {
  if (!band.grad) return band.color;
  const g = band.gradDir === 'h'
    ? ctx.createLinearGradient(px, py, px + pw, py)
    : ctx.createLinearGradient(px, py, px, py + ph);
  g.addColorStop(0, band.color);
  g.addColorStop(1, band.color2 || band.color);
  return g;
}

/** 単体プレビュー用（塗り足しなし・原点 0,0） */
export function renderItemThumb(canvas, item, pxPerMm) {
  canvas.width = Math.max(1, Math.round(item.w * pxPerMm));
  canvas.height = Math.max(1, Math.round(item.h * pxPerMm));
  const ctx = canvas.getContext('2d');
  drawItem(ctx, item, 0, 0, pxPerMm, { bleed: 0 });
}

function fontStr(item, px) {
  const fam = item.font === 'sans-serif' ? 'sans-serif' : `"${item.font}", "Noto Sans JP", sans-serif`;
  return `${item.weight || 400} ${px}px ${fam}`;
}

/**
 * 枠の高さに合わせたフォントサイズと実測幅を求める
 * @returns {{px:number,width:number,asc:number,desc:number}}
 */
function measureFit(ctx, text, boxH, item, heightRatio = 0.96) {
  let px = boxH * heightRatio;
  const setFont = () => {
    ctx.font = fontStr(item, px);
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${(item.letterSpacing || 0) * px / 100}px`;
  };
  setFont();
  let m = ctx.measureText(text);
  // 実グリフの高さで枠に合わせる（英字だけの行は大きめに描かれる）
  const glyphH = (m.actualBoundingBoxAscent || px * 0.8) + (m.actualBoundingBoxDescent || 0);
  if (glyphH > 0) {
    const f = Math.min(1.25, boxH * heightRatio / glyphH);
    if (Math.abs(f - 1) > 0.02) { px *= f; setFont(); m = ctx.measureText(text); }
  }
  return { px, width: m.width, asc: m.actualBoundingBoxAscent || px * 0.8, desc: m.actualBoundingBoxDescent || px * 0.1 };
}

/**
 * 枠に収まるように文字を描く（高さ基準でサイズ決定、幅が超える場合は長体）
 * box: {x,y,w,h} in px
 */
function fitText(ctx, text, box, item, color, align = 'center', opts = {}) {
  if (!text || box.h < 0.5 || box.w <= 0) return;
  ctx.save();
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'center';
  const f = measureFit(ctx, text, box.h, item, opts.heightRatio ?? 0.96);
  const scaleX = f.width > box.w ? box.w / f.width : 1;
  const cy = box.y + box.h / 2 + (f.asc - f.desc) / 2;
  const drawW = f.width * scaleX;
  let cx = box.x + box.w / 2;
  if (align === 'left') cx = box.x + drawW / 2;
  else if (align === 'right') cx = box.x + box.w - drawW / 2;
  ctx.translate(cx, cy);
  ctx.scale(scaleX, 1);
  ctx.fillStyle = color;
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

/** 枠付き / 塗りつぶしのパネルを描き、文字用の内側の箱を返す */
function drawPanel(ctx, style, color, x, y, w, h, radiusPct) {
  const radius = Math.min(h / 2, h * ((radiusPct || 0) / 100));
  if (style === 'fill') {
    ctx.fillStyle = color;
    roundRect(ctx, x, y, w, h, radius);
    ctx.fill();
  } else if (style === 'box') {
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(0.5, h * 0.04);
    roundRect(ctx, x + ctx.lineWidth / 2, y + ctx.lineWidth / 2, w - ctx.lineWidth, h - ctx.lineWidth, radius);
    ctx.stroke();
  }
  const ipad = style === 'plain' || !style ? 0 : h * 0.08;
  return { x: x + ipad, y: y + ipad, w: w - 2 * ipad, h: h - 2 * ipad, ipad };
}

function drawSignContent(ctx, item, x, y, s) {
  const pad = item.h * ((item.padding ?? 8) / 100);
  const inner = { x: (x + pad) * s, y: (y + pad) * s, w: (item.w - 2 * pad) * s, h: (item.h - 2 * pad) * s };
  if (inner.w <= 0 || inner.h <= 0) return;

  const kind = item.kind || {}, dest = item.dest || {}, st = item.station || {};
  const kindOn = kind.enabled !== false && !!(kind.text || kind.en);
  const destOn = dest.enabled !== false && !!(dest.text || dest.en);
  const stOn = st.enabled !== false && !!(st.text && String(st.text).trim());

  // 英字行（下段）の分割。行先で「横」を選んだ場合、行先は分割しない
  const enR = (item.enRatio ?? 0) > 0 ? Math.min(70, item.enRatio) / 100 : 0;
  const kindSplit = kindOn && enR > 0 && !!kind.en;
  const destBelow = destOn && enR > 0 && !!dest.en && item.enLayout !== 'right';
  const destRight = destOn && enR > 0 && !!dest.en && item.enLayout === 'right';
  // 種別と行先の高さを揃えるため、どちらかが 2 段なら同じ分割を使う
  const split = kindSplit || destBelow;
  const rowGap = split ? inner.h * 0.06 : 0;
  const jpH = split ? inner.h * (1 - enR) - rowGap / 2 : inner.h;
  const enH = split ? inner.h * enR - rowGap / 2 : 0;

  // 駅ナンバー（右端）: 日本語行の高さに合わせた正方形
  const rowH = split ? jpH : inner.h;
  const stSize = stOn ? rowH * (Math.min(150, Math.max(30, st.size ?? 95)) / 100) : 0;
  const stGap = stOn ? inner.h * 0.1 : 0;
  const availW = inner.w - stSize - stGap;

  // 種別・行先の幅配分
  const ratio = Math.min(90, Math.max(0, kind.ratio ?? 30)) / 100;
  const colGap = kindOn && destOn ? inner.h * ((item.colGap ?? 6) / 100) : 0;
  const kindW = kindOn ? (destOn ? availW * ratio : availW) : 0;
  const destW = destOn ? availW - kindW - colGap : 0;

  // 種別
  if (kindOn && kindW > 0) {
    const style = kind.style || 'plain';
    const textColor = style === 'plain' ? kind.color : (kind.textColor || kind.color);
    const kb = drawPanel(ctx, style, kind.color, inner.x, inner.y, kindW, inner.h, kind.radius);
    if (split && kind.en) {
      fitText(ctx, kind.text, { x: kb.x, y: kb.y, w: kb.w, h: jpH - kb.ipad }, item, textColor);
      fitText(ctx, kind.en, { x: kb.x, y: inner.y + jpH + rowGap, w: kb.w, h: enH - kb.ipad }, item, style === 'plain' ? (item.enColor || textColor) : textColor, 'center', { heightRatio: 0.85 });
    } else {
      fitText(ctx, kind.text || kind.en, kb, item, textColor);
    }
  }

  // 行先
  if (destOn && destW > 0) {
    const dx = inner.x + kindW + colGap;
    const style = dest.style || 'plain';
    const db = drawPanel(ctx, style, dest.boxColor || dest.color, dx, inner.y, destW, inner.h, dest.radius);
    const enColor = item.enColor || dest.color;
    if (destBelow) {
      fitText(ctx, dest.text, { x: db.x, y: db.y, w: db.w, h: jpH - db.ipad }, item, dest.color);
      fitText(ctx, dest.en, { x: db.x, y: inner.y + jpH + rowGap, w: db.w, h: enH - db.ipad }, item, enColor, 'center', { heightRatio: 0.85 });
    } else if (destRight && dest.text) {
      // 日本語の右に英字を並べる。合計幅が箱を超えるときは両方を同じ比率で詰める
      const jpBoxH = split ? jpH - db.ipad : db.h;   // 種別が 2 段なら日本語行の高さに揃える
      const enBoxH = db.h * enR;
      const gap = db.h * 0.12;
      ctx.save();
      const fj = measureFit(ctx, dest.text, jpBoxH, item, 0.96);
      const fe = measureFit(ctx, dest.en, enBoxH, item, 0.85);
      ctx.restore();
      const total = fj.width + gap + fe.width;
      const sc = total > db.w ? db.w / total : 1;
      const jpW = fj.width * sc, enW = fe.width * sc, g = gap * sc;
      const x0 = db.x + (db.w - (jpW + g + enW)) / 2;
      const jpY = db.y + (db.h - jpBoxH) / 2;
      fitText(ctx, dest.text, { x: x0, y: jpY, w: jpW, h: jpBoxH }, item, dest.color, 'left');
      // 英字は日本語の下端に寄せる
      const enY = jpY + jpBoxH - enBoxH - jpBoxH * 0.04;
      fitText(ctx, dest.en, { x: x0 + jpW + g, y: enY, w: enW, h: enBoxH }, item, enColor, 'left', { heightRatio: 0.85 });
    } else if (split) {
      // 種別だけ 2 段のとき、行先は日本語行の高さで中央に
      fitText(ctx, dest.text || dest.en, { x: db.x, y: db.y, w: db.w, h: db.h }, item, dest.text ? dest.color : enColor);
    } else {
      fitText(ctx, dest.text || dest.en, db, item, dest.text ? dest.color : enColor);
    }
  }

  // 駅ナンバー
  if (stOn) {
    const bx = inner.x + inner.w - stSize, by = inner.y + (rowH - stSize) / 2;
    const r = Math.min(stSize / 2, stSize * ((st.radius ?? 18) / 100));
    const lw = Math.max(0.5, stSize * 0.07);
    if (st.style === 'fill') {
      ctx.fillStyle = st.color; roundRect(ctx, bx, by, stSize, stSize, r); ctx.fill();
    } else {
      ctx.strokeStyle = st.color; ctx.lineWidth = lw;
      roundRect(ctx, bx + lw / 2, by + lw / 2, stSize - lw, stSize - lw, r); ctx.stroke();
    }
    const ip = stSize * 0.1;
    const box = { x: bx + ip, y: by + ip, w: stSize - 2 * ip, h: stSize - 2 * ip };
    const txt = String(st.text).trim();
    const m2 = st.twoLine !== false ? txt.match(/^([A-Za-z]+)[-\s]?(\d+)$/) : null;
    const stItem = { ...item, letterSpacing: 0 };
    if (m2) {
      const lh = box.h / 2;
      fitText(ctx, m2[1], { x: box.x, y: box.y, w: box.w, h: lh * 0.95 }, stItem, st.textColor, 'center', { heightRatio: 0.9 });
      fitText(ctx, m2[2], { x: box.x, y: box.y + lh, w: box.w, h: lh * 0.95 }, stItem, st.textColor, 'center', { heightRatio: 0.9 });
    } else {
      fitText(ctx, txt, box, stItem, st.textColor, 'center', { heightRatio: 0.8 });
    }
  }
}

function roundRect(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  if (r === 0) { ctx.rect(x, y, w, h); return; }
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** LED ドット風: 文字だけを高解像度で描いてからドット格子にサンプリング。背景は通常どおり塗ってある */
function drawSignLED(ctx, item, x, y, s) {
  const rows = Math.max(6, Math.min(64, Math.round(item.ledRows || 16)));
  const cols = Math.max(1, Math.round(rows * item.w / item.h));
  const sup = 6;
  const off = document.createElement('canvas');
  off.width = cols * sup; off.height = rows * sup;
  const octx = off.getContext('2d');
  drawSignContent(octx, item, 0, 0, (rows * sup) / item.h);   // 透明な下地

  const small = document.createElement('canvas');
  small.width = cols; small.height = rows;
  const sctx = small.getContext('2d');
  sctx.imageSmoothingEnabled = true; sctx.imageSmoothingQuality = 'high';
  sctx.drawImage(off, 0, 0, cols, rows);
  const data = sctx.getImageData(0, 0, cols, rows).data;

  const cell = item.h / rows;                // mm
  const r = cell * 0.45 * s;                 // px
  ctx.save();
  ctx.beginPath();
  ctx.rect(x * s, y * s, item.w * s, item.h * s);
  ctx.clip();
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const o = (j * cols + i) * 4;
      const a = data[o + 3] / 255;
      if (a < 0.3) continue;                 // 消灯ドット
      ctx.fillStyle = `rgb(${data[o]},${data[o + 1]},${data[o + 2]})`;
      ctx.beginPath();
      ctx.arc((x + (i + 0.5) * cell) * s, (y + (j + 0.5) * cell) * s, r * (a >= 0.55 ? 1 : 0.7), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawTextItem(ctx, item, x, y, s) {
  const pad = item.h * ((item.padding ?? 8) / 100);
  const inner = { x: (x + pad) * s, y: (y + pad) * s, w: (item.w - 2 * pad) * s, h: (item.h - 2 * pad) * s };
  const lines = String(item.text || '').split('\n');
  const lh = inner.h / lines.length;
  lines.forEach((line, i) => {
    fitText(ctx, line, { x: inner.x, y: inner.y + i * lh, w: inner.w, h: lh }, item, item.color || '#000', item.align || 'center');
  });
}

function drawImageItem(ctx, item, x, y, s, bleed) {
  const img = getImage(item.src);
  if (!img) {
    // プレースホルダ
    ctx.strokeStyle = '#999'; ctx.lineWidth = 1;
    ctx.strokeRect(x * s, y * s, item.w * s, item.h * s);
    ctx.fillStyle = '#999';
    ctx.font = `400 ${Math.max(6, item.h * s * 0.4)}px sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('画像', (x + item.w / 2) * s, (y + item.h / 2) * s);
    return;
  }
  const cover = item.fit !== 'contain';
  const bx = cover ? x - bleed : x, by = cover ? y - bleed : y;
  const bw = cover ? item.w + 2 * bleed : item.w, bh = cover ? item.h + 2 * bleed : item.h;
  const sc = cover ? Math.max(bw / img.naturalWidth, bh / img.naturalHeight) : Math.min(bw / img.naturalWidth, bh / img.naturalHeight);
  const dw = img.naturalWidth * sc, dh = img.naturalHeight * sc;
  const dx = bx + (bw - dw) / 2, dy = by + (bh - dh) / 2;
  ctx.save();
  ctx.beginPath(); ctx.rect(bx * s, by * s, bw * s, bh * s); ctx.clip();
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, dx * s, dy * s, dw * s, dh * s);
  ctx.restore();
}

