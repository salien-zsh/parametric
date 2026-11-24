import { beforeAll, describe, expect, it } from 'vitest';
import init from 'replicad-opencascadejs';
import { ModelBuilder } from '../src/kernel/build';
import { setOc } from '../src/kernel/occ';
import { newRib } from '../src/model/features';
import type { Feature, SkEntity } from '../src/model/types';
import { extrude, rect, req, sketch } from './helpers';

beforeAll(async () => {
  setOc(await init());
});

const line = (a: [number, number], b: [number, number]): SkEntity[] => [
  { id: 'ra', t: 'point', x: a[0], y: a[1] },
  { id: 'rb', t: 'point', x: b[0], y: b[1] },
  { id: 'rl', t: 'line', a: 'ra', b: 'rb' },
];

const base = (): Feature[] => [sketch('base', rect(0, 0, 60, 40)), extrude('e1', 'base', 10)];

const build = async (features: Feature[]) => {
  const builder = new ModelBuilder();
  const res = await builder.build(req(features) as never);
  return res;
};

describe('rib feature', () => {
  it('thickens the sketch line into a wall along the sketch normal', async () => {
    const plain = await build(base());
    const res = await build([...base(), sketch('rib', line([0, 20], [60, 20])), { ...newRib('r1', 'Rib1', 4, 20), sketch: 'rib' }]);
    expect(res.status[res.status.length - 1].ok).toBe(true);
    // The wall stands 20 above the plate (z 0..20).
    expect(res.bbox!.max[2]).toBeCloseTo(20, 6);
    expect(res.bbox!.max[2]).toBeGreaterThan(plain.bbox!.max[2]);
    const [min, max] = [res.bbox!.min, res.bbox!.max];
    // It spans the plate in X; Y stays the plate's own extent.
    expect(min[0]).toBeCloseTo(0, 5);
    expect(max[0]).toBeCloseTo(60, 5);
    expect(min[1]).toBeCloseTo(0, 5);
    expect(res.faces.some((f) => Math.abs(f.center[2] - 20) < 6)).toBe(true);
  });

  it('extends both ways when symmetric', async () => {
    const res = await build([...base(), sketch('rib', line([0, 20], [60, 20])), { ...newRib('r1', 'Rib1', 4, 20), sketch: 'rib', symmetric: true }]);
    // From -10 to +10 about the sketch plane; the plate adds up to 10.
    expect(res.bbox!.min[2]).toBeCloseTo(-10, 5);
    expect(res.bbox!.max[2]).toBeCloseTo(10, 5);
  });

  it('rejects a sketch without lines and a zero thickness', async () => {
    const noLines = await build([...base(), sketch('rib', [{ id: 'p', t: 'point', x: 5, y: 5 }]), { ...newRib('r1', 'Rib1', 4, 20), sketch: 'rib' }]);
    expect(noLines.status[noLines.status.length - 1].ok).toBe(false);
    const flat = await build([...base(), sketch('rib', line([0, 20], [60, 20])), { ...newRib('r1', 'Rib1', 0, 20), sketch: 'rib' }]);
    expect(flat.status[flat.status.length - 1].ok).toBe(false);
  });
});
