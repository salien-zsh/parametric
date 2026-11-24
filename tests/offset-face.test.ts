import { beforeAll, describe, expect, it } from 'vitest';
import init from 'replicad-opencascadejs';
import { ModelBuilder } from '../src/kernel/build';
import type { FaceInfo } from '../src/kernel/protocol';
import { setOc } from '../src/kernel/occ';
import { newOffsetFace } from '../src/model/features';
import type { FaceRef, Feature } from '../src/model/types';
import { circle, extrude, rect, req, sketch } from './helpers';

beforeAll(async () => {
  setOc(await init());
});

const faceRef = (f: FaceInfo): FaceRef => ({ name: f.name, sig: { type: f.type, c: f.center, n: f.normal, area: f.area } });
const plate = (): Feature[] => [sketch('s1', rect(0, 0, 60, 40)), extrude('e1', 's1', 10)];

const topFace = (faces: FaceInfo[]) => faces.find((f) => f.type === 'plane' && Math.abs((f.normal?.[2] ?? 0) - 1) < 1e-6)!;

const build = async (features: Feature[]) => {
  const builder = new ModelBuilder();
  return builder.build(req(features) as never);
};

describe('offset face', () => {
  it('pushes a face out and cuts it in', async () => {
    const plain = await build(plate());
    const face = faceRef(topFace(plain.faces as FaceInfo[]));
    const out = await build([...plate(), { ...newOffsetFace('o1', 'Offset1'), face, offset: 5 }]);
    expect(out.status[out.status.length - 1].ok).toBe(true);
    expect(out.bbox!.max[2]).toBeCloseTo(15, 4);
    const inward = await build([...plate(), { ...newOffsetFace('o1', 'Offset1'), face, offset: -3 }]);
    expect(inward.status[inward.status.length - 1].ok).toBe(true);
    expect(inward.bbox!.max[2]).toBeCloseTo(7, 4);
  });

  it('rejects a zero offset and a curved face', async () => {
    const plain = await build(plate());
    const face = faceRef(topFace(plain.faces as FaceInfo[]));
    const zero = await build([...plate(), { ...newOffsetFace('o1', 'Offset1'), face, offset: 0 }]);
    expect(zero.status[zero.status.length - 1].ok).toBe(false);
    const cylinder = await build([sketch('s2', circle(0, 0, 10)), extrude('e2', 's2', 30)]);
    const curved = (cylinder.faces as FaceInfo[]).find((f) => f.type === 'cylinder')!;
    const bad = await build([sketch('s2', circle(0, 0, 10)), extrude('e2', 's2', 30), { ...newOffsetFace('o1', 'Offset1'), face: faceRef(curved) }]);
    expect(bad.status[bad.status.length - 1].ok).toBe(false);
  });
});
