import { beforeAll, describe, expect, it } from 'vitest';
import init from 'replicad-opencascadejs';
import { ModelBuilder } from '../src/kernel/build';
import { setOc } from '../src/kernel/occ';
import { newBaseFlange, newEdgeFlange, newFlatPattern } from '../src/model/features';
import type { Feature } from '../src/model/types';
import { rect, req, sketch } from './helpers';

beforeAll(async () => {
  setOc(await init());
});

const build = (features: Feature[]) => {
  const builder = new ModelBuilder();
  return builder.build(req(features) as never);
};

const baseFeatures = (): Feature[] => [
  sketch('s1', rect(0, 0, 30, 20)),
  { ...newBaseFlange('bf1', 'Base Flange1'), sketch: 's1', thickness: 2 },
];

describe('flat pattern', () => {
  it('lays the base flange and its edge flange flat', async () => {
    const base = baseFeatures();
    const folded = await build(base);
    const edge = folded.edges.find((e) => e.type === 'line'
      && Math.abs(e.mid[1] - 20) < 1e-6 && Math.abs(e.mid[2] - 2) < 1e-6
      && Math.abs(Math.abs(e.dir![0]) - 1) < 1e-6);
    expect(edge).toBeTruthy();
    const flange = {
      ...newEdgeFlange('ef1', 'Edge Flange1'),
      edge: { name: edge!.name, sig: { type: 'line' as const, m: edge!.mid, len: edge!.length } },
      length: 15,
      angle: 90,
    };
    const flat = { ...newFlatPattern('fp1', 'Flat Pattern1'), kFactor: 0.5 };
    const res = await build([...base, flange, flat]);
    expect(res.status[res.status.length - 1].ok).toBe(true);
    expect(res.bodies).toBe(1);
    // Thickness only: the bend is gone and the flange lies in the sheet plane.
    expect(res.bbox!.max[2] - res.bbox!.min[2]).toBeCloseTo(2, 4);
    // 20 mm base + 15 mm flange + bend allowance (90° × (2 + 0.5 × 2) = 4.71).
    expect(res.bbox!.max[1]).toBeGreaterThan(39);
    expect(res.bbox!.max[1]).toBeLessThan(41);
  });

  it('suppressing the flat pattern shows the folded part again', async () => {
    const base = baseFeatures();
    const folded = await build(base);
    const edge = folded.edges.find((e) => e.type === 'line'
      && Math.abs(e.mid[1] - 20) < 1e-6 && Math.abs(e.mid[2] - 2) < 1e-6
      && Math.abs(Math.abs(e.dir![0]) - 1) < 1e-6)!;
    const flange = {
      ...newEdgeFlange('ef1', 'Edge Flange1'),
      edge: { name: edge.name, sig: { type: 'line' as const, m: edge.mid, len: edge.length } },
      length: 15,
      angle: 90,
    };
    const flat = { ...newFlatPattern('fp1', 'Flat Pattern1'), kFactor: 0.5, suppressed: true };
    const res = await build([...base, flange, flat]);
    expect(res.status[res.status.length - 1].suppressed).toBe(true);
    expect(res.bbox!.max[2]).toBeGreaterThan(13);
  });

  it('needs a base flange', async () => {
    const res = await build([{ ...newFlatPattern('fp1', 'Flat Pattern1'), kFactor: 0.5 }]);
    expect(res.status[res.status.length - 1].ok).toBe(false);
  });
});
