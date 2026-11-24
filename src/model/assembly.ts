// Assembly mate solving and joint transforms. These functions are pure so the
// same transforms drive the geometry worker, tests and motion simulation.

import type {
  AssemblyAxis, AssemblyComponent, AssemblyJoint, ComponentPattern, ComponentTransform, Id, PartDocument,
} from './types';
import type { Vec3 } from '../math/vec';

export interface JointOverride {
  value?: number;
  value2?: number;
}

export type JointOverrides = Partial<Record<Id, number | JointOverride>>;

export const ASSEMBLY_AXES: AssemblyAxis[] = ['x', 'y', 'z'];

const axisIndex = (axis: AssemblyAxis): 0 | 1 | 2 => axis === 'x' ? 0 : axis === 'y' ? 1 : 2;

const cloneTransform = (t: ComponentTransform): ComponentTransform => ({
  position: [...t.position],
  rotation: [...t.rotation],
});

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

/** Rotation matrix of a component transform: the model applies X, then Y, then Z. */
export function rotationMatrix(rotation: Vec3): number[][] {
  const [rx, ry, rz] = rotation.map((v: number) => v * RAD);
  const ca = Math.cos(rx), sa = Math.sin(rx);
  const cb = Math.cos(ry), sb = Math.sin(ry);
  const cc = Math.cos(rz), sc = Math.sin(rz);
  // R = Rz * Ry * Rx
  return [
    [cc * cb, cc * sa * sb - ca * sc, ca * cc * sb + sa * sc],
    [sc * cb, ca * cc + sa * sb * sc, -cc * sa + ca * sb * sc],
    [-sb, cb * sa, ca * cb],
  ];
}

/** Euler angles (degrees) of a rotation matrix, the inverse of rotationMatrix. */
export function matrixToRotation(m: number[][]): Vec3 {
  const sb = Math.max(-1, Math.min(1, -m[2][0]));
  const ry = Math.asin(sb);
  if (Math.abs(sb) > 0.999999) {
    // Looking straight up or down: choose X = 0 and put the turn in Z.
    const rx = 0;
    const rz = Math.atan2(-m[0][1], m[1][1]);
    return [rx * DEG, ry * DEG, rz * DEG];
  }
  const rx = Math.atan2(m[2][1], m[2][2]);
  const rz = Math.atan2(m[1][0], m[0][0]);
  return [rx * DEG, ry * DEG, rz * DEG];
}

export const multiply = (a: number[][], b: number[][]): number[][] => a.map((row) => [0, 1, 2].map((j) => row[0] * b[0][j] + row[1] * b[1][j] + row[2] * b[2][j]));

export const rotateVec = (m: number[][], v: Vec3): Vec3 => [
  m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
  m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
  m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
];

const transpose = (m: number[][]): number[][] => [0, 1, 2].map((i) => [0, 1, 2].map((j) => m[j][i]));
const rad = (v: number) => v * RAD;

export const norm3 = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

