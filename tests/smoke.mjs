// スモークテスト: 画面が動くこと、書き出し PNG のピクセル数が用紙×dpi と一致すること
import { openApp, makeChecker } from './helpers.mjs';
import { SIM_SRC } from './colorsim.mjs';

const { page, errors, close } = await openApp();

const checker = makeChecker();
const c = checker.check;

// L判 300dpi の書き出しサイズ・既定補正
let dims = await page.evaluate(() => { const cv = window.__app.exportCanvas(); return [cv.width, cv.height, window.__app.project.scaleK]; });
c('L判 300dpi は 1051×1500 px, 補正103.6%', dims[0] === 1051 && dims[1] === 1500 && dims[2] === 103.6, dims.join('×'));

// プリセットを全部追加して配置・描画できる
// プリセットの選択画面から、すべてのプリセットを 1 つずつ追加する
await page.click('#btn-preset');
const presetIds = await page.evaluate(() => [...document.querySelectorAll('#preset-list .preset-card')].map(b => b.dataset.preset));
await page.keyboard.press('Escape');
for (const id of presetIds) {
  await page.click('#btn-preset');
  await page.click(`.preset-card[data-preset="${id}"]`);
}
await page.waitForTimeout(100);
const presetCount = presetIds.length;
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

// 補正は用紙×印刷方法ごとに記憶され、切り替えて戻しても保持される
await page.selectOption('#print-mode', 'cvs-borderless');
let kb = await page.evaluate(() => window.__app.project.scaleK);
c('フチなしに切り替えると既定 96%', kb === 96, String(kb));
await page.selectOption('#print-mode', 'cvs-border');
kb = await page.evaluate(() => window.__app.project.scaleK);
c('フチありに戻すと実測から求めた 108% が保持される', kb === 108, String(kb));

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

