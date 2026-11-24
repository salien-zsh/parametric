import { beforeAll, describe, expect, it } from 'vitest';
import init from 'replicad-opencascadejs';
import { ModelBuilder } from '../src/kernel/build';
import type { FaceInfo } from '../src/kernel/protocol';
import { setOc } from '../src/kernel/occ';
import { newMoveBody } from '../src/model/features';
import type { Feature } from '../src/model/types';
import { extrude, rect, req, sketch } from './helpers';

beforeAll(async () => {
  setOc(await init());
});

const plate = (): Feature[] => [sketch('s1', rect(0, 0, 60, 40)), extrude('e1', 's1', 10)];

const build = (features: Feature[]) => {
  const builder = new ModelBuilder();
  return builder.build(req(features) as never);
};

describe('move body', () => {
  it('shifts the whole body and keeps its faces', async () => {
    const features = plate();
    const plain = await build(features);
    const moved = await build([...features, { ...newMoveBody('m1', 'Move1'), dx: 10, dy: -5, dz: 2 }]);
    expect(moved.status[moved.status.length - 1].ok).toBe(true);
    expect(moved.bbox!.min[0]).toBeCloseTo(10, 5);
    expect(moved.bbox!.max[0]).toBeCloseTo(70, 5);
    expect(moved.bbox!.min[1]).toBeCloseTo(-5, 5);
    expect(moved.bbox!.min[2]).toBeCloseTo(2, 5);
    // The same faces are still there, now at the new position.
    const before = (plain.faces as FaceInfo[]).map((f) => f.name).sort();
    const after = (moved.faces as FaceInfo[]).map((f) => f.name).sort();
    expect(after).toEqual(before);
  });

  it('rotates the body about the world axes', async () => {
    const features = plate();
    const turned = await build([...features, { ...newMoveBody('m1', 'Move1'), dx: 0, dy: 0, dz: 0, rotZ: 90 }]);
    expect(turned.status[turned.status.length - 1].ok).toBe(true);
    // 0..60 x 0..40 turned 90 degrees about Z becomes -40..0 x 0..60.
    expect(turned.bbox!.min[0]).toBeCloseTo(-40, 4);
    expect(turned.bbox!.max[0]).toBeCloseTo(0, 4);
    expect(turned.bbox!.max[1]).toBeCloseTo(60, 4);
  });

  it('does nothing for a zero move and needs a body', async () => {
    const zero = await build([...plate(), { ...newMoveBody('m1', 'Move1'), dx: 0, dy: 0, dz: 0 }]);
    expect(zero.status[zero.status.length - 1].ok).toBe(true);
    const none = await build([{ ...newMoveBody('m1', 'Move1') }]);
    expect(none.status[none.status.length - 1].ok).toBe(false);
  });
});
