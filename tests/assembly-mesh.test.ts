// Assembly builds return per-component faces and edges: a pick can select the
// component, and joints can grip its geometry.
import { beforeAll, describe, expect, it } from 'vitest';
import init from 'replicad-opencascadejs';
import { ModelBuilder } from '../src/kernel/build';
import { setOc } from '../src/kernel/occ';
import type { AssemblyBuildComponent } from '../src/kernel/protocol';
import type { Feature } from '../src/model/types';
import { req } from './helpers';
import { extrude, rect, sketch } from './helpers';

beforeAll(async () => {
  setOc(await init());
});

const boxPart = (depth: number): Feature[] => [sketch('S1', rect(0, 0, 40, 20)), extrude('E1', 'S1', depth)];

const component = (id: string, name: string, x: number): AssemblyBuildComponent => ({
  id, name, features: boxPart(10), upTo: 2, blobs: {}, visible: true,
  transform: { position: [x, 0, 0], rotation: [0, 0, 0] },
});

describe('assembly mesh metadata', () => {
  it('tags every face and edge with its component', async () => {
    const b = new ModelBuilder();
    const res = await b.build({ ...req([], { components: [component('c1', 'Base', 0), component('c2', 'Bracket', 100)] }), features: [], upTo: 0 } as never);
    expect(res.status.every((s) => s.ok)).toBe(true);
    expect(res.faces).toHaveLength(12);
    expect(res.edges).toHaveLength(24);
    expect(res.faces.every((f) => f.component === 'c1' || f.component === 'c2')).toBe(true);
    expect(new Set(res.faces.map((f) => f.component))).toEqual(new Set(['c1', 'c2']));
    expect(new Set(res.edges.map((e) => e.component))).toEqual(new Set(['c1', 'c2']));
    // Faces are in world space, named after their component.
    const base = res.faces.filter((f) => f.component === 'c1');
    const bracket = res.faces.filter((f) => f.component === 'c2');
    expect(base.every((f) => f.center[0] >= -1e-6 && f.center[0] <= 40 + 1e-6)).toBe(true);
    expect(bracket.every((f) => f.center[0] >= 100 - 1e-6 && f.center[0] <= 140 + 1e-6)).toBe(true);
    expect(base.every((f) => f.name.startsWith('c1/'))).toBe(true);
    // The mesh maps every vertex to one of those faces.
    const mesh = res.mesh!;
    expect(mesh.vertexFace.length).toBe(mesh.positions.length / 3);
    expect([...mesh.vertexFace].every((i) => i >= 0 && i < res.faces.length)).toBe(true);
    expect([...mesh.edgeIds].every((i) => i >= 0 && i < res.edges.length)).toBe(true);
    // Each box's 6 faces carry triangles, so every face index is used.
    const used = new Set([...mesh.vertexFace].map((v) => Math.round(v)));
    expect(used.size).toBe(12);
  }, 120000);

  it('keeps a component face normal usable as a joint connector', async () => {
    const b = new ModelBuilder();
    const res = await b.build({ ...req([], { components: [component('c1', 'Base', 0)] }), features: [], upTo: 0 } as never);
    const top = res.faces.find((f) => f.type === 'plane' && Math.abs((f.normal?.[2] ?? 0) - 1) < 1e-6)!;
    expect(top).toBeTruthy();
    expect(top.center[2]).toBeCloseTo(10, 6);
    expect(top.normal![2]).toBeCloseTo(1, 6);
    const circle = res.edges.find((e) => e.type === 'circle');
    expect(circle).toBeUndefined();
    const line = res.edges.find((e) => e.type === 'line' && Math.abs(e.mid[2]) < 1e-6)!;
    expect(line.dir).toBeTruthy();
    expect(Math.abs(line.dir![2])).toBeLessThan(1e-6);
  }, 120000);
});
