import { beforeAll, describe, expect, it } from 'vitest';
import init from 'replicad-opencascadejs';
import { ModelBuilder } from '../src/kernel/build';
import { setOc } from '../src/kernel/occ';
import { extrude, rect, req, sketch } from './helpers';

beforeAll(async () => {
  setOc(await init());
});

const build = (features: ReturnType<typeof plate>) => {
  const builder = new ModelBuilder();
  return builder.build(req(features) as never);
};
const plate = () => [sketch('s1', rect(0, 0, 20, 20)), extrude('e1', 's1', 10)];

describe('extrude start offset', () => {
  it('starts the extrusion away from the sketch plane', async () => {
    // A single extrusion: with an existing body it would join and 0..10 stays.
    const res = await build([sketch('s1', rect(0, 0, 20, 20)), { ...extrude('e1', 's1', 10), startOffset: 5 }]);
    expect(res.status[res.status.length - 1].ok).toBe(true);
    expect(res.bbox!.max[2] - res.bbox!.min[2]).toBeCloseTo(10, 4);
    expect(Math.abs(res.bbox!.min[2])).toBeCloseTo(5, 4);
  });

  it('rejects a start offset combined with a draft', async () => {
    const res = await build([...plate(), { ...extrude('e1', 's1', 10), startOffset: 5, draft: 3 }]);
    expect(res.status[res.status.length - 1].ok).toBe(false);
  });
});
