// PNG 書き出し（pHYs で dpi を埋め込み）と印刷
import { renderSheet } from './render.js';
import { layoutSheet } from './layout.js';
import { renderChart, applyProfileToCanvas } from './colorcal.js';

/** 色補正が有効か（プロファイルがあり、オンで、強さが 0 より大きい） */
export function colorCorrectionActive(project) {
  const cc = project.colorCorr;
  return !!(cc && cc.enabled && cc.profile && (cc.strength ?? 100) > 0);
}

/** 書き出し用のキャンバス。opts.correct === false で色補正をかけない */
export function exportCanvas(project, opts = {}) {
  const s = project.dpi / 25.4;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(project.paper.w * s);
  canvas.height = Math.round(project.paper.h * s);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  renderSheet(ctx, project, s, { mode: 'export' });
  if (opts.correct !== false && colorCorrectionActive(project)) {
    applyProfileToCanvas(canvas, project.colorCorr.profile, (project.colorCorr.strength ?? 100) / 100);
  }
  return canvas;
}

/** 色見本シート（色補正はかけない。サイズ補正の事前拡大はシールと同じ） */
export function chartCanvas(project, dpi = 300) {
  const s = dpi / 25.4;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(project.paper.w * s);
  canvas.height = Math.round(project.paper.h * s);
  renderChart(canvas.getContext('2d'), project, layoutSheet({ ...project, ruler: false, items: [] }).area, s);
  return canvas;
}

export function exportFileName(project, ext) {
  const k = project.scaleK && project.scaleK !== 100 ? `_x${project.scaleK}` : '';
  const c = colorCorrectionActive(project) ? '_color' : '';
  return `plarail_seal_${project.paper.preset}_${project.dpi}dpi${k}${c}.${ext}`;
}

export async function savePNGCanvas(canvas, dpi, name) { return savePNG(canvas, dpi, name); }

async function savePNG(canvas, dpi, name) {
  const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
  const buf = new Uint8Array(await blob.arrayBuffer());
  downloadBlob(new Blob([addPhys(buf, dpi)], { type: 'image/png' }), name);
  return canvas;
}

export async function exportPNG(project) {
  return savePNG(exportCanvas(project), project.dpi, exportFileName(project, 'png'));
}

export async function exportChartPNG(project) {
  return savePNG(chartCanvas(project, 300), 300, `plarail_seal_colorchart_${project.paper.preset}.png`);
}

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** IHDR の直後に pHYs チャンクを挿入する */
export function addPhys(png, dpi) {
  const ppm = Math.round(dpi / 0.0254);
  // 既存 pHYs を探す（ある場合は置き換え）
  const ihdrEnd = 8 + 4 + 4 + 13 + 4;
  const chunk = new Uint8Array(4 + 4 + 9 + 4);
  const dv = new DataView(chunk.buffer);
  dv.setUint32(0, 9);
  chunk.set([0x70, 0x48, 0x59, 0x73], 4); // 'pHYs'
  dv.setUint32(8, ppm); dv.setUint32(12, ppm); chunk[16] = 1;
  dv.setUint32(17, crc32(chunk.subarray(4, 17)));
  const out = new Uint8Array(png.length + chunk.length);
  out.set(png.subarray(0, ihdrEnd), 0);
  out.set(chunk, ihdrEnd);
  out.set(png.subarray(ihdrEnd), ihdrEnd + chunk.length);
  return out;
}

let crcTable;
function crc32(bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** ブラウザの印刷ダイアログで原寸印刷（PDF 保存にも使える） */
export function printSheet(project) {
  const canvas = exportCanvas(project);
  const area = document.getElementById('print-area');
  area.innerHTML = '';
  const style = document.createElement('style');
  style.textContent = `@page { size: ${project.paper.w}mm ${project.paper.h}mm; margin: 0; }`;
  const img = document.createElement('img');
  img.src = canvas.toDataURL('image/png');
  img.style.width = `${project.paper.w}mm`;
  img.style.height = `${project.paper.h}mm`;
  area.append(style, img);
  img.decode().catch(() => {}).finally(() => window.print());
}