// 画像の簡易編集: 白地に赤い四角、その中に白い穴、右下に青い点のテスト画像
const imgRes = await page.evaluate(async () => {
  const ie = await import('./js/imageedit.js');
  const mk = () => {
    const c = document.createElement('canvas'); c.width = 100; c.height = 60;
    const x = c.getContext('2d');
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, 100, 60);
    x.fillStyle = '#ff0000'; x.fillRect(20, 10, 60, 40);
    x.fillStyle = '#ffffff'; x.fillRect(40, 25, 20, 10);     // 赤の内側の白（外周とつながっていない）
    x.fillStyle = '#0000ff'; x.fillRect(70, 40, 6, 6);
    return c;
  };
  const px = (c, X, Y) => [...c.getContext('2d').getImageData(X, Y, 1, 1).data];
  const src = mk();
  // 背景が透明でロゴが外周に触れている画像（受け取った SR ロゴと同じ状況）
  const tp = document.createElement('canvas'); tp.width = 100; tp.height = 60;
  const tx = tp.getContext('2d'); tx.fillStyle = '#3b4890'; tx.fillRect(0, 20, 40, 40);
  const transparentBg = ie.detectBorderColor(tx.getImageData(0, 0, 100, 60));
  const bg = ie.detectBorderColor(src.getContext('2d').getImageData(0, 0, 100, 60));
  const edge = ie.applyEdits(src, { ...ie.defaultEdits(), removeBg: { enabled: true, color: '#ffffff', tolerance: 10, mode: 'edge', feather: 0 } });
  const all = ie.applyEdits(src, { ...ie.defaultEdits(), removeBg: { enabled: true, color: '#ffffff', tolerance: 10, mode: 'all', feather: 0 } });
  const rec = ie.applyEdits(src, { ...ie.defaultEdits(), recolors: [{ from: '#ff0000', to: '#00ff00', tolerance: 20 }] });
  const mono = ie.applyEdits(src, { ...ie.defaultEdits(), removeBg: { enabled: true, color: '#ffffff', tolerance: 10, mode: 'edge', feather: 0 }, mono: { enabled: true, color: '#000000' } });
  const trim = ie.applyEdits(src, { ...ie.defaultEdits(), removeBg: { enabled: true, color: '#ffffff', tolerance: 10, mode: 'edge', feather: 0 }, trim: true });
  // 書き出しにも反映されるか（背景を透明にした画像を、マゼンタ地の画像シールに置く）
  const app = window.__app, p = app.project, saved = JSON.stringify(p);
  p.items = [{ id: 'im', type: 'image', w: 20, h: 12, copies: 1, fit: 'contain', src: src.toDataURL('image/png'),
    bg: '#ff00ff', fill: { mode: 'solid', bands: [{ weight: 1, color: '#ff00ff' }] },
    edits: { ...ie.defaultEdits(), removeBg: { enabled: true, color: '#ffffff', tolerance: 10, mode: 'edge', feather: 0 } } }];
  p.marks = 'none'; p.bleed = 0; p.ruler = false; p.scaleK = 100; p.dpi = 300;
  app.update(); app.flush();
  await new Promise(r => setTimeout(r, 300));
  const l = app.layout(), q = l.placed[0], s = 300 / 25.4;
  const ex = app.exportCanvas();
  const at = (mx, my) => [...ex.getContext('2d').getImageData(Math.round((q.x + mx) * s), Math.round((q.y + my) * s), 1, 1).data].slice(0, 3);
  const exportCorner = at(1, 1), exportRed = at(6, 4);
  app.project = JSON.parse(saved);
  return {
    transparentBg, bg, edgeCorner: px(edge, 2, 2)[3], edgeHole: px(edge, 50, 30)[3], edgeRed: px(edge, 30, 15),
    allHole: px(all, 50, 30)[3], recRed: px(rec, 30, 15), recBlue: px(rec, 72, 42), recWhite: px(rec, 2, 2),
    monoRed: px(mono, 30, 15), monoBlue: px(mono, 72, 42), trimSize: [trim.width, trim.height], exportCorner, exportRed,
  };
});
c('外周の色から背景色を推定', imgRes.bg === '#ffffff', imgRes.bg);
c('背景がすでに透明な画像では推定しない（ロゴの色を背景と誤認しない）', imgRes.transparentBg === null, String(imgRes.transparentBg));
c('背景の透明化（外周から）: 外側は透明、内側の白は残る', imgRes.edgeCorner === 0 && imgRes.edgeHole === 255 && imgRes.edgeRed[3] === 255, JSON.stringify(imgRes));
c('背景の透明化（全体）: 内側の白も透明', imgRes.allHole === 0);
c('色の置き換え: 赤だけが緑になり、青と白はそのまま', imgRes.recRed[1] > 240 && imgRes.recRed[0] < 15 && imgRes.recBlue[2] > 240 && imgRes.recWhite[0] > 240, JSON.stringify([imgRes.recRed, imgRes.recBlue, imgRes.recWhite]));
c('単色化: 不透明な部分がすべて黒', imgRes.monoRed.slice(0, 3).every(v => v < 5) && imgRes.monoBlue.slice(0, 3).every(v => v < 5));
c('余白の切り詰め: 赤い四角の大きさになる', imgRes.trimSize[0] === 60 && imgRes.trimSize[1] === 40, imgRes.trimSize.join('x'));
c('書き出し: 透明にした部分にシールの地色が出て、ロゴは残る', imgRes.exportCorner[0] > 240 && imgRes.exportCorner[1] < 15 && imgRes.exportCorner[2] > 240 && imgRes.exportRed[0] > 240 && imgRes.exportRed[1] < 15, JSON.stringify([imgRes.exportCorner, imgRes.exportRed]));

