// キャンバス描画（プレビュー・書き出し共通）。座標は mm、s = px/mm。
import { layoutSheet, MARK_LEN, MARK_GAP } from './layout.js';

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
  // 背景（塗り足し込み）
  ctx.fillStyle = item.bg || '#ffffff';
  ctx.fillRect((x - b) * s, (y - b) * s, (item.w + 2 * b) * s, (item.h + 2 * b) * s);

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
 * 枠に収まるように文字を描く（高さ基準でサイズ決定、幅が超える場合は長体）
 * box: {x,y,w,h} in px
 */
function fitText(ctx, text, box, item, color, align = 'center', opts = {}) {
  if (!text) return;
  const heightRatio = opts.heightRatio ?? 0.96;
  let px = box.h * heightRatio;
  if (px < 0.5) return;
  ctx.save();
  ctx.font = fontStr(item, px);
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${(item.letterSpacing || 0) * px / 100}px`;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'center';
  let m = ctx.measureText(text);
  let width = m.width;
  // 実グリフの高さで枠に合わせる（英字だけの行は大きめに描かれる）
  const glyphH = (m.actualBoundingBoxAscent || px * 0.8) + (m.actualBoundingBoxDescent || 0);
  if (glyphH > 0 && !opts.noHeightFit) {
    const target = box.h * heightRatio;
    const f = Math.min(1.25, target / glyphH);
    if (Math.abs(f - 1) > 0.02) {
      px *= f;
      ctx.font = fontStr(item, px);
      if ('letterSpacing' in ctx) ctx.letterSpacing = `${(item.letterSpacing || 0) * px / 100}px`;
      m = ctx.measureText(text);
      width = m.width;
    }
  }
  const asc = m.actualBoundingBoxAscent || px * 0.8;
  const desc = m.actualBoundingBoxDescent || px * 0.1;
  const scaleX = width > box.w ? box.w / width : 1;
  const cy = box.y + box.h / 2 + (asc - desc) / 2;
  let cx = box.x + box.w / 2;
  const drawW = width * scaleX;
  if (align === 'left') cx = box.x + drawW / 2;
  else if (align === 'right') cx = box.x + box.w - drawW / 2;
  ctx.translate(cx, cy);
  ctx.scale(scaleX, 1);
  ctx.fillStyle = color;
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

function drawSignContent(ctx, item, x, y, s) {
  const pad = item.h * ((item.padding ?? 8) / 100);
  const inner = { x: (x + pad) * s, y: (y + pad) * s, w: (item.w - 2 * pad) * s, h: (item.h - 2 * pad) * s };
  if (inner.w <= 0 || inner.h <= 0) return;

  const hasKind = !!(item.kind?.text || item.kind?.en);
  const ratio = hasKind ? Math.min(90, Math.max(0, item.kind.ratio ?? 30)) / 100 : 0;
  const colGap = hasKind && ratio > 0 ? inner.h * ((item.colGap ?? 6) / 100) : 0;
  const kindW = inner.w * ratio;
  const destW = inner.w - kindW - colGap;

  const hasEn = (item.enRatio ?? 0) > 0 && !!(item.dest?.en || item.kind?.en);
  const enR = hasEn ? Math.min(70, item.enRatio) / 100 : 0;
  const rowGap = hasEn ? inner.h * 0.06 : 0;
  const jpH = inner.h * (1 - enR) - rowGap / 2;
  const enH = inner.h * enR - rowGap / 2;

  // 種別
  if (hasKind && ratio > 0) {
    const kx = inner.x, kw = kindW;
    const style = item.kind.style || 'plain';
    let textColor = item.kind.color;
    if (style === 'fill') {
      ctx.fillStyle = item.kind.color;
      ctx.fillRect(kx, inner.y, kw, inner.h);
      textColor = item.bg || '#000000';
    } else if (style === 'box') {
      ctx.strokeStyle = item.kind.color;
      ctx.lineWidth = Math.max(0.5, inner.h * 0.04);
      ctx.strokeRect(kx + ctx.lineWidth / 2, inner.y + ctx.lineWidth / 2, kw - ctx.lineWidth, inner.h - ctx.lineWidth);
    }
    const ipad = style === 'plain' ? 0 : inner.h * 0.08;
    const kbox = { x: kx + ipad, y: inner.y + ipad, w: kw - 2 * ipad, h: inner.h - 2 * ipad };
    if (hasEn) {
      const jp = { ...kbox, h: jpH - ipad };
      const en = { x: kbox.x, y: inner.y + jpH + rowGap, w: kbox.w, h: enH - ipad };
      fitText(ctx, item.kind.text, jp, item, textColor);
      fitText(ctx, item.kind.en, en, item, style === 'fill' ? textColor : (item.enColor || textColor), 'center', { heightRatio: 0.85 });
    } else {
      fitText(ctx, item.kind.text, kbox, item, textColor);
    }
  }

  // 行先
  const dx = inner.x + kindW + colGap;
  if (hasEn) {
    fitText(ctx, item.dest.text, { x: dx, y: inner.y, w: destW, h: jpH }, item, item.dest.color);
    fitText(ctx, item.dest.en, { x: dx, y: inner.y + jpH + rowGap, w: destW, h: enH }, item, item.enColor || item.dest.color, 'center', { heightRatio: 0.85 });
  } else {
    fitText(ctx, item.dest.text, { x: dx, y: inner.y, w: destW, h: inner.h }, item, item.dest.color);
  }
}

/** LED ドット風: 高解像度で描いてからドット格子にサンプリング */
function drawSignLED(ctx, item, x, y, s) {
  const rows = Math.max(6, Math.min(64, Math.round(item.ledRows || 16)));
  const cols = Math.max(1, Math.round(rows * item.w / item.h));
  const sup = 6;
  const off = document.createElement('canvas');
  off.width = cols * sup; off.height = rows * sup;
  const octx = off.getContext('2d');
  octx.fillStyle = item.bg || '#000';
  octx.fillRect(0, 0, off.width, off.height);
  drawSignContent(octx, item, 0, 0, (rows * sup) / item.h);

  const small = document.createElement('canvas');
  small.width = cols; small.height = rows;
  const sctx = small.getContext('2d');
  sctx.imageSmoothingEnabled = true; sctx.imageSmoothingQuality = 'high';
  sctx.drawImage(off, 0, 0, cols, rows);
  const data = sctx.getImageData(0, 0, cols, rows).data;

  const bg = hexToRgb(item.bg || '#000000');
  const darkBg = (bg[0] + bg[1] + bg[2]) < 200;
  const cell = item.h / rows;                // mm
  const r = cell * 0.45 * s;                 // px
  ctx.save();
  ctx.beginPath();
  ctx.rect(x * s, y * s, item.w * s, item.h * s);
  ctx.clip();
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const o = (j * cols + i) * 4;
      let R = data[o], G = data[o + 1], B = data[o + 2];
      const diff = Math.abs(R - bg[0]) + Math.abs(G - bg[1]) + Math.abs(B - bg[2]);
      if (diff < 24) continue;                 // 消灯ドット
      // 文字の縁のアンチエイリアスで暗くなったドットを点灯色に正規化（LED らしいコントラストにする）
      if (darkBg) {
        const t = Math.max(R, G, B) / 255;
        if (t < 0.3) continue;
        const gain = (t >= 0.55 ? 1 : 0.65) / t;
        R = Math.min(255, Math.round(R * gain)); G = Math.min(255, Math.round(G * gain)); B = Math.min(255, Math.round(B * gain));
      }
      ctx.fillStyle = `rgb(${R},${G},${B})`;
      ctx.beginPath();
      ctx.arc((x + (i + 0.5) * cell) * s, (y + (j + 0.5) * cell) * s, r, 0, Math.PI * 2);
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

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const n = parseInt(v, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
