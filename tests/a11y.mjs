// アクセシビリティテスト: キーボード操作（タブ順・フォーカス維持・一覧のキー操作）とアクセシブルネーム
import { openApp, makeChecker } from './helpers.mjs';
import { SIM_SRC } from './colorsim.mjs';

const { page, errors, close } = await openApp();
const checker = makeChecker();
const c = checker.check;

/** 現在のフォーカス要素を識別する文字列 */
const focused = () => page.evaluate(() => {
  const a = document.activeElement;
  if (!a || a === document.body) return 'body';
  return a.dataset?.key || (a.id ? '#' + a.id : `${a.tagName.toLowerCase()}:${(a.textContent || '').trim().slice(0, 12)}`);
});
const firstItemId = await page.evaluate(() => window.__app.project.items[0].id);
const key = (section, label) => `${firstItemId}:${section}:${label}`;

// ---------------------------------------------------------------- 1. アクセシブルネーム
const unnamed = await page.evaluate(() => {
  const visible = el => el.getClientRects().length > 0;
  const nameOf = el => {
    if (el.getAttribute('aria-label')) return el.getAttribute('aria-label');
    const by = el.getAttribute('aria-labelledby');
    if (by) return by.split(/\s+/).map(id => document.getElementById(id)?.textContent || '').join(' ').trim();
    if (el.id) { const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l?.textContent.trim()) return l.textContent.trim(); }
    const wrap = el.closest('label'); if (wrap?.textContent.trim()) return wrap.textContent.trim();
    if (el.title) return el.title;
    return (el.textContent || el.value || '').trim();
  };
  return [...document.querySelectorAll('input:not([type=hidden]), select, textarea, button, [role=option], [role=img]')]
    .filter(visible).filter(el => !nameOf(el))
    .map(el => `${el.tagName.toLowerCase()}#${el.id || ''}.${el.className || ''}`);
});
c('すべての操作要素にアクセシブルネームがある', unnamed.length === 0, unnamed.join(', '));

// ---------------------------------------------------------------- 2. タブ順
const order = [];
await page.evaluate(() => document.body.focus());
for (let i = 0; i < 250; i++) {
  await page.keyboard.press('Tab');
  const f = await focused();
  if (f === 'body' && order.length > 5) break;    // 一周した
  order.push(f);
}
const idx = id => order.indexOf(id);
const expected = ['#btn-new', '#btn-load', '#btn-save-project', '#btn-copy-project', '#btn-help', '#paper-preset', '#paper-w', '#print-mode', '#scale-k', '#gap', '#add-type', '#btn-add', '#add-preset', `item:${firstItemId}`, key('', '名前（任意）'), key('', '幅 mm'), '#zoom-out', '#btn-png', '#btn-print'];
const missing = expected.filter(id => idx(id) < 0);
c('主要な操作要素がすべて Tab で到達できる', missing.length === 0, missing.join(', '));
const monotonic = expected.every((id, i) => i === 0 || idx(id) > idx(expected[i - 1]));
c('Tab 順が画面の並び（ヘッダー → 設定 → 一覧 → 編集 → プレビュー）どおり', monotonic, expected.map(id => `${id}@${idx(id)}`).join(' '));
const listStops = order.filter(k => k.startsWith('item:')).length;
c('シール一覧は Tab 停止 1 つ（項目間は矢印キー）', listStops === 1, `stops=${listStops}`);
const actionStops = order.filter(k => /^button:(↑|↓|⧉|✕)/.test(k)).length;
c('一覧の操作ボタンは Tab 順に入らない', actionStops === 0, `stops=${actionStops}`);
const swatchStops = order.filter(k => /:sw\d+$/.test(k));
const swatchPerField = new Set(swatchStops.map(k => k.replace(/\d+$/, ''))).size;
c('色見本はグループごとに Tab 停止 1 つ', swatchStops.length === swatchPerField && swatchStops.length > 0, `stops=${swatchStops.length} groups=${swatchPerField}`);
c('隠しファイル入力は Tab 順に入らない', idx('#file-project') < 0);

