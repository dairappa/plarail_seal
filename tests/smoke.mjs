// Playwright によるスモークテスト: 画面が動くこと、書き出し PNG のピクセル数が用紙×dpi と一致すること
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  const p = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  try {
    const body = await readFile(join(root, p));
    res.writeHead(200, { 'content-type': types[extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, r));
const url = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });

let failed = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`); if (!ok) failed++; };

await page.goto(url);
await page.waitForFunction(() => window.__app && document.querySelectorAll('#item-list li').length > 0);

// L判 300dpi の書き出しサイズ
let dims = await page.evaluate(() => { const c = window.__app.exportCanvas(); return [c.width, c.height]; });
check('L判 300dpi は 1051×1500 px', dims[0] === 1051 && dims[1] === 1500, dims.join('×'));

// プリセットを全部追加して配置・描画できる
const presetCount = await page.evaluate(() => document.querySelectorAll('#add-preset option').length - 1);
for (let i = 1; i <= presetCount; i++) {
  await page.selectOption('#add-preset', { index: i });
}
const n = await page.evaluate(() => window.__app.project.items.length);
check('プリセット追加', n === presetCount + 1, `items=${n}`);
const lay = await page.evaluate(() => { const l = window.__app.layout(); return { placed: l.placed.length, overflow: l.overflow, ruler: !!l.ruler }; });
check('配置される', lay.placed > 0 && lay.overflow === 0, JSON.stringify(lay));

// 配置が有効領域内に収まる（塗り足し・トンボ含む）
const inside = await page.evaluate(() => {
  const p = window.__app.project, l = window.__app.layout();
  const pad = (p.bleed || 0) + (p.marks === 'corner' ? 1.8 : 0);
  return l.placed.every(q => q.x - pad >= l.area.x - 1e-6 && q.y - pad >= l.area.y - 1e-6 && q.x + q.w + pad <= l.area.x + l.area.w + 1e-6 && q.y + q.h + pad <= l.area.y + l.area.h + 1e-6);
});
check('配置が領域内', inside);

// 2L 600dpi
await page.selectOption('#paper-preset', '2L');
await page.selectOption('#dpi', '600');
dims = await page.evaluate(() => { const c = window.__app.exportCanvas(); return [c.width, c.height, window.__app.project.scaleK]; });
check('2L 600dpi は 3000×4205 px, 補正104%', dims[0] === 3000 && dims[1] === 4205 && dims[2] === 104, dims.join('×'));

// A4 は家庭用に切り替わり補正 100%
await page.selectOption('#paper-preset', 'A4');
const a4 = await page.evaluate(() => [window.__app.project.printMode, window.__app.project.scaleK]);
check('A4 → 家庭用 / 100%', a4[0] === 'home' && a4[1] === 100, a4.join(','));

// キャリブレーション: 50mm が 46.3mm で印刷された → 補正 108%
await page.selectOption('#paper-preset', 'L');
await page.evaluate(() => { window.__app.project.scaleK = 100; window.__app.update(); });
await page.click('.calib summary');
await page.fill('#calib-measured', '46.3');
await page.click('#btn-calib');
const k = await page.evaluate(() => window.__app.project.scaleK);
check('キャリブレーション 50/46.3 → 108%', k === 108, String(k));

// 書き出し画像の中央付近に黒い LED 背景があること（描画されている）
const hasInk = await page.evaluate(async () => {
  await window.__app.ensureFonts();
  const c = window.__app.exportCanvas();
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let dark = 0;
  for (let i = 0; i < d.length; i += 4 * 97) if (d[i] < 40 && d[i + 1] < 40 && d[i + 2] < 40) dark++;
  return dark > 50;
});
check('書き出し画像に描画がある', hasInk);

// localStorage 保存 → 再読み込みで復元
await page.waitForTimeout(500);
await page.reload();
await page.waitForFunction(() => window.__app);
const restored = await page.evaluate(() => window.__app.project.items.length);
check('自動保存の復元', restored === n, `items=${restored}`);

await page.screenshot({ path: process.env.SHOT || '/tmp/plarail_seal.png', fullPage: false });
check('エラーなし', errors.length === 0, errors.join(' | '));

await browser.close();
server.close();
process.exit(failed ? 1 : 0);
