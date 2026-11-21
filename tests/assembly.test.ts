import { beforeAll, describe, expect, it } from 'vitest';
import init from 'replicad-opencascadejs';
import { ModelBuilder } from '../src/kernel/build';
import { setOc } from '../src/kernel/occ';
import { assemblyDiagnostics, assemblyTransforms, componentTransform, jointValue, movableJoints, solveAssemblyTransforms } from '../src/model/assembly';
import { serializeDocument, isAssembly, newAssembly, newDocument, parseDocument } from '../src/model/document';
import { extrude, rect, req, sketch } from './helpers';

beforeAll(async () => {
  setOc(await init());
});

describe('assembly documents', () => {
  it('round-trips placed part documents and their transforms', () => {
    const assembly = newAssembly('Fixture');
    expect(isAssembly(assembly)).toBe(true);
    const part = newDocument('Plate');
    part.features = [sketch('s1', rect(0, 0, 40, 20)), extrude('e1', 's1', 8)];
    assembly.components = [
      {
        id: 'c1', name: 'Plate1', part,
        transform: { position: [25, -5, 12], rotation: [0, 90, 0] },
        visible: true, fixed: true,
      },
      {
        id: 'c2', name: 'Plate2', part,
        transform: { position: [80, 0, 0], rotation: [0, 0, 0] },
        visible: true,
      },
    ];
    assembly.mates = [{ id: 'm1', name: 'Offset', type: 'distance', a: 'c1', b: 'c2', axis: 'x', value: 30 }];
    assembly.joints = [{ id: 'j1', name: 'Slide', type: 'prismatic', component: 'c2', axis: 'z', value: 4, min: -20, max: 20 }];
    const back = parseDocument(serializeDocument(assembly));
    expect(back.kind).toBe('assembly');
    expect(back.components).toHaveLength(2);
    expect(back.components![0]).toMatchObject({
      id: 'c1',
      name: 'Plate1',
      transform: { position: [25, -5, 12], rotation: [0, 90, 0] },
      visible: true,
      part: { kind: 'part', name: 'Plate' },
    });
    expect(back.components![0].part.features).toHaveLength(2);
    expect(back.mates).toEqual([{ ...assembly.mates![0], aRef: 'origin', bRef: 'origin' }]);
    expect(back.joints).toEqual([{
      ...assembly.joints![0], axis2: 'y', value2: 0, min2: -180, max2: 180,
    }]);
  });

  it('refuses malformed component lists and nested assemblies', () => {
    const assembly = newAssembly();
    expect(() => parseDocument(JSON.stringify({ ...assembly, components: undefined }))).toThrow(/component list/);
    expect(() => parseDocument(JSON.stringify({
      ...assembly,
      components: [{ id: 'c1', name: 'Nested', part: newAssembly('Nested'), transform: {}, visible: true }],
    }))).toThrow(/Nested assemblies/);
    const part = newDocument('Part');
    assembly.components = [
      { id: 'c1', name: 'A', part, transform: { position: [0, 0, 0], rotation: [0, 0, 0] }, visible: true },
      { id: 'c2', name: 'B', part, transform: { position: [0, 0, 0], rotation: [0, 0, 0] }, visible: true },
    ];
    assembly.mates = [{ id: 'm1', name: 'Bad', type: 'bad' as never, a: 'c1', b: 'c2', axis: 'x', value: 0 }];
    expect(() => parseDocument(JSON.stringify(assembly))).toThrow(/invalid mate/);
    assembly.mates = [];
    assembly.joints = [{ id: 'j1', name: 'Bad', type: 'bad' as never, component: 'c2', axis: 'x', value: 0, min: -1, max: 1 }];
    expect(() => parseDocument(JSON.stringify(assembly))).toThrow(/invalid joint/);
  });
});

