// UI とアプリ状態
import { PAPERS, FONTS, LED_SWATCHES, PRESETS, defaultProject, makeItem, itemLabel, paperById, defaultScaleK, usableArea, signIsBlank } from './model.js';
import { layoutSheet, rulerLength } from './layout.js';
import { renderSheet, renderItemThumb, fontsInUse, setImageLoadedCallback } from './render.js';
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
    project.scaleK = defaultScaleK(project);
    update({ fit: true });
  });
  bindNumber('paper-w', v => { project.paper.w = v; project.paper.preset = 'custom'; }, { fit: true });
  bindNumber('paper-h', v => { project.paper.h = v; project.paper.preset = 'custom'; }, { fit: true });
  bindNumber('paper-margin', v => { project.paper.margin = v; });
  $('print-mode').addEventListener('change', e => {
    project.printMode = e.target.value;
    project.scaleK = defaultScaleK(project);
    update();
  });
  bindNumber('scale-k', v => { project.scaleK = v; });
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

  setImageLoadedCallback(() => renderPreview());
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
  };
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
function update(opts = {}) {
  if (opts.fit) zoom = 1;
  syncSheetForm();
  renderList();
  renderEditor();
  renderPreview();
  saveLocal(project);
  ensureFonts().then(loaded => renderPreview());
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
    note = `「フチあり」で印刷すると全体が約 ${Math.round((1 - 100 / project.scaleK) * 10) * 10 / 10}% 縮小されるため、書き出し時に ${project.scaleK}% に拡大して打ち消します。L判の既定値は実機で測った値、2L判・スクエアは目安です。機体差もあるので、ものさしを印刷して実測すると確実です。`;
  } else if (project.printMode === 'cvs-borderless') {
    note = `「フチなし」は用紙より大きく拡大して印刷され、周囲が切れます。既定値は目安です。必ずものさしで実測してください。`;
  } else {
    note = '印刷ダイアログで倍率 100%（「ページに合わせる」を外す）にすれば補正は不要です。ずれる場合はものさしで実測して補正してください。';
  }
  $('scale-note').textContent = note;
  $('sheet-info').textContent = `${project.paper.w}×${project.paper.h} mm ／ 有効 ${u.w.toFixed(1)}×${u.h.toFixed(1)} mm ／ 書き出し ${Math.round(project.paper.w * project.dpi / 25.4)}×${Math.round(project.paper.h * project.dpi / 25.4)} px`;
}