// ---------------------------------------------------------------- 3. 値を変えて Tab しても次の欄に進む
await page.focus(`[data-key="${key('', '幅 mm')}"]`);
await page.keyboard.press('Control+A');
await page.keyboard.type('12');
await page.keyboard.press('Tab');
await page.waitForTimeout(50);
let f = await focused();
const w = await page.evaluate(() => window.__app.project.items[0].w);
c('数値を変更して Tab → 次の欄（高さ）にフォーカスが移る', f === key('', '高さ mm') && w === 12, `focus=${f} w=${w}`);

await page.focus(`[data-key="${key('行先（右側）', '行先')}"]`);
await page.keyboard.press('Control+A');
await page.keyboard.type('鳥羽');
await page.keyboard.press('Tab');
await page.waitForTimeout(50);
f = await focused();
const dest = await page.evaluate(() => window.__app.project.items[0].dest.text);
c('文字を変更して Tab → 次の欄（英字）にフォーカスが移る', f === key('行先（右側）', '英字') && dest === '鳥羽', `focus=${f} dest=${dest}`);

// Tab で入った欄は全選択されている（上書き入力できる）
const selAll = await page.evaluate(() => { const a = document.activeElement; return a.selectionStart === 0 && a.selectionEnd === a.value.length && a.value.length > 0; });
c('Tab で移った文字欄は全選択されている', selAll);

// ---------------------------------------------------------------- 4. チェックボックスを Space で切り替えてもフォーカスが残る
const kindKey = key('種別（左側）', '種別を表示する');
await page.focus(`[data-key="${kindKey}"]`);
await page.keyboard.press('Space');
await page.waitForTimeout(50);
f = await focused();
let enabled = await page.evaluate(() => window.__app.project.items[0].kind.enabled);
c('チェックを Space で外す → フォーム再構築後もフォーカスが残る', f === kindKey && enabled === false, `focus=${f} enabled=${enabled}`);
await page.keyboard.press('Space');
await page.waitForTimeout(50);
enabled = await page.evaluate(() => window.__app.project.items[0].kind.enabled);
c('もう一度 Space で戻る', enabled === true && (await focused()) === kindKey);

// スタイル切替（select）でフォームの項目が増えてもフォーカスが残る
const styleKey = key('種別（左側）', 'スタイル');
await page.focus(`[data-key="${styleKey}"]`);
await page.selectOption(`[data-key="${styleKey}"]`, 'fill');
await page.waitForTimeout(50);
f = await focused();
c('スタイルを変えて項目が増えてもフォーカスが残る', f === styleKey, `focus=${f}`);

// ---------------------------------------------------------------- 5. 色見本の矢印キー
const swKey = key('種別（左側）', '塗りつぶし色:sw0');
await page.focus(`[data-key="${swKey}"]`);
await page.keyboard.press('ArrowRight');
f = await focused();
c('色見本で → を押すと次の見本に移る', f === key('種別（左側）', '塗りつぶし色:sw1'), `focus=${f}`);
await page.keyboard.press('Enter');
await page.waitForTimeout(50);
const col = await page.evaluate(() => window.__app.project.items[0].kind.color);
c('Enter で見本の色が適用される', col === '#ff9a00' && (await focused()) === key('種別（左側）', '塗りつぶし色:sw1'), `color=${col}`);

// ---------------------------------------------------------------- 6. 一覧のキーボード操作
await page.selectOption('#add-preset', { index: 2 });
await page.selectOption('#add-preset', { index: 3 });
await page.waitForTimeout(50);
const ids = await page.evaluate(() => window.__app.project.items.map(i => i.id));
await page.focus(`[data-key="item:${ids[0]}"]`);
await page.keyboard.press('ArrowDown');
await page.waitForTimeout(50);
let sel = await page.evaluate(() => [document.activeElement.dataset.key, document.querySelector('#editor-card').hidden, document.querySelector('#item-list [aria-selected=true]')?.dataset.key]);
c('一覧で ↓ → 次のシールが選択されフォーカスも移る', sel[0] === `item:${ids[1]}` && sel[2] === `item:${ids[1]}`, sel.join(' '));
await page.keyboard.press('Control+D');
await page.waitForTimeout(50);
let count = await page.evaluate(() => window.__app.project.items.length);
sel = await focused();
c('Ctrl+D で複製され、複製にフォーカスが移る', count === ids.length + 1 && sel.startsWith('item:') && !ids.includes(sel.slice(5)), `count=${count} focus=${sel}`);
await page.keyboard.press('Delete');
await page.waitForTimeout(50);
count = await page.evaluate(() => window.__app.project.items.length);
sel = await focused();
c('Delete で削除され、隣のシールにフォーカスが移る', count === ids.length && sel === `item:${ids[2]}`, `count=${count} focus=${sel}`);
await page.keyboard.press('Alt+ArrowUp');
await page.waitForTimeout(50);
const moved = await page.evaluate(() => window.__app.project.items.map(i => i.id));
c('Alt+↑ で並べ替え', moved[1] === ids[2] && (await focused()) === `item:${ids[2]}`, moved.join(','));

