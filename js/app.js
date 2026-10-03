// UI とアプリ状態
import { PAPERS, FONTS, LED_SWATCHES, PRESETS, defaultProject, makeItem, itemLabel, paperById, defaultScaleK, scaleKFor, calibKey, usableArea, signIsBlank, fillOf, makeBand } from './model.js';
import { layoutSheet, rulerLength } from './layout.js';
import { renderSheet, renderItemThumb, fontsInUse, setImageLoadedCallback, getImage, getEditedImage } from './render.js';
import { normalizeEdits, makeRecolor, detectBorderColor, colorAt, downscaleDataURL, hasEdits, opaqueRatio } from './imageedit.js';
import { exportPNG, exportCanvas, printSheet } from './export.js';
import { saveLocal, loadLocal, clearLocal, exportProjectJSON, readProjectFile, readImageFile } from './storage.js';

const $ = id => document.getElementById(id);

let project = loadLocal() || defaultProject();
let selectedId = project.items[0]?.id || null;
let zoom = 1;          // 「全体」に対する倍率
let lastLayout = null;
const loadedFonts = new Set();

// ------------------------------------------------------------------ 初期化
function init() {
  const ps = $('paper-preset');
  for (const p of PAPERS) ps.add(new Option(p.name, p.id));
  const ap = $('add-preset');
  ap.add(new Option('プリセットから追加…', ''));
  for (const p of PRESETS) ap.add(new Option(p.name, p.id));

  ps.addEventListener('change', () => {
    const p = paperById(ps.value);
    project.paper.preset = p.id;
    if (p.id !== 'custom') { project.paper.w = p.w; project.paper.h = p.h; }
    if (!p.cvs && project.printMode !== 'home') project.printMode = 'home';
    if (p.cvs && project.printMode === 'home') project.printMode = 'cvs-border';
    project.scaleK = scaleKFor(project);
    update({ fit: true });
  });
  bindNumber('paper-w', v => { project.paper.w = v; project.paper.preset = 'custom'; }, { fit: true });
  bindNumber('paper-h', v => { project.paper.h = v; project.paper.preset = 'custom'; }, { fit: true });
  bindNumber('paper-margin', v => { project.paper.margin = v; });
  $('print-mode').addEventListener('change', e => {
    project.printMode = e.target.value;
    project.scaleK = scaleKFor(project);
    update();
  });
  bindNumber('scale-k', v => { project.scaleK = v; rememberCalib(); });
  $('dpi').addEventListener('change', e => { project.dpi = Number(e.target.value); update(); });
  bindNumber('gap', v => { project.gap = v; });
  bindNumber('bleed', v => { project.bleed = v; });
  $('marks').addEventListener('change', e => { project.marks = e.target.value; update(); });
  $('ruler').addEventListener('change', e => { project.ruler = e.target.checked; update(); });
  $('show-unprintable').addEventListener('change', e => { project.showUnprintable = e.target.checked; update(); });

  $('calib-measured').addEventListener('input', () => {
    const measured = Number($('calib-measured').value);
    const len = lastLayout?.ruler?.len || rulerLength(layoutSheet(project).area.w);
    $('calib-preview').textContent = measured > 0
      ? `現在 ${project.scaleK}% × ${len} ÷ ${measured} → 新しい補正 ${(Math.round((project.scaleK || 100) * (len / measured) * 10) / 10)}%`
      : '';
  });
  $('btn-calib').addEventListener('click', () => {
    const measured = Number($('calib-measured').value);
    const len = lastLayout?.ruler?.len || rulerLength(layoutSheet(project).area.w);
    if (!(measured > 0)) { toast('実測した長さ（mm）を入力してください'); return; }
    const newK = Math.round((project.scaleK || 100) * (len / measured) * 10) / 10;
    project.scaleK = newK;
    rememberCalib();
    $('calib-measured').value = '';
    $('calib-preview').textContent = '';
    update();
    toast(`サイズ補正を ${newK}% に更新しました。もう一度書き出して印刷してください`);
  });

  $('btn-add').addEventListener('click', () => {
    const it = makeItem($('add-type').value);
    project.items.push(it); selectedId = it.id; update();
  });
  ap.addEventListener('change', () => {
    const p = PRESETS.find(x => x.id === ap.value);
    if (p) { const it = makeItem(p.item.type, p.item); project.items.push(it); selectedId = it.id; update(); }
    ap.value = '';
  });

  $('btn-png').addEventListener('click', async () => {
    await ensureFonts();
    const canvas = await exportPNG(project);
    $('export-img').src = canvas.toDataURL('image/png');
    $('export-info').textContent = `${canvas.width}×${canvas.height} px（${project.paper.w}×${project.paper.h} mm, ${project.dpi} dpi, サイズ補正 ${project.scaleK}%）。ネットワークプリントには「写真プリント」として登録してください。`;
    $('export-dialog').showModal();
  });
  $('btn-print').addEventListener('click', async () => { await ensureFonts(); printSheet(project); });
  $('btn-save-project').addEventListener('click', () => exportProjectJSON(project));
  $('btn-load').addEventListener('click', () => $('file-project').click());
  $('file-project').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    try { project = await readProjectFile(f); selectedId = project.items[0]?.id || null; update({ fit: true }); }
    catch (err) { toast('プロジェクトファイルを読み込めませんでした'); }
    e.target.value = '';
  });
  $('btn-new').addEventListener('click', () => $('confirm-new').showModal());
  $('confirm-new').addEventListener('close', () => {
    if ($('confirm-new').returnValue !== 'ok') return;
    clearLocal(); project = defaultProject(); selectedId = project.items[0]?.id || null; update({ fit: true });
    toast('初期状態に戻しました');
  });
  $('btn-copy-project').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(JSON.stringify(project)); toast('プロジェクトの JSON をコピーしました'); }
    catch (e) { toast('コピーできませんでした。「プロジェクト保存」をお使いください'); }
  });
  $('btn-help').addEventListener('click', () => $('help').showModal());

  $('zoom-in').addEventListener('click', () => { zoom = Math.min(8, zoom * 1.25); update(); });
  $('zoom-out').addEventListener('click', () => { zoom = Math.max(0.25, zoom / 1.25); update(); });
  $('zoom-fit').addEventListener('click', () => { zoom = 1; update(); });
  window.addEventListener('resize', () => renderPreview());

  // モバイルの 編集 / プレビュー 切替
  const VIEW_KEY = 'plarail-seal-view';
  const setView = (v, focus) => {
    document.body.dataset.view = v;
    $('view-edit').setAttribute('aria-pressed', String(v === 'edit'));
    $('view-preview').setAttribute('aria-pressed', String(v === 'preview'));
    try { localStorage.setItem(VIEW_KEY, v); } catch (e) { /* ignore */ }
    if (v === 'preview') renderPreview();          // 非表示中は描けていないので表示時に描く
    if (focus) $(v === 'edit' ? 'view-edit' : 'view-preview').focus();
  };
  let savedView = 'edit';
  try { savedView = localStorage.getItem(VIEW_KEY) || 'edit'; } catch (e) { /* ignore */ }
  setView(savedView === 'preview' ? 'preview' : 'edit');
  $('view-edit').addEventListener('click', () => setView('edit'));
  $('view-preview').addEventListener('click', () => setView('preview'));
  // 左右キーでも切り替えられるように（タブ的な操作）
  for (const id of ['view-edit', 'view-preview']) {
    $(id).addEventListener('keydown', e => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); setView(id === 'view-edit' ? 'preview' : 'edit', true); }
    });
  }
  // デスクトップ幅に戻ったらプレビューを描き直す（モバイルで非表示だった場合に備える）
  const mq = window.matchMedia('(max-width: 900px)');
  mq.addEventListener('change', () => renderPreview());

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && pickTarget) {
      e.preventDefault();
      const k = pickTarget.key; pickTarget = null;
      requestFocus(k + ':pick'); update();
      toast('スポイトを解除しました');
    }
  });

  setImageLoadedCallback(() => { renderPreview(); if (project.items.find(i => i.id === selectedId)?.type === 'image') update(); });
  if (document.fonts) {
    document.fonts.addEventListener('loadingdone', () => renderPreview());
  }

  update({ fit: true });
  ensureFonts().then(() => renderPreview());

  // テスト・デバッグ用フック
  window.__app = {
    get project() { return project; },
    set project(p) { project = p; selectedId = p.items[0]?.id || null; update({ fit: true }); },
    layout: () => layoutSheet(project),
    exportCanvas: () => exportCanvas(project),
    ensureFonts,
    update,
    flush,
  };
}

