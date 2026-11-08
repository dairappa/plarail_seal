// 印刷の色補正。色見本シートを実際に印刷し、その写真（スキャン）から
// 「意図した色 → 実際に印刷された色」を測って、逆向きの補正を作る。
//
//   1. 色見本: 4 隅のマークと 6×8 = 48 色のパッチ。配置はマーク中心を (0,0)〜(1,1) とする
//      単位座標で決めるので、用紙サイズに関係なく同じ手順で読み取れる
//   2. 読み取り: 写真上でマーク 4 点を指定 → 射影変換で各パッチの中央部を標本化（中央値）
//   3. 補正モデル: 灰色の段階から各チャンネルの階調カーブ（逆関数）を作り、
//      全パッチで 3×4 のアフィン変換を最小二乗（単位行列寄りに正則化）で当てはめる
//   4. 適用: 書き出し画像の各画素に「階調カーブ → アフィン変換」をかける。純白（紙の色）はそのまま

export const CHART_COLS = 6, CHART_ROWS = 8;
export const MARKER_MM = 6;          // マークの一辺
export const GRID_V0 = 0.075, GRID_V1 = 0.925;   // パッチ領域の上下（単位座標）
export const PATCH_GAP = 0.12;       // パッチ間の隙間（セルに対する割合）

const GRAYS = [255, 232, 209, 185, 162, 139, 116, 93, 70, 46, 23, 0];
const CUBE = [];
for (const r of [0, 128, 255]) for (const g of [0, 128, 255]) for (const b of [0, 128, 255]) {
  if (r === g && g === b) continue;          // 灰色は GRAYS にある
  CUBE.push([r, g, b]);
}
// アプリでよく使う色（LED 表示・帯・ロゴ）。最後の 1 色はグリッドの右下角に来るので明るい色にする
const EXTRA = ['#ffe600', '#ff9a00', '#ff2d2d', '#2ee05a', '#3b8dff', '#00d5d5', '#2f4fd0', '#c8102e', '#1d3f8f', '#f08a1a', '#3a4790', '#7fb2ff'];

export function hexToRgb(hex) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function rgbToHex([r, g, b]) {
  return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}

/** 色見本のパッチ（行優先 48 色）。kind: gray / color */
export const CHART_PATCHES = [
  ...GRAYS.map(v => ({ rgb: [v, v, v], kind: 'gray' })),
  ...CUBE.map(rgb => ({ rgb, kind: 'color' })),
  ...EXTRA.map(h => ({ rgb: hexToRgb(h), kind: 'color' })),
];

/** パッチ i の矩形（単位座標）。inner は標本化に使う中央部の割合 */
export function patchRect(i, inner = 1) {
  const col = i % CHART_COLS, row = Math.floor(i / CHART_COLS);
  const cw = 1 / CHART_COLS, ch = (GRID_V1 - GRID_V0) / CHART_ROWS;
  const pw = cw * (1 - PATCH_GAP), ph = ch * (1 - PATCH_GAP);
  const cx = (col + 0.5) * cw, cy = GRID_V0 + (row + 0.5) * ch;
  return { x: cx - pw * inner / 2, y: cy - ph * inner / 2, w: pw * inner, h: ph * inner };
}

// ---------------------------------------------------------------- 色見本の描画

/** 用紙上のマーク中心の矩形（mm）。配置領域の 4 隅にマークを置く */
export function chartFrame(area) {
  const h = MARKER_MM / 2;
  return { x: area.x + h, y: area.y + h, w: area.w - MARKER_MM, h: area.h - MARKER_MM };
}

/**
 * 色見本シートを描く（書き出しと同じく、サイズ補正の事前拡大をかける）
 * @param area 配置領域（mm）。layoutSheet(project).area
 */