// 色補正: 色見本を「印刷 → 撮影」した写真から補正を作り、ずれが縮むか
await page.addScriptTag({ content: SIM_SRC });
const cc = await page.evaluate(async () => {
  const cal = await import('./js/colorcal.js');
  const ex = await import('./js/export.js');
  const app = window.__app, p = app.project;
  const chart = ex.chartCanvas(p, 150);
  // マーク中心（色見本キャンバスの px）
  const s = 150 / 25.4, k = p.scaleK / 100, W = p.paper.w, H = p.paper.h;
  const area = app.layout().area, f = cal.chartFrame(area);
  const toPx = (u, v) => { const x = (f.x + u * f.w) * s, y = (f.y + v * f.h) * s; return [W * s / 2 + (x - W * s / 2) * k, H * s / 2 + (y - H * s / 2) * k]; };
  const markers = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([u, v]) => toPx(u, v));
  const { photo, pts } = window.__sim.shoot(chart, markers);
  const img = photo.getContext('2d').getImageData(0, 0, photo.width, photo.height);
  // クリックが少しずれても、マークの中心に寄せられるか
  const off = pts.map(([x, y]) => cal.snapToMarker(img, x + 7, y - 5, Math.hypot(photo.width, photo.height) * 0.03));
  const snapErr = Math.max(...off.map((q, i) => Math.hypot(q[0] - pts[i][0], q[1] - pts[i][1])));
  const prof = cal.fitProfile(cal.samplePatches(img, off));
  // 評価: 補正前後で「印刷して見える色」（紙の白で正規化）と意図した色の差
  const seen = rgb => { const w = window.__sim.printer([255, 255, 255]); return window.__sim.printer(rgb).map((v, i) => Math.min(255, v * 255 / w[i])); };
  const test = [[200, 60, 40], [40, 120, 200], [90, 160, 70], [128, 128, 128], [230, 200, 120], [60, 60, 90], [255, 154, 0], [47, 79, 208]];
  const before = test.reduce((a, c) => a + cal.deltaE(c, seen(c)), 0) / test.length;
  const after = test.reduce((a, c) => a + cal.deltaE(c, seen(cal.correctColor(prof, c, 1))), 0) / test.length;
  // 純白は変えない・書き出しに反映される
  const white = cal.correctColor(prof, [255, 255, 255], 1);
  const saved = JSON.stringify(p);
  p.colorCorr = { enabled: true, strength: 100, preview: false, profile: prof };
  p.items = [{ id: 'cc', type: 'text', w: 20, h: 8, copies: 1, text: '', font: 'Noto Sans JP', weight: 700, padding: 0,
    bg: '#c8102e', fill: { mode: 'solid', bands: [{ weight: 1, color: '#c8102e' }] } }];
  p.marks = 'none'; p.ruler = false; p.dpi = 300; app.update(); app.flush();
  const l = app.layout(), q = l.placed[0], S = 300 / 25.4;
  const pick = c => [...c.getContext('2d').getImageData(Math.round((q.x + 10) * S), Math.round((q.y + 4) * S), 1, 1).data].slice(0, 3);
  const corr = pick(app.exportCanvas()), raw = pick(app.exportCanvas({ correct: false }));
  const paperCorner = [...app.exportCanvas().getContext('2d').getImageData(2, 2, 1, 1).data].slice(0, 3);
  app.project = JSON.parse(saved);
  return { snapErr, before, after, fitBefore: prof.before, fitAfter: prof.after, white, corr, raw, paperCorner };
});
// 目で合わせる: 12 マスについて、印刷の見た目に一番近い候補を選び続けた場合
const vis = await page.evaluate(async () => {
  const cal = await import('./js/colorcal.js');
  const w = window.__sim.printer([255, 255, 255]);
  const seen = rgb => window.__sim.printer(rgb).map((v, i) => Math.min(255, v * 255 / w[i]));
  const picks = {}; let clicks = 0;
  for (const idx of cal.VISUAL_PATCHES) {
    let st = cal.visualStart(idx); const goal = seen(st.target);
    while (!st.done) {
      const g = cal.visualGrid(st); let best = 4, bd = cal.deltaE(g[4], goal);
      g.forEach((c, k) => { const d = cal.deltaE(c, goal); if (d < bd - 0.3) { bd = d; best = k; } });
      st = cal.visualPick(st, best); clicks++;
    }
    picks[idx] = st.center;
  }
  const prof = cal.fitProfile(cal.visualSamples(picks), { method: 'visual' });
  const test = [[200, 60, 40], [40, 120, 200], [90, 160, 70], [128, 128, 128], [230, 200, 120], [60, 60, 90], [255, 154, 0], [47, 79, 208]];
  const before = test.reduce((a, c) => a + cal.deltaE(c, seen(c)), 0) / test.length;
  const after = test.reduce((a, c) => a + cal.deltaE(c, seen(cal.correctColor(prof, c, 1))), 0) / test.length;
  const nums = cal.VISUAL_PATCHES.map(i => i + 1);
  return { clicks, before, after, nums };
});
c('目で合わせる: 12 マスを選ぶだけで印刷のずれが半分以下になる', vis.after < vis.before * 0.5, `${vis.before.toFixed(1)} → ${vis.after.toFixed(1)}、選択 ${vis.clicks} 回、マス ${vis.nums.join(',')}`);

c('色見本: マークのクリックが少しずれても中心に合わせる', cc.snapErr < 2.5, `ずれ ${cc.snapErr.toFixed(2)} px`);
c('色補正: 印刷のずれが大きく縮む（平均 ΔE）', cc.after < cc.before * 0.4, `${cc.before.toFixed(1)} → ${cc.after.toFixed(1)}（読み取り時の推定 ${cc.fitBefore} → ${cc.fitAfter}）`);
c('色補正: 純白（紙の色）は変えない', cc.white.every(v => v >= 254.5), JSON.stringify(cc.white));
c('色補正: 書き出しにかかり、補正なしの書き出しとは色が変わる', cc.corr.some((v, i) => Math.abs(v - cc.raw[i]) > 8) && cc.paperCorner.every(v => v === 255), JSON.stringify(cc));

