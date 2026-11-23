// Builds every power-transmission generator through the real OpenCascade
// kernel: the parts have to come out as valid solids, not just valid JSON.
import { beforeAll, describe, expect, it } from 'vitest';
import init from 'replicad-opencascadejs';
import { ModelBuilder } from '../src/kernel/build';
import { setOc } from '../src/kernel/occ';
import type { Feature } from '../src/model/types';
import { newBevelGear, newSprocket, newSpurGear, newSyncBelt, newVBelt, newWormGear } from '../src/model/features';

beforeAll(async () => {
  setOc(await init());
});

const build = async (f: Feature) => {
  const b = new ModelBuilder();
  const res = await b.build({ features: [f], upTo: 1, blobs: {}, quality: 0 } as never);
  return res;
};

const volumeOf = (b: ModelBuilder): number => b.massProperties()?.volume ?? 0;

describe('power transmission generators', () => {
  const cases: [string, () => Feature][] = [
    ['spur gear', () => newSpurGear('f1', 'G1')],
    ['bevel gear', () => newBevelGear('f1', 'B1')],
    ['worm gear', () => newWormGear('f1', 'W1')],
    ['v-belt drive', () => newVBelt('f1', 'V1')],
    ['synchronous belt', () => newSyncBelt('f1', 'S1')],
    ['sprocket', () => newSprocket('f1', 'P1')],
  ];

  for (const [name, make] of cases) {
    it(`builds a ${name}`, async () => {
      const b = new ModelBuilder();
      const res = await b.build({ features: [make()], upTo: 1, blobs: {}, quality: 0 } as never);
      expect(res.status.map((s) => s.ok)).toEqual([true]);
      expect(volumeOf(b)).toBeGreaterThan(0);
      expect(res.faces.length).toBeGreaterThan(4);
      expect(res.mesh?.indices.length ?? 0).toBeGreaterThan(0);
    }, 120000);
  }

  it('reports a face width that is too wide for a bevel gear', async () => {
    const f = newBevelGear('f1', 'B1');
    f.faceWidth = 200;
    const res = await build(f);
    expect(res.status[0].ok).toBe(false);
    expect(res.status[0].error).toMatch(/third of the cone distance/);
  });

  it('reports a bore that is too large for a spur gear', async () => {
    const f = newSpurGear('f1', 'G1');
    f.bore = 100;
    const res = await build(f);
    expect(res.status[0].ok).toBe(false);
  });

  it('reports a centre distance that cannot clear both pulleys', async () => {
    const f = newVBelt('f1', 'V1');
    f.centerDistance = 50;
    const res = await build(f);
    expect(res.status[0].ok).toBe(false);
    expect(res.status[0].error).toMatch(/centre distance/);
  });
});
