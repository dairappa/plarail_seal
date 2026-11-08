// 印刷の色補正。色見本シートを実際に印刷し、その写真（スキャン）から
// 「意図した色 → 実際に印刷された色」を測って、逆向きの補正を作る。
//
//   1. 色見本: 4 隅のマークと 6×8 = 48 色のパッチ。配置はマーク中心を (0,0)〜(1,1) とする
//      単位座標で決めるので、用紙サイズに関係なく同じ手順で読み取れる
//   2. 読み取り（2 通り）
//      写真: 写真上でマーク 4 点を指定 → 射影変換で各パッチの中央部を標本化（中央値）
//      目で合わせる: 代表 12 マスについて、印刷と見比べて画面上の 3×3 の候補から近い色を選ぶ
//   3. 補正モデル: 測ったマスの「入力した色 → 印刷された色（Lab）」を、色空間全体で滑らかにつなぐ
//      （放射基底関数による補間＋1 次の項）。インクで色を作る印刷は色ごとに振る舞いが違う
//      （灰色は明るめ、赤や紺は暗め、など）ので、チャンネルごとのカーブでは表せない
//   4. 逆算: 「意図した色を印刷で出すには何色を入力すればよいか」を 17×17×17 の格子点で解き、補正表にする。
//      出せない鮮やかな色は、出せる範囲で一番近い色になる
//   5. 適用: 書き出し画像の各画素を補正表で変換（3 線形補間）。純白（紙の色）はそのまま

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
  // マス番号（左上の角。写真の読み取りは中央部だけを使うので影響しない）。目で合わせるときに使う
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.font = `700 ${1.9 * s}px "Noto Sans JP", sans-serif`;
  CHART_PATCHES.forEach((p, i) => {
    const r = patchRect(i);
    const [x0, y0] = U(r.x, r.y);
    const [R, G, B] = p.rgb;
    ctx.fillStyle = 0.299 * R + 0.587 * G + 0.114 * B > 140 ? '#000000' : '#ffffff';
    ctx.fillText(String(i + 1), x0 + 0.7 * s, y0 + 0.5 * s);
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
  ctx.fillText('印刷したら、アプリで画面と見比べるか、写真かスキャンを取り込む', bx, by);
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

export function srgbToLab([r, g, b]) {
  const lin = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const R = lin(r), G = lin(g), B = lin(b);
  const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047;
  const Y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  const Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const f = t => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  const fx = f(X), fy = f(Y), fz = f(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
/** Lab → sRGB（範囲外は切り詰め） */
export function labToSrgb([L, a, b]) {
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
  const inv = t => t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787;
  const X = inv(fx) * 0.95047, Y = inv(fy), Z = inv(fz) * 1.08883;
  const R = 3.2406 * X - 1.5372 * Y - 0.4986 * Z;
  const G = -0.9689 * X + 1.8758 * Y + 0.0415 * Z;
  const B = 0.0557 * X - 0.2040 * Y + 1.0570 * Z;
  const g = v => { v = Math.max(0, Math.min(1, v)); return 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055); };
  return [g(R), g(G), g(B)].map(v => Math.round(v));
}

/** CIE76 の色差 ΔE */
export function deltaE(a, b) {
  const p = srgbToLab(a), q = srgbToLab(b);
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

// ---------------------------------------------------------------- 目で合わせる

const idxOf = rgb => CHART_PATCHES.findIndex(p => p.rgb.every((v, k) => v === rgb[k]));
/**
 * 目で合わせる 12 マス（色見本のマス番号 = 添字 + 1）。
 * 灰色 4 段階と、シール紙で出せる範囲にあってよく使う 8 色（赤・オレンジ・黄・オリーブ・緑・青緑・紺・青紫）。
 * 純色の緑・青・マゼンタなどは印刷で大きく鮮やかさが落ち、補正では直せないので含めない（実機の印刷で確認）
 */
export const VISUAL_PATCHES = [
  [209, 209, 209], [139, 139, 139], [93, 93, 93], [46, 46, 46],
  hexToRgb('#c8102e'), hexToRgb('#ff9a00'), hexToRgb('#ffe600'), [128, 128, 0],
  [0, 128, 0], [0, 128, 128], hexToRgb('#1d3f8f'), hexToRgb('#3a4790'),
].map(idxOf);

// 候補の幅（Lab）。同じ向きの候補を続けて選ぶと広がり、真ん中を選ぶと狭まる
const V_START = { L: 10, a1: 16, a2: 12 };
const V_MIN = { L: 2, a1: 4, a2: 4 };
const V_MAX = { L: 30, a1: 45, a2: 40 };
const V_GROW = 1.6;
const MAX_ROUNDS = 60;

/** 候補の軸（ab 平面の単位ベクトル）。色ごとに固定 */
function visualAxes(target) {
  const [, a, b] = srgbToLab(target);
  const C = Math.hypot(a, b);
  if (C > 12) return { u1: [a / C, b / C], u2: [-b / C, a / C], chromatic: true };
  return { u1: [0, 1], u2: [1, 0], chromatic: false };
}

/** 列と行の説明（読み上げ・見出し用）。axis 1: 鮮やかさ（灰色は 青み ↔ 黄み）、2: 色合い（灰色は 緑み ↔ 赤み） */
export function visualAxisLabels(target, axis) {
  const { chromatic } = visualAxes(target);
  const cols = axis === 1 ? (chromatic ? ['くすんだ', 'そのまま', '鮮やか'] : ['青み', 'そのまま', '黄み'])
    : (chromatic ? ['色合い −', 'そのまま', '色合い ＋'] : ['緑み', 'そのまま', '赤み']);
  return { rows: ['明るい', 'そのまま', '暗い'], cols };
}

export function visualStart(index) {
  const target = CHART_PATCHES[index].rgb;
  return { index, target, center: target.slice(), axis: 1, steps: { ...V_START }, last: { L: 0, a1: 0, a2: 0 }, rounds: 0, done: false };
}

/** 候補の幅の目安（1: 粗い 〜 3: 細かい） */
export function visualFineness(st) {
  const L = st.steps.L;
  return L >= 8 ? 1 : L >= 4 ? 2 : 3;
}

/** いまの候補 3×3（行優先、4 番が中央）。行は明るさ、列は axis の向き */
export function visualGrid(st) {
  const { u1, u2 } = visualAxes(st.target);
  const u = st.axis === 1 ? u1 : u2;
  const d = st.axis === 1 ? st.steps.a1 : st.steps.a2;
  const [L, a, b] = srgbToLab(st.center);
  const out = [];
  for (const r of [1, 0, -1]) for (const c of [-1, 0, 1]) {
    out.push(r === 0 && c === 0 ? st.center.slice() : labToSrgb([L + r * st.steps.L, a + c * d * u[0], b + c * d * u[1]]));
  }
  return out;
}

/**
 * k 番の候補を選ぶ。
 *   真ん中: いまの軸と明るさの幅を半分にして、もう一方の軸に切り替える。すべての幅が最小になったら決定
 *   それ以外: その色を中心にする。同じ向きに続けて動いた軸は幅を広げる（大きくずれた色にも早く届く）
 */
export function visualPick(st, k) {
  const grid = visualGrid(st);
  const steps = { ...st.steps }, last = { ...st.last };
  const ax = st.axis === 1 ? 'a1' : 'a2';
  const next = { ...st, steps, last, rounds: st.rounds + 1 };
  if (k === 4) {
    steps.L = Math.max(V_MIN.L, steps.L / 2);
    steps[ax] = Math.max(V_MIN[ax], steps[ax] / 2);
    last.L = last.a1 = last.a2 = 0;
    next.axis = st.axis === 1 ? 2 : 1;
    if (steps.L <= V_MIN.L && steps.a1 <= V_MIN.a1 && steps.a2 <= V_MIN.a2) next.done = true;
  } else {
    next.center = grid[k];
    const dr = 1 - Math.floor(k / 3), dc = (k % 3) - 1;
    for (const [key, dir] of [['L', dr], [ax, dc]]) {
      if (dir && last[key] === dir) steps[key] = Math.min(V_MAX[key], steps[key] * V_GROW);
      last[key] = dir;
    }
  }
  if (next.rounds >= MAX_ROUNDS) next.done = true;
  return next;
}

/**
 * スライダー: 意図した色から、明るさ・鮮やかさ・色合いをどれだけずらすか。
 * 灰色は鮮やかさ・色合いの代わりに 青み ↔ 黄み・緑み ↔ 赤み
 */
export function visualSliderSpec(target) {
  const { chromatic } = visualAxes(target);
  return chromatic
    ? [{ id: 'l', label: '明るさ', min: -50, max: 40, unit: '' }, { id: 'c', label: '鮮やかさ', min: 0, max: 160, unit: '%' }, { id: 'h', label: '色合い', min: -60, max: 60, unit: '°' }]
    : [{ id: 'l', label: '明るさ', min: -50, max: 40, unit: '' }, { id: 'c', label: '青み ↔ 黄み', min: -30, max: 30, unit: '' }, { id: 'h', label: '緑み ↔ 赤み', min: -30, max: 30, unit: '' }];
}

export function visualFromSliders(target, v) {
  const [L, a, b] = srgbToLab(target);
  const { chromatic } = visualAxes(target);
  if (!chromatic) return labToSrgb([L + v.l, a + v.h, b + v.c]);
  const C = Math.hypot(a, b) * v.c / 100, h = Math.atan2(b, a) + v.h * Math.PI / 180;
  return labToSrgb([L + v.l, C * Math.cos(h), C * Math.sin(h)]);
}

export function visualToSliders(target, rgb) {
  const [L0, a0, b0] = srgbToLab(target), [L, a, b] = srgbToLab(rgb);
  const { chromatic } = visualAxes(target);
  if (!chromatic) return { l: L - L0, c: b - b0, h: a - a0 };
  const C0 = Math.hypot(a0, b0), C = Math.hypot(a, b);
  let dh = (Math.atan2(b, a) - Math.atan2(b0, a0)) * 180 / Math.PI;
  dh = ((dh + 540) % 360) - 180;
  return { l: L - L0, c: C / C0 * 100, h: dh };
}

/** スライダーで決めた色を中心に、候補を中くらいの幅からやり直す */
export function visualSetCenter(st, rgb) {
  return { ...st, center: rgb.slice(), axis: 1, steps: { L: 5, a1: 8, a2: 6 }, last: { L: 0, a1: 0, a2: 0 }, done: false };
}

/**
 * 目で合わせた結果を fitProfile 用の標本にする。
 * 紙の白は画面の白、印刷の黒は画面の黒とみなす（合わせにくい両端は測らない）
 * @param picks { [色見本の添字]: 選んだ RGB }
 */
export function visualSamples(picks) {
  const out = [
    { target: [255, 255, 255], kind: 'gray', raw: [255, 255, 255] },
    { target: [0, 0, 0], kind: 'gray', raw: [0, 0, 0] },
  ];
  for (const [i, rgb] of Object.entries(picks)) {
    const p = CHART_PATCHES[Number(i)];
    out.push({ target: p.rgb, kind: p.kind, raw: rgb.slice() });
  }
  return out;
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

/** n×n の連立一次方程式（部分ピボット付きガウスの消去法） */
function solveN(M, y) {
  const n = y.length;
  const a = M.map((r, i) => [...r, y[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[piv][c])) piv = r;
    [a[c], a[piv]] = [a[piv], a[c]];
    const d = a[c][c] || 1e-12;
    for (let r = c + 1; r < n; r++) {
      const f = a[r][c] / d;
      if (f) for (let k = c; k <= n; k++) a[r][k] -= f * a[c][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let v = a[r][n];
    for (let k = r + 1; k < n; k++) v -= a[r][k] * x[k];
    x[r] = v / (a[r][r] || 1e-12);
  }
  return x;
}

/**
 * 印刷の振る舞いのモデル: 入力 RGB（0〜1）→ 印刷された色（Lab で返す。内部では RGB で補間）。
 * φ(r) = r の放射基底関数＋1 次の項。smooth は測定のばらつきをならす強さ
 */
export function buildPrinterModel(pairs, smooth = 0.02) {
  // 出力は RGB（0〜1）で表す。「ほぼそのまま印刷される」部分を 1 次の項が受け持つので、点が少なくても安定する
  const C = pairs.map(p => p.c.map(v => v / 255));
  const Y = pairs.map(p => p.m.map(v => v / 255));
  const n = C.length, N = n + 4;
  const M = Array.from({ length: N }, () => new Array(N).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) M[i][j] = Math.hypot(C[i][0] - C[j][0], C[i][1] - C[j][1], C[i][2] - C[j][2]);
    M[i][i] += smooth * (pairs[i].w ? 1 / pairs[i].w : 1);
    M[i][n] = M[n][i] = 1;
    for (let k = 0; k < 3; k++) M[i][n + 1 + k] = M[n + 1 + k][i] = C[i][k];
  }
  const W = [0, 1, 2].map(ch => solveN(M, [...Y.map(y => y[ch]), 0, 0, 0, 0]));
  return c => srgbToLab(rgbAt(c).map(v => Math.max(0, Math.min(255, v * 255))));
  function rgbAt(c) {
    const out = [0, 0, 0];
    for (let ch = 0; ch < 3; ch++) {
      const w = W[ch];
      let v = w[n] + w[n + 1] * c[0] + w[n + 2] * c[1] + w[n + 3] * c[2];
      for (let i = 0; i < n; i++) v += w[i] * Math.hypot(c[0] - C[i][0], c[1] - C[i][1], c[2] - C[i][2]);
      out[ch] = v;
    }
    return out;
  }
}

/**
 * 意図した色（Lab）を出すための入力（0〜1）を、印刷モデルから逆算する（範囲付きのガウス・ニュートン法）。
 * 測った色から遠い領域ではモデルの予測があてにならないので、元の色（want）から離れるほど損になる項
 * （重み hold）を加え、大きく動かしすぎないようにする
 */
function invertPrinter(model, targetLab, start, want = start, hold = 0) {
  let c = start.slice();
  const clamp01 = v => Math.max(0, Math.min(1, v));
  const resid = cc => {
    const p = model(cc);
    return [p[0] - targetLab[0], p[1] - targetLab[1], p[2] - targetLab[2],
      hold * (cc[0] - want[0]), hold * (cc[1] - want[1]), hold * (cc[2] - want[2])];
  };
  const norm = e => Math.hypot(...e);
  let e = resid(c), E = norm(e);
  for (let it = 0; it < 14 && E > 0.05; it++) {
    const h = 1e-3, J = Array.from({ length: 6 }, () => [0, 0, 0]);
    for (let k = 0; k < 3; k++) {
      const cc = c.slice(); cc[k] += cc[k] > 1 - h ? -h : h;
      const d = cc[k] - c[k], ek = resid(cc);
      for (let r = 0; r < 6; r++) J[r][k] = (ek[r] - e[r]) / d;
    }
    const mu = 1e-2;
    const JtJ = [0, 1, 2].map(i => [0, 1, 2].map(j => J.reduce((a, row) => a + row[i] * row[j], 0) + (i === j ? mu : 0)));
    const Jte = [0, 1, 2].map(i => -J.reduce((a, row, r) => a + row[i] * e[r], 0));
    const step = solveN(JtJ, Jte);
    let t = 1, improved = false;
    for (let k = 0; k < 6; k++) {
      const nc = c.map((v, i) => clamp01(v + t * step[i]));
      const ne = resid(nc), NE = norm(ne);
      if (NE < E) { c = nc; e = ne; E = NE; improved = true; break; }
      t /= 2;
    }
    if (!improved) break;
  }
  const p = model(c);
  return { c, residual: Math.hypot(p[0] - targetLab[0], p[1] - targetLab[1], p[2] - targetLab[2]) };
}

const LUT_N = 17;
const HOLD = 25;     // 元の色から離れるほど損になる重み（入力 0〜1 の差 0.2 で ΔE 5 相当）
const lutCache = new Map();
/** 補正表（意図した色 → 入力する色）。17³ の格子点ごとに逆算する。プロファイルの測定値ごとに 1 回だけ作る */
export function profileLUT(profile) {
  const key = JSON.stringify([profile.samples, profile.smooth ?? 0.02, profile.hold ?? HOLD]);
  let lut = lutCache.get(key);
  if (lut) return lut;
  const pairs = profile.samples.map(s => ({ c: s.target, m: s.meas, w: s.target.every(v => v === 255) ? 20 : 1 }));
  const model = buildPrinterModel(pairs, profile.smooth ?? 0.02);
  lut = new Float32Array(LUT_N * LUT_N * LUT_N * 3);
  const st = 1 / (LUT_N - 1);
  let prev = null;
  for (let r = 0; r < LUT_N; r++) for (let g = 0; g < LUT_N; g++) for (let b = 0; b < LUT_N; b++) {
    const want = [r * st, g * st, b * st];
    // 近い格子点の解から始めると速く安定する
    const startC = prev && g + b > 0 ? prev : want;
    const { c } = invertPrinter(model, srgbToLab(want.map(v => v * 255)), startC, want, profile.hold ?? HOLD);
    prev = c;
    const o = ((r * LUT_N + g) * LUT_N + b) * 3;
    lut[o] = c[0] * 255; lut[o + 1] = c[1] * 255; lut[o + 2] = c[2] * 255;
  }
  // 純白は紙の色なので、ちょうど白に固定する
  const ow = ((LUT_N - 1) * LUT_N * LUT_N + (LUT_N - 1) * LUT_N + (LUT_N - 1)) * 3;
  lut[ow] = lut[ow + 1] = lut[ow + 2] = 255;
  if (lutCache.size > 6) lutCache.delete(lutCache.keys().next().value);
  lutCache.set(key, lut);
  return lut;
}

/** 補正表を 3 線形補間で引く */
function lookup(lut, r, g, b) {
  const s = (LUT_N - 1) / 255;
  const fr = r * s, fg = g * s, fb = b * s;
  const r0 = Math.min(LUT_N - 2, Math.floor(fr)), g0 = Math.min(LUT_N - 2, Math.floor(fg)), b0 = Math.min(LUT_N - 2, Math.floor(fb));
  const dr = fr - r0, dg = fg - g0, db = fb - b0;
  const out = [0, 0, 0];
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) for (let k = 0; k < 2; k++) {
    const w = (i ? dr : 1 - dr) * (j ? dg : 1 - dg) * (k ? db : 1 - db);
    if (!w) continue;
    const o = (((r0 + i) * LUT_N + (g0 + j)) * LUT_N + (b0 + k)) * 3;
    out[0] += w * lut[o]; out[1] += w * lut[o + 1]; out[2] += w * lut[o + 2];
  }
  return out;
}

/**
 * 写真（または目で合わせた結果）から読み取ったパッチから補正プロファイルを作る。
 * プロファイルには測定値（samples）だけを保存し、補正表は使うときに作る
 */
export function fitProfile(samples, opts = {}) {
  const visual = opts.method === 'visual';
  const norm = normalizeSamples(samples);
  if (norm.some(s => s.meas.some(v => !Number.isFinite(v)))) throw new Error('写真の外にはみ出したパッチがあります。色見本全体が写るように撮ってください');
  if (!grayRampOk(norm)) throw new Error(visual
    ? '灰色のマスで選んだ色が、明るい順に並んでいません。灰色のマスを選び直してください'
    : '灰色の段階が正しく読み取れませんでした。1 左上 → 2 右上 → 3 右下 → 4 左下 の順にマークを指定したか確認してください');
  // 目で合わせた場合は点が少ないので、ばらつきのならしを強めにする
  const smooth = opts.smooth ?? (visual ? 0.05 : 0.02);
  const profile = {
    model: 'rbf', smooth,
    samples: norm.map(s => ({ target: s.target, meas: s.meas.map(v => Math.round(v)) })),
  };
  // 印刷で出せるか: 意図した色を逆算した結果が、目標から大きく離れたままなら出せない色
  const pairs = profile.samples.map(s => ({ c: s.target, m: s.meas, w: s.target.every(v => v === 255) ? 20 : 1 }));
  const model = buildPrinterModel(pairs, smooth);
  // 出せるかは、動かす量を制限せずに逆算して判定する。補正後の推定は、実際の補正（制限あり）で出す
  const reachFree = profile.samples.map(s => invertPrinter(model, srgbToLab(s.target), s.target.map(v => v / 255)));
  const reach = profile.samples.map(s => invertPrinter(model, srgbToLab(s.target), s.target.map(v => v / 255), s.target.map(v => v / 255), HOLD));
  profile.samples.forEach((s, i) => { s.out = reachFree[i].residual > 8; });
  const inG = profile.samples.filter(s => !s.out);
  const mean = (arr, f) => arr.length ? arr.reduce((a, x) => a + f(x), 0) / arr.length : 0;
  const r1 = v => Math.round(v * 10) / 10;
  // 補正後の推定: 印刷モデル上で、逆算した入力を印刷したときの目標との差（出せない色は届かない分が残る）
  const afterOf = i => reach[i].residual;
  return {
    ...profile,
    before: r1(mean(inG, s => deltaE(s.target, s.meas))),              // 印刷で出せる色の、補正前のずれ（平均 ΔE）
    after: r1(mean(profile.samples.map((s, i) => i).filter(i => !profile.samples[i].out), afterOf)),
    beforeAll: r1(mean(profile.samples, s => deltaE(s.target, s.meas))),
    afterAll: r1(mean(profile.samples.map((s, i) => i), afterOf)),
    outOfGamut: profile.samples.filter(s => s.out).map(s => rgbToHex(s.target)),
  };
}

/** 1 色に補正をかける（意図した色 → 印刷に渡す色） */
export function correctColor(profile, rgb, strength = 1) {
  if (rgb[0] >= 255 && rgb[1] >= 255 && rgb[2] >= 255) return [255, 255, 255];
  const out = lookup(profileLUT(profile), rgb[0], rgb[1], rgb[2]);
  return out.map((v, k) => Math.max(0, Math.min(255, rgb[k] + (v - rgb[k]) * strength)));
}

/** 画像全体に補正をかける（その場で書き換え）。純白（紙の色）は変えない。同じ色は 1 回だけ計算する */
export function applyProfile(img, profile, strength = 1) {
  if (!profile || strength <= 0) return;
  const lut = profileLUT(profile);
  const s = Math.min(1, strength);
  const d = img.data;
  const memo = new Map();
  for (let o = 0; o < d.length; o += 4) {
    const r = d[o], g = d[o + 1], b = d[o + 2];
    if (r === 255 && g === 255 && b === 255) continue;
    const key = (r << 16) | (g << 8) | b;
    let v = memo.get(key);
    if (!v) {
      const c = lookup(lut, r, g, b);
      v = [r + (c[0] - r) * s, g + (c[1] - g) * s, b + (c[2] - b) * s];
      if (memo.size < 200000) memo.set(key, v);
    }
    d[o] = v[0]; d[o + 1] = v[1]; d[o + 2] = v[2];   // Uint8ClampedArray が丸めと範囲を処理
  }
}

/** キャンバス全体に補正をかける */
export function applyProfileToCanvas(canvas, profile, strength = 1) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  applyProfile(img, profile, strength);
  ctx.putImageData(img, 0, 0);
}
