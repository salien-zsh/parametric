import { beforeAll, describe, expect, it } from 'vitest';
import init from 'replicad-opencascadejs';
import { ModelBuilder } from '../src/kernel/build';
import type { FaceInfo } from '../src/kernel/protocol';
import { setOc } from '../src/kernel/occ';
import { newScaleBody } from '../src/model/features';
import type { Feature } from '../src/model/types';
import { extrude, rect, req, sketch } from './helpers';

beforeAll(async () => {
  setOc(await init());
});

const plate = (): Feature[] => [sketch('s1', rect(0, 0, 20, 20)), extrude('e1', 's1', 10)];

const build = (features: Feature[]) => {
  const builder = new ModelBuilder();
  return builder.build(req(features) as never);
};

describe('scale body', () => {
  it('scales the body about the origin and keeps its faces', async () => {
    const features = plate();
    const plain = await build(features);
    const scaled = await build([...features, { ...newScaleBody('sc1', 'Scale1'), factor: 2 }]);
    expect(scaled.status[scaled.status.length - 1].ok).toBe(true);
    expect(scaled.bbox!.max[0]).toBeCloseTo(40, 4);
    expect(scaled.bbox!.max[2]).toBeCloseTo(20, 4);
    const names = (res: typeof plain) => (res.faces as FaceInfo[]).map((f) => f.name).sort();
    expect(names(scaled)).toEqual(names(plain));
  });

  it('rejects a non-positive factor and needs a body', async () => {
    const bad = await build([...plate(), { ...newScaleBody('sc1', 'Scale1'), factor: 0 }]);
    expect(bad.status[bad.status.length - 1].ok).toBe(false);
    const none = await build([{ ...newScaleBody('sc1', 'Scale1') }]);
    expect(none.status[none.status.length - 1].ok).toBe(false);
  });
});
