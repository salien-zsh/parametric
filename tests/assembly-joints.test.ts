// Assembly joints made between picked geometry: placement, propagation and
// the round trip through a saved assembly file.
import { describe, expect, it } from 'vitest';
import {
  assemblyTransforms, composeTransform, jointPlacement, relativeTransform, snapJointValue,
} from '../src/model/assembly';
import type { AssemblyComponent, AssemblyJoint, ComponentTransform, PartDocument } from '../src/model/types';
import { newAssembly, newDocument, parseDocument } from '../src/model/document';

const transform = (position: [number, number, number], rotation: [number, number, number] = [0, 0, 0]): ComponentTransform => ({ position, rotation });

const component = (id: string, position: [number, number, number], fixed = false): AssemblyComponent => ({
  id, name: id, part: newDocument(id), transform: transform(position), visible: true, fixed,
});

const assembly = (components: AssemblyComponent[], joints: AssemblyJoint[] = []): PartDocument => ({
  ...newAssembly('Test'), components, joints,
});

describe('assembly joint placement', () => {
  it('composes and inverts component transforms', () => {
    const a = transform([10, 20, 30], [0, 0, 90]);
    const b = transform([5, 0, 0], [0, 0, 0]);
    const world = composeTransform(a, b);
    // The child's local +X points along the parent's +Y.
    expect(world.position[0]).toBeCloseTo(10, 6);
    expect(world.position[1]).toBeCloseTo(25, 6);
    expect(world.rotation[2]).toBeCloseTo(90, 6);
    const back = relativeTransform(a, world);
    expect(back.position[0]).toBeCloseTo(5, 6);
    expect(back.position[1]).toBeCloseTo(0, 6);
    expect(back.rotation[2]).toBeCloseTo(0, 6);
  });

  it('mates two picked faces by putting their centres together, normals opposed', () => {
    // Base top face (+Z at z = 30) and bracket bottom face (-Z at its origin).
    const placement = jointPlacement(
      { transform: transform([0, 0, 0]), p: [30, 30, 30], d: [0, 0, 1] },
      { transform: transform([120, 0, 0]), p: [140, 20, 0], d: [0, 0, -1] },
      { mate: true, offset: 0 },
    );
    expect(placement.position[0]).toBeCloseTo(10, 6);
    expect(placement.position[1]).toBeCloseTo(10, 6);
    expect(placement.position[2]).toBeCloseTo(30, 6);
    expect(placement.rotation.every((r) => Math.abs(r) < 1e-6)).toBe(true);
  });

  it('rotates the driven part when the faces point the same way', () => {
    const placement = jointPlacement(
      { transform: transform([0, 0, 0]), p: [0, 0, 0], d: [0, 0, 1] },
      { transform: transform([50, 0, 0]), p: [50, 0, 0], d: [0, 0, 1] },
      { mate: true, offset: 0 },
    );
    // A half turn about X (or Y) brings +Z onto -Z.
    expect(placement.position[0]).toBeCloseTo(0, 6);
    expect(placement.position[2]).toBeCloseTo(0, 6);
    const turned = Math.abs(Math.abs(placement.rotation[0]) - 180) < 1e-6 || Math.abs(Math.abs(placement.rotation[1]) - 180) < 1e-6;
    expect(turned).toBe(true);
  });

  it('keeps the driven part on its place when the reference moves', async () => {
    const base = component('c1', [0, 0, 0]);
    const bracket = component('c2', [10, 10, 30]);
    const joint: AssemblyJoint = {
      id: 'j1', name: 'Joint1', type: 'rigid', component: 'c2', relativeTo: 'c1',
      axis: 'z', value: 0, min: 0, max: 0,
      offset: { position: [10, 10, 30], rotation: [0, 0, 0] },
      aRef: { kind: 'face', p: [30, 30, 0], d: [0, 0, 1] },
    };
    const doc = assembly([base, bracket], [joint]);
    let solved = assemblyTransforms(doc);
    expect(solved.get('c2')!.position).toEqual([10, 10, 30]);

    // Move the reference by editing its placed transform.
    doc.components![0].transform = transform([20, 0, 5]);
    solved = assemblyTransforms(doc);
    expect(solved.get('c2')!.position[0]).toBeCloseTo(30, 6);
    expect(solved.get('c2')!.position[1]).toBeCloseTo(10, 6);
    expect(solved.get('c2')!.position[2]).toBeCloseTo(35, 6);
  });

  it('slides a jointed part along the picked edge', () => {
    const base = component('c1', [0, 0, 0]);
    const slider = component('c2', [0, 0, 10]);
    const joint: AssemblyJoint = {
      id: 'j1', name: 'Slider', type: 'prismatic', component: 'c2', relativeTo: 'c1',
      axis: 'x', value: 15, min: -100, max: 100,
      offset: { position: [0, 0, 10], rotation: [0, 0, 0] },
      aRef: { kind: 'edge', p: [0, 0, 0], d: [1, 0, 0] },
    };
    const doc = assembly([base, slider], [joint]);
    const solved = assemblyTransforms(doc);
    expect(solved.get('c2')!.position[0]).toBeCloseTo(15, 6);
    // A joint value outside its limits is clamped.
    const clamped = assemblyTransforms(doc, { j1: 500 });
    expect(clamped.get('c2')!.position[0]).toBeCloseTo(100, 6);
    // Turning the reference takes the slide direction with it.
    doc.components![0].transform = transform([0, 0, 0], [0, 0, 90]);
    const turned = assemblyTransforms(doc);
    expect(turned.get('c2')!.position[0]).toBeCloseTo(0, 5);
    expect(turned.get('c2')!.position[1]).toBeCloseTo(15, 5);
  });

  it('keeps a joint made between picked geometry when the assembly is saved', () => {
    const base = component('c1', [0, 0, 0], true);
    const bracket = component('c2', [10, 10, 30]);
    const doc = assembly([base, bracket], [{
      id: 'j1', name: 'Joint1', type: 'revolute', component: 'c2', relativeTo: 'c1', axis: 'z',
      value: 12, min: -180, max: 180,
      offset: { position: [10, 10, 30], rotation: [0, 0, 45] },
      aRef: { kind: 'face', name: 'c1/f5', p: [30, 30, 0], d: [0, 0, 1] },
      bRef: { kind: 'edge', name: 'c2/e3', p: [10, 10, 30], d: [1, 0, 0] },
    }]);
    doc.kind = 'assembly';
    const loaded = parseDocument(JSON.stringify({ ...doc, components: doc.components!.map((c) => ({ ...c })) }));
    const joint = loaded.joints![0];
    expect(joint.relativeTo).toBe('c1');
    expect(joint.offset!.position).toEqual([10, 10, 30]);
    expect(joint.offset!.rotation).toEqual([0, 0, 45]);
    expect(joint.aRef!.name).toBe('c1/f5');
    expect(joint.bRef!.kind).toBe('edge');
  });
});

describe('joint drag limits', () => {
  const slider: AssemblyJoint = {
    id: 'j1', name: 'Slide', type: 'prismatic', component: 'c2', axis: 'x', value: 0, min: -100, max: 100,
  };
  const hinge: AssemblyJoint = {
    id: 'j2', name: 'Hinge', type: 'revolute', component: 'c2', axis: 'z', value: 0, min: -180, max: 180,
  };

  it('clamps a dragged slider to its travel', () => {
    expect(snapJointValue(slider, 150)).toBe(100);
    expect(snapJointValue(slider, -150)).toBe(-100);
    expect(snapJointValue(slider, 99)).toBe(100);
    expect(snapJointValue(slider, -98.5)).toBe(-100);
  });

  it('snaps close values to whole units, zero and limits', () => {
    expect(snapJointValue(slider, 45.1)).toBe(45);
    expect(snapJointValue(slider, 0.1)).toBe(0);
    expect(snapJointValue(slider, 42.6)).toBeCloseTo(42.6, 6);
    expect(snapJointValue(hinge, 179)).toBe(180);
    expect(snapJointValue(hinge, 45.4)).toBe(45);
    expect(snapJointValue(hinge, 44)).toBe(44);
  });
});