/** 現在の用紙×印刷方法の補正 % を覚える（切り替えて戻しても保持される） */
function rememberCalib() {
  if (!project.calib) project.calib = {};
  if (project.scaleK === defaultScaleK(project)) delete project.calib[calibKey(project)];
  else project.calib[calibKey(project)] = project.scaleK;
}

let toastTimer = null;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

function bindNumber(id, setter, opts = {}) {
  $(id).addEventListener('change', e => {
    const v = Number(e.target.value);
    if (Number.isFinite(v)) { setter(v); update(opts); }
  });
}

async function ensureFonts() {
  if (!document.fonts) return;
  const wanted = fontsInUse(project).filter(f => !loadedFonts.has(f));
  if (!wanted.length) return;
  await Promise.all(wanted.map(f => document.fonts.load(f, '急行普通名古屋 Local Express 0123').then(() => loadedFonts.add(f)).catch(() => {})));
}

// ------------------------------------------------------------------ 更新
// 再描画は次のタスクまで遅らせる。change イベント（Tab で離れた瞬間）に同期でフォームを
// 作り直すと、ブラウザが移そうとしていた次の要素ごと消えてフォーカスが失われるため。
// スポイト: 元画像をクリックして色を拾う対象（null なら無効）
let pickTarget = null;     // { key, label, apply(hex) }

let renderTimer = null;
let focusRequest = null;   // 再描画後にフォーカスを当てたい data-key

function update(opts = {}) {
  if (opts.fit) zoom = 1;
  saveLocal(project);
  if (renderTimer) return;
  renderTimer = setTimeout(() => { renderTimer = null; renderAll(); }, 0);
}

/** テスト・同期が必要な場面用: 保留中の再描画を即時に実行 */
function flush() {
  if (renderTimer) { clearTimeout(renderTimer); renderTimer = null; renderAll(); }
}

function renderAll() {
  const active = document.activeElement;
  const key = focusRequest || active?.dataset?.key || (active?.id ? '#' + active.id : null);
  const selectAll = !focusRequest && active && (active.tagName === 'INPUT' && ['text', 'number'].includes(active.type) || active.tagName === 'TEXTAREA');
  focusRequest = null;
  syncSheetForm();
  renderList();
  renderEditor();
  renderPreview();
  updateLayoutWarning();
  restoreFocus(key, selectAll);
  ensureFonts().then(() => renderPreview());
}

function requestFocus(key) { focusRequest = key; }

function restoreFocus(key, selectAll) {
  if (!key) return;
  const el = key.startsWith('#') ? document.getElementById(key.slice(1))
    : document.querySelector(`[data-key="${CSS.escape(key)}"]`);
  if (!el || el === document.activeElement) return;
  el.focus({ preventScroll: true });
  if (selectAll && typeof el.select === 'function') el.select();
}

