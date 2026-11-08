// 色補正の画面: 用紙欄の設定と、色見本の写真からプロファイルを作るダイアログ
import { samplePatches, fitProfile, snapToMarker, quadIsValid, homographyFromUnitSquare, patchRect, CHART_PATCHES, rgbToHex,
  VISUAL_PATCHES, visualStart, visualGrid, visualPick, visualSamples, visualAxisLabels, VISUAL_STAGES } from './colorcal.js';
import { exportChartPNG, chartCanvas } from './export.js';
import { paperById } from './model.js';

const $ = id => document.getElementById(id);
const MAX_PHOTO_PX = 2400;
const CORNER_NAMES = ['1（左上）', '2（右上）', '3（右下）', '4（左下）'];
const MODE_NAMES = { 'cvs-border': 'フチあり', 'cvs-borderless': 'フチなし', home: '家庭用' };

// ダイアログの状態（開き直しても保持）。結果は読み取り方ごとに持つ
const cal = {
  mode: 'visual',
  photo: null, data: null, pts: [null, null, null, null], sel: 0,
  results: { photo: null, visual: null }, errors: { photo: null, visual: null },
  // 目で合わせる: いま何マス目か（VISUAL_PATCHES の添字）、選び途中の状態、決まった色
  v: { i: 0, st: visualStart(VISUAL_PATCHES[0]), picks: {}, finished: false, focus: 4 },
};
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
      cal.pts = [null, null, null, null]; cal.sel = 0; cal.results.photo = null; cal.errors.photo = null;
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
    cal.pts = [null, null, null, null]; cal.sel = 0; cal.results.photo = null; cal.errors.photo = null;
    renderDialog(); $('cc-canvas').focus();
  });

  // 読み取り方の切り替え
  for (const [id, mode] of [['cc-mode-visual', 'visual'], ['cc-mode-photo', 'photo']]) {
    $(id).addEventListener('click', () => { cal.mode = mode; renderDialog(); });
  }

  // 目で合わせる
  $('btn-cc-v-accept').addEventListener('click', () => { if (!cal.v.finished) { decideVisual(cal.v.st.center); focusVisual(); } });
  $('btn-cc-v-skip').addEventListener('click', () => { if (!cal.v.finished) { delete cal.v.picks[VISUAL_PATCHES[cal.v.i]]; nextVisual(); focusVisual(); } });
  $('btn-cc-v-back').addEventListener('click', () => {
    const v = cal.v;
    const i = v.finished ? VISUAL_PATCHES.length - 1 : v.i - 1;
    if (i < 0) return;
    v.finished = false; v.i = i;
    const idx = VISUAL_PATCHES[i];
    v.st = visualStart(idx);
    if (v.picks[idx]) v.st.center = v.picks[idx].slice();   // 前に選んだ色から始める
    cal.results.visual = null; cal.errors.visual = null;
    renderDialog(); focusVisual();
  });
  $('btn-cc-v-restart').addEventListener('click', () => {
    cal.v = { i: 0, st: visualStart(VISUAL_PATCHES[0]), picks: {}, finished: false, focus: 4 };
    cal.results.visual = null; cal.errors.visual = null;
    renderDialog(); focusVisual();
  });
  $('btn-cc-use').addEventListener('click', () => {
    const r = cal.results[cal.mode];
    if (!r) return;
    const p = app.getProject();
    p.colorCorr.profile = { ...r, method: cal.mode, created: new Date().toISOString().slice(0, 10), paper: p.paper.preset, mode: p.printMode };
    p.colorCorr.enabled = true;
    $('color-dialog').close();
    app.update();
    app.toast(`色補正を有効にしました（ずれ ΔE ${r.before} → 推定 ${r.after}）`);
  });

  // テスト用: 写真の読み込みと点の指定を外から行う
  return {
    loadPhotoCanvas(canvas) { setPhoto(canvas); cal.pts = [null, null, null, null]; cal.sel = 0; cal.results.photo = null; renderDialog(); },
    get state() { return cal; },
    pickVisual(k) { pickVisual(k); },
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
  cal.results.photo = null; cal.errors.photo = null;
  if (cal.pts.some(p => !p)) return;
  if (!quadIsValid(cal.pts)) {
    cal.errors.photo = '4 点の順番が違うか、形がゆがんでいます。1 左上 → 2 右上 → 3 右下 → 4 左下 の順に指定してください。';
    return;
  }
  try { cal.results.photo = fitProfile(samplePatches(cal.data, cal.pts)); }
  catch (e) { cal.errors.photo = e.message; }
}

