import { beforeAll, describe, expect, it } from 'vitest';
import init from 'replicad-opencascadejs';
import { ModelBuilder } from '../src/kernel/build';
import { setOc } from '../src/kernel/occ';
import { newExtrude } from '../src/model/features';
import { extrude, rect, req, sketch } from './helpers';

beforeAll(async () => {
  setOc(await init());
});

const plate = () => [sketch('s1', rect(0, 0, 40, 40)), extrude('e1', 's1', 10)];

const build = (features: ReturnType<typeof plate>) => {
  const builder = new ModelBuilder();
  return builder.build(req(features) as never);
};

describe('extrude intersect', () => {
  it('keeps only the shared material', async () => {
    const plain = await build(plate());
    const cut = {
      ...newExtrude('e2', 'Extrude2', 's2', false, 10),
      intersect: true,
    };
    const features = [...plate(), sketch('s2', rect(0, 0, 40, 20))] as ReturnType<typeof plate>;
    const res = await build([...features, cut]);
    expect(res.status[res.status.length - 1].ok).toBe(true);
    expect(res.bbox!.max[1]).toBeCloseTo(20, 4);
    expect(res.bbox!.max[0]).toBeCloseTo(40, 4);
    void plain;
  });

  it('needs a body to intersect with', async () => {
    const res = await build([{ ...newExtrude('e2', 'Extrude2', 's1', false, 10), intersect: true }] as ReturnType<typeof plate>);
    expect(res.status[res.status.length - 1].ok).toBe(false);
  });
});
