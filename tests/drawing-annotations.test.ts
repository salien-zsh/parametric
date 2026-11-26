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

describe('title block fields', () => {
  it('shows the drawing number and revision', () => {
    const sheet = buildSheet({ ...doc(), number: 'DWG-001', revision: 'B' }, new Map([['v1', projection]]), info());
    const texts = sheet.items.filter((it) => it.t === 'text').map((it) => it.s);
    expect(texts).toContain('DWG-001');
    expect(texts).toContain('B');
    expect(texts).toContain('DWG NO');
    expect(texts).toContain('REV');
  });
});

describe('sheet notes', () => {
  it('prints the notes at the top left', () => {
    const sheet = buildSheet({ ...doc(), notes: 'Deburr all edges\nTolerance ISO 2768-m' }, new Map([['v1', projection]]), info());
    const texts = sheet.items.filter((it) => it.t === 'text').map((it) => it.s);
    expect(texts).toContain('NOTES');
    expect(texts).toContain('Deburr all edges');
    expect(texts).toContain('Tolerance ISO 2768-m');
  });
});

describe('bill of materials', () => {
  it('shows a description column from the part drawing title', () => {
    const sheet = buildSheet(doc(), new Map([['v1', projection]]), info({
      bom: [{ item: 1, part: 'Plate', description: 'Base plate', quantity: 2, material: 'Steel' }],
    }));
    const texts = sheet.items.filter((it) => it.t === 'text').map((it) => it.s);
    expect(texts).toContain('DESCRIPTION');
    expect(texts).toContain('Base plate');
    expect(texts).toContain('QTY');
  });
});

describe('bill of materials size', () => {
  it('caps the table at the ten rows the layout reserves', () => {
    const bom = Array.from({ length: 20 }, (_, i) => ({ item: i + 1, part: `Part${i + 1}`, quantity: 1, material: 'Steel' }));
    const sheet = buildSheet(doc(), new Map([['v1', projection]]), info({ bom }));
    const texts = sheet.items.filter((it) => it.t === 'text').map((it) => it.s);
    expect(texts).toContain('Part10');
    expect(texts).not.toContain('Part11');
    expect(texts).not.toContain('Part20');
  });
});

describe('exploded assembly drawings', () => {
  it('marks the isometric view as exploded', () => {
    const explodedDoc = doc({ id: 'v1', kind: 'isometric' });
    const sheet = buildSheet(explodedDoc, new Map([['v1', projection]]), info({ exploded: true }));
    const texts = sheet.items.filter((it) => it.t === 'text').map((it) => it.s);
    expect(texts).toContain('ISOMETRIC (EXPLODED)');
  });
});

describe('manual dimensions', () => {
  it('draws a linear dimension with its true model length', () => {
    const withDim: DrawingDoc = {
      ...doc(),
      dimensions: [{ id: 'dim1', view: 'v1', a: [0, 0], b: [60, 0], offset: 10 }],
    };
    const sheet = buildSheet(withDim, new Map([['v1', projection]]), info());
    const texts = sheet.items.filter((it) => it.t === 'text').map((it) => it.s);
    expect(texts).toContain('60');
    // Two arrow heads and the dimension line.
    expect(sheet.items.filter((it) => it.t === 'tri').length).toBeGreaterThanOrEqual(2);
    expect(sheet.items.filter((it) => it.t === 'line').length).toBeGreaterThanOrEqual(3);
  });
});

describe('tolerance callouts', () => {
  it('draws the framed text with a leader to its point', () => {
    const withNote: DrawingDoc = {
      ...doc(),
      callouts: [{ id: 'note1', view: 'v1', p: [0, 0], text: 'POS 0.2 A' }],
    };
    const sheet = buildSheet(withNote, new Map([['v1', projection]]), info());
    const texts = sheet.items.filter((it) => it.t === 'text').map((it) => it.s);
    expect(texts).toContain('POS 0.2 A');
    expect(sheet.items.filter((it) => it.t === 'rect').length).toBeGreaterThanOrEqual(1);
    expect(sheet.items.filter((it) => it.t === 'line').length).toBeGreaterThanOrEqual(1);
  });
});
