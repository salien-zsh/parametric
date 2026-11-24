// Picks likely mating geometry between assembly components, so a joint can
// start from a suggestion instead of two manual face picks.
import type { Vec3 } from '../math/vec';
import type { AssemblyJointType } from './types';

/** The face and edge information the fit suggestions read. */
export interface FitFace {
  name: string;
  type: string;
  center: Vec3;
  normal?: Vec3;
  axis?: { p: Vec3; d: Vec3 };
  area: number;
  component?: string;
}

export interface FitEdge {
  name: string;
  type: string;
  mid: Vec3;
  center?: Vec3;
  axis?: Vec3;
  dir?: Vec3;
  component?: string;
}

export interface FitSource {
  faces: FitFace[];
  edges: FitEdge[];
}

/** One side of a suggested constraint: a face or an edge. */
export interface FitPick {
  kind: 'face' | 'edge';
  name: string;
}

export interface FitCandidate {
  aComponent: string;
  bComponent: string;
  a: FitPick;
  b: FitPick;
  /** What the picked geometry does: flush/contact faces or a shared axis. */
  fit: 'coincident' | 'flush' | 'concentric';
  jointType: AssemblyJointType;
  /** The picked directions face each other (mate) rather than run the same way. */
  mate: boolean;
  /** Gap along the axis of the picked geometry (mm). */
  distance: number;
  /** Angle between the picked directions (radians). */
  angle: number;
  /** 0..1, higher is a better fit. */
  score: number;
}

export interface FitPair {
  a: string;
  b: string;
}

const sub = (p: Vec3, q: Vec3): Vec3 => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
const dot = (p: Vec3, q: Vec3): number => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
const length = (p: Vec3): number => Math.hypot(p[0], p[1], p[2]);
const normalize = (p: Vec3): Vec3 | null => {
  const l = length(p);
  return l > 1e-9 ? [p[0] / l, p[1] / l, p[2] / l] : null;
};
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** The top-level component a nested sub-assembly face belongs to. */
export const fitOwner = (component: string | undefined): string | null => component ? component.split('/')[0] : null;

const MAX_FACE_ANGLE = Math.PI / 7.2; // 25 degrees
const MAX_AXIS_ANGLE = Math.PI / 12; // 15 degrees

/**
 * Scores the base pairs of faces and edges for a joint. Coincident faces need
 * opposed normals, flush faces parallel ones; cylinders and circular edges
 * need parallel axes. Results are sorted by score and de-duplicated by the
 * picked geometry.
 */
export function fitCandidates(source: FitSource, pairs: FitPair[], limit = 6): FitCandidate[] {
  const out: FitCandidate[] = [];
  const seen = new Set<string>();
  const push = (c: FitCandidate) => {
    const key = `${c.aComponent}|${c.a.kind}:${c.a.name}|${c.bComponent}|${c.b.kind}:${c.b.name}|${c.fit}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(c);
  };
  const facesBy = (component: string) => source.faces.filter((f) => fitOwner(f.component) === component);
  const edgesBy = (component: string) => source.edges.filter((e) => fitOwner(e.component) === component);

  for (const pair of pairs) {
    if (pair.a === pair.b) continue;
    const facesA = facesBy(pair.a);
    const facesB = facesBy(pair.b);
    const edgesA = edgesBy(pair.a);
    const edgesB = edgesBy(pair.b);

    // Planar faces: contact (opposed normals) or flush (parallel normals).
    for (const a of facesA) {
      if (a.type !== 'plane' || !a.normal) continue;
      for (const b of facesB) {
        if (b.type !== 'plane' || !b.normal) continue;
        const scale = Math.min(a.area, b.area) / Math.max(1e-9, Math.max(a.area, b.area));
        const ca = dot(a.normal, b.normal);
        const angle = Math.acos(clamp(Math.abs(ca), 0, 1));
        if (angle > MAX_FACE_ANGLE) continue;
        const gap = Math.abs(dot(sub(b.center, a.center), a.normal));
        const mate = ca < 0;
        // Faces facing each other are the natural fit for a part dropped onto
        // another, so contact beats a merely parallel pair of side faces.
        const score = clamp(0.6 * (1 - angle / MAX_FACE_ANGLE) + 0.2 * Math.exp(-gap / 80) + 0.05 * scale + (mate ? 0.15 : 0), 0, 1);
        push({
          aComponent: pair.a, bComponent: pair.b,
          a: { kind: 'face', name: a.name }, b: { kind: 'face', name: b.name },
          fit: mate ? 'coincident' : 'flush', jointType: 'planar', mate, distance: gap, angle, score,
        });
      }
    }

    // Shared axes: cylindrical faces and circular edges on each side.
    const axisA: { kind: 'face' | 'edge'; name: string; p: Vec3; d: Vec3 }[] = [
      ...facesA.filter((f) => (f.type === 'cylinder' || f.type === 'cone') && f.axis).map((f) => ({ kind: 'face' as const, name: f.name, p: f.axis!.p, d: f.axis!.d })),
      ...edgesA.filter((e) => e.type === 'circle' && e.axis && e.center).map((e) => ({ kind: 'edge' as const, name: e.name, p: e.center!, d: e.axis! })),
    ];
    const axisB: { kind: 'face' | 'edge'; name: string; p: Vec3; d: Vec3 }[] = [
      ...facesB.filter((f) => (f.type === 'cylinder' || f.type === 'cone') && f.axis).map((f) => ({ kind: 'face' as const, name: f.name, p: f.axis!.p, d: f.axis!.d })),
      ...edgesB.filter((e) => e.type === 'circle' && e.axis && e.center).map((e) => ({ kind: 'edge' as const, name: e.name, p: e.center!, d: e.axis! })),
    ];
    for (const a of axisA) {
      const da = normalize(a.d);
      if (!da) continue;
      for (const b of axisB) {
        const db = normalize(b.d);
        if (!db) continue;
        const ca = clamp(Math.abs(dot(da, db)), 0, 1);
        const angle = Math.acos(ca);
        if (angle > MAX_AXIS_ANGLE) continue;
        // Distance between the two lines, measured across the first axis.
        const between = sub(b.p, a.p);
        const along = dot(between, da);
        const radial: Vec3 = [between[0] - da[0] * along, between[1] - da[1] * along, between[2] - da[2] * along];
        const distance = length(radial);
        const score = clamp(0.66 * (1 - angle / MAX_AXIS_ANGLE) + 0.34 * Math.exp(-distance / 30), 0, 1);
        push({
          aComponent: pair.a, bComponent: pair.b,
          a: { kind: a.kind, name: a.name }, b: { kind: b.kind, name: b.name },
          fit: 'concentric', jointType: 'cylindrical', mate: true, distance, angle, score,
        });
      }
    }
  }
  return out.sort((x, y) => y.score - x.score).slice(0, limit);
}

/** A short, translatable description of what a candidate does. */
export const isGoodFit = (candidate: FitCandidate | undefined): boolean => !!candidate && candidate.score >= 0.5;