// ---------------------------------------------------------------- 7. ダイアログ
await page.focus('#btn-help');
await page.keyboard.press('Enter');
c('使い方ダイアログが開く', await page.evaluate(() => document.getElementById('help').open));
await page.keyboard.press('Escape');
await page.waitForTimeout(50);
c('Escape で閉じ、フォーカスが「使い方」ボタンに戻る', (await focused()) === '#btn-help' && !(await page.evaluate(() => document.getElementById('help').open)));

// ---------------------------------------------------------------- 8. 画像の編集（キーボードとスポイト）
const pngB64 = await page.evaluate(() => {
  const c = document.createElement('canvas'); c.width = 100; c.height = 60;
  const x = c.getContext('2d');
  x.fillStyle = '#ffffff'; x.fillRect(0, 0, 100, 60);
  x.fillStyle = '#ff0000'; x.fillRect(20, 10, 60, 40);
  return c.toDataURL('image/png').split(',')[1];
});
await page.selectOption('#add-type', 'image');
await page.click('#btn-add');
await page.waitForTimeout(100);
const imgId = await page.evaluate(() => window.__app.project.items.at(-1).id);
await page.setInputFiles(`[data-key="${imgId}:画像:画像ファイル"]`, { name: 'logo.png', mimeType: 'image/png', buffer: Buffer.from(pngB64, 'base64') });
await page.waitForFunction(id => window.__app.project.items.find(i => i.id === id).src && document.querySelector(`[data-key="${id}:original"]`), imgId);
await page.waitForTimeout(200);

const unnamedImg = await page.evaluate(() => {
  const nameOf = el => el.getAttribute('aria-label') || (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent.trim()) || el.closest('label')?.textContent.trim() || (el.textContent || '').trim();
  return [...document.querySelectorAll('#editor input, #editor select, #editor button, #editor [role=img]')]
    .filter(el => el.getClientRects().length > 0 && el.type !== 'file' || el.type === 'file').filter(el => !nameOf(el)).map(el => el.dataset.key || el.tagName);
});
c('画像の編集欄の操作要素にもアクセシブルネームがある', unnamedImg.length === 0, unnamedImg.join(', '));

const rbKey = `${imgId}:背景の透明化:背景を透明にする`;
await page.focus(`[data-key="${rbKey}"]`);
await page.keyboard.press('Space');
await page.waitForTimeout(100);
let st = await page.evaluate(id => window.__app.project.items.find(i => i.id === id).edits.removeBg, imgId);
c('「背景を透明にする」を Space でオン → 背景色を外周から推定し、フォーカスも残る', st.enabled && st.color === '#ffffff' && (await focused()) === rbKey, JSON.stringify(st));

// 置き換えを追加 → スポイトが自動で有効 → 元画像の赤い部分をクリック
await page.click(`[data-key="${imgId}:色の置き換え:追加"]`);
await page.waitForTimeout(100);
const pickKey = `${imgId}:色の置き換え:1:元の色:pick`;
let pressed = await page.getAttribute(`[data-key="${pickKey}"]`, 'aria-pressed');
c('置き換えを追加するとスポイトが有効になり、元画像にフォーカスが移る', pressed === 'true' && (await focused()) === `${imgId}:original`, `pressed=${pressed} focus=${await focused()}`);
const box = await page.locator(`[data-key="${imgId}:original"]`).boundingBox();
await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.5);
await page.waitForTimeout(150);
const from = await page.evaluate(id => window.__app.project.items.find(i => i.id === id).edits.recolors[0].from, imgId);
pressed = await page.getAttribute(`[data-key="${pickKey}"]`, 'aria-pressed');
c('元画像をクリックすると色が入り、スポイトは解除され、ボタンにフォーカスが戻る', from === '#ff0000' && pressed === 'false' && (await focused()) === pickKey, `from=${from} pressed=${pressed} focus=${await focused()}`);

