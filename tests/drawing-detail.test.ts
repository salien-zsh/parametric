import { describe, expect, it } from 'vitest';
import { buildSheet, clipPathsToCircle, clipSegment, type SheetInfo } from '../src/drawing/sheet';
import { newDocument, parseDocument, serializeDocument } from '../src/model/document';
import type { DrawingDoc } from '../src/model/types';

const projection = { id: 'v1', visible: ['M 0 0 L 60 0 L 60 -40 L 0 -40 Z', 'M 20 -20 L 40 -20 L 40 -40 L 20 -40 Z'], hidden: [], bounds: [0, -40, 60, 0] as [number, number, number, number] };
const info: SheetInfo = { partName: 'Plate', material: 'Steel', units: 'mm', date: '2026-01-01', formatLength: (mm) => String(mm), bom: [] };

describe('detail view clipping', () => {
  it('keeps the part of a segment inside the circle', () => {
    expect(clipSegment([-10, 0], [10, 0], 0, 0, 5)).toEqual([[-5, 0], [5, 0]]);
    expect(clipSegment([-10, -10], [10, -10], 0, 0, 5)).toBeNull();
    expect(clipSegment([-2, 0], [2, 0], 0, 0, 5)).toEqual([[-2, 0], [2, 0]]);
  });

  it('clips projected polylines to the window and reports its bounds', () => {
    // Around the corner of the square two edges cross the window.
    const { paths, bounds } = clipPathsToCircle(['M 0 0 L 60 0 L 60 -40 L 0 -40 Z'], 0, 0, 10);
    expect(bounds).toEqual([-10, -10, 10, 10]);
    expect(paths.length).toBeGreaterThan(0);
    for (const d of paths) {
      for (const [, x, y] of d.matchAll(/(-?\d+\.\d+) (-?\d+\.\d+)/g)) {
        expect(Math.hypot(Number(x), Number(y))).toBeLessThanOrEqual(10.001);
      }
    }
  });
});

describe('detail view on the sheet', () => {
  const doc = (): DrawingDoc => ({
    sheet: 'A4', landscape: true, scale: 1, title: '', drawnBy: '', notes: '',
    views: [
      { id: 'v1', kind: 'front', x: 100, y: 80, hidden: false, dims: false },
      { id: 'v2', kind: 'detail', x: 100, y: 160, hidden: false, dims: false, detail: { source: 'v1', x: 4, y: -4, radius: 10, scale: 2 } },
    ],
  });

  it('draws the circle, the clipped geometry and the label', () => {
    const sheet = buildSheet(doc(), new Map([['v1', projection]]), info);
    expect(sheet.frames).toHaveLength(2);
    const circle = sheet.items.find((it) => it.t === 'circle' && Math.abs(it.x - 100) < 1e-9);
    expect(circle).toBeTruthy();
    if (circle?.t === 'circle') expect(circle.r).toBeCloseTo(20, 6);
    const texts = sheet.items.filter((it) => it.t === 'text').map((it) => it.s);
    expect(texts.some((t) => t.includes('DETAIL A') && t.includes('2:1'))).toBe(true);
    // Everything the detail draws stays inside its enlarged 20 mm circle.
    const paths = sheet.items.filter((it): it is Extract<typeof sheet.items[number], { t: 'path' }> => it.t === 'path');
    expect(paths.length).toBeGreaterThan(0);
    for (const p of paths) {
      for (const [, x, y] of p.d.matchAll(/(-?\d+\.\d+) (-?\d+\.\d+)/g)) {
        const sx = p.tx + Number(x) * p.s;
        const sy = p.ty + Number(y) * p.s;
        expect(Math.hypot(sx - 100, sy - 160)).toBeLessThanOrEqual(20.001);
      }
    }
  });

  it('round-trips through save and open', () => {
    const part = newDocument('DetailPart');
    part.drawing = doc();
    const back = parseDocument(serializeDocument(part));
    expect(back.drawing?.views[1].kind).toBe('detail');
    expect(back.drawing?.views[1].detail).toEqual({ source: 'v1', x: 4, y: -4, radius: 10, scale: 2 });
  });
});

describe('auxiliary view', () => {
  it('labels a view taken square on at a face', () => {
    const doc: DrawingDoc = {
      sheet: 'A4', landscape: true, scale: 1, title: '', drawnBy: '', notes: '',
      views: [
        { id: 'v1', kind: 'front', x: 100, y: 80, hidden: false, dims: false },
        {
          id: 'v2', kind: 'auxiliary', x: 100, y: 160, hidden: false, dims: false,
          auxiliary: { face: { name: 'f1', sig: { type: 'plane', c: [0, 0, 0], n: [0, 0, 1], area: 10 } } },
        },
      ],
    };
    const sheet = buildSheet(doc, new Map([
      ['v1', projection],
      ['v2', { id: 'v2', visible: ['M 10 0 L 30 0 L 30 -20 Z'], hidden: [], bounds: [10, -20, 30, 0] as [number, number, number, number] }],
    ]), info);
    const texts = sheet.items.filter((it) => it.t === 'text').map((it) => it.s);
    expect(texts.some((t) => t.includes('AUXILIARY A'))).toBe(true);
  });
});
