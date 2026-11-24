import { beforeAll, describe, expect, it } from 'vitest';
import init from 'replicad-opencascadejs';
import { ModelBuilder } from '../src/kernel/build';
import { setOc } from '../src/kernel/occ';
import { buildSheet, hatchLoops, parseLoops } from '../src/drawing/sheet';
import type { DrawingDoc } from '../src/model/types';
import { extrude, rect, req, sketch } from './helpers';

beforeAll(async () => {
  setOc(await init());
});

const box = async () => {
  const builder = new ModelBuilder();
  await builder.build(req([sketch('s1', rect(0, 0, 60, 40)), extrude('e1', 's1', 20)]) as never);
  return builder;
};

describe('section views', () => {
  it('cuts the model and outlines the cut face', async () => {
    const builder = await box();
    const [full] = builder.project([{ id: 'v1', dir: [0, 0, 1], x: [1, 0, 0] }]);
    const [section] = builder.project([{ id: 'v2', dir: [0, 0, 1], x: [1, 0, 0], cut: { p: [30, 20, 10], n: [0, 0, 1] } }]);
    // Cutting at mid height leaves the same outline projected along Z.
    expect(section.visible.length).toBe(full.visible.length);
    expect(section.section?.length).toBe(1);
    const loops = parseLoops(section.section!);
    expect(loops).toHaveLength(1);
    // The cut face of the 60 x 40 box is a 60 x 40 rectangle.
    const xs = loops[0].map(([x]) => x);
    const ys = loops[0].map(([, y]) => y);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(60, 2);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(40, 2);
  });

  it('cuts along X and keeps the smaller outline', async () => {
    const builder = await box();
    const [section] = builder.project([{ id: 'v3', dir: [1, 0, 0], x: [0, 1, 0], cut: { p: [30, 20, 10], n: [1, 0, 0] } }]);
    expect(section.section?.length).toBeGreaterThan(0);
    const loops = parseLoops(section.section!);
    const xs = loops.flat().map(([x]) => x);
    const ys = loops.flat().map(([, y]) => y);
    // Looking along X the section is 40 wide (Y) and 20 tall (Z).
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(40, 1);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(20, 1);
  });

  it('keeps holes clear when hatching', () => {
    // Outer 20 x 20 square with a 6 x 6 hole: hatch lines must not cross the hole.
    const outer = parseLoops(['M 0 0 L 20 0 L 20 20 L 0 20 Z']);
    const hole = parseLoops(['M 7 7 L 13 7 L 13 13 L 7 13 Z']);
    const items: Parameters<typeof hatchLoops>[0] = [];
    hatchLoops(items, [...outer, ...hole], 2);
    expect(items.length).toBeGreaterThan(5);
    const insideHole = items.filter((it) => it.t === 'line' && (() => {
      // Midpoint of the segment inside the hole square would mean a bad hatch.
      const mx = (it.x1 + it.x2) / 2;
      const my = (it.y1 + it.y2) / 2;
      return mx > 7.2 && mx < 12.8 && my > 7.2 && my < 12.8;
    })());
    expect(insideHole).toHaveLength(0);
  });
});

describe('section sheet rendering', () => {
  it('draws a section view with its label and hatching', async () => {
    const builder = await box();
    const [projection] = builder.project([{ id: 'v1', dir: [0, 0, 1], x: [1, 0, 0], cut: { p: [30, 20, 10], n: [0, 0, 1] } }]);
    const doc: DrawingDoc = {
      sheet: 'A4', landscape: true, scale: 1, title: '', drawnBy: '', notes: '',
      views: [{ id: 'v1', kind: 'section', x: 100, y: 80, hidden: false, dims: false }],
    };
    const info = { partName: 'Box', material: 'Steel', units: 'mm', date: '2026-01-01', formatLength: (mm: number) => String(mm), bom: [] };
    const sheet = buildSheet(doc, new Map([['v1', projection]]), info);
    const texts = sheet.items.filter((it) => it.t === 'text').map((it) => it.s);
    expect(texts.some((t) => t.includes('SECTION A-A'))).toBe(true);
    // Hatch lines are thin lines inside the 60 x 40 outline (sheet at 1:1).
    const thin = sheet.items.filter((it) => it.t === 'line' && it.w === 0.13);
    expect(thin.length).toBeGreaterThan(5);
  });

  it('honours a per-view scale', async () => {
    const builder = await box();
    const [projection] = builder.project([{ id: 'v1', dir: [0, 0, 1], x: [1, 0, 0] }]);
    const doc: DrawingDoc = {
      sheet: 'A4', landscape: true, scale: 1, title: '', drawnBy: '', notes: '',
      views: [{ id: 'v1', kind: 'front', x: 100, y: 80, hidden: false, dims: false, scale: 0.5 }],
    };
    const info = { partName: 'Box', material: 'Steel', units: 'mm', date: '2026-01-01', formatLength: (mm: number) => String(mm), bom: [] };
    const full = buildSheet(doc, new Map([['v1', projection]]), info).frames[0];
    const halfDoc = { ...doc, views: [{ ...doc.views[0], scale: undefined }] };
    const half = buildSheet(halfDoc, new Map([['v1', projection]]), info).frames[0];
    const span = (f: { x0: number; x1: number }) => f.x1 - f.x0;
    expect(span(full)).toBeCloseTo(span(half) / 2, 4);
  });
});