// スポイトを Esc で解除
await page.focus(`[data-key="${pickKey}"]`);
await page.keyboard.press('Enter');
await page.waitForTimeout(100);
pressed = await page.getAttribute(`[data-key="${pickKey}"]`, 'aria-pressed');
await page.keyboard.press('Escape');
await page.waitForTimeout(100);
const pressedAfter = await page.getAttribute(`[data-key="${pickKey}"]`, 'aria-pressed');
c('スポイトは Enter で有効、Esc で解除され、フォーカスがボタンに戻る', pressed === 'true' && pressedAfter === 'false' && (await focused()) === pickKey, `${pressed} → ${pressedAfter} focus=${await focused()}`);

// ---------------------------------------------------------------- 8b. 前照灯・尾灯の編集
await page.selectOption('#add-type', 'lamp');
await page.click('#btn-add');
await page.waitForTimeout(100);
const lampId = await page.evaluate(() => window.__app.project.items.at(-1).id);
const unnamedLamp = await page.evaluate(() => {
  const nameOf = el => el.getAttribute('aria-label') || (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent.trim()) || el.closest('label')?.textContent.trim() || (el.textContent || '').trim();
  return [...document.querySelectorAll('#editor input, #editor select, #editor button')].filter(el => el.getClientRects().length > 0 && !nameOf(el)).map(el => el.dataset.key || el.tagName);
});
c('前照灯の編集欄の操作要素にアクセシブルネームがある', unnamedLamp.length === 0, unnamedLamp.join(', '));
const pairKey = `${lampId}:左右:左右`;
await page.focus(`[data-key="${pairKey}"]`);
await page.selectOption(`[data-key="${pairKey}"]`, 'mirror');
await page.waitForTimeout(100);
let lampSt = await page.evaluate(id => ({ focus: document.activeElement.dataset.key, label: document.querySelector(`[data-key="${id}::組数"]`) ? '組数' : '枚数',
  meta: [...document.querySelectorAll('#item-list li')].at(-1).querySelector('.meta').textContent }), lampId);
c('左右ペアにすると「枚数」が「組数」になり、一覧にも「組」と出て、フォーカスは残る', lampSt.focus === pairKey && lampSt.label === '組数' && /組/.test(lampSt.meta), JSON.stringify(lampSt));
await page.click(`[data-key="${lampId}:ランプ:追加"]`);
await page.waitForTimeout(100);
lampSt = await page.evaluate(id => ({ n: window.__app.project.items.find(i => i.id === id).lamps.length, focus: document.activeElement.dataset.key }), lampId);
c('「ランプを追加」で 3 灯になり、追加したランプの色欄にフォーカスが移る', lampSt.n === 3 && lampSt.focus === `${lampId}:ランプ:3:色`, JSON.stringify(lampSt));
await page.click(`[data-key="${lampId}:ランプ:まとめて:尾灯"]`);
await page.waitForTimeout(100);
lampSt = await page.evaluate(id => window.__app.project.items.find(i => i.id === id).lamps.map(l => l.color), lampId);
c('「色をまとめて: 尾灯」で全ランプが尾灯の色になる', lampSt.every(v => v === '#e4261c'), lampSt.join(','));
await page.click(`[data-key="${lampId}:ランプ:1:ランプ 1 を削除"]`);
await page.waitForTimeout(100);
lampSt = await page.evaluate(id => ({ n: window.__app.project.items.find(i => i.id === id).lamps.length, focus: document.activeElement.dataset.key }), lampId);
c('ランプを削除すると「ランプを追加」にフォーカスが移る', lampSt.n === 2 && lampSt.focus === `${lampId}:ランプ:追加`, JSON.stringify(lampSt));

