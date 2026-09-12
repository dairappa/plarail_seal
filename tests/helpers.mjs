// テスト共通: 静的ファイルサーバとブラウザ起動、結果集計
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

export async function startServer() {
  const server = createServer(async (req, res) => {
    const p = req.url === '/' ? '/index.html' : req.url.split('?')[0];
    try {
      const body = await readFile(join(root, p));
      res.writeHead(200, { 'content-type': types[extname(p)] || 'application/octet-stream' });
      res.end(body);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(r => server.listen(0, r));
  return { server, url: `http://127.0.0.1:${server.address().port}/` };
}

export async function openApp() {
  const { server, url } = await startServer();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  // Web フォントなどの外部リソース失敗はネットワーク環境依存なので除外
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.goto(url);
  await page.waitForFunction(() => window.__app && document.querySelectorAll('#item-list li').length > 0);
  return {
    page, errors,
    close: async () => { await browser.close(); server.close(); },
  };
}

export function makeChecker() {
  let failed = 0;
  const check = (name, ok, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' ' + detail : ''}`);
    if (!ok) failed++;
  };
  return { check, get failed() { return failed; } };
}
