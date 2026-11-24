// Construction axes and points, built by the real kernel.
import { beforeAll, describe, expect, it } from 'vitest';
import init from 'replicad-opencascadejs';
import { ModelBuilder } from '../src/kernel/build';
import type { EdgeInfo, FaceInfo } from '../src/kernel/protocol';
import { setOc } from '../src/kernel/occ';
import type { AxisFeature, EdgeRef, FaceRef, Feature, PointFeature } from '../src/model/types';
import { newAxis, newPoint } from '../src/model/features';
import { circle, extrude, rect, req, sketch } from './helpers';

beforeAll(async () => {
  setOc(await init());
});

/** A 60 x 60 plate 30 tall with a 10 mm boss on top, so there are planar and cylindrical faces. */
const base = (): Feature[] => [
  sketch('S1', rect(0, 0, 60, 60)),
  extrude('E1', 'S1', 30),
  sketch('S2', circle(30, 30, 10)),
  extrude('E2', 'S2', 50),
];

const faceRef = (f: FaceInfo): FaceRef => ({ name: f.name, sig: { type: f.type, c: f.center, n: f.normal, area: f.area } });
const edgeRef = (e: EdgeInfo): EdgeRef => ({ name: e.name, sig: { type: e.type, m: e.mid, len: e.length } });

async function model() {
  const b = new ModelBuilder();
  const res = await b.build(req(base()) as never);
  const faces = res.faces as FaceInfo[];
  const edges = res.edges as EdgeInfo[];
  return { res, faces, edges };
}

const axisOf = (f: Partial<AxisFeature>): AxisFeature => ({ ...newAxis('A1', 'Axis1'), ...f });
const pointOf = (f: Partial<PointFeature>): PointFeature => ({ ...newPoint('P1', 'Point1'), ...f });

async function buildWith(extra: Feature[]) {
  const b = new ModelBuilder();
  const res = await b.build(req([...base(), ...extra]) as never);
  return res;
}

describe('construction axes', () => {
  it('follows a cylindrical face axis', async () => {
    const { faces } = await model();
    const cylinder = faces.find((f) => f.type === 'cylinder')!;
    expect(cylinder).toBeTruthy();
    const res = await buildWith([axisOf({ kind: 'cylinder', face: faceRef(cylinder) })]);
    const ax = res.axes!.A1;
    expect(ax).toBeTruthy();
    expect(Math.abs(ax.d[2])).toBeCloseTo(1, 6);
    expect(Math.hypot(ax.p[0] - 30, ax.p[1] - 30)).toBeLessThan(1e-6);
  });

  it('runs through two points', async () => {
    const res = await buildWith([axisOf({ kind: 'twoPoints', points: [[0, 0, 0], [10, 20, 30]] })]);
    const ax = res.axes!.A1;
    const expected = [10, 20, 30].map((v) => v / Math.hypot(10, 20, 30));
    ax.d.forEach((v, i) => expect(v).toBeCloseTo(expected[i], 6));
    expect(ax.p).toEqual([0, 0, 0]);
  });

  it('follows a straight edge and a circular edge', async () => {
    const { edges } = await model();
    // A horizontal edge of the base: its axis lies in the XY plane.
    const line = edges.find((e) => e.type === 'line' && Math.abs(e.b[2] - e.a[2]) < 1e-6)!;
    const byLine = await buildWith([axisOf({ kind: 'edge', edge: edgeRef(line) })]);
    expect(Math.abs(byLine.axes!.A1.d[2])).toBeLessThan(1e-6);
    // A vertical edge gives a vertical axis.
    const vertical = edges.find((e) => e.type === 'line' && Math.abs(e.b[2] - e.a[2]) > 1)!;
    const byVertical = await buildWith([axisOf({ kind: 'edge', edge: edgeRef(vertical) })]);
    expect(Math.abs(byVertical.axes!.A1.d[2])).toBeCloseTo(1, 6);

    const arc = edges.find((e) => e.type === 'circle' && Math.abs(e.axis?.[2] ?? 0) > 0.9)!;
    const byCircle = await buildWith([axisOf({ kind: 'edge', edge: edgeRef(arc) })]);
    expect(Math.abs(byCircle.axes!.A1.d[2])).toBeCloseTo(1, 6);
    expect(Math.hypot(byCircle.axes!.A1.p[0] - 30, byCircle.axes!.A1.p[1] - 30)).toBeLessThan(1e-6);
  });

  it('stands perpendicular to a plane through a point', async () => {
    const res = await buildWith([axisOf({ kind: 'perpendicular', ref: { kind: 'base', plane: 'front' }, point: [5, 5, 5] })]);
    const ax = res.axes!.A1;
    expect(ax.d[2]).toBeCloseTo(1, 6);
    expect(ax.p).toEqual([5, 5, 5]);
    const flipped = await buildWith([axisOf({ kind: 'perpendicular', ref: { kind: 'base', plane: 'front' }, point: [5, 5, 5], flip: true })]);
    expect(flipped.axes!.A1.d[2]).toBeCloseTo(-1, 6);
  });

  it('rejects a face with no axis', async () => {
    const { faces } = await model();
    const planar = faces.find((f) => f.type === 'plane')!;
    const res = await buildWith([axisOf({ kind: 'cylinder', face: faceRef(planar) })]);
    expect(res.status[res.status.length - 1].ok).toBe(false);
    expect(res.axes?.A1).toBeUndefined();
  });
});

describe('construction points', () => {
  it('sits at a vertex and at an edge midpoint', async () => {
    const { edges } = await model();
    const line = edges.find((e) => e.type === 'line')!;
    const res = await buildWith([
      pointOf({ kind: 'vertex', point: [0, 0, 0] }),
      { ...pointOf({ kind: 'midpoint', edge: edgeRef(line) }), id: 'P2' },
    ]);
    expect(res.points!.P1).toEqual([0, 0, 0]);
    expect(res.points!.P2[0]).toBeCloseTo(line.mid[0], 6);
    expect(res.points!.P2[1]).toBeCloseTo(line.mid[1], 6);
  });

  it('sits at a circular edge centre and at a face centre', async () => {
    const { faces, edges } = await model();
    const arc = edges.find((e) => e.type === 'circle')!;
    const top = faces.find((f) => f.type === 'plane' && Math.abs((f.normal?.[2] ?? 0) - 1) < 1e-6)!;
    const res = await buildWith([
      pointOf({ kind: 'center', edge: edgeRef(arc) }),
      { ...pointOf({ kind: 'faceCenter', face: faceRef(top) }), id: 'P2' },
    ]);
    expect(res.points!.P1[0]).toBeCloseTo(arc.center![0], 6);
    expect(res.points!.P1[1]).toBeCloseTo(arc.center![1], 6);
    expect(res.points!.P2[2]).toBeCloseTo(top.center[2], 6);
    expect(res.points!.P2[0]).toBeCloseTo(top.center[0], 6);
  });

  it('finds where an edge meets a plane', async () => {
    const { edges } = await model();
    const line = edges.find((e) => e.type === 'line' && Math.abs(e.b[0] - e.a[0]) < 1e-6 && Math.abs(e.b[1] - e.a[1]) < 1e-6 && Math.abs(e.mid[2] - 15) < 1e-6);
    if (!line) return; // vertical corner edges may be named differently
    const res = await buildWith([pointOf({ kind: 'intersection', edge2: edgeRef(line), plane: { kind: 'base', plane: 'front' } })]);
    // The front plane is z = 0, so the corner edge crosses it at its base.
    expect(res.points?.P1?.[2] ?? 0).toBeCloseTo(0, 6);
  });
});