export function renderChart(ctx, project, area, s) {
  const W = project.paper.w, H = project.paper.h;
  const k = (project.scaleK || 100) / 100;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W * s, H * s);
  if (Math.abs(k - 1) > 1e-6) {
    ctx.translate(W * s / 2, H * s / 2); ctx.scale(k, k); ctx.translate(-W * s / 2, -H * s / 2);
  }
  const f = chartFrame(area);
  const U = (u, v) => [(f.x + u * f.w) * s, (f.y + v * f.h) * s];
  // パッチ
  CHART_PATCHES.forEach((p, i) => {
    const r = patchRect(i);
    const [x0, y0] = U(r.x, r.y), [x1, y1] = U(r.x + r.w, r.y + r.h);
    ctx.fillStyle = rgbToHex(p.rgb);
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  });
  // 白いパッチ（紙の色）の位置が分かるよう細い枠
  { const r = patchRect(0); const [x0, y0] = U(r.x, r.y), [x1, y1] = U(r.x + r.w, r.y + r.h);
    ctx.strokeStyle = '#bbbbbb'; ctx.lineWidth = Math.max(1, 0.1 * s); ctx.strokeRect(x0, y0, x1 - x0, y1 - y0); }
  // マークと番号
  const m = MARKER_MM * s;
  const corners = [[0, 0], [1, 0], [1, 1], [0, 1]];
  ctx.font = `700 ${2.6 * s}px "Noto Sans JP", sans-serif`;
  ctx.textBaseline = 'middle';
  corners.forEach(([u, v], i) => {
    const [cx, cy] = U(u, v);
    ctx.fillStyle = '#000000';
    ctx.fillRect(cx - m / 2, cy - m / 2, m, m);
    ctx.textAlign = u === 0 ? 'left' : 'right';
    ctx.fillText(String(i + 1), cx + (u === 0 ? 1 : -1) * (m / 2 + 1 * s), cy);
  });
  // 見出しと説明
  const [tx, ty] = U(0.5, 0);
  ctx.textAlign = 'center';
  ctx.font = `700 ${2.4 * s}px "Noto Sans JP", sans-serif`;
  ctx.fillText('↑ 上　色見本（プラレール シールメーカー）', tx, ty);
  const [bx, by] = U(0.5, 1);
  ctx.font = `400 ${1.9 * s}px "Noto Sans JP", sans-serif`;
  ctx.fillText('印刷したら写真かスキャンをアプリに取り込み、1→4 のマークを指定', bx, by);
  ctx.restore();
}

// ---------------------------------------------------------------- 写真の読み取り

/** 単位正方形の 4 隅 (0,0)(1,0)(1,1)(0,1) → 写真上の 4 点 への射影変換 */
export function homographyFromUnitSquare(pts) {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = pts;
  const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2;
  const sx = x0 - x1 + x2 - x3, sy = y0 - y1 + y2 - y3;
  let g = 0, h = 0;
  const den = dx1 * dy2 - dx2 * dy1;
  if (Math.abs(sx) > 1e-9 || Math.abs(sy) > 1e-9) {
    g = (sx * dy2 - dx2 * sy) / den;
    h = (dx1 * sy - sx * dy1) / den;
  }
  const a = x1 - x0 + g * x1, b = x3 - x0 + h * x3, c = x0;
  const d = y1 - y0 + g * y1, e = y3 - y0 + h * y3, f = y0;
  return (u, v) => {
    const w = g * u + h * v + 1;
    return [(a * u + b * v + c) / w, (d * u + e * v + f) / w];
  };
}

/** 4 点が凸で、時計回り（1 左上 → 2 右上 → 3 右下 → 4 左下）か */
export function quadIsValid(pts) {
  if (!pts || pts.length !== 4 || pts.some(p => !p)) return false;
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % 4], [cx, cy] = pts[(i + 2) % 4];
    const cr = (bx - ax) * (cy - by) - (by - ay) * (cx - bx);
    if (Math.abs(cr) < 1e-6) return false;
    const sg = Math.sign(cr);
    if (sign && sg !== sign) return false;
    sign = sg;
  }
  return sign > 0;   // 画像座標（y 下向き）で時計回り
}

/**
 * クリック位置の近くにある暗いかたまり（マーク）の重心へ寄せる。見つからなければ元の位置。
 * かたまりが探索範囲の端で切れているときは、その重心へ範囲を移して最大 3 回やり直す。
 */
