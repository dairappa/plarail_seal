// アクセシビリティテスト: キーボード操作（タブ順・フォーカス維持・一覧のキー操作）とアクセシブルネーム
import { openApp, makeChecker } from './helpers.mjs';

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

c('エラーなし', errors.length === 0, errors.join(' | '));
await close();
process.exit(checker.failed ? 1 : 0);
