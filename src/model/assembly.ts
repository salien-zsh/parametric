// Assembly mate solving and joint transforms. These functions are pure so the
// same transforms drive the geometry worker, tests and motion simulation.

import type {
  AssemblyAxis, AssemblyComponent, AssemblyJoint, ComponentTransform, Id, PartDocument,
} from './types';

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
  for (const joint of doc.joints ?? []) {
    const component = components.get(joint.component);
    const transform = out.get(joint.component);
    if (!component || !transform || component.fixed) continue;
    const override = overrides[joint.id];
    const value = jointValue(joint, typeof override === 'number' ? override : override?.value);
    const value2 = jointValue2(joint, typeof override === 'object' ? override?.value2 : undefined);
    const i = axisIndex(joint.axis);
    const j = axisIndex(joint.axis2 ?? (joint.axis === 'x' ? 'y' : 'x'));
    if (joint.type === 'prismatic') transform.position[i] += value;
    else if (joint.type === 'revolute') transform.rotation[i] += value;
    else if (joint.type === 'cylindrical') {
      transform.position[i] += value;
      transform.rotation[i] += value2;
    } else if (joint.type === 'planar') {
      transform.position[i] += value;
      transform.position[j] += value2;
    } else if (joint.type === 'ball') {
      transform.rotation[i] += value;
      transform.rotation[j] += value2;
    } else if (joint.type === 'pinSlot') {
      transform.position[i] += value;
      transform.rotation[j] += value2;
    }
  }
  return out;
}

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