// ------------------------------------------------------------------ 項目リスト
function renderList() {
  const ul = $('item-list');
  ul.innerHTML = '';
  project.items.forEach((it, idx) => {
    const li = document.createElement('li');
    if (it.id === selectedId) li.classList.add('active');
    const sw = document.createElement('canvas');
    sw.className = 'swatch';
    renderItemThumb(sw, it, 56 / it.w * 2);
    const name = document.createElement('span'); name.className = 'name'; name.textContent = itemLabel(it);
    if (signIsBlank(it)) { name.textContent += '（無地）'; name.title = '表示するパーツがありません。背景色だけで印刷されます'; }
    const meta = document.createElement('span'); meta.className = 'meta'; meta.textContent = `${it.w}×${it.h} mm ×${it.copies}`;
    const actions = document.createElement('span'); actions.className = 'actions';
    const mk = (label, title, fn) => {
      const b = document.createElement('button'); b.textContent = label; b.title = title;
      b.addEventListener('click', e => { e.stopPropagation(); fn(); }); return b;
    };
    actions.append(
      mk('↑', '上へ', () => { if (idx > 0) { [project.items[idx - 1], project.items[idx]] = [project.items[idx], project.items[idx - 1]]; update(); } }),
      mk('↓', '下へ', () => { if (idx < project.items.length - 1) { [project.items[idx + 1], project.items[idx]] = [project.items[idx], project.items[idx + 1]]; update(); } }),
      mk('⧉', '複製', () => { const c = makeItem(it.type, it); c.name = it.name ? it.name + ' コピー' : ''; project.items.splice(idx + 1, 0, c); selectedId = c.id; update(); }),
      mk('✕', '削除', () => { project.items.splice(idx, 1); if (selectedId === it.id) selectedId = project.items[0]?.id || null; update(); }),
    );
    li.append(sw, name, meta, actions);
    li.addEventListener('click', () => { selectedId = it.id; renderList(); renderEditor(); });
    ul.appendChild(li);
  });
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

  const sec = (title) => { const d = document.createElement('div'); d.className = 'editor-section'; if (title) { const h = document.createElement('h4'); h.textContent = title; d.appendChild(h); } root.appendChild(d); return d; };
  const row = (parent, ...els) => { const r = document.createElement('div'); r.className = 'row'; r.append(...els); parent.appendChild(r); return r; };
  const field = (label, input) => { const f = document.createElement('div'); f.className = 'field'; const l = document.createElement('label'); l.textContent = label; f.append(l, input); return f; };
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
    c.addEventListener('change', () => { set(c.checked); update(); });
    l.append(c, document.createTextNode(' ' + label)); return l;
  };
  const color = (label, get, set) => {
    const wrap = document.createElement('div'); wrap.className = 'field';
    const l = document.createElement('label'); l.textContent = label;
    const cf = document.createElement('div'); cf.className = 'color-field';
    const c = document.createElement('input'); c.type = 'color'; c.value = get();
    const t = document.createElement('input'); t.type = 'text'; t.value = get();
    c.addEventListener('input', () => { t.value = c.value; set(c.value); renderPreview(); });
    c.addEventListener('change', () => update());
    t.addEventListener('change', () => { if (/^#[0-9a-f]{6}$/i.test(t.value)) { c.value = t.value; set(t.value); update(); } });
    const sw = document.createElement('div'); sw.className = 'swatches';
    for (const col of LED_SWATCHES) {
      const b = document.createElement('button'); b.type = 'button'; b.style.background = col; b.title = col;
      b.addEventListener('click', () => { c.value = col; t.value = col; set(col); update(); }); sw.appendChild(b);
    }
    cf.append(c, t, sw); wrap.append(l, cf); return wrap;
  };
  const fontSel = () => sel(FONTS.map(f => [f.id, f.name]), () => it.font, v => {
    it.font = v; const f = FONTS.find(x => x.id === v);
    if (f && !f.weights.includes(it.weight)) it.weight = f.weights[f.weights.length - 1];
  });
  const weightSel = () => {
    const f = FONTS.find(x => x.id === it.font) || FONTS[1];
    return sel(f.weights.map(w => [w, w >= 800 ? `極太 (${w})` : w >= 700 ? `太字 (${w})` : w >= 500 ? `中 (${w})` : `標準 (${w})`]), () => it.weight, v => { it.weight = Number(v); });
  };

  // 共通
  const g = sec(null);
  g.appendChild(field('名前（任意）', text(() => it.name, v => { it.name = v; })));
  row(g, field('幅 mm', num(() => it.w, v => { it.w = v; }, 0.1, 1)), field('高さ mm', num(() => it.h, v => { it.h = v; }, 0.1, 1)), field('枚数', num(() => it.copies, v => { it.copies = v; }, 1, 0)));

  if (it.type === 'sign') {
    const s1 = sec('表示器');
    row(s1, color('背景色', () => it.bg, v => { it.bg = v; }));
    row(s1, field('フォント', fontSel()), field('太さ', weightSel()));
    row(s1, field('内側余白 %', num(() => it.padding, v => { it.padding = v; }, 1, 0)), field('字間 %', num(() => it.letterSpacing, v => { it.letterSpacing = v; }, 1, -20)));
    row(s1, check('LED ドット風', () => it.ledDots, v => { it.ledDots = v; }), field('ドット行数', num(() => it.ledRows, v => { it.ledRows = v; }, 1, 6)));

    const blankNote = document.createElement('p'); blankNote.className = 'warn';
    blankNote.textContent = '表示するパーツがありません。背景色だけの四角として印刷されます。';
    blankNote.hidden = !signIsBlank(it);
    s1.appendChild(blankNote);

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
    const ta = document.createElement('textarea'); ta.value = it.text;
    ta.addEventListener('input', () => { it.text = ta.value; renderPreview(); saveLocal(project); });
    ta.addEventListener('change', () => update());
    s1.appendChild(field('内容（改行で複数行）', ta));
    row(s1, color('文字色', () => it.color, v => { it.color = v; }), color('背景色', () => it.bg, v => { it.bg = v; }));
    row(s1, field('フォント', fontSel()), field('太さ', weightSel()));
    row(s1, field('揃え', sel([['left', '左'], ['center', '中央'], ['right', '右']], () => it.align, v => { it.align = v; })), field('内側余白 %', num(() => it.padding, v => { it.padding = v; }, 1, 0)), field('字間 %', num(() => it.letterSpacing, v => { it.letterSpacing = v; }, 1, -20)));
  } else if (it.type === 'image') {
    const s1 = sec('画像');
    const f = document.createElement('input'); f.type = 'file'; f.accept = 'image/*';
    f.addEventListener('change', async () => { const file = f.files[0]; if (file) { it.src = await readImageFile(file); update(); } });
    s1.appendChild(field('画像ファイル（PNG/JPEG/SVG）', f));
    row(s1, field('収め方', sel([['cover', '枠いっぱい（はみ出しは切る）'], ['contain', '全体を収める']], () => it.fit, v => { it.fit = v; })), color('背景色', () => it.bg, v => { it.bg = v; }));
    const note = document.createElement('p'); note.className = 'note';
    note.textContent = '画像はプロジェクトに埋め込まれます。大きな画像は縮小してから読み込むと保存が軽くなります。';
    s1.appendChild(note);
  }

  const thumbWrap = sec('拡大プレビュー');
  const th = document.createElement('canvas');
  th.style.width = '100%'; th.style.border = '1px solid #ccc'; th.style.imageRendering = 'auto';
  renderItemThumb(th, it, Math.max(20, 1200 / Math.max(it.w, 1)));
  thumbWrap.appendChild(th);
}

// ------------------------------------------------------------------ プレビュー
function renderPreview() {
  const canvas = $('preview');
  const wrap = $('preview-scroll');
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

  const warn = $('layout-warn');
  const total = project.items.reduce((a, b) => a + Math.max(0, Math.floor(b.copies || 0)), 0);
  if (lastLayout.overflow > 0) {
    warn.hidden = false;
    warn.textContent = `${total} 枚中 ${lastLayout.overflow} 枚がシートに収まりません。枚数・間隔・余白を減らすか、用紙を大きくしてください。`;
  } else {
    warn.hidden = true;
  }
}

init();
