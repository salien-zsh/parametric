import { beforeAll, describe, expect, it } from 'vitest';
import init from 'replicad-opencascadejs';
import { ModelBuilder } from '../src/kernel/build';
import type { FaceInfo } from '../src/kernel/protocol';
import { setOc } from '../src/kernel/occ';
import { newExtrude, newSplitBody } from '../src/model/features';
import type { Feature } from '../src/model/types';
import { extrude, rect, req, sketch } from './helpers';

beforeAll(async () => {
  setOc(await init());
});

const build = (features: Feature[]) => {
  const builder = new ModelBuilder();
  return builder.build(req(features) as never);
};

const plate = (): Feature[] => [sketch('s1', rect(0, 0, 20, 10)), extrude('e1', 's1', 10)];
const second = (): Feature[] => [sketch('s2', rect(40, 0, 60, 10))];

describe('multiple bodies', () => {
  it('keeps a new extrusion as its own body', async () => {
    const features = [...plate(), ...second(), { ...newExtrude('e2', 'Extrude2', 's2', false, 10), newBody: true }];
    const res = await build(features);
    expect(res.status[res.status.length - 1].ok).toBe(true);
    expect(res.bodies).toBe(2);
    expect(res.bbox!.min[0]).toBeCloseTo(0, 4);
    expect(res.bbox!.max[0]).toBeCloseTo(60, 4);
    // Both boxes contribute their six faces; the new one carries a body suffix.
    expect((res.faces as FaceInfo[]).length).toBeGreaterThanOrEqual(12);
    expect((res.faces as FaceInfo[]).some((f) => f.name.includes('@b1'))).toBe(true);
  });

  it('joins into one body unless New body is set', async () => {
    const features = [...plate(), ...second(), newExtrude('e2', 'Extrude2', 's2', false, 10)];
    const res = await build(features);
    expect(res.status[res.status.length - 1].ok).toBe(true);
    expect(res.bodies).toBe(1);
  });

  it('Split Body can keep both halves', async () => {
    const plate40: Feature[] = [sketch('s1', rect(0, 0, 40, 20)), extrude('e1', 's1', 10)];
    const res = await build([...plate40, { ...newSplitBody('sp1', 'Split1'), axis: 'x', offset: 20, keepBoth: true }]);
    expect(res.status[res.status.length - 1].ok).toBe(true);
    expect(res.bodies).toBe(2);
    expect(res.bbox!.min[0]).toBeCloseTo(0, 4);
    expect(res.bbox!.max[0]).toBeCloseTo(40, 4);
  });
});
