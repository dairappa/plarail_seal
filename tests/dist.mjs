// 配信物（dist/）の検証: ビルドスクリプトでバージョンが付き、そのまま動くこと
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { makeChecker } from './helpers.mjs';

const root = new URL('..', import.meta.url).pathname;
const checker = makeChecker(); const c = checker.check;
execFileSync('sh', [join(root, 'scripts/build-dist.sh'), 'testver'], { stdio: 'inherit' });

const html = readFileSync(join(root, 'dist/index.html'), 'utf8');
c('index.html の CSS / JS 参照にバージョンが付く', html.includes('css/style.css?v=testver') && html.includes('js/app.js?v=testver') && !html.includes('?v=dev'));
const appJs = readFileSync(join(root, 'dist/js/app.js'), 'utf8');
c('モジュール間の import にもバージョンが付く', /from '\.\/model\.js\?v=testver'/.test(appJs) && !/from '\.\/[a-z]+\.js'/.test(appJs));

// dist をそのまま配信して起動できるか
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer(async (req, res) => {
  const p = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  try { res.writeHead(200, { 'content-type': types[extname(p)] || 'application/octet-stream' }); res.end(await readFile(join(root, 'dist', p))); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, r));
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = []; const loaded = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('request', r => { if (/\.(js|css)/.test(r.url())) loaded.push(r.url()); });
await page.goto(`http://127.0.0.1:${server.address().port}/`);
await page.waitForFunction(() => window.__app && document.querySelectorAll('#item-list li').length > 0);
c('dist 版が起動する（エラーなし）', errors.length === 0, errors.join(' | '));
c('読み込まれた CSS / JS がすべてバージョン付き URL', loaded.length >= 7 && loaded.every(u => u.includes('?v=testver')), loaded.filter(u => !u.includes('?v=testver')).join(' '));
await browser.close(); server.close();
process.exit(checker.failed ? 1 : 0);