// 前照灯・尾灯: 左右ペアは 1 組で 2 枚、2 枚目は鏡写し（尾灯と前照灯の位置が入れ替わる）
const lamp = await page.evaluate(async () => {
  const app = window.__app, p = app.project, saved = JSON.stringify(p);
  const { makeItem, PRESETS, sheetCount } = await import('./js/model.js');
  const preset = id => PRESETS.find(x => x.id === id).item;
  p.items = [makeItem('lamp', { ...preset('lamp-head-tail-row'), copies: 2 }), makeItem('lamp', preset('lamp-round2'))];
  p.marks = 'none'; p.ruler = false; p.scaleK = 100; p.dpi = 600; app.update(); app.flush();
  const l = app.layout(), S = 600 / 25.4, c = app.exportCanvas(), ctx = c.getContext('2d');
  const at = (q, fx) => [...ctx.getImageData(Math.round((q.x + q.w * fx) * S), Math.round((q.y + q.h / 2) * S), 1, 1).data].slice(0, 3);
  const pairs = l.placed.filter(q => q.item.pair === 'mirror');
  const res = {
    placed: l.placed.length, mirrored: l.placed.filter(q => q.mirror).length, count: sheetCount(p.items[0]),
    firstLeft: at(pairs[0], 0.28), firstRight: at(pairs[0], 0.72), secondLeft: at(pairs[1], 0.28), secondRight: at(pairs[1], 0.72),
    roundGap: at(l.placed.find(q => q.item.pair !== 'mirror'), 0.5),
    names: (await import('./js/model.js')).PRESETS.filter(x => x.id.startsWith('lamp-')).length,
  };
  app.project = JSON.parse(saved);
  return res;
});
// 「光って見える」は中心を白く飛ばすので、中心では赤みの強さ（R − G）で尾灯を見分ける
const red = c => c[0] - c[1] > 40, light = c => c.every(v => v > 200) && c[0] - c[1] < 20;
c('前照灯・尾灯: 左右ペア 2 組で 4 枚並び、半分が鏡写し', lamp.placed === 5 && lamp.mirrored === 2 && lamp.count === 4, JSON.stringify({ placed: lamp.placed, mirrored: lamp.mirrored, count: lamp.count }));
c('前照灯・尾灯: 1 枚目は左が尾灯・右が前照灯、鏡写しの 2 枚目は逆になる', red(lamp.firstLeft) && light(lamp.firstRight) && light(lamp.secondLeft) && red(lamp.secondRight), JSON.stringify(lamp));
c('前照灯: 丸目 2 灯のランプの間はケースの色（黒）', lamp.roundGap.every(v => v < 40), JSON.stringify(lamp.roundGap));
const cats = await page.evaluate(async () => {
  const { PRESETS, PRESET_CATEGORIES } = await import('./js/model.js');
  const ids = new Set(PRESET_CATEGORIES.map(c => c.id));
  return { total: PRESETS.length, lamp: PRESETS.filter(p => p.id.startsWith('lamp-')).length, uncategorized: PRESETS.filter(p => !ids.has(p.category)).map(p => p.id),
    shown: document.querySelectorAll('#preset-list .preset-card').length, sections: document.querySelectorAll('#preset-list .preset-cat').length };
});
c('すべてのプリセットにカテゴリがあり、選択画面に全部並ぶ', cats.uncategorized.length === 0 && cats.shown === cats.total && cats.sections === 6 && cats.lamp >= 17, JSON.stringify(cats));