function syncSheetForm() {
  const paper = paperById(project.paper.preset);
  $('paper-preset').value = project.paper.preset;
  $('paper-w').value = project.paper.w;
  $('paper-h').value = project.paper.h;
  $('paper-margin').value = project.paper.margin;
  $('print-mode').value = project.printMode;
  $('scale-k').value = project.scaleK;
  $('dpi').value = String(project.dpi);
  $('gap').value = project.gap;
  $('bleed').value = project.bleed;
  $('marks').value = project.marks;
  $('ruler').checked = !!project.ruler;
  $('show-unprintable').checked = !!project.showUnprintable;

  const cvsOpts = [...$('print-mode').options].filter(o => o.value.startsWith('cvs'));
  cvsOpts.forEach(o => { o.disabled = !paper.cvs; });

  $('paper-note').textContent = paper.cvs
    ? 'ローソン・ファミマ・ミニストップ（シャープ製マルチコピー機）のシール紙はこの 3 サイズのみ。A4 のシール紙は取り扱いがありません。'
    : 'このサイズはコンビニのシール紙では印刷できません。家庭用プリンタなどで市販の A4 シール台紙等に印刷してください。';

  const u = usableArea(project);
  let note;
  if (project.printMode === 'cvs-border') {
    note = `「フチあり」で印刷すると全体が約 ${Math.round((1 - 100 / project.scaleK) * 1000) / 10}% 縮小されるため、書き出し時に ${project.scaleK}% に拡大して打ち消します。L判の既定値は実機で測った値、2L判・スクエアは目安です。機体差もあるので、ものさしを印刷して実測すると確実です。`;
  } else if (project.printMode === 'cvs-borderless') {
    note = `「フチなし」は用紙より大きく拡大して印刷され、周囲が切れます。既定値は目安です。必ずものさしで実測してください。`;
  } else {
    note = '印刷ダイアログで倍率 100%（「ページに合わせる」を外す）にすれば補正は不要です。ずれる場合はものさしで実測して補正してください。';
  }
  const remembered = project.calib?.[calibKey(project)];
  if (Number.isFinite(remembered)) note += `（この用紙・印刷方法の実測から求めた値 ${remembered}% を使用中。既定値は ${defaultScaleK(project)}%）`;
  $('scale-note').textContent = note;
  $('sheet-info').textContent = `${project.paper.w}×${project.paper.h} mm ／ 有効 ${u.w.toFixed(1)}×${u.h.toFixed(1)} mm ／ 書き出し ${Math.round(project.paper.w * project.dpi / 25.4)}×${Math.round(project.paper.h * project.dpi / 25.4)} px`;
}

// ------------------------------------------------------------------ 項目リスト
function renderList() {
  const ul = $('item-list');
  ul.innerHTML = '';
  if (selectedId && !project.items.some(i => i.id === selectedId)) selectedId = project.items[0]?.id || null;
  const tabId = selectedId || project.items[0]?.id;
  project.items.forEach((it, idx) => {
    const li = document.createElement('li');
    li.setAttribute('role', 'option');
    li.dataset.key = 'item:' + it.id;
    li.tabIndex = it.id === tabId ? 0 : -1;          // 一覧全体で 1 つのタブ停止
    li.setAttribute('aria-selected', String(it.id === selectedId));
    if (it.id === selectedId) li.classList.add('active');
    const sw = document.createElement('canvas');
    sw.className = 'swatch'; sw.setAttribute('aria-hidden', 'true');
    renderItemThumb(sw, it, 56 / it.w * 2);
    const name = document.createElement('span'); name.className = 'name'; name.textContent = itemLabel(it);
    if (signIsBlank(it)) { name.textContent += '（無地）'; name.title = '表示するパーツがありません。背景色だけで印刷されます'; }
    const meta = document.createElement('span'); meta.className = 'meta'; meta.textContent = `${it.w}×${it.h} mm ×${it.copies}`;
    li.setAttribute('aria-label', `${name.textContent}、${it.w}×${it.h} mm、${it.copies} 枚`);
    const actions = document.createElement('span'); actions.className = 'actions';
    const mk = (label, title, fn) => {
      const b = document.createElement('button'); b.textContent = label; b.title = title; b.setAttribute('aria-label', title);
      b.tabIndex = -1;                                  // キーボードは li 上のショートカットで操作
      b.addEventListener('click', e => { e.stopPropagation(); fn(); }); return b;
    };
    actions.append(
      mk('↑', '上へ', () => moveItem(idx, -1)),
      mk('↓', '下へ', () => moveItem(idx, 1)),
      mk('⧉', '複製', () => duplicateItem(idx)),
      mk('✕', '削除', () => deleteItem(idx)),
    );
    li.append(sw, name, meta, actions);
    li.addEventListener('click', () => selectItem(it.id));
    li.addEventListener('focus', () => { if (selectedId !== it.id) selectItem(it.id); });
    li.addEventListener('keydown', e => {
      const alt = e.altKey, mod = e.ctrlKey || e.metaKey;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const d = e.key === 'ArrowDown' ? 1 : -1;
        if (alt) { moveItem(idx, d); return; }
        const next = project.items[idx + d];
        if (next) selectItem(next.id);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault(); deleteItem(idx);
      } else if (mod && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault(); duplicateItem(idx);
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault(); selectItem(it.id);
      }
    });
    ul.appendChild(li);
  });
}

function selectItem(id) {
  if (selectedId !== id) pickTarget = null;
  selectedId = id;
  requestFocus('item:' + id);
  update();
}
function moveItem(idx, d) {
  const j = idx + d;
  if (j < 0 || j >= project.items.length) return;
  [project.items[j], project.items[idx]] = [project.items[idx], project.items[j]];
  requestFocus('item:' + project.items[j].id);
  update();
}
function duplicateItem(idx) {
  const it = project.items[idx];
  const c = makeItem(it.type, it); c.name = it.name ? it.name + ' コピー' : '';
  project.items.splice(idx + 1, 0, c); selectedId = c.id;
  requestFocus('item:' + c.id);
  update();
}
function deleteItem(idx) {
  const it = project.items[idx];
  project.items.splice(idx, 1);
  if (selectedId === it.id) selectedId = (project.items[idx] || project.items[idx - 1])?.id || null;
  if (selectedId) requestFocus('item:' + selectedId); else requestFocus('#btn-add');
  update();
  toast(`「${itemLabel(it)}」を削除しました`);
}