describe('assembly mates and joints', () => {
  const assemblyWithComponents = () => {
    const doc = newAssembly('Mechanism');
    const part = newDocument('Block');
    part.features = [sketch('s1', rect(0, 0, 10, 10)), extrude('e1', 's1', 10)];
    doc.components = [
      { id: 'c1', name: 'Base', part, transform: { position: [0, 0, 0], rotation: [0, 0, 0] }, visible: true, fixed: true },
      { id: 'c2', name: 'Slide', part, transform: { position: [100, 10, 20], rotation: [0, 0, 0] }, visible: true },
      { id: 'c3', name: 'Tip', part, transform: { position: [200, 30, 40], rotation: [0, 0, 5] }, visible: true },
    ];
    doc.mates = [
      { id: 'm1', name: 'Base to slide', type: 'distance', a: 'c1', b: 'c2', axis: 'x', value: 25 },
      { id: 'm2', name: 'Slide to tip', type: 'distance', a: 'c2', b: 'c3', axis: 'x', value: 15 },
      { id: 'm3', name: 'Align Y', type: 'distance', a: 'c1', b: 'c3', axis: 'y', value: 0 },
    ];
    doc.joints = [
      { id: 'j1', name: 'Slide joint', type: 'prismatic', component: 'c2', axis: 'z', value: 12, min: -20, max: 20 },
      { id: 'j2', name: 'Hinge', type: 'revolute', component: 'c3', axis: 'z', value: 45, min: -90, max: 90 },
    ];
    return doc;
  };

  it('propagates mate chains and applies joint motion on top', () => {
    const doc = assemblyWithComponents();
    const solved = solveAssemblyTransforms(doc);
    expect(solved.get('c2')!.position[0]).toBe(25);
    expect(solved.get('c3')!.position[0]).toBe(40);
    expect(solved.get('c3')!.position[1]).toBe(0);
    const moved = assemblyTransforms(doc, { j1: 5, j2: 30 });
    expect(moved.get('c2')!.position[2]).toBe(25);
    expect(moved.get('c3')!.rotation[2]).toBe(35);
    expect(componentTransform(doc, doc.components![1], { j1: 4 }).position[2]).toBe(24);
    expect(assemblyTransforms(doc, { j1: { value: 6, value2: 9 } }).get('c2')!.position[2]).toBe(26);
    expect(jointValue(doc.joints![0], 99)).toBe(20);
    expect(movableJoints(doc).map((j) => j.id)).toEqual(['j1', 'j2']);
  });

  it('does not move a grounded component with a joint', () => {
    const doc = assemblyWithComponents();
    doc.joints!.push({ id: 'j3', name: 'Grounded', type: 'prismatic', component: 'c1', axis: 'x', value: 9, min: -10, max: 10 });
    expect(assemblyTransforms(doc, { j3: 9 }).get('c1')!.position[0]).toBe(0);
    expect(movableJoints(doc).some((j) => j.id === 'j3')).toBe(false);
  });

  it('supports Fusion-style parallel, perpendicular and flush mates', () => {
    const docs = [
      { type: 'parallel' as const, expected: 0 },
      { type: 'perpendicular' as const, expected: 90 },
    ];
    for (const { type, expected } of docs) {
      const doc = assemblyWithComponents();
      doc.mates = [{ id: 'm1', name: type, type, a: 'c1', b: 'c2', axis: 'z', value: 0 }];
      expect(solveAssemblyTransforms(doc).get('c2')!.rotation[2]).toBe(expected);
    }
    const flush = assemblyWithComponents();
    flush.mates = [{ id: 'm1', name: 'flush', type: 'flush', a: 'c1', b: 'c2', axis: 'z', value: 8 }];
    expect(solveAssemblyTransforms(flush).get('c2')!.position[2]).toBe(8);
  });

  it('applies secondary degrees of freedom for cylindrical, planar, ball and pin-slot joints', () => {
    for (const [type, move, rotate] of [
      ['cylindrical', [0, 0, 5], [0, 0, 7]],
      ['planar', [0, 7, 5], [0, 0, 0]],
      ['ball', [0, 0, 0], [0, 7, 5]],
      ['pinSlot', [0, 0, 5], [0, 7, 0]],
    ] as const) {
      const doc = assemblyWithComponents();
      doc.mates = [];
      doc.joints = [{
        id: 'j', name: type, type, component: 'c2', axis: 'z', axis2: 'y',
        value: 5, min: -20, max: 20, value2: 7, min2: -90, max2: 90,
      }];
      const t = assemblyTransforms(doc).get('c2')!;
      expect(t.position.map((v, i) => v - doc.components![1].transform.position[i])).toEqual(move);
      expect(t.rotation.map((v, i) => v - doc.components![1].transform.rotation[i])).toEqual(rotate);
    }
  });

  it('reports fixed-fixed mates, joints on fixed parts and missing grounded references', () => {
    const doc = assemblyWithComponents();
    doc.mates = [{ id: 'm1', name: 'Locked pair', type: 'distance', a: 'c1', b: 'c3', axis: 'x', value: 5 }];
    doc.components![2].fixed = true;
    doc.joints = [{ id: 'j1', name: 'Blocked', type: 'revolute', component: 'c1', axis: 'z', value: 0, min: -1, max: 1 }];
    expect(assemblyDiagnostics(doc)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'mate-fixed-conflict', item: 'm1' }),
      expect.objectContaining({ code: 'joint-fixed-component', item: 'j1' }),
    ]));
    doc.components!.forEach((c) => { c.fixed = false; });
    expect(assemblyDiagnostics(doc)).toContainEqual(expect.objectContaining({ code: 'no-ground' }));
  });
});