export function snapToMarker(img, x, y, radius) {
  let cx = x, cy = y;
  for (let t = 0; t < 3; t++) {
    const r = snapOnce(img, cx, cy, radius);
    if (!r) return [x, y];
    if (!r.touches) return [r.x, r.y];
    if (Math.hypot(r.x - x, r.y - y) > radius * 1.5) return [x, y];   // 遠くへ行きすぎた（マークではない）
    cx = r.x; cy = r.y;
  }
  return [x, y];
}

function snapOnce(img, x, y, radius) {
  const { width: W, height: H, data } = img;
  const r = Math.max(4, Math.round(radius));
  const x0 = Math.max(0, Math.round(x) - r), x1 = Math.min(W - 1, Math.round(x) + r);
  const y0 = Math.max(0, Math.round(y) - r), y1 = Math.min(H - 1, Math.round(y) + r);
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  if (w < 3 || h < 3) return null;
  const lum = new Float32Array(w * h);
  let min = 255, sum = 0;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const o = ((y0 + j) * W + x0 + i) * 4;
    const L = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
    lum[j * w + i] = L; if (L < min) min = L; sum += L;
  }
  const mean = sum / (w * h);
  const th = (min + mean) / 2;
  if (mean - min < 30) return null;          // 暗いものが見当たらない
  // クリック位置に最も近い暗い画素から 4 近傍で広げる
  let seed = -1, best = Infinity;
  const ci = Math.round(x) - x0, cj = Math.round(y) - y0;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    if (lum[j * w + i] > th) continue;
    const d = (i - ci) ** 2 + (j - cj) ** 2;
    if (d < best) { best = d; seed = j * w + i; }
  }
  if (seed < 0 || best > (r * 0.6) ** 2) return null;
  const seen = new Uint8Array(w * h);
  const stack = [seed]; seen[seed] = 1;
  let n = 0, sx = 0, sy = 0, touches = false;
  while (stack.length) {
    const p = stack.pop();
    const i = p % w, j = (p - i) / w;
    n++; sx += i; sy += j;
    if (i === 0 || j === 0 || i === w - 1 || j === h - 1) touches = true;
    for (const q of [p - 1, p + 1, p - w, p + w]) {
      if (q < 0 || q >= w * h || seen[q]) continue;
      if ((q === p - 1 && i === 0) || (q === p + 1 && i === w - 1)) continue;
      if (lum[q] <= th) { seen[q] = 1; stack.push(q); }
    }
  }
  // 小さすぎるもの・探索範囲の大半を占めるもの（机の影など）はマークではない
  if (n < 9 || n > w * h * 0.6) return null;
  return { x: x0 + sx / n + 0.5, y: y0 + sy / n + 0.5, touches };
}

/** 各パッチの色を写真から読み取る（中央 50% の範囲を 12×12 点で標本化し、チャンネルごとの中央値） */
export function samplePatches(img, pts) {
  const map = homographyFromUnitSquare(pts);
  const { width: W, height: H, data } = img;
  const N = 12;
  return CHART_PATCHES.map((p, i) => {
    const r = patchRect(i, 0.5);
    const ch = [[], [], []];
    for (let a = 0; a < N; a++) for (let b = 0; b < N; b++) {
      const [px, py] = map(r.x + (a + 0.5) / N * r.w, r.y + (b + 0.5) / N * r.h);
      const xi = Math.round(px), yi = Math.round(py);
      if (xi < 0 || yi < 0 || xi >= W || yi >= H) continue;
      const o = (yi * W + xi) * 4;
      ch[0].push(data[o]); ch[1].push(data[o + 1]); ch[2].push(data[o + 2]);
    }
    const med = a => { if (!a.length) return NaN; a.sort((x, y) => x - y); return a[a.length >> 1]; };
    return { target: p.rgb, kind: p.kind, raw: ch.map(med) };
  });
}

// ---------------------------------------------------------------- 色差

