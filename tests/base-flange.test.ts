import { beforeAll, describe, expect, it } from 'vitest';
import init from 'replicad-opencascadejs';
import { ModelBuilder } from '../src/kernel/build';
import { setOc } from '../src/kernel/occ';
import { newBaseFlange } from '../src/model/features';
import type { Feature } from '../src/model/types';
import { extrude, rect, req, sketch } from './helpers';

beforeAll(async () => {
  setOc(await init());
});

const build = (features: Feature[]) => {
  const builder = new ModelBuilder();
  return builder.build(req(features) as never);
};

describe('base flange', () => {
  it('thickens the sketch profile to the sheet thickness', async () => {
    const features: Feature[] = [sketch('s1', rect(0, 0, 30, 20)), { ...newBaseFlange('bf1', 'Base Flange1'), sketch: 's1', thickness: 2 }];
    const res = await build(features);
    expect(res.status[res.status.length - 1].ok).toBe(true);
    expect(res.bodies).toBe(1);
    expect(res.bbox!.max[2] - res.bbox!.min[2]).toBeCloseTo(2, 4);
    expect(res.bbox!.max[0] - res.bbox!.min[0]).toBeCloseTo(30, 4);
  });

  it('keeps a second flange as its own body', async () => {
    const features: Feature[] = [
      sketch('s1', rect(0, 0, 30, 20)),
      { ...newBaseFlange('bf1', 'Base Flange1'), sketch: 's1', thickness: 2 },
      sketch('s2', rect(50, 0, 80, 20)),
      { ...newBaseFlange('bf2', 'Base Flange2'), sketch: 's2', thickness: 2 },
    ];
    const res = await build(features);
    expect(res.status[res.status.length - 1].ok).toBe(true);
    expect(res.bodies).toBe(2);
    expect(res.bbox!.min[0]).toBeCloseTo(0, 4);
    expect(res.bbox!.max[0]).toBeCloseTo(80, 4);
  });

  it('rejects a zero thickness, a negative bend radius and a missing sketch', async () => {
    const base = [sketch('s1', rect(0, 0, 30, 20))];
    const zero = await build([...base, { ...newBaseFlange('bf1', 'Base Flange1'), sketch: 's1', thickness: 0 }]);
    expect(zero.status[zero.status.length - 1].ok).toBe(false);
    const negative = await build([...base, { ...newBaseFlange('bf1', 'Base Flange1'), sketch: 's1', thickness: 2, bendRadius: -1 }]);
    expect(negative.status[negative.status.length - 1].ok).toBe(false);
    const noSketch = await build([{ ...newBaseFlange('bf1', 'Base Flange1') }]);
    expect(noSketch.status[noSketch.status.length - 1].ok).toBe(false);
    void extrude;
  });
});
