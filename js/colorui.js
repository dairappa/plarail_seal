// 色補正の画面: 用紙欄の設定と、色見本の写真からプロファイルを作るダイアログ
import { samplePatches, fitProfile, snapToMarker, quadIsValid, homographyFromUnitSquare, patchRect, CHART_PATCHES, rgbToHex } from './colorcal.js';
import { exportChartPNG, chartCanvas } from './export.js';
import { paperById } from './model.js';

const $ = id => document.getElementById(id);
const MAX_PHOTO_PX = 2400;
const CORNER_NAMES = ['1（左上）', '2（右上）', '3（右下）', '4（左下）'];
const MODE_NAMES = { 'cvs-border': 'フチあり', 'cvs-borderless': 'フチなし', home: '家庭用' };

// ダイアログの状態（開き直しても保持）
const cal = { photo: null, data: null, pts: [null, null, null, null], sel: 0, result: null, error: null };
let app = null;   // { getProject, update, toast, showExport }

export function initColorUI(api) {
  app = api;
  $('cc-enabled').addEventListener('change', e => { app.getProject().colorCorr.enabled = e.target.checked; app.update(); });
  $('cc-preview').addEventListener('change', e => { app.getProject().colorCorr.preview = e.target.checked; app.update(); });
  $('cc-strength').addEventListener('change', e => {
    const v = Number(e.target.value);
    if (Number.isFinite(v)) { app.getProject().colorCorr.strength = Math.max(0, Math.min(100, v)); app.update(); }
  });
  $('btn-cc-setup').addEventListener('click', () => { renderDialog(); $('color-dialog').showModal(); });

  $('btn-cc-chart').addEventListener('click', async () => {
    const p = app.getProject();
    await app.ensureFonts();
    const canvas = await exportChartPNG(p);
    app.showExport(canvas, `色見本 ${canvas.width}×${canvas.height} px（${p.paper.w}×${p.paper.h} mm, 300 dpi, サイズ補正 ${p.scaleK}%、色補正なし）。シールと同じ方法で印刷してください。`);
  });

  $('cc-photo').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      await loadPhoto(f);
      cal.pts = [null, null, null, null]; cal.sel = 0; cal.result = null; cal.error = null;
      renderDialog();
      $('cc-canvas').focus();
    } catch (err) { app.toast('画像を読み込めませんでした。JPEG / PNG を選んでください'); }
  });

  const cv = $('cc-canvas');
  cv.addEventListener('click', ev => {
    if (!cal.photo) return;
    const r = cv.getBoundingClientRect();
    const x = (ev.clientX - r.left) / r.width * cal.photo.width;
    const y = (ev.clientY - r.top) / r.height * cal.photo.height;
    placePoint(cal.sel, snap(x, y));
    // 次の未指定の点へ（全部指定済みなら次の番号へ）
    const next = cal.pts.findIndex(p => !p);
    cal.sel = next >= 0 ? next : (cal.sel + 1) % 4;
    analyze(); renderDialog();
  });
  cv.addEventListener('keydown', ev => {
    if (!cal.photo) return;
    const diag = Math.hypot(cal.photo.width, cal.photo.height);
    if (/^[1-4]$/.test(ev.key)) {
      ev.preventDefault();
      cal.sel = Number(ev.key) - 1;
      if (!cal.pts[cal.sel]) placePoint(cal.sel, guessCorner(cal.sel));
      analyze(); renderDialog();
      return;
    }
    const step = diag * (ev.shiftKey ? 0.02 : 0.002);
    const mv = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[ev.key];
    if (mv) {
      ev.preventDefault();
      const p = cal.pts[cal.sel] || guessCorner(cal.sel);
      placePoint(cal.sel, [clamp(p[0] + mv[0], 0, cal.photo.width - 1), clamp(p[1] + mv[1], 0, cal.photo.height - 1)]);
      analyze(); renderDialog();
    } else if (ev.key === 'Enter' && cal.pts[cal.sel]) {
      ev.preventDefault();
      placePoint(cal.sel, snap(...cal.pts[cal.sel]));
      analyze(); renderDialog();
    }
  });
  $('btn-cc-reset').addEventListener('click', () => {
    cal.pts = [null, null, null, null]; cal.sel = 0; cal.result = null; cal.error = null;
    renderDialog(); $('cc-canvas').focus();
  });
  $('btn-cc-use').addEventListener('click', () => {
    if (!cal.result) return;
    const p = app.getProject();
    p.colorCorr.profile = { ...cal.result, created: new Date().toISOString().slice(0, 10), paper: p.paper.preset, mode: p.printMode };
    p.colorCorr.enabled = true;
    $('color-dialog').close();
    app.update();
    app.toast(`色補正を有効にしました（ずれ ΔE ${cal.result.before} → 推定 ${cal.result.after}）`);
  });

  // テスト用: 写真の読み込みと点の指定を外から行う
  return {
    loadPhotoCanvas(canvas) { setPhoto(canvas); cal.pts = [null, null, null, null]; cal.sel = 0; cal.result = null; renderDialog(); },
    get state() { return cal; },
  };
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function guessCorner(i) {
  const w = cal.photo.width, h = cal.photo.height, m = 0.1;
  return [[w * m, h * m], [w * (1 - m), h * m], [w * (1 - m), h * (1 - m)], [w * m, h * (1 - m)]][i];
}

