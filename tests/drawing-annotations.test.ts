import { describe, expect, it } from 'vitest';
import { buildSheet, type Item, type SheetInfo } from '../src/drawing/sheet';
import { toDxf } from '../src/drawing/dxf';
import type { DrawingDoc } from '../src/model/types';

const projection = { id: 'v1', visible: ['M 0 0 L 60 0 L 60 -40 L 0 -40 Z'], hidden: [], bounds: [0, -40, 60, 0] as [number, number, number, number] };
const info = (extra: Partial<SheetInfo> = {}): SheetInfo => ({
  partName: 'Plate', material: 'Steel', units: 'mm', date: '2026-01-01', formatLength: (mm) => String(mm), bom: [], ...extra,
});
const doc = (view: Partial<DrawingDoc['views'][number]> = {}): DrawingDoc => ({
  sheet: 'A4', landscape: true, scale: 1, title: '', drawnBy: '', notes: '',
  views: [{ id: 'v1', kind: 'front', x: 100, y: 80, hidden: false, dims: false, ...view }],
});

describe('centre marks and balloons', () => {
  it('draws a centre mark on each circle facing the view', () => {
    const sheet = buildSheet(doc({ centers: true }), new Map([['v1', projection]]), info({
      annotations: new Map([['v1', { circles: [{ x: 20, y: -20, r: 5 }, { x: 40, y: -20, r: 5 }], balloons: [] }]]),
    }));
    const thin = sheet.items.filter((it) => it.t === 'line' && it.w === 0.18);
    // Two crosses of two lines each, plus the dashed centre lines around them.
    expect(thin.length).toBeGreaterThanOrEqual(8);
    const dashed = sheet.items.filter((it) => it.t === 'line' && it.dash);
    expect(dashed.length).toBeGreaterThan(0);
  });

  it('draws balloons with the bill-of-materials numbers', () => {
    const sheet = buildSheet(doc({ balloons: true }), new Map([['v1', projection]]), info({
      annotations: new Map([['v1', { circles: [], balloons: [{ x: 20, y: -20, item: 1 }, { x: 40, y: -20, item: 2 }] }]]),
      bom: [{ item: 1, part: 'A', quantity: 1, material: 'Steel' }, { item: 2, part: 'B', quantity: 1, material: 'Steel' }],
    }));
    const circles = sheet.items.filter((it) => it.t === 'circle');
    expect(circles).toHaveLength(2);
    const numbers = sheet.items.filter((it) => it.t === 'text').map((it) => it.s);
    expect(numbers).toContain('1');
    expect(numbers).toContain('2');
  });
});

describe('DXF export', () => {
  it('writes entities on named layers with y flipped', () => {
    const items: Item[] = [
      { t: 'line', x1: 10, y1: 20, x2: 30, y2: 20, w: 0.35 },
      { t: 'path', d: 'M 0 0 L 10 0 L 10 10 Z', tx: 5, ty: 7, s: 2, w: 0.35 },
      { t: 'rect', x: 1, y: 2, w: 50, h: 30, sw: 0.5 },
      { t: 'circle', x: 20, y: 20, r: 3, sw: 0.3 },
      { t: 'text', s: 'SECTION A-A', x: 12, y: 30, size: 2.6, anchor: 'middle' },
    ];
    const dxf = toDxf(items, 297, 210);
    expect(dxf.startsWith('0\nSECTION')).toBe(true);
    expect(dxf).toContain('ENTITIES');
    expect(dxf).toContain('LAYER');
    expect(dxf).toContain('VIEW');
    expect(dxf).toContain('BALLOON');
    expect(dxf).toContain('SECTION A-A');
    // The line at y = 20 becomes 210 - 20 = 190 in DXF.
    const tokens = dxf.split('\n');
    const at = tokens.indexOf('LINE');
    expect(tokens[at + 5]).toBe('20');
    expect(Number(tokens[at + 6])).toBeCloseTo(190, 6);
    // Path points are transformed by tx/ty/s and flipped too: (10,10) -> (25,27) -> 183.
    expect(dxf.split('\n').filter((t) => t === 'LINE').length).toBeGreaterThanOrEqual(8);
  });

  it('exports a whole sheet', () => {
    const sheet = buildSheet(doc({ centers: true }), new Map([['v1', projection]]), info({
      annotations: new Map([['v1', { circles: [{ x: 20, y: -20, r: 4 }], balloons: [] }]]),
    }));
    const dxf = toDxf(sheet.items, sheet.w, sheet.h);
    expect(dxf.endsWith('0\nEOF\n')).toBe(true);
    expect(dxf.split('\n').filter((t) => t === 'TEXT').length).toBeGreaterThan(3);
  });
});
