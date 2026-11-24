import { beforeAll, describe, expect, it } from 'vitest';
import init from 'replicad-opencascadejs';
import { ModelBuilder } from '../src/kernel/build';
import type { FaceInfo } from '../src/kernel/protocol';
import { setOc } from '../src/kernel/occ';
import { newThread } from '../src/model/features';
import type { FaceRef, Feature } from '../src/model/types';
import { circle, extrude, req, sketch } from './helpers';

beforeAll(async () => {
  setOc(await init());
});

const faceRef = (f: FaceInfo): FaceRef => ({ name: f.name, sig: { type: f.type, c: f.center, n: f.normal, area: f.area } });
const base = (): Feature[] => [sketch('s1', circle(0, 0, 10)), extrude('e1', 's1', 40)];

const build = async (features: Feature[]) => {
  const builder = new ModelBuilder();
  const res = await builder.build(req(features) as never);
  return { builder, res };
};

describe('thread feature', () => {
  it('cuts a helical groove into a cylindrical face', async () => {
    const { res: plain } = await build(base());
    const cylinder = (plain.faces as FaceInfo[]).find((f) => f.type === 'cylinder')!;
    expect(cylinder).toBeTruthy();
    const { res } = await build([...base(), { ...newThread('t1', 'Thread1'), face: faceRef(cylinder), pitch: 2, length: 20, depth: 1.2 }]);
    expect(res.status[res.status.length - 1].ok).toBe(true);
    // The groove is cut into the surface: the outline stays the same.
    expect(res.bbox!.max[2]).toBeCloseTo(plain.bbox!.max[2], 3);
    expect((res.faces as FaceInfo[]).length).toBeGreaterThan((plain.faces as FaceInfo[]).length);
  });

  it('supports a left-hand thread', async () => {
    const { res: plain } = await build(base());
    const cylinder = (plain.faces as FaceInfo[]).find((f) => f.type === 'cylinder')!;
    const { res } = await build([...base(), { ...newThread('t1', 'Thread1'), face: faceRef(cylinder), left: true }]);
    expect(res.status[res.status.length - 1].ok).toBe(true);
  });

  it('rejects planar faces and too deep threads', async () => {
    const { res: plain } = await build(base());
    const planar = (plain.faces as FaceInfo[]).find((f) => f.type === 'plane')!;
    const cylinder = (plain.faces as FaceInfo[]).find((f) => f.type === 'cylinder')!;
    const wrongFace = await build([...base(), { ...newThread('t1', 'Thread1'), face: faceRef(planar) }]);
    expect(wrongFace.res.status[wrongFace.res.status.length - 1].ok).toBe(false);
    const tooDeep = await build([...base(), { ...newThread('t1', 'Thread1'), face: faceRef(cylinder), depth: 20 }]);
    expect(tooDeep.res.status[tooDeep.res.status.length - 1].ok).toBe(false);
  });
});
