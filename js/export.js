// PNG 書き出し（pHYs で dpi を埋め込み）と印刷
import { renderSheet } from './render.js';

export function exportCanvas(project) {
  const s = project.dpi / 25.4;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(project.paper.w * s);
  canvas.height = Math.round(project.paper.h * s);
  const ctx = canvas.getContext('2d');
  renderSheet(ctx, project, s, { mode: 'export' });
  return canvas;
}

export function exportFileName(project, ext) {
  const k = project.scaleK && project.scaleK !== 100 ? `_x${project.scaleK}` : '';
  return `plarail_seal_${project.paper.preset}_${project.dpi}dpi${k}.${ext}`;
}

export async function exportPNG(project) {
  const canvas = exportCanvas(project);
  const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
  const buf = new Uint8Array(await blob.arrayBuffer());
  const withDpi = addPhys(buf, project.dpi);
  downloadBlob(new Blob([withDpi], { type: 'image/png' }), exportFileName(project, 'png'));
  return canvas;
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
