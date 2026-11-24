import { beforeAll, describe, expect, it } from 'vitest';
import init from 'replicad-opencascadejs';
import { ModelBuilder } from '../src/kernel/build';
import { setOc } from '../src/kernel/occ';
import { newCoil } from '../src/model/features';
import type { Feature } from '../src/model/types';
import { circle, req, sketch } from './helpers';

beforeAll(async () => {
  setOc(await init());
});

/** A circle profile offset from the sketch origin, so it becomes a coil. */
const coilPart = (over: Partial<ReturnType<typeof newCoil>> = {}): Feature[] => [
  sketch('s1', circle(10, 0, 3)),
  { ...newCoil('c1', 'Coil1'), profile: 's1', pitch: 5, revolutions: 3, height: 15, ...over },
];

const build = async (features: Feature[]) => {
  const builder = new ModelBuilder();
  const res = await builder.build(req(features) as never);
  return { res, builder };
};

describe('coil feature', () => {
  it('sweeps the circle into a helix about the sketch origin', async () => {
    const { res } = await build(coilPart());
    expect(res.bbox).toBeTruthy();
    const [min, max] = [res.bbox!.min, res.bbox!.max];
    // Pitch 5 x 3 turns, plus the swept profile's radius at both ends.
    expect(max[2] - min[2]).toBeCloseTo(15 + 6, 0);
    expect(max[0]).toBeGreaterThan(10);
    expect(min[0]).toBeLessThan(10);
    const status = res.status[res.status.length - 1];
    expect(status.ok).toBe(true);
  });

  it('sizes the coil by its height when asked', async () => {
    const { res } = await build(coilPart({ byHeight: true, height: 20, pitch: 4 }));
    expect(res.status[res.status.length - 1].ok).toBe(true);
    expect(res.bbox!.max[2] - res.bbox!.min[2]).toBeCloseTo(20 + 6, 0);
  });

  it('rejects a profile centred on the origin and a zero pitch', async () => {
    const centred = await build([sketch('s1', circle(0, 0, 3)), { ...newCoil('c1', 'Coil1'), profile: 's1' }]);
    expect(centred.res.status[centred.res.status.length - 1].ok).toBe(false);
    expect(centred.res.status[centred.res.status.length - 1].error).toContain('origin');
    const zeroPitch = await build(coilPart({ pitch: 0 }));
    expect(zeroPitch.res.status[zeroPitch.res.status.length - 1].ok).toBe(false);
  });
});
