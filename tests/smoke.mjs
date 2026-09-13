// スモークテスト: 画面が動くこと、書き出し PNG のピクセル数が用紙×dpi と一致すること
import { openApp, makeChecker } from './helpers.mjs';

const { page, errors, close } = await openApp();

const checker = makeChecker();
const c = checker.check;

// L判 300dpi の書き出しサイズ・既定補正
let dims = await page.evaluate(() => { const cv = window.__app.exportCanvas(); return [cv.width, cv.height, window.__app.project.scaleK]; });
c('L判 300dpi は 1051×1500 px, 補正103.6%', dims[0] === 1051 && dims[1] === 1500 && dims[2] === 103.6, dims.join('×'));

// プリセットを全部追加して配置・描画できる
const presetCount = await page.evaluate(() => document.querySelectorAll('#add-preset option').length - 1);
for (let i = 1; i <= presetCount; i++) await page.selectOption('#add-preset', { index: i });
const n = await page.evaluate(() => window.__app.project.items.length);
c('プリセット追加', n === presetCount + 1, `items=${n}`);
const lay = await page.evaluate(() => { const l = window.__app.layout(); return { placed: l.placed.length, overflow: l.overflow, ruler: !!l.ruler }; });
c('配置される', lay.placed > 0 && lay.overflow === 0, JSON.stringify(lay));

// 配置が有効領域内に収まる（塗り足し・トンボ含む）
const inside = await page.evaluate(() => {
  const p = window.__app.project, l = window.__app.layout();
  const pad = (p.bleed || 0) + (p.marks === 'corner' ? 1.8 : 0);
  return l.placed.every(q => q.x - pad >= l.area.x - 1e-6 && q.y - pad >= l.area.y - 1e-6 && q.x + q.w + pad <= l.area.x + l.area.w + 1e-6 && q.y + q.h + pad <= l.area.y + l.area.h + 1e-6);
});
c('配置が領域内', inside);

// 2L 600dpi
await page.selectOption('#paper-preset', '2L');
await page.selectOption('#dpi', '600');
dims = await page.evaluate(() => { const cv = window.__app.exportCanvas(); return [cv.width, cv.height, window.__app.project.scaleK]; });
c('2L 600dpi は 3000×4205 px, 補正104%', dims[0] === 3000 && dims[1] === 4205 && dims[2] === 104, dims.join('×'));

// A4 は家庭用に切り替わり補正 100%
await page.selectOption('#paper-preset', 'A4');
const a4 = await page.evaluate(() => [window.__app.project.printMode, window.__app.project.scaleK]);
c('A4 → 家庭用 / 100%', a4[0] === 'home' && a4[1] === 100, a4.join(','));

// キャリブレーション: 50mm が 46.3mm で印刷された → 補正 108%
await page.selectOption('#paper-preset', 'L');
await page.evaluate(() => { window.__app.project.scaleK = 100; window.__app.update(); window.__app.flush(); });
await page.click('.calib summary');
await page.fill('#calib-measured', '46.3');
await page.click('#btn-calib');
const k = await page.evaluate(() => window.__app.project.scaleK);
c('キャリブレーション 50/46.3 → 108%', k === 108, String(k));

// 書き出し画像に描画がある
const hasInk = await page.evaluate(async () => {
  await window.__app.ensureFonts();
  const cv = window.__app.exportCanvas();
  const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
  let dark = 0;
  for (let i = 0; i < d.length; i += 4 * 97) if (d[i] < 40 && d[i + 1] < 40 && d[i + 2] < 40) dark++;
  return dark > 50;
});
c('書き出し画像に描画がある', hasInk);

// ストライプ / グラデーション背景が書き出しに反映される
const stripe = await page.evaluate(async () => {
  const app = window.__app;
  const p = app.project;
  const saved = JSON.stringify(p);
  p.items = [{
    id: 't1', type: 'sign', w: 30, h: 6, copies: 1, font: 'Noto Sans JP', weight: 700, padding: 0,
    bg: '#ff0000', fill: { mode: 'cols', bands: [{ weight: 1, color: '#ff0000' }, { weight: 1, color: '#ffffff' }, { weight: 2, color: '#0000ff' }] },
    kind: { enabled: false }, dest: { enabled: false }, station: { enabled: false },
  }, {
    id: 't2', type: 'text', w: 30, h: 6, copies: 1, text: '', font: 'Noto Sans JP', weight: 700, padding: 0,
    bg: '#000000', fill: { mode: 'solid', bands: [{ weight: 1, color: '#000000', grad: true, color2: '#ffffff', gradDir: 'v' }] },
  }];
  p.marks = 'none'; p.bleed = 0; p.ruler = false; p.scaleK = 100; p.dpi = 300;
  app.update(); app.flush();
  const s = 300 / 25.4;
  const l = app.layout();
  const c = app.exportCanvas();
  const ctx = c.getContext('2d');
  const px = (x, y) => [...ctx.getImageData(Math.round(x * s), Math.round(y * s), 1, 1).data].slice(0, 3);
  const a = l.placed[0], b = l.placed[1];
  const res = {
    band1: px(a.x + 30 * (0.25 / 2), a.y + 3),           // 幅 1/4 の赤
    band2: px(a.x + 30 * (0.25 + 0.125), a.y + 3),       // 次の 1/4 の白
    band3: px(a.x + 30 * 0.75, a.y + 3),                 // 残り 1/2 の青
    gradTop: px(b.x + 15, b.y + 0.3), gradBottom: px(b.x + 15, b.y + 5.7),
  };
  app.project = JSON.parse(saved);
  return res;
});
const near = (c, t) => c.every((v, i) => Math.abs(v - t[i]) <= 3);
c('縦縞 3 帯（1:1:2）の色が正しい位置に出る', near(stripe.band1, [255, 0, 0]) && near(stripe.band2, [255, 255, 255]) && near(stripe.band3, [0, 0, 255]), JSON.stringify([stripe.band1, stripe.band2, stripe.band3]));
c('上→下グラデーションが暗→明になる', stripe.gradTop[0] < 40 && stripe.gradBottom[0] > 215, JSON.stringify([stripe.gradTop, stripe.gradBottom]));

// localStorage 保存 → 再読み込みで復元
await page.waitForTimeout(500);
await page.reload();
await page.waitForFunction(() => window.__app && document.querySelectorAll('#item-list li').length > 0);
const restored = await page.evaluate(() => window.__app.project.items.length);
c('自動保存の復元', restored === n, `items=${restored}`);

await page.screenshot({ path: process.env.SHOT || '/tmp/plarail_seal.png' });
c('エラーなし', errors.length === 0, errors.join(' | '));

await close();
process.exit(checker.failed ? 1 : 0);