// ---------------------------------------------------------------- 9. 色補正ダイアログ
await page.addScriptTag({ content: SIM_SRC });
const shot = await page.evaluate(async () => {
  const cal = await import('./js/colorcal.js');
  const ex = await import('./js/export.js');
  const app = window.__app, p = app.project;
  const chart = ex.chartCanvas(p, 150);
  const s = 150 / 25.4, k = p.scaleK / 100, W = p.paper.w, H = p.paper.h;
  const f = cal.chartFrame(app.layout().area);
  const toPx = (u, v) => { const x = (f.x + u * f.w) * s, y = (f.y + v * f.h) * s; return [W * s / 2 + (x - W * s / 2) * k, H * s / 2 + (y - H * s / 2) * k]; };
  const { photo, pts } = window.__sim.shoot(chart, [[0, 0], [1, 0], [1, 1], [0, 1]].map(([u, v]) => toPx(u, v)));
  return { b64: photo.toDataURL('image/png').split(',')[1], w: photo.width, h: photo.height, pts };
});
let ccState = await page.evaluate(() => [document.getElementById('cc-enabled').disabled, document.getElementById('cc-status').textContent]);
c('補正がないうちは「色補正をかける」は押せず、作り方を案内する', ccState[0] === true && ccState[1].includes('まだ補正はありません'), ccState[1]);
await page.focus('#btn-cc-setup');
await page.keyboard.press('Enter');
c('「色見本から補正を作る」でダイアログが開く', await page.evaluate(() => document.getElementById('color-dialog').open));

// --- 目で合わせる（既定）: 合成プリンタの印刷を「見た目どおりに一番近い候補を選ぶ人」を模す
let vs = await page.evaluate(() => ({ visual: !document.getElementById('cc-visual').hidden, photo: !document.getElementById('cc-photo-mode').hidden,
  pressed: document.getElementById('cc-mode-visual').getAttribute('aria-pressed'), n: document.querySelectorAll('#cc-v-grid button').length,
  prog: document.getElementById('cc-v-progress').textContent }));
c('既定は「目で見て合わせる」で、3×3 の候補と何番のマスかが表示される', vs.visual && !vs.photo && vs.pressed === 'true' && vs.n === 9 && /印刷の \d+ 番/.test(vs.prog), JSON.stringify(vs));
const vNames = await page.evaluate(() => [...document.querySelectorAll('#cc-v-grid button')].map(b => b.getAttribute('aria-label')));
c('候補のボタンにはそれぞれ名前（明るい・鮮やか 等）がある', vNames.every(Boolean) && new Set(vNames).size === 9, vNames.join(' / '));
const vStops = await page.evaluate(() => [...document.querySelectorAll('#cc-v-grid button')].filter(b => b.tabIndex === 0).length);
c('候補は Tab 停止 1 つ（矢印キーで移動）', vStops === 1);
// キーボードで候補を移動して選ぶ
await page.locator('#cc-v-grid button[tabindex="0"]').focus();
await page.keyboard.press('ArrowUp');
let fl = await page.evaluate(() => document.activeElement.getAttribute('aria-label'));
c('↑ で上（明るい）の候補に移る', /明るい/.test(fl), fl);
await page.keyboard.press('ArrowDown');
await page.keyboard.press('Enter');     // 真ん中 = いまの色が一番近い → 細かい段階へ
vs = await page.evaluate(() => ({ prog: document.getElementById('cc-v-progress').textContent, focus: document.activeElement.getAttribute('aria-label') }));
c('真ん中を Enter で選ぶと細かい段階に進み、フォーカスは真ん中に残る', /細かさ 2 \/ 3/.test(vs.prog) && /真ん中/.test(vs.focus), JSON.stringify(vs));
await page.click('#btn-cc-v-restart');
// 12 マスを人の代わりに選ぶ（一番近い候補。差がわずかなら真ん中）
const vres = await page.evaluate(async () => {
  const cal = await import('./js/colorcal.js');
  const w = window.__sim.printer([255, 255, 255]);
  const seen = rgb => window.__sim.printer(rgb).map((v, i) => Math.min(255, v * 255 / w[i]));
  const ui = window.__app.colorUI; let clicks = 0;
  while (!ui.state.v.finished && clicks < 400) {
    const st = ui.state.v.st, g = cal.visualGrid(st), goal = seen(st.target);
    let best = 4, bd = cal.deltaE(g[4], goal);
    g.forEach((c, k) => { const d = cal.deltaE(c, goal); if (d < bd - 0.3) { bd = d; best = k; } });
    document.querySelectorAll('#cc-v-grid button')[best].click(); clicks++;
  }
  return { clicks, finished: ui.state.v.finished, res: document.getElementById('cc-result').textContent, use: !document.getElementById('btn-cc-use').hidden,
    sw: document.querySelectorAll('#cc-swatches span').length, focus: document.activeElement.id };
});
const vm = vres.res.match(/ΔE）は\s*([\d.]+)、補正後の推定は\s*([\d.]+)/);
c('12 マスを選び終えると結果が出て、補正でずれが縮む', vres.finished && vm && Number(vm[2]) < Number(vm[1]) * 0.6 && vres.use && vres.sw === 12, `${vres.clicks} 回の選択、${vres.res}`);
c('選び終えると「この補正を使う」にフォーカスが移る', vres.focus === 'btn-cc-use', vres.focus);
await page.click('#btn-cc-v-back');
vs = await page.evaluate(() => ({ prog: document.getElementById('cc-v-progress').textContent, use: document.getElementById('cc-step4').hidden }));
c('「前のマスに戻る」で最後のマスを選び直せる（結果は一度消える）', /12 \/ 12 マス目/.test(vs.prog) && vs.use, JSON.stringify(vs));
await page.click('#btn-cc-v-accept');

