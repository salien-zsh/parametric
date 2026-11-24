// DXF export of a drawing sheet: the same display list as the screen, PDF
// and SVG, written as R12 ASCII entities on named layers.

import { type Item, parseLoops } from './sheet';
import { tr } from '../i18n';

const LAYERS = ['BORDER', 'VIEW', 'HIDDEN', 'DIM', 'TEXT', 'TITLE', 'BOM', 'HATCH', 'BALLOON'] as const;

const num = (v: number) => (Math.abs(v) < 1e-9 ? '0' : Number(v.toFixed(4)).toString());

/**
 * The sheet as DXF R12 text. Sheet coordinates are y down; DXF is y up, so
 * every y is flipped through the sheet height. Hatch lines stay on HATCH.
 */
export function toDxf(items: Item[], w: number, h: number): string {
  const out: string[] = [];
  const pair = (code: number | string, value: number | string) => out.push(String(code), String(value));
  const y = (v: number) => h - v;

  const layerOf = (it: Item): string => {
    switch (it.t) {
      case 'path': return it.dash ? 'HIDDEN' : 'VIEW';
      case 'line': return it.w <= 0.2 ? (it.dash ? 'HIDDEN' : 'DIM') : 'VIEW';
      case 'rect': return tr("BORDER");
      case 'text': return tr("TEXT");
      case 'circle': return tr("BALLOON");
      default: return tr("DIM");
    }
  };
  const line = (layer: string, x1: number, y1: number, x2: number, y2: number) => {
    if (Math.abs(x1 - x2) < 1e-9 && Math.abs(y1 - y2) < 1e-9) return;
    pair(0, 'LINE'); pair(8, layer);
    pair(10, num(x1)); pair(20, num(y(y1))); pair(30, '0');
    pair(11, num(x2)); pair(21, num(y(y2))); pair(31, '0');
  };
  const text = (layer: string, s: string, x: number, yy: number, size: number, rotate = 0, anchor: 'start' | 'middle' | 'end' = 'start') => {
    pair(0, 'TEXT'); pair(8, layer);
    pair(10, num(x)); pair(20, num(y(yy))); pair(30, '0');
    pair(40, num(size)); pair(1, s.replace(/[\r\n]+/g, ' '));
    if (rotate) pair(50, num(-rotate));
    if (anchor && anchor !== 'start') {
      pair(72, anchor === 'middle' ? 1 : 2);
      pair(11, num(x)); pair(21, num(y(yy))); pair(31, '0');
    }
  };
  const circle = (layer: string, x: number, yy: number, r: number) => {
    pair(0, 'CIRCLE'); pair(8, layer);
    pair(10, num(x)); pair(20, num(y(yy))); pair(30, '0'); pair(40, num(r));
  };

  // ---- header and layer table ----
  pair(0, 'SECTION'); pair(2, 'HEADER');
  pair(9, '$ACADVER'); pair(1, 'AC1009');
  pair(9, '$INSBASE'); pair(10, '0'); pair(20, '0'); pair(30, '0');
  pair(9, '$EXTMIN'); pair(10, '0'); pair(20, '0'); pair(30, '0');
  pair(9, '$EXTMAX'); pair(10, num(w)); pair(20, num(h)); pair(30, '0');
  pair(0, 'ENDSEC');
  pair(0, 'SECTION'); pair(2, 'TABLES');
  pair(0, 'TABLE'); pair(2, 'LAYER'); pair(70, LAYERS.length);
  for (const name of LAYERS) {
    pair(0, 'LAYER'); pair(2, name); pair(70, '0'); pair(62, '7'); pair(6, 'CONTINUOUS');
  }
  pair(0, 'ENDTAB');
  pair(0, 'ENDSEC');

  // ---- entities ----
  pair(0, 'SECTION'); pair(2, 'ENTITIES');
  for (const it of items) {
    switch (it.t) {
      case 'path':
        for (const loop of parseLoops([it.d])) {
          const pts = loop.map(([px, py]) => [it.tx + px * it.s, it.ty + py * it.s] as [number, number]);
          for (let i = 1; i < pts.length; i++) line(layerOf(it), pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
        }
        break;
      case 'line':
        line(layerOf(it), it.x1, it.y1, it.x2, it.y2);
        break;
      case 'rect': {
        const x0 = it.x, y0 = it.y, x1 = it.x + it.w, y1 = it.y + it.h;
        const layer = layerOf(it);
        line(layer, x0, y0, x1, y0); line(layer, x1, y0, x1, y1);
        line(layer, x1, y1, x0, y1); line(layer, x0, y1, x0, y0);
        break;
      }
      case 'circle':
        circle(layerOf(it), it.x, it.y, it.r);
        break;
      case 'tri':
        line(layerOf(it), it.a[0], it.a[1], it.b[0], it.b[1]);
        line(layerOf(it), it.b[0], it.b[1], it.c[0], it.c[1]);
        line(layerOf(it), it.c[0], it.c[1], it.a[0], it.a[1]);
        break;
      case 'text':
        text(layerOf(it), it.s, it.x, it.y, it.size, it.rotate ?? 0, it.anchor ?? 'start');
        break;
    }
  }
  pair(0, 'ENDSEC');
  pair(0, 'EOF');
  return out.join('\n') + '\n';
}