/** Rotation taking direction `from` onto `to` (both need not be unit). */
export function rotationFromTo(from: Vec3, to: Vec3): number[][] {
  const a = norm3(from), b = norm3(to);
  const cross: Vec3 = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  const s = Math.hypot(cross[0], cross[1], cross[2]);
  if (s < 1e-9) {
    if (dot > 0) return [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    // Opposite directions: a half turn about any axis perpendicular to `a`.
    const axis: Vec3 = Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const u = norm3([a[1] * axis[2] - a[2] * axis[1], a[2] * axis[0] - a[0] * axis[2], a[0] * axis[1] - a[1] * axis[0]]);
    return rotationAxisAngle(u, Math.PI);
  }
  return rotationAxisAngle([cross[0] / s, cross[1] / s, cross[2] / s], Math.atan2(s, dot));
}

/** Rotation of `angle` radians about a unit axis. */
export function rotationAxisAngle(axis: Vec3, angle: number): number[][] {
  const [x, y, z] = norm3(axis);
  const c = Math.cos(angle), s = Math.sin(angle), t = 1 - c;
  return [
    [t * x * x + c, t * x * y - s * z, t * x * z + s * y],
    [t * x * y + s * z, t * y * y + c, t * y * z - s * x],
    [t * x * z - s * y, t * y * z + s * x, t * z * z + c],
  ];
}

/** Transform of a child placed in a parent's frame (parent ∘ child). */
export function composeTransform(parent: ComponentTransform, child: ComponentTransform): ComponentTransform {
  const pm = rotationMatrix(parent.rotation);
  const p = rotateVec(pm, child.position);
  return {
    position: [parent.position[0] + p[0], parent.position[1] + p[1], parent.position[2] + p[2]],
    rotation: matrixToRotation(multiply(pm, rotationMatrix(child.rotation))),
  };
}

/** Placement of a child in a parent's frame: inverse(parent) ∘ child. */
export function relativeTransform(parent: ComponentTransform, child: ComponentTransform): ComponentTransform {
  const pm = rotationMatrix(parent.rotation);
  const rel: Vec3 = [child.position[0] - parent.position[0], child.position[1] - parent.position[1], child.position[2] - parent.position[2]];
  const inv = transpose(pm);
  const p = rotateVec(inv, rel);
  return { position: p, rotation: matrixToRotation(multiply(inv, rotationMatrix(child.rotation))) };
}

/** The dominant world axis of a direction. */
export function dominantAxis(d: Vec3): AssemblyAxis {
  const v = d.map(Math.abs);
  return v[0] >= v[1] && v[0] >= v[2] ? 'x' : v[1] >= v[2] ? 'y' : 'z';
}

/**
 * The transform that mates the picked geometry on `b` to the picked geometry
 * on `a`: the two contact points coincide (plus `offset` along a's direction)
 * and the directions oppose for a mate, or line up when not flipped.
 */
export function jointPlacement(
  a: { transform: ComponentTransform; p: Vec3; d: Vec3 },
  b: { transform: ComponentTransform; p: Vec3; d: Vec3 },
  opts: { mate: boolean; offset: number },
): ComponentTransform {
  const targetDir: Vec3 = opts.mate ? [-a.d[0], -a.d[1], -a.d[2]] : [...a.d];
  const align = rotationFromTo(b.d, targetDir);
  const bm = rotationMatrix(b.transform.rotation);
  const rotation = matrixToRotation(multiply(align, bm));
  const target: Vec3 = [
    a.p[0] + a.d[0] * opts.offset,
    a.p[1] + a.d[1] * opts.offset,
    a.p[2] + a.d[2] * opts.offset,
  ];
  // Keep the contact point where the geometry puts it: move the component by
  // the difference between the target point and its contact point.
  return {
    position: [
      b.transform.position[0] + target[0] - b.p[0],
      b.transform.position[1] + target[1] - b.p[1],
      b.transform.position[2] + target[2] - b.p[2],
    ],
    rotation,
  };
}

/** Rotates a placed component about a point and a direction, keeping the point fixed. */
export function rotateAbout(transform: ComponentTransform, pivot: Vec3, dir: Vec3, angleDeg: number): ComponentTransform {
  const m = multiply(rotationAxisAngle(dir, rad(angleDeg)), rotationMatrix(transform.rotation));
  const rel: Vec3 = [transform.position[0] - pivot[0], transform.position[1] - pivot[1], transform.position[2] - pivot[2]];
  const p = rotateVec(rotationAxisAngle(dir, rad(angleDeg)), rel);
  return {
    position: [pivot[0] + p[0], pivot[1] + p[1], pivot[2] + p[2]],
    rotation: matrixToRotation(m),
  };
}

/** A joint's contact point and direction, in world or in a component's frame. */
export interface JointFrame {
  p: Vec3;
  d: Vec3;
}

/** A world-space joint frame expressed in a component's own frame. */
export function frameToLocal(transform: ComponentTransform, frame: JointFrame): JointFrame {
  const inv = transpose(rotationMatrix(transform.rotation));
  const rel: Vec3 = [frame.p[0] - transform.position[0], frame.p[1] - transform.position[1], frame.p[2] - transform.position[2]];
  return { p: rotateVec(inv, rel), d: norm3(rotateVec(inv, frame.d)) };
}

/** A joint frame stored in a component's frame, placed in the world. */
export function frameToWorld(transform: ComponentTransform, frame: JointFrame): JointFrame {
  const m = rotationMatrix(transform.rotation);
  const p = rotateVec(m, frame.p);
  return {
    p: [transform.position[0] + p[0], transform.position[1] + p[1], transform.position[2] + p[2]],
    d: norm3(rotateVec(m, frame.d)),
  };
}

const identityTransform = (): ComponentTransform => ({ position: [0, 0, 0], rotation: [0, 0, 0] });

/**
 * Clamps a dragged joint value to its limits and snaps it when close to a
 * limit, to zero, or to a whole degree/millimetre. Returns the value to use.
 */
export function snapJointValue(joint: AssemblyJoint, raw: number): number {
  const angle = joint.type === 'revolute' || joint.type === 'ball';
  const span = Math.max(1e-9, joint.max - joint.min);
  const limitSnap = Math.max(1e-6, Math.min(2, span * 0.02));
  let v = Math.max(joint.min, Math.min(joint.max, Number.isFinite(raw) ? raw : joint.value));
  const step = angle ? 5 : 1;
  const near = Math.round(v / step) * step;
  if (near >= joint.min && near <= joint.max && Math.abs(near - v) < (angle ? 0.75 : 0.15)) v = near;
  if (joint.min <= 0 && joint.max >= 0 && Math.abs(v) < (angle ? 0.75 : 0.15)) v = 0;
  if (Math.abs(v - joint.min) < limitSnap) v = joint.min;
  else if (Math.abs(v - joint.max) < limitSnap) v = joint.max;
  return v;
}


const translateBy = (t: ComponentTransform, d: Vec3): ComponentTransform => ({
  position: [t.position[0] + d[0], t.position[1] + d[1], t.position[2] + d[2]],
  rotation: [...t.rotation],
});


/** Clamp a joint's current value to its authored limits. */
export function jointValue(joint: AssemblyJoint, override?: number): number {
  const value = Number.isFinite(override) ? override! : joint.value;
  return Math.max(joint.min, Math.min(joint.max, value));
}

export function jointValue2(joint: AssemblyJoint, override?: number): number {
  const min = joint.min2 ?? -180;
  const max = joint.max2 ?? 180;
  const value = Number.isFinite(override) ? override! : joint.value2 ?? 0;
  return Math.max(min, Math.min(max, value));
}

export function connectorAxis(kind: AssemblyJoint['axis'] | 'origin' | 'xy' | 'xz' | 'yz'): AssemblyAxis | null {
  if (kind === 'x' || kind === 'yz') return 'x';
  if (kind === 'y' || kind === 'xz') return 'y';
  if (kind === 'z' || kind === 'xy') return 'z';
  return null;
}

/**
 * Solves the supported mates from their reference component (`a`) onto the
 * driven component (`b`). If `b` is grounded, an ungrounded `a` is adjusted
 * instead. Repeated passes propagate mate chains; fixed-fixed conflicts are
 * intentionally left for the UI to report.
 */
export function solveAssemblyTransforms(doc: PartDocument): Map<Id, ComponentTransform> {
  const components = doc.components ?? [];
  const out = new Map<Id, ComponentTransform>(components.map((c) => [c.id, cloneTransform(c.transform)]));
  const fixed = new Set(components.filter((c) => c.fixed).map((c) => c.id));
  const mates = doc.mates ?? [];
  const passes = Math.max(2, components.length * 2);
  for (let pass = 0; pass < passes; pass++) {
    let changed = false;
    for (const mate of mates) {
      const a = out.get(mate.a);
      const b = out.get(mate.b);
      if (!a || !b) continue;
      const adjustB = !(fixed.has(mate.b) && !fixed.has(mate.a));
      const source = adjustB ? a : b;
      const target = adjustB ? b : a;
      const i = axisIndex(mate.axis);
      if (mate.type === 'coincident') {
        if ((mate.aRef ?? 'origin') === 'origin' && (mate.bRef ?? 'origin') === 'origin') {
          for (let axis = 0; axis < 3; axis++) {
            const next = source.position[axis];
            if (target.position[axis] !== next) {
              target.position[axis] = next;
              changed = true;
            }
          }
        } else {
          const next = source.position[i] + (adjustB ? mate.value : -mate.value);
          if (target.position[i] !== next) {
            target.position[i] = next;
            changed = true;
          }
        }
      } else if (mate.type === 'distance' || mate.type === 'flush') {
        const next = source.position[i] + (adjustB ? mate.value : -mate.value);
        if (target.position[i] !== next) {
          target.position[i] = next;
          changed = true;
        }
      } else if (mate.type === 'angle') {
        const next = source.rotation[i] + (adjustB ? mate.value : -mate.value);
        if (target.rotation[i] !== next) {
          target.rotation[i] = next;
          changed = true;
        }
      } else if (mate.type === 'parallel' || mate.type === 'perpendicular') {
        const offset = mate.type === 'perpendicular' ? 90 : 0;
        const next = source.rotation[i] + (adjustB ? offset : -offset);
        if (target.rotation[i] !== next) {
          target.rotation[i] = next;
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  return out;
}

/** Applies every joint on top of the mate-solved transforms. */
export function assemblyTransforms(doc: PartDocument, overrides: JointOverrides = {}): Map<Id, ComponentTransform> {
  const out = solveAssemblyTransforms(doc);
  const components = new Map((doc.components ?? []).map((c) => [c.id, c]));
  const joints = doc.joints ?? [];

  // Two-component joints first: the driven component is placed in the
  // reference's frame, so moving the reference carries it along. Repeated
  // passes let a chain of joints settle.
  const jointed = joints.filter((j) => !!j.relativeTo && !!j.offset);
  for (let pass = 0; pass < Math.max(2, jointed.length * components.size + 2); pass++) {
    let changed = false;
    for (const joint of jointed) {
      const driven = components.get(joint.component);
      const reference = components.get(joint.relativeTo!);
      const base = out.get(joint.relativeTo!);
      const current = out.get(joint.component);
      if (!driven || !reference || !base || !current || driven.fixed) continue;
      const next = composeTransform(base, joint.offset!);
      if (Math.abs(next.position[0] - current.position[0]) + Math.abs(next.position[1] - current.position[1]) +
          Math.abs(next.position[2] - current.position[2]) < 1e-9 &&
          Math.abs(next.rotation[0] - current.rotation[0]) + Math.abs(next.rotation[1] - current.rotation[1]) +
          Math.abs(next.rotation[2] - current.rotation[2]) < 1e-9) continue;
      out.set(joint.component, next);
      changed = true;
    }
    if (!changed) break;
  }

  // Joint motion on top of the constraint.
  for (const joint of joints) {
    const component = components.get(joint.component);
    const transform = out.get(joint.component);
    if (!component || !transform || component.fixed) continue;
    const override = overrides[joint.id];
    const value = jointValue(joint, typeof override === 'number' ? override : override?.value);
    const value2 = jointValue2(joint, typeof override === 'object' ? override?.value2 : undefined);
    const i = axisIndex(joint.axis);
    const j = axisIndex(joint.axis2 ?? (joint.axis === 'x' ? 'y' : 'x'));
    // A joint made between picked geometry moves along that geometry, which
    // follows the reference component when it is moved.
    const reference = joint.relativeTo ? out.get(joint.relativeTo) ?? identityTransform() : identityTransform();
    const worldFrame = joint.aRef?.d
      ? frameToWorld(reference, { p: joint.aRef.p ?? [0, 0, 0], d: joint.aRef.d })
      : null;
    const dir = worldFrame?.d ?? [joint.axis === 'x' ? 1 : 0, joint.axis === 'y' ? 1 : 0, joint.axis === 'z' ? 1 : 0];
    const pivot = worldFrame?.p ?? [0, 0, 0];
    const hasAxis = !!worldFrame;
    if (joint.type === 'prismatic') out.set(joint.component, translateBy(transform, hasAxis ? scaleVec(norm3(dir), value) : axisVec(joint.axis, value)));
    else if (joint.type === 'revolute') out.set(joint.component, hasAxis ? rotateAbout(transform, pivot, norm3(dir), value) : withRotation(transform, i, transform.rotation[i] + value));
    else if (joint.type === 'cylindrical') {
      const moved = hasAxis ? translateBy(transform, scaleVec(norm3(dir), value)) : translateBy(transform, axisVec(joint.axis, value));
      out.set(joint.component, hasAxis ? rotateAbout(moved, pivot, norm3(dir), value2) : withRotation(moved, i, moved.rotation[i] + value2));
    } else if (joint.type === 'planar') {
      const moved = hasAxis
        ? translateBy(transform, addVec(scaleVec(norm3(dir), value), scaleVec(axisVec(joint.axis2 ?? 'y', 1), value2)))
        : translateBy(transform, addVec(axisVec(joint.axis, value), axisVec(joint.axis2 ?? 'y', value2)));
      out.set(joint.component, moved);
    } else if (joint.type === 'ball') {
      out.set(joint.component, withRotation(withRotation(transform, i, transform.rotation[i] + value), j, transform.rotation[j] + value2));
    } else if (joint.type === 'pinSlot') {
      const moved = hasAxis ? translateBy(transform, scaleVec(norm3(dir), value)) : translateBy(transform, axisVec(joint.axis, value));
      out.set(joint.component, withRotation(moved, j, moved.rotation[j] + value2));
    }
  }
  return out;
}

const axisVec = (axis: AssemblyAxis, value: number): Vec3 => (axis === 'x' ? [value, 0, 0] : axis === 'y' ? [0, value, 0] : [0, 0, value]);
const scaleVec = (v: Vec3, s: number): Vec3 => [v[0] * s, v[1] * s, v[2] * s];
const addVec = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const withRotation = (t: ComponentTransform, i: 0 | 1 | 2, value: number): ComponentTransform => {
  const rotation: Vec3 = [...t.rotation];
  rotation[i] = value;
  return { position: [...t.position], rotation };
};

export function componentTransform(doc: PartDocument, component: AssemblyComponent, overrides: JointOverrides = {}): ComponentTransform {
  return assemblyTransforms(doc, overrides).get(component.id) ?? cloneTransform(component.transform);
}

/** Joints whose component is present and movable. */
export function movableJoints(doc: PartDocument): AssemblyJoint[] {
  const components = new Map((doc.components ?? []).map((c) => [c.id, c]));
  return (doc.joints ?? []).filter((joint) => {
    const component = components.get(joint.component);
    return joint.type !== 'rigid' && !!component && !component.fixed;
  });
}

export type AssemblyDiagnosticCode =
  | 'missing-component'
  | 'mate-fixed-conflict'
  | 'joint-fixed-component'
  | 'no-ground'
  | 'invalid-joint-range';

export interface AssemblyDiagnostic {
  code: AssemblyDiagnosticCode;
  severity: 'warning' | 'error';
  item?: Id;
  componentA?: Id;
  componentB?: Id;
}

/** Structural checks that complement the transform solver. */
export function assemblyDiagnostics(doc: PartDocument): AssemblyDiagnostic[] {
  const out: AssemblyDiagnostic[] = [];
  const components = new Map((doc.components ?? []).map((c) => [c.id, c]));
  const fixed = new Set([...components.values()].filter((c) => c.fixed).map((c) => c.id));
  for (const mate of doc.mates ?? []) {
    if (!components.has(mate.a) || !components.has(mate.b)) {
      out.push({ code: 'missing-component', severity: 'error', item: mate.id, componentA: mate.a, componentB: mate.b });
    } else if (fixed.has(mate.a) && fixed.has(mate.b)) {
      out.push({ code: 'mate-fixed-conflict', severity: 'error', item: mate.id, componentA: mate.a, componentB: mate.b });
    }
  }
  for (const joint of doc.joints ?? []) {
    if (!components.has(joint.component)) out.push({ code: 'missing-component', severity: 'error', item: joint.id, componentA: joint.component });
    else if (components.get(joint.component)!.fixed) out.push({ code: 'joint-fixed-component', severity: 'warning', item: joint.id, componentA: joint.component });
    if ((joint.min2 ?? -180) > (joint.max2 ?? 180)) out.push({ code: 'invalid-joint-range', severity: 'error', item: joint.id });
  }
  if ((doc.mates?.length || doc.joints?.length) && !fixed.size) out.push({ code: 'no-ground', severity: 'warning' });
  return out;
}

// ---- component patterns ----

/** Axis vector of a world X/Y/Z direction, for patterns. */
export function patternDir(axis: AssemblyAxis | null | undefined): Vec3 {
  return axis === 'x' ? [1, 0, 0] : axis === 'y' ? [0, 1, 0] : [0, 0, 1];
}

/** One copy of a pattern: how far to turn about the assembly origin and how far to slide. */
export interface PatternStep {
  /** Rotation about the pattern axis, in degrees (circular patterns). */
  rotation: number;
  /** Translation from the seed (rectangular patterns). */
  offset: Vec3;
}

/** The angle between neighbouring copies, or 0 for a full turn spread evenly. */
export function circularStep(angle: number, count: number): number {
  if (count <= 1) return 0;
  // A full turn divides by the count; a partial sweep puts the last copy on the angle.
  return angle >= 359.999 ? 360 / count : angle / (count - 1);
}

/** Copies a pattern adds, excluding the seed itself. */
export function patternSteps(pattern: ComponentPattern): PatternStep[] {
  const out: PatternStep[] = [];
  if (pattern.type === 'circular') {
    const count = Math.max(1, Math.floor(pattern.count ?? 1));
    const angle = pattern.angle ?? 360;
    const step = circularStep(angle, count);
    for (let i = 1; i < count; i++) out.push({ rotation: step * i, offset: [0, 0, 0] });
    return out;
  }
  const dir1 = patternDir(pattern.dir1 ?? 'x');
  const spacing1 = pattern.spacing1 ?? 0;
  const count1 = Math.max(1, Math.floor(pattern.count1 ?? 1));
  const dir2 = pattern.dir2 ? patternDir(pattern.dir2) : null;
  const spacing2 = pattern.spacing2 ?? 0;
  const count2 = dir2 ? Math.max(1, Math.floor(pattern.count2 ?? 1)) : 1;
  for (let j = 0; j < count2; j++) {
    for (let i = 0; i < count1; i++) {
      if (i === 0 && j === 0) continue;
      out.push({ rotation: 0, offset: [
        dir1[0] * spacing1 * i + (dir2 ? dir2[0] * spacing2 * j : 0),
        dir1[1] * spacing1 * i + (dir2 ? dir2[1] * spacing2 * j : 0),
        dir1[2] * spacing1 * i + (dir2 ? dir2[2] * spacing2 * j : 0),
      ] });
    }
  }
  return out;
}

/** How many copies a pattern makes of its seeds, including the seed. */
export function patternMultiplier(pattern: ComponentPattern): number {
  if (pattern.type === 'circular') return Math.max(1, Math.floor(pattern.count ?? 1));
  return Math.max(1, Math.floor(pattern.count1 ?? 1)) * (pattern.dir2 ? Math.max(1, Math.floor(pattern.count2 ?? 1)) : 1);
}

/**
 * How many times a component appears in the assembly, counting the copies a
 * pattern makes of it (several patterns multiply, as in Fusion).
 */
export function componentInstanceCount(patterns: ComponentPattern[] | undefined, componentId: Id): number {
  let count = 1;
  for (const pattern of patterns ?? []) {
    if (pattern.components.includes(componentId)) count *= patternMultiplier(pattern);
  }
  return count;
}

/** The patterns that copy a given component. */
export function patternsOf(patterns: ComponentPattern[] | undefined, componentId: Id): ComponentPattern[] {
  return (patterns ?? []).filter((pattern) => pattern.components.includes(componentId));
}