// 段・見た目: 「2 灯の下に尾灯ライン」（上段に白と黄、下段に赤いライン）、LED の粒、消灯
const rows = await page.evaluate(async () => {
  const app = window.__app, p = app.project, saved = JSON.stringify(p);
  const { makeItem, PRESETS } = await import('./js/model.js');
  const P = id => PRESETS.find(x => x.id === id).item;
  p.items = [makeItem('lamp', { ...P('lamp-2-over-tailline'), pair: 'single' }), makeItem('lamp', P('lamp-led-dots2')),
    makeItem('lamp', P('lamp-tail2')), makeItem('lamp', P('lamp-tail2-off'))];
  p.marks = 'none'; p.ruler = false; p.scaleK = 100; p.dpi = 600; app.update(); app.flush();
  const l = app.layout(), S = 600 / 25.4, ctx = app.exportCanvas().getContext('2d');
  const at = (q, mx, my) => [...ctx.getImageData(Math.round((q.x + mx) * S), Math.round((q.y + my) * S), 1, 1).data].slice(0, 3);
  const [hc, dots, lit, off] = l.placed;
  // LED の粒: 左のランプの範囲で明るさのばらつき（粒と隙間）があるか
  const lum = []; for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) { const c = at(dots, 1.1 + i * 0.07, 1.05 + j * 0.07); lum.push(0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]); }
  const res = { hcWhite: at(hc, 1.95, 1.35), hcAmber: at(hc, 4.85, 1.35), hcTail: at(hc, 3.25, 2.69), hcGap: at(hc, 3.25, 2.25),
    dotsSpread: Math.max(...lum) - Math.min(...lum), litTail: at(lit, 1.25, 1.25), offTail: at(off, 1.25, 1.25) };
  app.project = JSON.parse(saved);
  return res;
});
c('2 段: 上段に白と黄色の前照灯、下段に赤い尾灯ライン、段の間はケースの色', rows.hcWhite.every(v => v > 200) && rows.hcAmber[0] > 200 && rows.hcAmber[1] > 140 && rows.hcAmber[2] < 140 && rows.hcTail[0] - rows.hcTail[1] > 60 && rows.hcGap.every(v => v < 60), JSON.stringify(rows));
c('LED の粒: ランプの中に明るい粒と暗い隙間がある', rows.dotsSpread > 100, rows.dotsSpread.toFixed(0));
c('消灯: 点灯より暗い赤になる', rows.offTail[0] < rows.litTail[0] - 60 && rows.offTail[0] > rows.offTail[1], JSON.stringify([rows.litTail, rows.offTail]));

// ケースの形と回転: シール内の決まった位置が「背景（白）」か「ケース（黒）」か
const shp = await page.evaluate(async () => {
  const app = window.__app, p = app.project, saved = JSON.stringify(p);
  const { makeItem, PRESETS } = await import('./js/model.js');
  const P = id => PRESETS.find(x => x.id === id).item;
  p.items = [
    makeItem('lamp', P('lamp-trapezoid')),                                  // 7×3、上辺 72%
    makeItem('lamp', { ...P('lamp-led-slanted'), pair: 'single' }),         // 7×2、平行四辺形 25°
    makeItem('lamp', { ...P('lamp-round2'), rotate: 30 }),                  // 6×3 を 30° 回転
  ];
  p.marks = 'none'; p.ruler = false; p.scaleK = 100; p.dpi = 600; app.update(); app.flush();
  const l = app.layout(), S = 600 / 25.4, ctx = app.exportCanvas().getContext('2d');
  const at = (q, mx, my) => { const d = ctx.getImageData(Math.round((q.x + mx) * S), Math.round((q.y + my) * S), 1, 1).data; return d[0] > 200 ? 'white' : d[0] < 60 ? 'dark' : 'mid'; };
  const [t, pg, r] = l.placed;
  const res = {
    trapTopLeft: at(t, 0.35, 0.3), trapBottomLeft: at(t, 0.6, 2.7), trapTopMid: at(t, 3.5, 0.3),
    paraTopLeft: at(pg, 0.3, 0.25), paraTopRight: at(pg, 6.1, 0.25), paraBottomLeft: at(pg, 0.9, 1.75), paraBottomRight: at(pg, 6.7, 1.75),
    rotCorners: [at(r, 0.15, 0.15), at(r, 5.85, 0.15), at(r, 0.15, 2.85), at(r, 5.85, 2.85)], rotCenter: at(r, 3, 1.5),
  };
  app.project = JSON.parse(saved);
  return res;
});
c('台形: 上の角は背景、下の角と上辺の中央はケース', shp.trapTopLeft === 'white' && shp.trapBottomLeft === 'dark' && shp.trapTopMid === 'dark', JSON.stringify(shp));
c('平行四辺形: 右に傾く（左上と右下は背景、右上と左下はケース）', shp.paraTopLeft === 'white' && shp.paraBottomRight === 'white' && shp.paraTopRight === 'dark' && shp.paraBottomLeft === 'dark', JSON.stringify(shp));
c('回転: 30° 回してもシールの 4 隅からはみ出さず、中央はケース', shp.rotCorners.every(v => v === 'white') && shp.rotCenter === 'dark', JSON.stringify(shp));

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
