import { describe, expect, it } from 'vitest';
import { gridSpacing, planeGrid } from '../src/render/grid';
import { BASE_FRAMES } from '../src/model/planes';
import { snapPoint } from '../src/app/sketch/inference';
import { formatCanvasValue, parseCanvasValue } from '../src/app/canvas-value';
import type { SketchFeature } from '../src/model/types';
import type { UnitContext } from '../src/app/pm';

const emptySketch = (): SketchFeature => ({
  id: 's1', name: 'Sketch1', type: 'sketch', plane: { kind: 'base', plane: 'front' }, entities: [], constraints: [],
});

describe('planar grid', () => {
  it('keeps squares between about 20 and 60 pixels and snaps to 1, 2 or 5', () => {
    for (const px of [0.001, 0.01, 0.1, 0.3, 1, 2.2, 10, 55.5]) {
      const step = gridSpacing(px);
      const screen = step / px;
      expect(screen).toBeGreaterThanOrEqual(20);
      expect(screen).toBeLessThanOrEqual(60);
      const mantissa = step / 10 ** Math.floor(Math.log10(step));
      expect([1, 2, 5, 10]).toContain(Math.round(mantissa));
    }
  });

  it('draws lines on multiples of the step, with every fifth line stronger', () => {
    const g = planeGrid(BASE_FRAMES.front, [0, 0], 20, 10);
    // x = -20, -10, 0, 10, 20 and the same in y: 10 segments of 2 vertices.
    expect(g.minor.length / 6).toBe(8);
    expect(g.major.length / 6).toBe(2);
    // The x = 10 line runs from (10, -20, 0) to (10, 20, 0) on the front plane.
    const positions = [...g.minor, ...g.major];
    const has = (a: number, b: number, c: number) =>
      positions.some((_, i) => i % 3 === 0 && positions[i] === a && positions[i + 1] === b && positions[i + 2] === c);
    expect(has(10, -20, 0)).toBe(true);
    expect(has(10, 20, 0)).toBe(true);
    expect(has(0, -20, 0)).toBe(true);
  });

  it('refuses an unbounded grid instead of queueing a huge batch', () => {
    const g = planeGrid(BASE_FRAMES.front, [0, 0], 1e6, 1);
    expect(g.minor).toHaveLength(0);
    expect(g.major).toHaveLength(0);
  });
});

describe('grid snapping', () => {
  it('rounds a free point onto the nearest crossing', () => {
    const s = snapPoint(emptySketch(), [12.4, -7.6], { tol: 1, grid: 10 });
    expect(s.kind).toBe('grid');
    expect(s.p).toEqual([10, -10]);
  });

  it('keeps a horizontal or vertical inference while putting the free axis on the grid', () => {
    const h = snapPoint(emptySketch(), [12.4, 0.3], { from: [0, 0], tol: 1, grid: 10 });
    expect(h.kind).toBe('h');
    expect(h.p).toEqual([10, 0]);
    const v = snapPoint(emptySketch(), [0.3, 12.4], { from: [0, 0], tol: 1, grid: 10 });
    expect(v.kind).toBe('v');
    expect(v.p).toEqual([0, 10]);
  });

  it('does nothing without the grid option or when snapping is disabled', () => {
    expect(snapPoint(emptySketch(), [12.4, -7.6], { tol: 1 }).kind).toBe('none');
    expect(snapPoint(emptySketch(), [12.4, -7.6], { tol: 1, grid: 10, disabled: true })).toMatchObject({ kind: 'none', p: [12.4, -7.6] });
  });
});

const ctx: UnitContext = { units: 'MMGS', decimals: 2, variables: () => new Map([['Width', 20]]) };

describe('on-model value box', () => {
  it('shows a length with the document unit, and angles in degrees', () => {
    expect(formatCanvasValue(0, 'length', ctx)).toBe('0.00 mm');
    expect(formatCanvasValue(12.345, 'length', ctx)).toBe('12.35 mm');
    expect(formatCanvasValue(90, 'angle', ctx)).toBe('90.0°');
  });

  it('reads plain values in document units, explicit units, and expressions', () => {
    expect(parseCanvasValue('12.5', 'length', ctx)).toBe(12.5);
    expect(parseCanvasValue('1 in', 'length', ctx)).toBe(25.4);
    expect(parseCanvasValue('=Width/2', 'length', ctx)).toBe(10);
    expect(parseCanvasValue('45°', 'angle', ctx)).toBe(45);
    expect(parseCanvasValue('nonsense', 'length', ctx)).toBeNull();
  });
});

describe('sketch point magnet', () => {
  it('snaps to a point from further away than the curve tolerance', () => {
    const sk = emptySketch();
    sk.entities.push({ id: 'p1', t: 'point', x: 10, y: 0 });
    // 1.5 units away is past the 1-unit curve tolerance but inside the point magnet.
    expect(snapPoint(sk, [11.5, 0], { tol: 1 })).toMatchObject({ kind: 'point', p: [10, 0] });
    expect(snapPoint(sk, [12, 0], { tol: 1 }).kind).not.toBe('point');
  });
});
