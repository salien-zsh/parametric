// The construction planes Fusion offers besides offset/midplane/angle: tangent
// to a curved face, through two edges and through three points.
import { beforeAll, describe, expect, it } from 'vitest';
import init from 'replicad-opencascadejs';
import { ModelBuilder } from '../src/kernel/build';
import type { EdgeInfo, FaceInfo } from '../src/kernel/protocol';
import { setOc } from '../src/kernel/occ';
import type { EdgeRef, FaceRef, Feature, PlaneFeature } from '../src/model/types';
import { newPlane } from '../src/model/features';
import { circle, extrude, rect, req, sketch } from './helpers';

beforeAll(async () => {
  setOc(await init());
});

const base = (): Feature[] => [sketch('S1', rect(0, 0, 100, 60)), extrude('E1', 'S1', 20)];

const planeOf = (extra: Partial<PlaneFeature>): PlaneFeature => ({ ...newPlane('P1', 'Plane1', null, 0), ...extra });

/** Face refs and edge refs of the built box, by index into the result. */
async function box() {
  const b = new ModelBuilder();
  const res = await b.build(req(base()) as never);
  const faces = res.faces as FaceInfo[];
  const edges = res.edges as EdgeInfo[];
  const faceRefOf = (i: number): FaceRef => ({ name: faces[i].name, sig: { type: faces[i].type, c: faces[i].center, n: faces[i].normal, area: faces[i].area } });
  const edgeRefOf = (i: number): EdgeRef => ({ name: edges[i].name, sig: { type: edges[i].type, m: edges[i].mid, len: edges[i].length } });
  return { b, res, faces, edges, faceRefOf, edgeRefOf };
}

async function buildWith(plane: PlaneFeature) {
  const b = new ModelBuilder();
  const res = await b.build(req([...base(), plane]) as never);
  return { res, frame: res.frames[plane.id], status: res.status[res.status.length - 1] };
}

describe('construction planes', () => {
  it('builds a plane through three points', async () => {
    const plane = planeOf({ kind: 'threePoints', points: [[0, 0, 0], [100, 0, 0], [0, 60, 0]] });
    const { frame, status } = await buildWith(plane);
    expect(status.ok).toBe(true);
    expect(Math.abs(frame.n[2])).toBeCloseTo(1, 6);
    expect(frame.o[2]).toBeCloseTo(0, 6);
    // The plane's X axis follows the first two points.
    expect(frame.x[0]).toBeCloseTo(1, 6);
  });

  it('rejects three points on one line', async () => {
    const plane = planeOf({ kind: 'threePoints', points: [[0, 0, 0], [50, 0, 0], [100, 0, 0]] });
    const { status } = await buildWith(plane);
    expect(status.ok).toBe(false);
    expect(status.error).toMatch(/one line/);
  });

  it('builds a plane through two straight edges', async () => {
    const { edges, edgeRefOf } = await box();
    const lines = edges.map((e, i) => ({ e, i })).filter(({ e }) => e.type === 'line' && Math.abs(e.mid[2]) < 1e-6);
    const alongX = lines.find(({ e }) => Math.abs(e.b[1] - e.a[1]) < 1e-6)!;
    const alongY = lines.find(({ e }) => Math.abs(e.b[0] - e.a[0]) < 1e-6)!;
    const plane = planeOf({ kind: 'twoEdges', edges: [edgeRefOf(alongX.i), edgeRefOf(alongY.i)] });
    const { frame, status } = await buildWith(plane);
    expect(status.ok).toBe(true);
    expect(Math.abs(frame.n[2])).toBeCloseTo(1, 6);
    expect(frame.o[2]).toBeCloseTo(0, 6);
  });

  it('rejects parallel edges', async () => {
    const { edges, edgeRefOf } = await box();
    const parallel = edges.map((e, i) => ({ e, i })).filter(({ e }) => e.type === 'line' &&
      Math.abs(e.b[1] - e.a[1]) < 1e-6 && Math.abs(e.b[2] - e.a[2]) < 1e-6);
    const plane = planeOf({ kind: 'twoEdges', edges: [edgeRefOf(parallel[0].i), edgeRefOf(parallel[1].i)] });
    const { status } = await buildWith(plane);
    expect(status.ok).toBe(false);
    expect(status.error).toMatch(/parallel/);
  });

  it('builds a tangent plane on a cylinder at its face centre', async () => {
    const b = new ModelBuilder();
    const built = await b.build(req([sketch('C1', circle(0, 0, 20)), extrude('E1', 'C1', 30)]) as never);
    const cylinder = (built.faces as FaceInfo[]).find((f) => f.type === 'cylinder')!;
    expect(cylinder).toBeTruthy();
    const plane = planeOf({
      kind: 'tangent',
      face: { name: cylinder.name, sig: { type: cylinder.type, c: cylinder.center, n: cylinder.normal, area: cylinder.area } },
    });
    const res = await (async () => {
      const nb = new ModelBuilder();
      return nb.build(req([sketch('C1', circle(0, 0, 20)), extrude('E1', 'C1', 30), plane]) as never);
    })();
    expect(res.status[res.status.length - 1].ok).toBe(true);
    const frame = res.frames[plane.id];
    // The plane touches the cylinder wall: its origin is on the radius, its
    // normal is radial and horizontal.
    expect(Math.hypot(frame.o[0], frame.o[1])).toBeCloseTo(20, 4);
    expect(frame.n[2]).toBeCloseTo(0, 6);
    expect(Math.abs(Math.hypot(frame.n[0], frame.n[1]) - 1)).toBeLessThan(1e-6);
  });

  it('rejects a tangent plane on a planar face', async () => {
    const { faces, faceRefOf } = await box();
    const capIndex = faces.findIndex((f) => f.type === 'plane' && Math.abs((f.normal?.[2] ?? 0) - 1) < 1e-6);
    const plane = planeOf({ kind: 'tangent', face: faceRefOf(capIndex) });
    const { status } = await buildWith(plane);
    expect(status.ok).toBe(false);
    expect(status.error).toMatch(/planar/);
  });
});