function placePoint(i, p) { cal.pts[i] = p; }

function snap(x, y) {
  const diag = Math.hypot(cal.photo.width, cal.photo.height);
  return snapToMarker(cal.data, x, y, diag * 0.03);
}

function setPhoto(canvas) {
  cal.photo = canvas;
  cal.data = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height);
}

function loadPhoto(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, MAX_PHOTO_PX / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      setPhoto(c); resolve();
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('load')); };
    img.src = url;
  });
}

function analyze() {
  cal.result = null; cal.error = null;
  if (cal.pts.some(p => !p)) return;
  if (!quadIsValid(cal.pts)) {
    cal.error = '4 点の順番が違うか、形がゆがんでいます。1 左上 → 2 右上 → 3 右下 → 4 左下 の順に指定してください。';
    return;
  }
  try { cal.result = fitProfile(samplePatches(cal.data, cal.pts)); }
  catch (e) { cal.error = e.message; }
}

// ---------------------------------------------------------------- 描画

function renderDialog() {
  const has = !!cal.photo;
  $('cc-step3').hidden = !has;
  $('cc-step4').hidden = !cal.result;
  if (!has) return;

  // 写真と指定点、標本化する位置の枠
  const cv = $('cc-canvas');
  const k = Math.min(1, 1100 / cal.photo.width);
  cv.width = Math.round(cal.photo.width * k); cv.height = Math.round(cal.photo.height * k);
  const ctx = cv.getContext('2d');
  ctx.drawImage(cal.photo, 0, 0, cv.width, cv.height);
  const P = p => [p[0] * k, p[1] * k];
  const lw = Math.max(1.5, cv.width / 500);
  if (cal.pts.every(Boolean) && quadIsValid(cal.pts)) {
    const map = homographyFromUnitSquare(cal.pts);
    ctx.lineWidth = lw;
    CHART_PATCHES.forEach((_, i) => {
      const r = patchRect(i, 0.5);
      const q = [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]].map(([u, v]) => P(map(u, v)));
      ctx.strokeStyle = cal.error ? '#ff3b30' : '#ffd400';
      ctx.beginPath(); q.forEach(([x, y], j) => j ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath(); ctx.stroke();
    });
  }
  const placed = cal.pts.map((p, i) => p && [i, P(p)]).filter(Boolean);
  if (placed.length > 1) {
    ctx.strokeStyle = 'rgba(0,160,255,.9)'; ctx.lineWidth = lw;
    ctx.beginPath();
    cal.pts.forEach((p, i) => { if (!p) return; const [x, y] = P(p); i && cal.pts[i - 1] ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    if (cal.pts.every(Boolean)) { const [x, y] = P(cal.pts[0]); ctx.lineTo(x, y); }
    ctx.stroke();
  }
  const rad = Math.max(8, cv.width / 70);
  placed.forEach(([i, [x, y]]) => {
    ctx.fillStyle = i === cal.sel ? '#f29a00' : '#0a84ff';
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = lw;
    ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#ffffff'; ctx.font = `700 ${rad * 1.2}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(i + 1), x, y + 1);
  });

  const nPlaced = cal.pts.filter(Boolean).length;
  const instr = $('cc-instr');
  if (cal.error) { instr.className = 'warn'; instr.textContent = cal.error; }
  else if (nPlaced < 4) { instr.className = 'warn'; instr.textContent = `マーク ${CORNER_NAMES[cal.sel]} の中心をクリックしてください（${nPlaced} / 4）`; }
  else { instr.className = 'note'; instr.textContent = '黄色い枠が各パッチの内側に収まっていれば読み取りは正確です。ずれていたら点を指定し直してください。'; }
  cv.setAttribute('aria-label', `取り込んだ色見本の画像。指定済みのマーク ${nPlaced} / 4。選択中は ${CORNER_NAMES[cal.sel]}。1〜4 で点を選び、矢印キーで移動`);

  // 結果
  if (cal.result) {
    const r = cal.result;
    const verdict = r.before < 5 ? '<span class="cc-good">ずれはごく小さく、補正はほとんど必要ありません。</span>'
      : r.after < r.before * 0.6 ? '<span class="cc-good">補正でかなり近づけられます。</span>'
      : '<span class="cc-bad">補正の効果は限定的です。写真の撮り方（影・反射・色かぶり）を見直すと改善することがあります。</span>';
    $('cc-result').innerHTML = `印刷のずれ（平均 ΔE）は <b>${r.before}</b>、補正後の推定は <b>${r.after}</b> です。${verdict}`;
    const sw = $('cc-swatches');
    sw.innerHTML = '';
    r.samples.forEach(s => {
      const cell = document.createElement('span');
      cell.title = `意図 ${rgbToHex(s.target)} → 印刷 ${rgbToHex(s.meas)}`;
      const a = document.createElement('i'); a.style.background = rgbToHex(s.target);
      const b = document.createElement('i'); b.style.background = rgbToHex(s.meas);
      cell.append(a, b); sw.appendChild(cell);
    });
    sw.setAttribute('aria-label', `48 色のパッチの比較。印刷のずれ 平均 ΔE ${r.before}`);
  }
}

/** 用紙欄の色補正の表示を同期 */
export function syncColorPanel(project) {
  const cc = project.colorCorr;
  const pr = cc.profile;
  $('cc-enabled').checked = !!cc.enabled && !!pr;
  $('cc-enabled').disabled = !pr;
  $('cc-strength').value = cc.strength ?? 100;
  $('cc-strength').disabled = !pr;
  $('cc-preview').checked = !!cc.preview;
  $('cc-preview').disabled = !pr;
  let t;
  if (!pr) t = 'まだ補正はありません。色見本を印刷し、その写真から補正を作ります。';
  else {
    const paperName = paperById(pr.paper).name.split('（')[0].split(' ')[0];
    t = `${pr.created} に ${paperName}・${MODE_NAMES[pr.mode] || pr.mode} で作成。印刷のずれ ΔE ${pr.before} → 補正後の推定 ${pr.after}。`;
    if (pr.paper !== project.paper.preset || pr.mode !== project.printMode) t += ' 今の用紙・印刷方法とは別の条件で作った補正です。';
  }
  $('cc-status').textContent = t;
}