// --- 写真・スキャンで読み取る
await page.click('#cc-mode-photo');
vs = await page.evaluate(() => ({ visual: !document.getElementById('cc-visual').hidden, photo: !document.getElementById('cc-photo-mode').hidden, step4: document.getElementById('cc-step4').hidden }));
c('「写真・スキャンで読み取る」に切り替えると写真の手順だけが出る（目で合わせた結果は混ざらない）', !vs.visual && vs.photo && vs.step4, JSON.stringify(vs));
await page.setInputFiles('#cc-photo', { name: 'chart.png', mimeType: 'image/png', buffer: Buffer.from(shot.b64, 'base64') });
await page.waitForFunction(() => !document.getElementById('cc-step3').hidden);
c('写真を取り込むとマーク指定の画面に進み、画像にフォーカスが移る', (await focused()) === '#cc-canvas');

const clickPhoto = async ([x, y]) => {
  const loc = page.locator('#cc-canvas');
  const b = await loc.boundingBox();
  await loc.click({ position: { x: x / shot.w * b.width, y: y / shot.h * b.height } });
};
// わざと 1 と 2 を逆に指定 → 案内が出る
await clickPhoto(shot.pts[1]); await clickPhoto(shot.pts[0]); await clickPhoto(shot.pts[2]); await clickPhoto(shot.pts[3]);
let instr = await page.textContent('#cc-instr');
c('マークの順番を間違えると、正しい順番を案内する', /順番/.test(instr) && await page.evaluate(() => document.getElementById('cc-step4').hidden), instr);
await page.click('#btn-cc-reset');
// 少しずらしてクリック（中心への吸着を確かめる）
for (const [x, y] of shot.pts) await clickPhoto([x + 6, y + 4]);
await page.waitForFunction(() => !document.getElementById('cc-step4').hidden);
const res = await page.textContent('#cc-result');
const m = res.match(/ΔE）は\s*([\d.]+)、補正後の推定は\s*([\d.]+)/);
c('4 点を指定すると結果が出て、補正でずれが縮む', m && Number(m[2]) < Number(m[1]) * 0.5, res);