// ---------------------------------------------------------------- 目で合わせる

function decideVisual(rgb) {
  cal.v.picks[VISUAL_PATCHES[cal.v.i]] = rgb.slice();
  nextVisual();
}

function nextVisual() {
  const v = cal.v;
  v.focus = 4;
  if (v.i + 1 < VISUAL_PATCHES.length) {
    v.i++;
    const idx = VISUAL_PATCHES[v.i];
    v.st = visualStart(idx);
    if (v.picks[idx]) v.st.center = v.picks[idx].slice();
  } else {
    v.finished = true;
    cal.results.visual = null; cal.errors.visual = null;
    if (Object.keys(v.picks).length < 6) {
      cal.errors.visual = '選んだマスが少なすぎます（6 マス以上必要です）。「前のマスに戻る」で飛ばしたマスを選んでください。';
    } else {
      try { cal.results.visual = fitProfile(visualSamples(v.picks), { method: 'visual' }); }
      catch (e) { cal.errors.visual = e.message; }
    }
  }
  renderDialog();
}

function pickVisual(k) {
  const v = cal.v;
  v.st = visualPick(v.st, k);
  v.focus = 4;
  if (v.st.done) decideVisual(v.st.center);
  else renderDialog();
}

/** 候補の真ん中（または結果）にフォーカスを置く */
function focusVisual() {
  if (cal.v.finished) { ($('btn-cc-use').hidden || $('cc-step4').hidden ? $('btn-cc-v-back') : $('btn-cc-use')).focus(); return; }
  $('cc-v-grid').querySelector('button[tabindex="0"]')?.focus();
}

function renderVisual() {
  const v = cal.v;
  const total = VISUAL_PATCHES.length;
  const grid = $('cc-v-grid');
  grid.innerHTML = '';
  const map = $('cc-v-map');
  map.innerHTML = '';
  CHART_PATCHES.forEach((p, i) => {
    const cell = document.createElement('i');
    cell.style.background = rgbToHex(p.rgb);
    if (!v.finished && i === v.st.index) cell.className = 'now';
    else if (VISUAL_PATCHES.includes(i) && v.picks[i]) cell.className = 'done';
    map.appendChild(cell);
  });
  const done = Object.keys(v.picks).length;
  for (const id of ['btn-cc-v-accept', 'btn-cc-v-skip']) $(id).disabled = v.finished;
  $('btn-cc-v-back').disabled = !v.finished && v.i === 0;

  if (v.finished) {
    $('cc-v-progress').innerHTML = `${total} マスのうち <b>${done}</b> マスを選び終わりました。`;
    map.setAttribute('aria-label', '色見本の 48 マス。目で合わせるマスはすべて終わりました');
    grid.hidden = true;
    for (const c of [0, 1, 2]) $('cc-v-col' + c).textContent = '';
    return;
  }
  grid.hidden = false;
  const no = v.st.index + 1;
  $('cc-v-progress').innerHTML = `印刷の <b>${no}</b> 番のマスに一番近い色を選んでください（${v.i + 1} / ${total} マス目、細かさ ${v.st.stage + 1} / ${VISUAL_STAGES.length}）`;
  map.setAttribute('aria-label', `色見本の 48 マス。いまは ${no} 番（左から ${v.st.index % 6 + 1} 列目、上から ${Math.floor(v.st.index / 6) + 1} 行目）`);
  const labels = visualAxisLabels(v.st.target, v.st.stage);
  labels.cols.forEach((t, c) => { $('cc-v-col' + c).textContent = t; });
  const colors = visualGrid(v.st);
  const btns = colors.map((rgb, k) => {
    const b = document.createElement('button'); b.type = 'button';
    b.style.background = rgbToHex(rgb);
    const r = Math.floor(k / 3), c = k % 3;
    b.setAttribute('aria-label', k === 4 ? '真ん中（いまの色）。これが一番近い' : `${labels.rows[r]}・${labels.cols[c]}`.replace('そのまま・', '').replace('・そのまま', ''));
    if (k === 4) b.classList.add('center');
    b.tabIndex = k === v.focus ? 0 : -1;
    b.addEventListener('click', () => { pickVisual(k); focusVisual(); });
    b.addEventListener('keydown', e => {
      const mv = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[e.key];
      if (!mv) return;
      e.preventDefault();
      const nr = Math.max(0, Math.min(2, r + mv[0])), nc = Math.max(0, Math.min(2, c + mv[1]));
      v.focus = nr * 3 + nc;
      btns.forEach((x, j) => { x.tabIndex = j === v.focus ? 0 : -1; });
      btns[v.focus].focus();
    });
    return b;
  });
  grid.append(...btns);
}