describe('assembly regeneration', () => {
  it('rebuilds components independently and applies position and rotation', async () => {
    const builder = new ModelBuilder();
    const features = req([sketch('s1', rect(0, 0, 10, 10)), extrude('e1', 's1', 10)]).features;
    const result = await builder.build({
      features: [],
      upTo: 0,
      blobs: {},
      quality: 0,
      components: [
        { id: 'c1', name: 'A', features, upTo: features.length, blobs: {}, transform: { position: [0, 0, 0], rotation: [0, 0, 0] }, visible: true },
        { id: 'c2', name: 'B', features, upTo: features.length, blobs: {}, transform: { position: [20, 0, 0], rotation: [0, 0, 0] }, visible: true },
      ],
    });
    expect(result.status).toEqual([{ id: 'c1', ok: true }, { id: 'c2', ok: true }]);
    expect(builder.massProperties()!.volume).toBeCloseTo(2000, 4);
    expect(result.bbox).toMatchObject({ min: [0, 0, 0], max: [30, 10, 10] });
    expect(result.mesh!.indices.length).toBeGreaterThan(0);
  });

  it('keeps hidden components out of the assembly body', async () => {
    const builder = new ModelBuilder();
    const features = req([sketch('s1', rect(0, 0, 10, 10)), extrude('e1', 's1', 10)]).features;
    const result = await builder.build({
      features: [],
      upTo: 0,
      blobs: {},
      quality: 0,
      components: [
        { id: 'c1', name: 'A', features, upTo: features.length, blobs: {}, transform: { position: [0, 0, 0], rotation: [0, 0, 0] }, visible: true },
        { id: 'c2', name: 'Hidden', features, upTo: features.length, blobs: {}, transform: { position: [20, 0, 0], rotation: [0, 0, 0] }, visible: false },
      ],
    });
    expect(result.status[1]).toMatchObject({ id: 'c2', ok: true, suppressed: true });
    expect(builder.massProperties()!.volume).toBeCloseTo(1000, 4);
    expect(result.bbox!.max[0]).toBeCloseTo(10, 6);
  });

  it('finds real B-Rep intersections between components', async () => {
    const builder = new ModelBuilder();
    const features = req([sketch('s1', rect(0, 0, 10, 10)), extrude('e1', 's1', 10)]).features;
    await builder.build({
      features: [],
      upTo: 0,
      blobs: {},
      quality: 0,
      components: [
        { id: 'c1', name: 'A', features, upTo: features.length, blobs: {}, transform: { position: [0, 0, 0], rotation: [0, 0, 0] }, visible: true },
        { id: 'c2', name: 'B', features, upTo: features.length, blobs: {}, transform: { position: [5, 0, 0], rotation: [0, 0, 0] }, visible: true },
      ],
    });
    expect(builder.checkInterference()).toEqual([{ a: 'c1', b: 'c2', volume: expect.closeTo(500, 4) }]);
    await builder.build({
      features: [],
      upTo: 0,
      blobs: {},
      quality: 0,
      components: [
        { id: 'c1', name: 'A', features, upTo: features.length, blobs: {}, transform: { position: [0, 0, 0], rotation: [0, 0, 0] }, visible: true },
        { id: 'c2', name: 'B', features, upTo: features.length, blobs: {}, transform: { position: [20, 0, 0], rotation: [0, 0, 0] }, visible: true },
      ],
    });
    expect(builder.checkInterference()).toEqual([]);
  });
});