// キーボード: 1 で点を選び、矢印で動かす
await page.focus('#cc-canvas');
const before1 = await page.evaluate(() => window.__app.colorUI.state.pts[0].slice());
await page.keyboard.press('1');
await page.keyboard.press('Shift+ArrowRight');
const after1 = await page.evaluate(() => window.__app.colorUI.state.pts[0].slice());
c('キーボード: 1 で点を選び、Shift+→ で大きく動かせる', after1[0] - before1[0] > 5 && Math.abs(after1[1] - before1[1]) < 0.01, `${before1.map(v => v.toFixed(1))} → ${after1.map(v => v.toFixed(1))}`);
await page.keyboard.press('Enter');   // マークに合わせ直す
const snapped = await page.evaluate(() => window.__app.colorUI.state.pts[0].slice());
c('キーボード: Enter で近くのマークの中心に合わせ直す', Math.hypot(snapped[0] - shot.pts[0][0], snapped[1] - shot.pts[0][1]) < 3, snapped.map(v => v.toFixed(1)).join(','));

await page.click('#btn-cc-use');
await page.waitForTimeout(100);
ccState = await page.evaluate(() => ({ open: document.getElementById('color-dialog').open, en: window.__app.project.colorCorr.enabled, prof: !!window.__app.project.colorCorr.profile,
  checked: document.getElementById('cc-enabled').checked, status: document.getElementById('cc-status').textContent }));
c('「この補正を使う」で補正が有効になり、ダイアログが閉じ、状態が表示される', !ccState.open && ccState.en && ccState.prof && ccState.checked && /ΔE/.test(ccState.status), JSON.stringify(ccState));
c('ダイアログを閉じるとフォーカスが「色見本から補正を作る」に戻る', (await focused()) === '#btn-cc-setup');
await page.focus('#cc-enabled');
await page.keyboard.press('Space');
await page.waitForTimeout(50);
c('「書き出しに色補正をかける」を Space でオフにでき、フォーカスが残る', !(await page.evaluate(() => window.__app.project.colorCorr.enabled)) && (await focused()) === '#cc-enabled');

// ---------------------------------------------------------------- 10. モバイル幅: 編集 / プレビュー切替
await page.setViewportSize({ width: 400, height: 800 });
await page.waitForTimeout(100);
const vis = () => page.evaluate(() => ({
  panel: document.querySelector('.panel').getClientRects().length > 0,
  preview: document.querySelector('.preview').getClientRects().length > 0,
  bar: document.querySelector('.view-switch').getClientRects().length > 0,
  pressed: document.getElementById('view-preview').getAttribute('aria-pressed'),
  scrollW: document.documentElement.scrollWidth <= window.innerWidth,
}));
let v = await vis();
c('モバイル幅では切替バーが出て、初期状態はプレビュー非表示', v.bar && v.panel && !v.preview && v.pressed === 'false', JSON.stringify(v));
c('モバイル幅で横スクロールが出ない', v.scrollW);
await page.click('#view-preview');
await page.waitForTimeout(100);
v = await vis();
const canvasDrawn = await page.evaluate(() => document.getElementById('preview').width > 0 && document.getElementById('preview').getBoundingClientRect().width > 100);
c('「プレビュー」でプレビューだけが表示され、キャンバスが描画される', !v.panel && v.preview && v.pressed === 'true' && canvasDrawn, JSON.stringify(v));
await page.focus('#view-preview');
await page.keyboard.press('ArrowLeft');
await page.waitForTimeout(50);
v = await vis();
c('← キーで「編集」に戻り、フォーカスも移る', v.panel && !v.preview && (await focused()) === '#view-edit', JSON.stringify(v));
await page.reload();
await page.waitForFunction(() => window.__app && document.querySelectorAll('#item-list li').length > 0);
await page.click('#view-preview');
await page.reload();
await page.waitForFunction(() => window.__app && document.querySelectorAll('#item-list li').length > 0);
v = await vis();
c('選んだ表示が再読み込み後も保持される', v.preview && !v.panel, JSON.stringify(v));
await page.setViewportSize({ width: 1400, height: 900 });
await page.waitForTimeout(100);
v = await vis();
c('デスクトップ幅に戻すと両方表示され、切替バーは消える', v.panel && v.preview && !v.bar, JSON.stringify(v));

c('エラーなし', errors.length === 0, errors.join(' | '));
await close();
process.exit(checker.failed ? 1 : 0);