function srgbToLab([r, g, b]) {
  const lin = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const R = lin(r), G = lin(g), B = lin(b);
  const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047;
  const Y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  const Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const f = t => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  const fx = f(X), fy = f(Y), fz = f(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
/** CIE76 の色差 ΔE */
export function deltaE(a, b) {
  const p = srgbToLab(a), q = srgbToLab(b);
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

// ---------------------------------------------------------------- 補正モデル

/** 写真の明るさ・ホワイトバランスを白パッチ（紙の色）で正規化した測定値を返す */
export function normalizeSamples(samples) {
  const white = samples.find(s => s.kind === 'gray' && s.target[0] === 255);
  if (!white || white.raw.some(v => !(v > 0))) throw new Error('白いパッチを読み取れませんでした。マークの位置を確認してください');
  if (Math.min(...white.raw) < 40) throw new Error('写真が暗すぎます。明るい場所で撮り直してください');
  return samples.map(s => ({ ...s, meas: s.raw.map((v, k) => Math.min(255, v * 255 / white.raw[k])) }));
}

/** 灰色の段階が入力の明るさ順に並んでいるか（マークの順番違い・ずれの検出） */
function grayRampOk(norm) {
  const g = norm.filter(s => s.kind === 'gray').sort((a, b) => a.target[0] - b.target[0]);
  const L = g.map(s => (s.meas[0] + s.meas[1] + s.meas[2]) / 3);
  let up = 0;
  for (let i = 1; i < L.length; i++) if (L[i] >= L[i - 1] - 4) up++;
  return up >= L.length - 2 && L[L.length - 1] - L[0] > 60;
}

/** 測定値 m → 入力値 c の単調な対応から、0〜255 の逆カーブ（LUT）を作る */
function inverseCurve(pairs) {
  // pairs: [{c, m}] を c の昇順に。m は単調増加に揃える（隣接平均で違反を解消）
  const p = pairs.slice().sort((a, b) => a.c - b.c).map(x => ({ c: x.c, m: x.m, n: 1 }));
  for (let i = 1; i < p.length; i++) {
    let j = i;
    while (j > 0 && p[j].m < p[j - 1].m) {
      const mm = (p[j].m * p[j].n + p[j - 1].m * p[j - 1].n) / (p[j].n + p[j - 1].n);
      p[j].m = p[j - 1].m = mm; j--;
    }
  }
  for (let i = 1; i < p.length; i++) if (p[i].m <= p[i - 1].m) p[i].m = p[i - 1].m + 0.01;
  const lut = new Array(256);
  for (let x = 0; x < 256; x++) {
    if (x <= p[0].m) { lut[x] = p[0].c; continue; }
    if (x >= p[p.length - 1].m) { lut[x] = p[p.length - 1].c; continue; }
    let j = 1; while (p[j].m < x) j++;
    const t = (x - p[j - 1].m) / (p[j].m - p[j - 1].m);
    lut[x] = p[j - 1].c + t * (p[j].c - p[j - 1].c);
  }
  return lut.map(v => Math.round(v * 10) / 10);
}

/** 4×4 の連立一次方程式（ガウスの消去法） */
function solve4(M, y) {
  const a = M.map((r, i) => [...r, y[i]]);
  for (let c = 0; c < 4; c++) {
    let piv = c;
    for (let r = c + 1; r < 4; r++) if (Math.abs(a[r][c]) > Math.abs(a[piv][c])) piv = r;
    [a[c], a[piv]] = [a[piv], a[c]];
    for (let r = 0; r < 4; r++) {
      if (r === c) continue;
      const f = a[r][c] / a[c][c];
      for (let k = c; k < 5; k++) a[r][k] -= f * a[c][k];
    }
  }
  return a.map((r, i) => r[4] / r[i]);
}

/**
 * 写真から読み取ったパッチ（samplePatches の結果）から補正プロファイルを作る
 * @returns {{curves:number[][], A:number[][], before:number, after:number, samples:object[]}}
 */
export function fitProfile(samples) {
  const norm = normalizeSamples(samples);
  if (norm.some(s => s.meas.some(v => !Number.isFinite(v)))) throw new Error('写真の外にはみ出したパッチがあります。色見本全体が写るように撮ってください');
  if (!grayRampOk(norm)) throw new Error('灰色の段階が正しく読み取れませんでした。1 左上 → 2 右上 → 3 右下 → 4 左下 の順にマークを指定したか確認してください');

  // 1. 階調カーブ（チャンネルごと）: 灰色パッチで「印刷された値 → 入力値」
  const grays = norm.filter(s => s.kind === 'gray');
  const curves = [0, 1, 2].map(k => inverseCurve(grays.map(s => ({ c: s.target[k], m: s.meas[k] }))));
  const lin = m => m.map((v, k) => curves[k][Math.max(0, Math.min(255, Math.round(v)))]);

  // 2. アフィン変換: lin(測定値) → 入力値 を最小二乗。単位行列寄りに正則化し、白は強く固定する
  const lambda = 2;
  const A = [0, 1, 2].map(k => {
    const M = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
    const y = [0, 0, 0, 0];
    for (const s of norm) {
      const u = [...lin(s.meas).map(v => v / 255), 1];
      const w = s.kind === 'gray' && s.target[0] === 255 ? 40 : 1;
      const t = s.target[k] / 255;
      for (let i = 0; i < 4; i++) { y[i] += w * u[i] * t; for (let j = 0; j < 4; j++) M[i][j] += w * u[i] * u[j]; }
    }
    const e = [0, 0, 0, 0]; e[k] = 1;
    for (let i = 0; i < 4; i++) { M[i][i] += lambda; y[i] += lambda * e[i]; }
    const a = solve4(M, y);
    // 白（u = 曲線(255)/255）がちょうど白になるよう、定数項で合わせる
    const uw = [0, 1, 2].map(j => curves[j][255] / 255);
    a[3] += 1 - (a[0] * uw[0] + a[1] * uw[1] + a[2] * uw[2] + a[3]);
    return a.map(v => Math.round(v * 1e5) / 1e5);
  });

  const profile = { curves, A };
  const before = norm.reduce((a, s) => a + deltaE(s.target, s.meas), 0) / norm.length;
  const after = norm.reduce((a, s) => a + deltaE(s.target, correctColor(profile, s.meas, 1)), 0) / norm.length;
  return {
    ...profile,
    before: Math.round(before * 10) / 10,
    after: Math.round(after * 10) / 10,
    samples: norm.map(s => ({ target: s.target, meas: s.meas.map(v => Math.round(v)) })),
  };
}

/** 1 色に補正をかける（意図した色 → 印刷に渡す色） */
export function correctColor(profile, rgb, strength = 1) {
  if (rgb[0] >= 255 && rgb[1] >= 255 && rgb[2] >= 255) return [255, 255, 255];
  const u = rgb.map((v, k) => profile.curves[k][Math.max(0, Math.min(255, Math.round(v)))] / 255);
  return [0, 1, 2].map(k => {
    const a = profile.A[k];
    const out = (a[0] * u[0] + a[1] * u[1] + a[2] * u[2] + a[3]) * 255;
    return Math.max(0, Math.min(255, rgb[k] + (out - rgb[k]) * strength));
  });
}

/** 画像全体に補正をかける（その場で書き換え）。純白は紙の色なので変えない */
export function applyProfile(img, profile, strength = 1) {
  if (!profile || strength <= 0) return;
  const d = img.data;
  const [c0, c1, c2] = profile.curves;
  const [a0, a1, a2] = profile.A;
  const s = Math.min(1, strength);
  for (let o = 0; o < d.length; o += 4) {
    const r = d[o], g = d[o + 1], b = d[o + 2];
    if (r === 255 && g === 255 && b === 255) continue;
    const u0 = c0[r] / 255, u1 = c1[g] / 255, u2 = c2[b] / 255;
    const R = (a0[0] * u0 + a0[1] * u1 + a0[2] * u2 + a0[3]) * 255;
    const G = (a1[0] * u0 + a1[1] * u1 + a1[2] * u2 + a1[3]) * 255;
    const B = (a2[0] * u0 + a2[1] * u1 + a2[2] * u2 + a2[3]) * 255;
    d[o] = r + (R - r) * s; d[o + 1] = g + (G - g) * s; d[o + 2] = b + (B - b) * s;   // Uint8ClampedArray が丸めと範囲を処理
  }
}

/** キャンバス全体に補正をかける */
export function applyProfileToCanvas(canvas, profile, strength = 1) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  applyProfile(img, profile, strength);
  ctx.putImageData(img, 0, 0);
}