// ------------------------------------------------------------------ 編集フォーム
function renderEditor() {
  const card = $('editor-card');
  const it = project.items.find(x => x.id === selectedId);
  if (!it) { card.hidden = true; return; }
  card.hidden = false;
  $('editor-title').textContent = itemLabel(it);
  const root = $('editor');
  root.innerHTML = '';
  let section = '';

  const sec = (title) => { section = title || ''; const d = document.createElement('div'); d.className = 'editor-section'; if (title) { const h = document.createElement('h4'); h.textContent = title; d.appendChild(h); } root.appendChild(d); return d; };
  const row = (parent, ...els) => { const r = document.createElement('div'); r.className = 'row'; r.append(...els); parent.appendChild(r); return r; };
  // data-key: 再描画後にフォーカスを戻すための安定した識別子（項目 id + 区画 + ラベル）
  let seq = 0;
  const keyFor = (label) => `${it.id}:${section}:${label}`;
  const idFor = () => `ed-${it.id}-${seq++}`;
  const field = (label, input) => {
    const f = document.createElement('div'); f.className = 'field';
    const l = document.createElement('label'); l.textContent = label;
    if (!input.id) input.id = idFor();
    l.htmlFor = input.id;
    if (!input.dataset.key) input.dataset.key = keyFor(label);
    f.append(l, input); return f;
  };
  const num = (get, set, step = 0.1, min = 0) => {
    const i = document.createElement('input'); i.type = 'number'; i.step = step; i.min = min; i.value = get();
    i.addEventListener('change', () => { const v = Number(i.value); if (Number.isFinite(v)) { set(v); update(); } }); return i;
  };
  const text = (get, set, placeholder = '') => {
    const i = document.createElement('input'); i.type = 'text'; i.value = get(); i.placeholder = placeholder;
    i.addEventListener('input', () => { set(i.value); renderPreview(); saveLocal(project); });
    i.addEventListener('change', () => update()); return i;
  };
  const sel = (options, get, set) => {
    const s = document.createElement('select');
    for (const [v, l] of options) s.add(new Option(l, v));
    s.value = String(get());
    s.addEventListener('change', () => { set(s.value); update(); }); return s;
  };
  const check = (label, get, set) => {
    const l = document.createElement('label'); l.className = 'check';
    const c = document.createElement('input'); c.type = 'checkbox'; c.checked = !!get();
    c.id = idFor(); c.dataset.key = keyFor(label);
    c.addEventListener('change', () => { set(c.checked); update(); });
    l.append(c, document.createTextNode(' ' + label)); return l;
  };
  const color = (label, get, set, opts = {}) => {
    const wrap = document.createElement('div'); wrap.className = 'field';
    const l = document.createElement('label'); l.textContent = label;
    const cf = document.createElement('div'); cf.className = 'color-field';
    const c = document.createElement('input'); c.type = 'color'; c.value = get();
    c.id = idFor(); l.htmlFor = c.id; c.dataset.key = keyFor(label);
    const t = document.createElement('input'); t.type = 'text'; t.value = get();
    t.setAttribute('aria-label', `${label}（16進カラーコード）`); t.dataset.key = keyFor(label + ':hex');
    t.pattern = '#[0-9a-fA-F]{6}'; t.spellcheck = false;
    c.addEventListener('input', () => { t.value = c.value; set(c.value); renderPreview(); });
    c.addEventListener('change', () => update());
    t.addEventListener('change', () => { if (/^#[0-9a-f]{6}$/i.test(t.value)) { c.value = t.value; set(t.value); update(); } });
    // 色見本: グループで 1 つのタブ停止、←→ で移動、Enter / Space で選択
    const sw = document.createElement('div'); sw.className = 'swatches';
    sw.setAttribute('role', 'group'); sw.setAttribute('aria-label', `${label}の色見本`);
    const btns = LED_SWATCHES.map((col, i) => {
      const b = document.createElement('button'); b.type = 'button'; b.style.background = col;
      b.setAttribute('aria-label', `${label}を ${col} にする`);
      b.tabIndex = i === 0 ? 0 : -1; b.dataset.key = keyFor(label + ':sw' + i);
      b.addEventListener('click', () => { c.value = col; t.value = col; set(col); update(); });
      b.addEventListener('keydown', e => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        e.preventDefault();
        const j = (i + (e.key === 'ArrowRight' ? 1 : -1) + btns.length) % btns.length;
        btns.forEach((x, k) => { x.tabIndex = k === j ? 0 : -1; });
        btns[j].focus();
      });
      return b;
    });
    sw.append(...btns);
    cf.append(c, t);
    if (opts.pick) {
      // スポイト: 押してから元画像をクリックすると、その色が入る
      const key = keyFor(label);
      const active = pickTarget?.key === key;
      const pb = document.createElement('button'); pb.type = 'button'; pb.className = 'btn small pick-btn';
      pb.textContent = active ? 'クリックで色を拾う…' : 'スポイト';
      pb.setAttribute('aria-pressed', String(active));
      pb.setAttribute('aria-label', `${label}を元画像から拾う`);
      pb.dataset.key = key + ':pick';
      pb.addEventListener('click', () => {
        pickTarget = active ? null : { key, label, apply: v => { c.value = v; t.value = v; set(v); } };
        if (!active) requestFocus(`${it.id}:original`);
        update();
      });
      cf.append(pb);
    }
    if (opts.extra) cf.append(opts.extra);
    cf.append(sw); wrap.append(l, cf); return wrap;
  };
  const fontSel = () => sel(FONTS.map(f => [f.id, f.name]), () => it.font, v => {
    it.font = v; const f = FONTS.find(x => x.id === v);
    if (f && !f.weights.includes(it.weight)) it.weight = f.weights[f.weights.length - 1];
  });
  const weightSel = () => {
    const f = FONTS.find(x => x.id === it.font) || FONTS[1];
    return sel(f.weights.map(w => [w, w >= 800 ? `極太 (${w})` : w >= 700 ? `太字 (${w})` : w >= 500 ? `中 (${w})` : `標準 (${w})`]), () => it.weight, v => { it.weight = Number(v); });
  };

  /** 画像の簡易編集（背景の透明化・色の置き換え・単色化・余白の切り詰め） */
  const imageEditor = () => {
    it.edits = normalizeEdits(it.edits);
    const E = it.edits;
    const src = getImage(it.src);
    let srcData = null;
    const sourceData = () => {
      if (!srcData && src) {
        const c = document.createElement('canvas'); c.width = src.naturalWidth; c.height = src.naturalHeight;
        const cx = c.getContext('2d', { willReadFrequently: true }); cx.drawImage(src, 0, 0);
        srcData = cx.getImageData(0, 0, c.width, c.height);
      }
      return srcData;
    };
    const detected = src ? detectBorderColor(sourceData()) : null;
    const alreadyTransparent = !!src && detected === null;

    // 元画像（スポイト用）と編集後を並べて表示
    const sp = sec('画像の編集');
    const pair = document.createElement('div'); pair.className = 'img-pair';
    const mkView = (title, cv, extraClass) => {
      const fig = document.createElement('figure'); fig.className = 'img-view ' + (extraClass || '');
      const cap = document.createElement('figcaption'); cap.textContent = title;
      fig.append(cv, cap); return fig;
    };
    const orig = document.createElement('canvas'); orig.className = 'checker';
    orig.dataset.key = `${it.id}:original`;
    orig.setAttribute('role', 'img');
    const edited = document.createElement('canvas'); edited.className = 'checker';
    edited.setAttribute('role', 'img'); edited.setAttribute('aria-label', '編集後の画像');
    if (src) {
      const k = Math.min(1, 480 / Math.max(src.naturalWidth, src.naturalHeight));
      orig.width = Math.round(src.naturalWidth * k); orig.height = Math.round(src.naturalHeight * k);
      orig.getContext('2d').drawImage(src, 0, 0, orig.width, orig.height);
      const ed = getEditedImage(it);
      const ew = ed.naturalWidth || ed.width, eh = ed.naturalHeight || ed.height;
      const k2 = Math.min(1, 480 / Math.max(ew, eh));
      edited.width = Math.round(ew * k2); edited.height = Math.round(eh * k2);
      edited.getContext('2d').drawImage(ed, 0, 0, edited.width, edited.height);
    }
    if (pickTarget) {
      orig.classList.add('picking');
      orig.tabIndex = 0;
      orig.setAttribute('aria-label', `元画像。クリックすると「${pickTarget.label}」にその色が入ります。Esc で解除`);
      orig.addEventListener('click', ev => {
        if (!src || !pickTarget) return;
        const r = orig.getBoundingClientRect();
        const x = (ev.clientX - r.left) / r.width * src.naturalWidth;
        const y = (ev.clientY - r.top) / r.height * src.naturalHeight;
        const hex = colorAt(sourceData(), x, y);
        const t = pickTarget; pickTarget = null;
        t.apply(hex);
        requestFocus(t.key + ':pick');
        update();
        toast(`「${t.label}」を ${hex} にしました`);
      });
    } else {
      orig.setAttribute('aria-label', '元画像');
    }
    pair.append(mkView(pickTarget ? '元画像（クリックで色を拾う）' : '元画像', orig, pickTarget ? 'is-picking' : ''), mkView('編集後', edited));
    sp.appendChild(pair);
    if (src && hasEdits(E) && orig.width && edited.width) {
      const before = opaqueRatio(orig.getContext('2d').getImageData(0, 0, orig.width, orig.height));
      const after = opaqueRatio(edited.getContext('2d').getImageData(0, 0, edited.width, edited.height)) * (edited.width * edited.height) / (orig.width * orig.height);
      if (before > 0 && after / before < 0.05) {
        const w = document.createElement('p'); w.className = 'warn'; w.setAttribute('role', 'status');
        w.textContent = '編集後の画像がほとんど透明になりました。「消す色」がロゴの色になっていないか、許容範囲が大きすぎないか確認してください。';
        sp.appendChild(w);
      }
    }
    if (pickTarget) {
      const hint = document.createElement('p'); hint.className = 'warn'; hint.setAttribute('role', 'status');
      hint.textContent = `元画像をクリックすると「${pickTarget.label}」に色が入ります。Esc で解除。`;
      sp.appendChild(hint);
    }

    // 1. 背景の透明化
    const sb = sec('背景の透明化');
    if (alreadyTransparent) {
      const n0 = document.createElement('p'); n0.className = 'note';
      n0.textContent = 'この画像は背景がすでに透明です。透明化は不要です（内側の色を消したいときだけ「画像全体の同じ色」で使ってください）。';
      sb.appendChild(n0);
    }
    sb.appendChild(check('背景を透明にする', () => E.removeBg.enabled, v => {
      E.removeBg.enabled = v;
      // 初めて有効にしたときは外周の色から背景色を推定する。すでに透明なら推定せず「画像全体」にする
      if (v && src && !E.removeBg._detected) {
        if (alreadyTransparent) {
          E.removeBg.mode = 'all';
          toast('背景はすでに透明です。消したい色をスポイトで選んでください');
        } else {
          E.removeBg.color = detected;
        }
        E.removeBg._detected = true;
      }
    }));
    if (E.removeBg.enabled) {
      const auto = document.createElement('button'); auto.type = 'button'; auto.className = 'btn small';
      auto.textContent = '外周から推定'; auto.dataset.key = keyFor('外周から推定');
      auto.setAttribute('aria-label', '背景色を画像の外周から推定する');
      auto.disabled = alreadyTransparent;
      auto.addEventListener('click', () => {
        if (!src || !detected) return;
        E.removeBg.color = detected;
        update(); toast(`背景色を ${detected} と推定しました`);
      });
      row(sb, color('消す色', () => E.removeBg.color, v => { E.removeBg.color = v; }, { pick: true, extra: auto }));
      row(sb, field('範囲', sel([['edge', '外周からつながった部分だけ'], ['all', '画像全体の同じ色']], () => E.removeBg.mode, v => { E.removeBg.mode = v; })));
      row(sb, field('許容範囲 %', num(() => E.removeBg.tolerance, v => { E.removeBg.tolerance = v; }, 1, 0)), field('なじませ %', num(() => E.removeBg.feather, v => { E.removeBg.feather = v; }, 1, 0)));
      const n1 = document.createElement('p'); n1.className = 'note';
      n1.textContent = '「外周からつながった部分だけ」なら、文字の内側の白などは残ります。消え残りがあれば許容範囲を上げ、ロゴまで欠けるなら下げてください。なじませは輪郭の白いフチを抑えます。';
      sb.appendChild(n1);
    }

    // 2. 色の置き換え
    const sr = sec('色の置き換え');
    E.recolors.forEach((r, i) => {
      const prev = section; section = `色の置き換え:${i + 1}`;
      const box = document.createElement('div'); box.className = 'band';
      const head = document.createElement('div'); head.className = 'band-head';
      const ttl = document.createElement('span'); ttl.textContent = `置き換え ${i + 1}`;
      const del = document.createElement('button'); del.type = 'button'; del.className = 'btn small';
      del.textContent = '✕'; del.setAttribute('aria-label', `置き換え ${i + 1} を削除`); del.dataset.key = keyFor('削除');
      del.addEventListener('click', () => { E.recolors.splice(i, 1); requestFocus(`${it.id}:色の置き換え:追加`); update(); });
      head.append(ttl, del); box.appendChild(head);
      row(box, color('元の色', () => r.from, v => { r.from = v; }, { pick: true }));
      row(box, color('新しい色', () => r.to, v => { r.to = v; }));
      row(box, field('許容範囲 %', num(() => r.tolerance, v => { r.tolerance = v; }, 1, 0)));
      sr.appendChild(box);
      section = prev;
    });
    const addR = document.createElement('button'); addR.type = 'button'; addR.className = 'btn small';
    addR.textContent = '＋ 置き換えを追加'; addR.dataset.key = `${it.id}:色の置き換え:追加`;
    addR.addEventListener('click', () => {
      E.recolors.push(makeRecolor());
      const n = E.recolors.length;
      // 追加した直後に「元の色」のスポイトを有効にする（すぐ画像をクリックできる）
      const key = `${it.id}:色の置き換え:${n}:元の色`;
      const r = E.recolors[n - 1];
      pickTarget = { key, label: '元の色', apply: v => { r.from = v; } };
      requestFocus(`${it.id}:original`);
      update();
    });
    sr.appendChild(addR);
    const n2 = document.createElement('p'); n2.className = 'note';
    n2.textContent = '元の色に近い部分を新しい色へずらします。陰影や輪郭のなめらかさは保たれます。';
    sr.appendChild(n2);

    // 3. 単色化・4. 切り詰め
    const sm = sec('仕上げ');
    sm.appendChild(check('単色にする（シルエット）', () => E.mono.enabled, v => { E.mono.enabled = v; }));
    if (E.mono.enabled) row(sm, color('単色の色', () => E.mono.color, v => { E.mono.color = v; }));
    sm.appendChild(check('透明な余白を切り詰める', () => E.trim, v => { E.trim = v; }));
    const acts = document.createElement('div'); acts.className = 'row';
    const fitBtn = document.createElement('button'); fitBtn.type = 'button'; fitBtn.className = 'btn small';
    fitBtn.textContent = '高さを画像の縦横比に合わせる'; fitBtn.dataset.key = keyFor('縦横比');
    fitBtn.addEventListener('click', () => {
      const ed = getEditedImage(it); if (!ed) return;
      const ew = ed.naturalWidth || ed.width, eh = ed.naturalHeight || ed.height;
      it.h = Math.round(it.w * eh / ew * 10) / 10;
      update(); toast(`高さを ${it.h} mm にしました（幅 ${it.w} mm 基準）`);
    });
    const reset = document.createElement('button'); reset.type = 'button'; reset.className = 'btn small danger';
    reset.textContent = '編集をすべて戻す'; reset.dataset.key = keyFor('リセット');
    reset.disabled = !hasEdits(E);
    reset.addEventListener('click', () => { it.edits = normalizeEdits(null); pickTarget = null; requestFocus(keyFor('縦横比')); update(); toast('画像の編集を元に戻しました'); });
    acts.append(fitBtn, reset); sm.appendChild(acts);
  };

  /** 背景（単色 / ストライプ / グラデーション）の編集 UI */
  const backgroundEditor = () => {
    const f = fillOf(it); it.fill = f;
    const syncBg = () => { it.bg = f.bands[0]?.color || '#ffffff'; };
    const sb = sec('背景');
    row(sb, field('塗り方', sel([['solid', '単色'], ['rows', 'ストライプ（横縞・上から順）'], ['cols', 'ストライプ（縦縞・左から順）']], () => f.mode, v => {
      f.mode = v;
      if (v !== 'solid' && f.bands.length < 2) f.bands.push(makeBand('#ffffff', f.bands[0].weight || 1));
      syncBg();
    })));
    const bandUI = (band, i, showWeight) => {
      const prev = section; section = `背景:帯${i + 1}`;
      const box = document.createElement('div'); box.className = 'band';
      const head = document.createElement('div'); head.className = 'band-head';
      const title = document.createElement('span'); title.textContent = `帯 ${i + 1}`;
      if (showWeight) head.appendChild(title);
      if (showWeight) {
        const acts = document.createElement('span'); acts.className = 'band-actions';
        const mk = (label, aria, fn, disabled) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn small'; b.textContent = label; b.setAttribute('aria-label', aria); b.disabled = !!disabled; b.dataset.key = keyFor(aria); b.addEventListener('click', fn); return b; };
        acts.append(
          mk('↑', `帯 ${i + 1} を上へ`, () => { [f.bands[i - 1], f.bands[i]] = [f.bands[i], f.bands[i - 1]]; syncBg(); requestFocus(keyFor(`帯 ${i} を上へ`)); update(); }, i === 0),
          mk('↓', `帯 ${i + 1} を下へ`, () => { [f.bands[i + 1], f.bands[i]] = [f.bands[i], f.bands[i + 1]]; syncBg(); requestFocus(keyFor(`帯 ${i + 2} を下へ`)); update(); }, i === f.bands.length - 1),
          mk('✕', `帯 ${i + 1} を削除`, () => { f.bands.splice(i, 1); syncBg(); requestFocus(`${it.id}:背景:帯を追加`); update(); }, f.bands.length <= 1),
        );
        head.appendChild(acts);
      }
      if (showWeight) box.appendChild(head);
      const r1 = row(box, color('色', () => band.color, v => { band.color = v; syncBg(); }));
      if (showWeight) r1.prepend(field('幅 %', num(() => band.weight, v => { band.weight = v; }, 1, 0)));
      box.appendChild(check('グラデーション', () => band.grad, v => { band.grad = v; }));
      if (band.grad) {
        row(box, color('色 2（終点）', () => band.color2, v => { band.color2 = v; }), field('向き', sel([['v', '上 → 下'], ['h', '左 → 右']], () => band.gradDir || 'v', v => { band.gradDir = v; })));
      }
      section = prev;
      return box;
    };
    if (f.mode === 'solid') {
      sb.appendChild(bandUI(f.bands[0], 0, false));
    } else {
      f.bands.forEach((band, i) => sb.appendChild(bandUI(band, i, true)));
      const add = document.createElement('button'); add.type = 'button'; add.className = 'btn small';
      add.textContent = '＋ 帯を追加'; add.dataset.key = `${it.id}:背景:帯を追加`;
      add.addEventListener('click', () => { f.bands.push(makeBand(f.bands.length % 2 ? f.bands[0].color : '#ffffff', 20)); requestFocus(`${it.id}:背景:帯${f.bands.length}:幅 %`); update(); });
      sb.appendChild(add);
      const note = document.createElement('p'); note.className = 'note';
      note.textContent = '幅 % は合計に対する割合です（合計が 100 でなくても構いません）。塗り足しは両端の帯を外側へ伸ばします。';
      sb.appendChild(note);
    }
  };

  // 共通
  const g = sec(null);
  g.appendChild(field('名前（任意）', text(() => it.name, v => { it.name = v; })));
  row(g, field('幅 mm', num(() => it.w, v => { it.w = v; }, 0.1, 1)), field('高さ mm', num(() => it.h, v => { it.h = v; }, 0.1, 1)), field('枚数', num(() => it.copies, v => { it.copies = v; }, 1, 0)));

  if (it.type === 'sign') {
    const s1 = sec('表示器');
    row(s1, field('フォント', fontSel()), field('太さ', weightSel()));
    row(s1, field('内側余白 %', num(() => it.padding, v => { it.padding = v; }, 1, 0)), field('字間 %', num(() => it.letterSpacing, v => { it.letterSpacing = v; }, 1, -20)));
    row(s1, check('LED ドット風', () => it.ledDots, v => { it.ledDots = v; }), field('ドット行数', num(() => it.ledRows, v => { it.ledRows = v; }, 1, 6)));

    const blankNote = document.createElement('p'); blankNote.className = 'warn';
    blankNote.textContent = '表示するパーツがありません。背景色だけの四角として印刷されます。';
    blankNote.hidden = !signIsBlank(it);
    s1.appendChild(blankNote);

    backgroundEditor();

    const s2 = sec('種別（左側）');
    s2.appendChild(check('種別を表示する', () => it.kind.enabled !== false, v => { it.kind.enabled = v; }));
    if (it.kind.enabled !== false) {
      row(s2, field('種別', text(() => it.kind.text, v => { it.kind.text = v; }, '例: 急行')), field('英字', text(() => it.kind.en, v => { it.kind.en = v; }, '例: Express')));
      row(s2, field('スタイル', sel([['plain', '文字のみ'], ['box', '枠付き'], ['fill', '塗りつぶし']], () => it.kind.style, v => { it.kind.style = v; })), field('幅の割合 %', num(() => it.kind.ratio, v => { it.kind.ratio = v; }, 1, 0)));
      if (it.kind.style === 'plain') {
        row(s2, color('文字色', () => it.kind.color, v => { it.kind.color = v; }));
      } else {
        row(s2, color(it.kind.style === 'fill' ? '塗りつぶし色' : '枠の色', () => it.kind.color, v => { it.kind.color = v; }), color('文字色', () => it.kind.textColor, v => { it.kind.textColor = v; }));
        row(s2, field('角丸 %（高さ比）', num(() => it.kind.radius, v => { it.kind.radius = v; }, 1, 0)));
      }
    }

    const s3 = sec('行先（右側）');
    s3.appendChild(check('行先を表示する', () => it.dest.enabled !== false, v => { it.dest.enabled = v; }));
    if (it.dest.enabled !== false) {
      row(s3, field('行先', text(() => it.dest.text, v => { it.dest.text = v; }, '例: 名古屋')), field('英字', text(() => it.dest.en, v => { it.dest.en = v; }, '例: Nagoya')));
      row(s3, field('スタイル', sel([['plain', '文字のみ'], ['box', '枠付き'], ['fill', '塗りつぶし']], () => it.dest.style, v => { it.dest.style = v; })),
              field('英字の位置', sel([['below', '下（2 段）'], ['right', '横（右に並べる）']], () => it.enLayout || 'below', v => { it.enLayout = v; })));
      if ((it.dest.style || 'plain') === 'plain') {
        row(s3, color('文字色', () => it.dest.color, v => { it.dest.color = v; }));
      } else {
        row(s3, color(it.dest.style === 'fill' ? '塗りつぶし色' : '枠の色', () => it.dest.boxColor, v => { it.dest.boxColor = v; }), color('文字色', () => it.dest.color, v => { it.dest.color = v; }));
        row(s3, field('角丸 %（高さ比）', num(() => it.dest.radius, v => { it.dest.radius = v; }, 1, 0)));
      }
    }

    const s5 = sec('駅ナンバー（右端）');
    s5.appendChild(check('駅ナンバーを表示する', () => it.station.enabled !== false, v => { it.station.enabled = v; }));
    if (it.station.enabled !== false) {
      row(s5, field('番号', text(() => it.station.text, v => { it.station.text = v; }, '例: E01')), field('大きさ %（行の高さ比）', num(() => it.station.size, v => { it.station.size = v; }, 1, 30)));
      row(s5, field('スタイル', sel([['box', '角丸枠'], ['fill', '塗りつぶし']], () => it.station.style, v => { it.station.style = v; })), field('角丸 %', num(() => it.station.radius, v => { it.station.radius = v; }, 1, 0)));
      row(s5, color('枠 / 塗りの色', () => it.station.color, v => { it.station.color = v; }), color('文字色', () => it.station.textColor, v => { it.station.textColor = v; }));
      s5.appendChild(check('英字と数字を 2 段にする（E / 01）', () => it.station.twoLine, v => { it.station.twoLine = v; }));
    }

    const s4 = sec('英字行');
    row(s4, field('英字の高さ %（0 でなし）', num(() => it.enRatio, v => { it.enRatio = v; }, 1, 0)), color('英字の色', () => it.enColor, v => { it.enColor = v; }));
    const enNote = document.createElement('p'); enNote.className = 'note';
    enNote.textContent = '「下」のときは表示器の高さに対する割合、「横」のときは日本語の高さに対する割合です。';
    s4.appendChild(enNote);
  } else if (it.type === 'text') {
    const s1 = sec('文字');
    const ta = document.createElement('textarea'); ta.value = it.text; ta.dataset.key = keyFor('内容');
    ta.addEventListener('input', () => { it.text = ta.value; renderPreview(); saveLocal(project); });
    ta.addEventListener('change', () => update());
    s1.appendChild(field('内容（改行で複数行）', ta));
    row(s1, color('文字色', () => it.color, v => { it.color = v; }));
    row(s1, field('フォント', fontSel()), field('太さ', weightSel()));
    row(s1, field('揃え', sel([['left', '左'], ['center', '中央'], ['right', '右']], () => it.align, v => { it.align = v; })), field('内側余白 %', num(() => it.padding, v => { it.padding = v; }, 1, 0)), field('字間 %', num(() => it.letterSpacing, v => { it.letterSpacing = v; }, 1, -20)));
    backgroundEditor();
  } else if (it.type === 'image') {
    const s1 = sec('画像');
    const f = document.createElement('input'); f.type = 'file'; f.accept = 'image/*'; f.dataset.key = keyFor('画像ファイル');
    f.addEventListener('change', async () => {
      const file = f.files[0]; if (!file) return;
      try {
        const r = await downscaleDataURL(await readImageFile(file));
        it.src = r.src;
        if (!it.edits) it.edits = normalizeEdits(null);
        update();
        toast(`画像を読み込みました（${r.w}×${r.h} px）`);
      } catch (e) { toast('画像を読み込めませんでした。PNG / JPEG / SVG を選んでください'); }
    });
    s1.appendChild(field('画像ファイル（PNG/JPEG/SVG）', f));
    row(s1, field('収め方', sel([['contain', '全体を収める'], ['cover', '枠いっぱい（はみ出しは切る）']], () => it.fit, v => { it.fit = v; })));
    const note = document.createElement('p'); note.className = 'note';
    note.textContent = `画像はプロジェクトに埋め込まれます。長辺 1200 px を超える画像は読み込み時に縮小します。`;
    s1.appendChild(note);
    if (it.src) imageEditor();
    backgroundEditor();
  }

  const thumbWrap = sec('拡大プレビュー');
  const th = document.createElement('canvas');
  th.style.width = '100%'; th.style.border = '1px solid #ccc'; th.style.imageRendering = 'auto';
  th.setAttribute('role', 'img'); th.setAttribute('aria-label', `${itemLabel(it)} の拡大プレビュー`);
  renderItemThumb(th, it, Math.max(20, 1200 / Math.max(it.w, 1)));
  thumbWrap.appendChild(th);
}

// ------------------------------------------------------------------ プレビュー
function renderPreview() {
  const canvas = $('preview');
  const wrap = $('preview-scroll');
  if (wrap.clientWidth === 0) return;          // モバイルでプレビュー非表示中
  const availW = Math.max(200, wrap.clientWidth - 48);
  const availH = Math.max(200, wrap.clientHeight - 48);
  const fit = Math.min(availW / project.paper.w, availH / project.paper.h);
  const cssPxPerMm = fit * zoom;
  const dpr = window.devicePixelRatio || 1;
  const s = cssPxPerMm * dpr;
  canvas.style.width = `${project.paper.w * cssPxPerMm}px`;
  canvas.style.height = `${project.paper.h * cssPxPerMm}px`;
  canvas.width = Math.round(project.paper.w * s);
  canvas.height = Math.round(project.paper.h * s);
  const ctx = canvas.getContext('2d');
  lastLayout = renderSheet(ctx, project, s, { mode: 'preview' });
  $('zoom-label').textContent = `${Math.round(zoom * 100)}%`;
  updateLayoutWarning(lastLayout);
}

function updateLayoutWarning(lay = layoutSheet(project)) {
  const warn = $('layout-warn');
  const total = project.items.reduce((a, b) => a + Math.max(0, Math.floor(b.copies || 0)), 0);
  if (lay.overflow > 0) {
    warn.hidden = false;
    warn.textContent = `${total} 枚中 ${lay.overflow} 枚がシートに収まりません。枚数・間隔・余白を減らすか、用紙を大きくしてください。`;
  } else {
    warn.hidden = true;
  }
}

init();
