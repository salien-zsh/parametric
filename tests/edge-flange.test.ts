import { beforeAll, describe, expect, it } from 'vitest';
import init from 'replicad-opencascadejs';
import { ModelBuilder } from '../src/kernel/build';
import { setOc } from '../src/kernel/occ';
import { newBaseFlange, newEdgeFlange } from '../src/model/features';
import type { Feature } from '../src/model/types';
import { rect, req, sketch } from './helpers';

beforeAll(async () => {
  setOc(await init());
});

const build = (features: Feature[]) => {
  const builder = new ModelBuilder();
  return builder.build(req(features) as never);
};

describe('edge flange', () => {
  it('bends a wall up along a straight edge of the sheet', async () => {
    const base: Feature[] = [sketch('s1', rect(0, 0, 30, 20)), { ...newBaseFlange('bf1', 'Base Flange1'), sketch: 's1', thickness: 2 }];
    const before = await build(base);
    expect(before.status[before.status.length - 1].ok).toBe(true);
    // The top edge at y = 20 running along X.
    const edge = before.edges.find((e) => e.type === 'line'
      && Math.abs(e.mid[1] - 20) < 1e-6 && Math.abs(e.mid[2] - 2) < 1e-6
      && Math.abs(Math.abs(e.dir![0]) - 1) < 1e-6);
    expect(edge).toBeTruthy();
    const flange = {
      ...newEdgeFlange('ef1', 'Edge Flange1'),
      edge: { name: edge!.name, sig: { type: 'line' as const, m: edge!.mid, len: edge!.length } },
      length: 15,
      angle: 90,
    };
    const after = await build([...base, flange]);
    expect(after.status[after.status.length - 1].ok).toBe(true);
    expect(after.bbox!.max[2]).toBeGreaterThan(13);
    expect(after.bbox!.max[2]).toBeLessThan(20);
    // Still one sheet-metal body joined to the base.
    expect(after.bodies).toBe(1);
    // The bend follows an arc (faceted approximation), so many more faces.
    expect(after.faces.length).toBeGreaterThan(before.faces.length + 10);
  });

  it('needs a straight edge', async () => {
    const base: Feature[] = [sketch('s1', rect(0, 0, 30, 20)), { ...newBaseFlange('bf1', 'Base Flange1'), sketch: 's1', thickness: 2 }];
    const bad = { ...newEdgeFlange('ef1', 'Edge Flange1'), edge: { name: 'missing', sig: { type: 'line' as const, m: [0, 0, 0] as [number, number, number], len: 10 } }, length: 10, angle: 90 };
    const res = await build([...base, bad]);
    expect(res.status[res.status.length - 1].ok).toBe(false);
  });
});
