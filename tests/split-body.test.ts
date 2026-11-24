import { beforeAll, describe, expect, it } from 'vitest';
import init from 'replicad-opencascadejs';
import { ModelBuilder } from '../src/kernel/build';
import { setOc } from '../src/kernel/occ';
import { newSplitBody } from '../src/model/features';
import type { Feature } from '../src/model/types';
import { extrude, rect, req, sketch } from './helpers';

beforeAll(async () => {
  setOc(await init());
});

const plate = (): Feature[] => [sketch('s1', rect(0, 0, 40, 40)), extrude('e1', 's1', 10)];

const build = (features: Feature[]) => {
  const builder = new ModelBuilder();
  return builder.build(req(features) as never);
};

describe('split body', () => {
  it('keeps the requested side of an axis plane', async () => {
    const positive = await build([...plate(), { ...newSplitBody('sp1', 'Split1'), axis: 'x', offset: 20 }]);
    expect(positive.status[positive.status.length - 1].ok).toBe(true);
    expect(positive.bbox!.min[0]).toBeCloseTo(20, 4);
    expect(positive.bbox!.max[0]).toBeCloseTo(40, 4);
    const negative = await build([...plate(), { ...newSplitBody('sp1', 'Split1'), axis: 'x', offset: 20, flip: true }]);
    expect(negative.status[negative.status.length - 1].ok).toBe(true);
    expect(negative.bbox!.min[0]).toBeCloseTo(0, 4);
    expect(negative.bbox!.max[0]).toBeCloseTo(20, 4);
  });

  it('rejects a plane outside the body and a missing body', async () => {
    const outside = await build([...plate(), { ...newSplitBody('sp1', 'Split1'), axis: 'x', offset: 100 }]);
    expect(outside.status[outside.status.length - 1].ok).toBe(false);
    const none = await build([{ ...newSplitBody('sp1', 'Split1') }]);
    expect(none.status[none.status.length - 1].ok).toBe(false);
  });
});
