// シート上へのシール自動配置（棚詰め）
import { usableArea } from './model.js';

export const MARK_LEN = 1.5;   // トンボの長さ mm
export const MARK_GAP = 0.3;   // 塗り足し外端からトンボまでの隙間 mm
export const RULER_LEN_MAX = 50;
export const RULER_STRIP_H = 9; // ものさし用に確保する高さ mm

export function cellPadding(project) {
  const bleed = Math.max(0, project.bleed || 0);
  return project.marks === 'corner' ? bleed + MARK_GAP + MARK_LEN : bleed;
}

export function rulerLength(areaW) {
  if (areaW >= RULER_LEN_MAX + 4) return RULER_LEN_MAX;
  return Math.max(10, Math.floor((areaW - 4) / 10) * 10);
}

/**
 * @returns {{ area, placed: Array<{item,x,y,w,h}>, overflow: number, ruler: null|{x,y,len} }}
 */
export function layoutSheet(project) {
  const u = usableArea(project);
  const m = Math.max(0, project.paper.margin || 0);
  const area = { x: u.x + m, y: u.y + m, w: u.w - 2 * m, h: u.h - 2 * m };

  const pad = cellPadding(project);
  const gap = Math.max(0, project.gap || 0);

  let ruler = null;
  let bottom = area.y + area.h;
  if (project.ruler && area.w >= 14 && area.h >= RULER_STRIP_H + 5) {
    const len = rulerLength(area.w);
    ruler = { x: area.x + 2, y: bottom - RULER_STRIP_H + 2, len };
    bottom -= RULER_STRIP_H + gap;
  }

  const placed = [];
  let overflow = 0;
  let cx = area.x, cy = area.y, rowH = 0;

  for (const item of project.items) {
    const copies = Math.max(0, Math.floor(item.copies ?? 1));
    const cw = item.w + 2 * pad, ch = item.h + 2 * pad;
    for (let i = 0; i < copies; i++) {
      if (cw > area.w || ch > bottom - area.y) { overflow++; continue; }
      if (cx + cw > area.x + area.w + 1e-6) {          // 折り返し
        cx = area.x; cy += rowH + gap; rowH = 0;
      }
      if (cy + ch > bottom + 1e-6) { overflow++; continue; }
      placed.push({ item, x: cx + pad, y: cy + pad, w: item.w, h: item.h });
      cx += cw + gap;
      rowH = Math.max(rowH, ch);
    }
  }
  return { area, usable: u, placed, overflow, ruler };
}
