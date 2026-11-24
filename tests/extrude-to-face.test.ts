import { beforeAll, describe, expect, it } from 'vitest';
import init from 'replicad-opencascadejs';
import { ModelBuilder } from '../src/kernel/build';
import type { FaceInfo } from '../src/kernel/protocol';
import { setOc } from '../src/kernel/occ';
import { newExtrude } from '../src/model/features';
import type { FaceRef, Feature } from '../src/model/types';
import { extrude, rect, req, sketch } from './helpers';

beforeAll(async () => {
  setOc(await init());
});

const faceRef = (f: FaceInfo): FaceRef => ({ name: f.name, sig: { type: f.type, c: f.center, n: f.normal, area: f.area } });
const plate = (): Feature[] => [sketch('s1', rect(0, 0, 40, 40)), extrude('e1', 's1', 10)];

const build = (features: Feature[]) => {
  const builder = new ModelBuilder();
  return builder.build(req(features) as never);
};

describe('extrude to face', () => {
  it('stops at the picked planar face', async () => {
    const plain = await build(plate());
    const top = (plain.faces as FaceInfo[]).find((f) => f.type === 'plane' && Math.abs((f.normal?.[2] ?? 0) - 1) < 1e-6)!;
    const boss: Feature = {
      ...newExtrude('e2', 'Extrude2', 's2', false, 10),
      end: 'toObject',
      toFace: faceRef(top),
    };
    const res = await build([...plate(), sketch('s2', rect(50, 0, 60, 10)), boss]);
    expect(res.status[res.status.length - 1].ok).toBe(true);
    expect(res.bbox!.max[0]).toBeCloseTo(60, 4);
    expect(res.bbox!.max[2]).toBeGreaterThan(10);
    expect(res.bbox!.max[2]).toBeLessThan(10.01);
  });

  it('needs a face when stopping to an object', async () => {
    const res = await build([...plate(), sketch('s2', rect(50, 0, 60, 10)), { ...newExtrude('e2', 'Extrude2', 's2', false, 10), end: 'toObject' }]);
    expect(res.status[res.status.length - 1].ok).toBe(false);
  });
});