// ---------------------------------------------------------------- 描画

function renderDialog() {
  const visual = cal.mode === 'visual';
  $('cc-mode-visual').setAttribute('aria-pressed', String(visual));
  $('cc-mode-photo').setAttribute('aria-pressed', String(!visual));
  $('cc-visual').hidden = !visual;
  $('cc-photo-mode').hidden = visual;
  if (visual) renderVisual(); else renderPhoto();
  renderResult();
}

function renderResult() {
  const r = cal.results[cal.mode], err = cal.errors[cal.mode];
  const visual = cal.mode === 'visual';
  $('cc-step4').hidden = !r && !(visual && err);
  $('btn-cc-use').hidden = !r;
  if (!r) {
    if (visual && err) { $('cc-result').innerHTML = ''; $('cc-result').textContent = err; $('cc-swatches').innerHTML = ''; }
    return;
  }
  const verdict = r.before < 5 ? '<span class="cc-good">ずれはごく小さく、補正はほとんど必要ありません。</span>'
    : r.after < r.before * 0.6 ? '<span class="cc-good">補正でかなり近づけられます。</span>'
    : visual ? '<span class="cc-bad">補正の効果は限定的です。選び方に迷ったマスがあれば、戻って選び直してみてください。</span>'
    : '<span class="cc-bad">補正の効果は限定的です。写真の撮り方（影・反射・色かぶり）を見直すと改善することがあります。</span>';
  $('cc-result').innerHTML = `印刷のずれ（平均 ΔE）は <b>${r.before}</b>、補正後の推定は <b>${r.after}</b> です。${verdict}`;
  const sw = $('cc-swatches');
  sw.innerHTML = '';
  // 目で合わせた場合、白と黒は仮定なので表示しない
  const shown = visual ? r.samples.filter(x => !(x.target.every(v => v === 255) || x.target.every(v => v === 0))) : r.samples;
  shown.forEach(x => {
    const cell = document.createElement('span');
    cell.title = `意図 ${rgbToHex(x.target)} → 印刷 ${rgbToHex(x.meas)}`;
    const a = document.createElement('i'); a.style.background = rgbToHex(x.target);
    const b = document.createElement('i'); b.style.background = rgbToHex(x.meas);
    cell.append(a, b); sw.appendChild(cell);
  });
  sw.setAttribute('aria-label', `${shown.length} 色の比較。印刷のずれ 平均 ΔE ${r.before}`);
  $('cc-swatch-note').textContent = visual ? '各マスの上半分が意図した色、下半分が「印刷はこう見えた」と選んだ色です。'
    : '各マスの上半分が意図した色、下半分が印刷された色です。';
}

function renderPhoto() {
  const has = !!cal.photo;
  $('cc-step3').hidden = !has;
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
      ctx.strokeStyle = cal.errors.photo ? '#ff3b30' : '#ffd400';
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
  if (cal.errors.photo) { instr.className = 'warn'; instr.textContent = cal.errors.photo; }
  else if (nPlaced < 4) { instr.className = 'warn'; instr.textContent = `マーク ${CORNER_NAMES[cal.sel]} の中心をクリックしてください（${nPlaced} / 4）`; }
  else { instr.className = 'note'; instr.textContent = '黄色い枠が各パッチの内側に収まっていれば読み取りは正確です。ずれていたら点を指定し直してください。'; }
  cv.setAttribute('aria-label', `取り込んだ色見本の画像。指定済みのマーク ${nPlaced} / 4。選択中は ${CORNER_NAMES[cal.sel]}。1〜4 で点を選び、矢印キーで移動`);

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
    const how = pr.method === 'visual' ? '目で合わせて' : '写真から';
    t = `${pr.created} に ${paperName}・${MODE_NAMES[pr.mode] || pr.mode} で、${how}作成。印刷のずれ ΔE ${pr.before} → 補正後の推定 ${pr.after}。`;
    if (pr.paper !== project.paper.preset || pr.mode !== project.printMode) t += ' 今の用紙・印刷方法とは別の条件で作った補正です。';
  }
  $('cc-status').textContent = t;
}
