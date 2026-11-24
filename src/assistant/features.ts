// Features as the assistant reads and writes them: the same argument shape
// for adding a feature, editing it (any subset of the arguments) and reading
// it back, with lengths in display units, faces and edges by name, and planes
// and axes as short specs (see refs.ts).

import type { Vec2 } from '../math/vec';
import { toLocal } from '../math/vec';
import {
  newChamfer, newCircularPattern, newDraft, newExtrude, newFillet, newHole, newLinearPattern, newLoft, newMirror, newPlane, newRevolve, newShell,
  newSweep,
} from '../model/features';
import type { Feature, FeatureType, Id, PatternDir, ThinOptions } from '../model/types';
import { Refs, axisSpec, planeSpec } from './refs';
import { ToolError, type Units } from './units';
import { tr } from '../i18n';

type Obj = Record<string, unknown>;

/** Tool name for adding each feature type the assistant can create. */
export const ADD_TOOLS: Partial<Record<FeatureType, string>> = {
  extrude: 'add_extrude', revolve: 'add_revolve', fillet: 'add_fillet', chamfer: 'add_chamfer', shell: 'add_shell', hole: 'add_hole',
  linearPattern: 'add_linear_pattern', circularPattern: 'add_circular_pattern', mirror: 'add_mirror', plane: 'add_plane', loft: 'add_loft',
  sweep: 'add_sweep', draft: 'add_draft',
};

const bool = (v: unknown, what: string): boolean => {
  if (typeof v === 'boolean') return v;
  if (v === 'true' || v === 1) return true;
  if (v === 'false' || v === 0) return false;
  throw new ToolError(`${what}: expected true or false`);
};

const text = (v: unknown, what: string): string => {
  if (typeof v !== 'string' || !v.trim()) throw new ToolError(`${what}: expected a non-empty string`);
  return v.trim();
};

function choice<T extends string>(v: unknown, options: Record<string, T>, what: string): T {
  const s = typeof v === 'string' ? v.trim().toLowerCase().replace(/[\s-]+/g, '_') : '';
  const r = options[s];
  if (!r) throw new ToolError(`${what}: one of ${[...new Set(Object.keys(options))].filter((k) => !k.includes('__')).join(', ')}`);
  return r;
}

const END = { blind: 'blind', through_all: 'throughAll', throughall: 'throughAll', mid_plane: 'midPlane', midplane: 'midPlane', symmetric: 'midPlane' } as const;
const END2 = { blind: 'blind', through_all: 'throughAll', throughall: 'throughAll' } as const;
const HOLE_END = { ...END2, to_object: 'toObject', toobject: 'toObject', object: 'toObject' } as const;
const END_OUT: Record<string, string> = { blind: 'blind', throughAll: 'through_all', midPlane: 'mid_plane', toObject: 'to_object' };
const HOLE_KIND = {
  simple: 'simple', counterbore: 'counterbore', double_counterbore: 'doubleCounterbore', countersink: 'countersink',
  counterdrill: 'counterdrill', spotface: 'spotface', tapped: 'tapped',
} as const;
const HOLE_TIP = { flat: 'flat', drill: 'drill', drill_point: 'drill' } as const;
const CHAMFER_MODE = { distance: 'distance', equal_distance: 'distance', two_distances: 'twoDistance', two_distance: 'twoDistance', distance_angle: 'distanceAngle' } as const;
const CHAMFER_OUT: Record<string, string> = { distance: 'distance', twoDistance: 'two_distances', distanceAngle: 'distance_angle' };
const PLANE_KIND = { offset: 'offset', midplane: 'midplane', angle: 'angle', plane_at_angle: 'angle', plane_at_an_angle: 'angle' } as const;

export class FeatureCodec {
  constructor(private u: Units, private refs: Refs) {}

  /**
   * A feature from tool arguments: a new one (base null) or the base with the
   * given arguments changed. Throws ToolError for anything unusable.
   */
  build(type: FeatureType, a: Obj, base: Feature | null, id: Id, name: string): Feature {
    const has = (k: string) => a[k] !== undefined;
    const u = this.u, refs = this.refs;
    const len = (k: string, what = k) => u.parseParam(a[k], 'length', what);
    const ang = (k: string, what = k) => u.parseParam(a[k], 'angle', what);
    const cnt = (k: string, what = k) => u.parseParam(a[k], 'count', what);
    const need = (...keys: string[]) => { if (!base) for (const k of keys) if (!has(k)) throw new ToolError(`${k} is required`); };
    // The kernel does not build thin (wall) features; one can only be cleared.
    const thin = (v: unknown): null => {
      if (v == null || v === false) return null;
      throw new ToolError(tr("thin: thin (wall) features are not supported. Sketch the wall as a closed profile (e.g. an offset of the outline), or build the solid and use add_shell."));
    };
    const regions = (v: unknown, sketch: Id): Vec2[] | undefined => {
      if (v == null || (Array.isArray(v) && !v.length)) return undefined;
      if (!Array.isArray(v)) throw new ToolError(tr("regions: a list of points inside the profile regions to use"));
      const sk = refs.sketch(sketch);
      const fr = refs.sketchFrame(sk);
      return v.map((p, i) => {
        const q = u.point(p, `regions[${i}]`);
        if (q.length === 2) return [q[0], q[1]] as Vec2;
        if (!fr) throw new ToolError(`regions[${i}]: the sketch plane is not resolved yet; give sketch coordinates [x, y]`);
        return toLocal(fr, q as [number, number, number]);
      });
    };
    const out = structuredClone(base) as Feature | null;

    switch (type) {
      case 'extrude': {
        need('sketch');
        const cut = has('cut') ? bool(a.cut, 'cut') : (base?.type === 'extrude' && base.cut) || false;
        const f = out?.type === 'extrude' ? out : newExtrude(id, name, '', cut, 10);
        f.cut = cut;
        if (has('sketch')) f.sketch = refs.sketch(a.sketch).id;
        if (has('end')) f.end = choice(a.end, END, 'end');
        // A depth given without an end means that depth, also for a cut (new cuts default to through_all).
        if (has('depth')) { f.depth = len('depth'); if (!has('end') && f.end === 'throughAll') f.end = 'blind'; }
        else if (!base && f.end !== 'throughAll') throw new ToolError(tr("depth is required unless end is through_all"));
        if (has('reverse')) f.flip = bool(a.reverse, 'reverse');
        if (has('direction2')) {
          const d = a.direction2 as Obj | null;
          // What is not given stays as it was, like the feature's other arguments; a depth alone means blind, as above.
          const cur = f.dir2;
          const kept = cur && (typeof cur.depth === 'string' || cur.depth > 0) ? cur.depth : null;
          const depth = d?.depth != null ? u.parseParam(d.depth, 'length', 'direction2.depth') : kept;
          f.dir2 = d ? { end: d.end != null ? choice(d.end, END2, 'direction2.end') : d.depth != null ? 'blind' : cur?.end ?? 'blind', depth: depth ?? 0 } : null;
          if (f.dir2 && f.dir2.end === 'blind' && depth == null) throw new ToolError(tr("direction2.depth is required for a blind second direction"));
        }
        if (has('draft')) f.draft = ang('draft');
        if (has('draft_outward')) f.draftOutward = bool(a.draft_outward, 'draft_outward');
        if (has('thin')) f.thin = thin(a.thin);
        if (has('regions')) { const r = regions(a.regions, f.sketch); if (r) f.contours = r; else delete f.contours; }
        return f;
      }
      case 'revolve': {
        need('sketch');
        const cut = has('cut') ? bool(a.cut, 'cut') : (base?.type === 'revolve' && base.cut) || false;
        const f = out?.type === 'revolve' ? out : newRevolve(id, name, '', cut);
        f.cut = cut;
        if (has('sketch')) f.sketch = refs.sketch(a.sketch).id;
        if (has('axis')) f.axis = a.axis == null ? null : refs.axis(a.axis, 'axis', f.axis);
        // The kernel builds at most a full turn: 720 was kept and reported back while 360 was built.
        if (has('angle')) { f.angle = ang('angle'); if (u.evalAngle(f.angle) > 360) throw new ToolError(tr("angle: at most 360 (a full revolve)")); }
        if (has('end')) f.end = choice(a.end, { blind: 'blind', one_direction: 'blind', mid_plane: 'midPlane', midplane: 'midPlane', symmetric: 'midPlane' }, 'end');
        if (has('reverse')) f.flip = bool(a.reverse, 'reverse');
        if (has('thin')) f.thin = thin(a.thin);
        if (has('regions')) { const r = regions(a.regions, f.sketch); if (r) f.contours = r; else delete f.contours; }
        return f;
      }
      case 'fillet': {
        need('radius');
        const f = out?.type === 'fillet' ? out : newFillet(id, name, 1);
        if (has('radius')) f.radius = len('radius');
        if (has('edges')) f.edges = refs.edgeRefs(a.edges, 'edges', f.edges);
        if (has('faces')) f.faces = refs.faceRefs(a.faces, 'faces', f.faces);
        if (!f.edges.length && !f.faces.length) throw new ToolError(tr("give edges and/or faces (every edge of a face is filleted)"));
        return f;
      }
      case 'chamfer': {
        need('distance');
        const f = out?.type === 'chamfer' ? out : newChamfer(id, name, 1);
        if (has('mode')) f.mode = choice(a.mode, CHAMFER_MODE, 'mode');
        if (has('distance')) { f.distance = len('distance'); if (!base && !has('distance2')) f.distance2 = f.distance; }
        if (has('distance2')) f.distance2 = len('distance2');
        if (has('angle')) f.angle = ang('angle');
        if (has('flip')) f.flip = bool(a.flip, 'flip');
        if (has('edges')) f.edges = refs.edgeRefs(a.edges, 'edges', f.edges);
        if (has('faces')) f.faces = refs.faceRefs(a.faces, 'faces', f.faces);
        if (!f.edges.length && !f.faces.length) throw new ToolError(tr("give edges and/or faces (every edge of a face is chamfered)"));
        return f;
      }
      case 'shell': {
        need('thickness');
        const f = out?.type === 'shell' ? out : newShell(id, name, 1);
        if (has('thickness')) f.thickness = len('thickness');
        if (has('faces_to_remove')) f.faces = refs.faceRefs(a.faces_to_remove, 'faces_to_remove', f.faces);
        if (has('outward')) f.outward = bool(a.outward, 'outward');
        return f;
      }
      case 'hole': {
        need('sketch', 'diameter');
        const f = out?.type === 'hole' ? out : newHole(id, name, '', 5);
        if (has('sketch')) f.sketch = refs.sketch(a.sketch).id;
        if (has('kind')) f.kind = choice(a.kind, HOLE_KIND, 'kind');
        if (has('diameter')) {
          f.diameter = len('diameter');
          // Sizes not given follow the diameter, also one given as an expression ("=D").
          const d = base ? NaN : u.evalLength(f.diameter);
          if (d > 0) Object.assign(f, {
            depth: d * 2, cbDiameter: d * 1.8, cbDepth: d * 0.6, csDiameter: d * 2,
            sfDiameter: d * 1.8, sfDepth: d * 0.4, cb2Diameter: d * 2.4, cb2Depth: d * 0.4,
            cdDiameter: d * 1.8, cdDepth: d * 0.5, cdAngle: 90, threadPitch: d * 0.15, tapDrillDiameter: d * 0.85,
            tip: 'drill', tipAngle: 118,
          });
        }
        if (has('end')) f.end = choice(a.end, HOLE_END, 'end');
        else if (has('depth') && f.end === 'throughAll') f.end = 'blind';
        if (has('depth')) f.depth = len('depth');
        if (has('to_face')) f.toFace = refs.faceRefs([a.to_face], 'to_face')[0] ?? null;
        if (f.end === 'toObject' && !f.toFace) throw new ToolError(tr("to_face is required when end is to_object"));
        if (has('cb_diameter')) f.cbDiameter = len('cb_diameter');
        if (has('cb_depth')) f.cbDepth = len('cb_depth');
        if (has('cb2_diameter')) f.cb2Diameter = len('cb2_diameter');
        if (has('cb2_depth')) f.cb2Depth = len('cb2_depth');
        if (has('cs_diameter')) f.csDiameter = len('cs_diameter');
        if (has('cs_angle')) f.csAngle = ang('cs_angle');
        if (has('cd_diameter')) f.cdDiameter = len('cd_diameter');
        if (has('cd_depth')) f.cdDepth = len('cd_depth');
        if (has('cd_angle')) f.cdAngle = ang('cd_angle');
        if (has('sf_diameter')) f.sfDiameter = len('sf_diameter');
        if (has('sf_depth')) f.sfDepth = len('sf_depth');
        if (has('thread_size')) f.threadSize = text(a.thread_size, 'thread_size');
        if (has('thread_pitch')) f.threadPitch = len('thread_pitch');
        if (has('thread_class')) f.threadClass = text(a.thread_class, 'thread_class');
        if (has('tap_drill_diameter')) f.tapDrillDiameter = len('tap_drill_diameter');
        if (has('drill_point')) f.tip = choice(a.drill_point, HOLE_TIP, 'drill_point');
        if (has('drill_point_angle')) f.tipAngle = ang('drill_point_angle');
        if (has('reverse')) f.flip = bool(a.reverse, 'reverse');
        return f;
      }
      case 'linearPattern': {
        need('features', 'direction', 'spacing', 'count');
        const f = out?.type === 'linearPattern' ? out : newLinearPattern(id, name, [], 10);
        if (has('features')) f.seeds = refs.features_(a.features, 'features').map((x) => x.id);
        if (has('direction')) f.dir1.ref = refs.axis(a.direction, 'direction', f.dir1.ref);
        if (has('spacing')) f.dir1.spacing = len('spacing');
        if (has('count')) f.dir1.count = cnt('count');
        if (has('reverse')) f.dir1.flip = bool(a.reverse, 'reverse');
        if (has('direction2')) {
          const d = a.direction2 as Obj | null;
          if (!d) f.dir2 = null;
          else {
            const cur: PatternDir = f.dir2 ?? { ref: null, spacing: 10, count: 2, flip: false };
            if (d.direction !== undefined) cur.ref = refs.axis(d.direction, 'direction2.direction', cur.ref);
            if (d.spacing !== undefined) cur.spacing = u.parseParam(d.spacing, 'length', 'direction2.spacing');
            if (d.count !== undefined) cur.count = u.parseParam(d.count, 'count', 'direction2.count');
            if (d.reverse !== undefined) cur.flip = bool(d.reverse, 'direction2.reverse');
            if (!cur.ref) throw new ToolError(tr("direction2.direction is required"));
            f.dir2 = cur;
          }
        }
        return f;
      }
      case 'circularPattern': {
        need('features', 'axis', 'count');
        const f = out?.type === 'circularPattern' ? out : newCircularPattern(id, name, []);
        if (has('features')) f.seeds = refs.features_(a.features, 'features').map((x) => x.id);
        if (has('axis')) f.axis = refs.axis(a.axis, 'axis', f.axis);
        if (has('count')) f.count = cnt('count');
        if (has('angle')) f.angle = ang('angle');
        if (has('equal_spacing')) f.equal = bool(a.equal_spacing, 'equal_spacing');
        if (has('reverse')) f.flip = bool(a.reverse, 'reverse');
        return f;
      }
      case 'mirror': {
        need('plane');
        const f = out?.type === 'mirror' ? out : newMirror(id, name, []);
        if (has('features')) f.seeds = refs.features_(a.features, 'features').map((x) => x.id);
        if (has('plane')) f.plane = refs.plane(a.plane, 'plane', f.plane);
        return f;
      }
      case 'plane': {
        const f = out?.type === 'plane' ? out : newPlane(id, name, null, 0);
        if (has('kind')) f.kind = choice(a.kind, PLANE_KIND, 'kind');
        const kind = f.kind ?? 'offset';
        const pointOf = (v: unknown, what: string): [number, number, number] => {
          const p = u.point(v, what);
          if (p.length !== 3) throw new ToolError(tr("{0}: give a world point [x, y, z]", [what]));
          return [p[0], p[1], p[2]];
        };
        if (kind === 'tangent') {
          if (!base && !has('face')) throw new ToolError(tr("face is required for a tangent plane"));
          if (has('face')) f.face = refs.faceRefs(a.face, 'face', f.face ? [f.face] : [])[0] ?? null;
          if (has('point')) f.point = a.point == null ? null : pointOf(a.point, 'point');
          if (has('reverse')) f.flip = bool(a.reverse, 'reverse');
          return f;
        }
        if (kind === 'twoEdges') {
          if (has('edges')) f.edges = refs.edgeRefs(a.edges, 'edges', f.edges ?? []);
          if (!base && (f.edges?.length ?? 0) < 2) throw new ToolError(tr("edges: two straight edge names are required"));
          if (has('reverse')) f.flip = bool(a.reverse, 'reverse');
          return f;
        }
        if (kind === 'threePoints') {
          if (has('points')) {
            const list = Array.isArray(a.points) ? a.points : [];
            if (list.length !== 3) throw new ToolError(tr("points: three world points are required"));
            f.points = list.map((p, i) => pointOf(p, `points[${i}]`));
          }
          if (!base && (f.points?.length ?? 0) < 3) throw new ToolError(tr("points: three world points are required"));
          if (has('reverse')) f.flip = bool(a.reverse, 'reverse');
          return f;
        }
        need('reference');
        if (!base && kind === 'midplane' && !has('second_reference')) throw new ToolError(tr("second_reference is required for a midplane"));
        if (!base && kind === 'angle' && !has('axis')) throw new ToolError(tr("axis is required for a plane at angle"));
        if (kind === 'angle' && f.angle == null) f.angle = 45;
        if (has('reference')) f.ref = refs.plane(a.reference, 'reference', f.ref);
        if (has('second_reference')) f.ref2 = refs.plane(a.second_reference, 'second_reference', f.ref2 ?? null);
        if (has('axis')) f.axis = refs.axis(a.axis, 'axis', f.axis ?? null);
        if (has('offset')) f.offset = len('offset');
        if (has('angle')) f.angle = ang('angle');
        if (has('reverse')) f.flip = bool(a.reverse, 'reverse');
        return f;
      }
      case 'loft': {
        need('profiles');
        const f = out?.type === 'loft' ? out : newLoft(id, name, [], false);
        if (has('profiles')) {
          f.profiles = (Array.isArray(a.profiles) ? a.profiles : []).map((p, i) => refs.sketch(p, `profiles[${i}]`).id);
          if (f.profiles.length < 2) throw new ToolError(tr("profiles: at least two sketches, in order"));
        }
        if (has('cut')) f.cut = bool(a.cut, 'cut');
        if (has('ruled')) f.ruled = bool(a.ruled, 'ruled');
        return f;
      }
      case 'sweep': {
        need('profile', 'path');
        const f = out?.type === 'sweep' ? out : newSweep(id, name, false);
        if (has('profile')) f.profile = refs.sketch(a.profile, 'profile').id;
        if (has('path')) f.path = refs.sketch(a.path, 'path').id;
        if (has('cut')) f.cut = bool(a.cut, 'cut');
        return f;
      }
      case 'draft': {
        need('faces', 'neutral_plane', 'angle');
        const f = out?.type === 'draft' ? out : newDraft(id, name);
        if (has('faces')) f.faces = refs.faceRefs(a.faces, 'faces', f.faces);
        if (has('neutral_plane')) f.neutral = refs.plane(a.neutral_plane, 'neutral_plane', f.neutral);
        if (has('angle')) f.angle = ang('angle');
        if (has('reverse')) f.flip = bool(a.reverse, 'reverse');
        return f;
      }
      default:
        throw new ToolError(`${type} features cannot be created or changed this way`);
    }
  }

  /** A feature's arguments as the add_/edit_ tools take them. */
  args(f: Feature): Obj {
    const u = this.u;
    const L = (p: number | string) => u.param(p, 'length');
    const A = (p: number | string) => u.param(p, 'angle');
    const C = (p: number | string) => u.param(p, 'count');
    // Only reported when set (outside the assistant): thin features are not built; edit_feature clears one with thin: null.
    const thin = (t: ThinOptions | null | undefined) => (t ? { thin: { thickness: L(t.thickness), side: t.side, not_supported: true } } : {});
    const regions = (c?: Vec2[]) => (c?.length ? c.map((p) => [Number(u.len(p[0])), Number(u.len(p[1]))]) : undefined);
    switch (f.type) {
      case 'sketch': return { plane: planeSpec(f.plane), entities: f.entities.length, constraints: f.constraints.length };
      case 'extrude': return {
        sketch: f.sketch, cut: f.cut, end: END_OUT[f.end], depth: f.end === 'throughAll' ? undefined : L(f.depth), reverse: f.flip,
        direction2: f.dir2 ? { end: END_OUT[f.dir2.end], depth: f.dir2.end === 'throughAll' ? undefined : L(f.dir2.depth) } : null,
        draft: A(f.draft), draft_outward: f.draftOutward, ...thin(f.thin), regions: regions(f.contours),
      };
      case 'revolve': return { sketch: f.sketch, cut: f.cut, axis: axisSpec(f.axis), angle: A(f.angle), end: END_OUT[f.end], reverse: f.flip, ...thin(f.thin), regions: regions(f.contours) };
      case 'fillet': return { edges: f.edges.map((e) => e.name), faces: f.faces.map((x) => x.name), radius: L(f.radius) };
      case 'chamfer': return { edges: f.edges.map((e) => e.name), faces: f.faces.map((x) => x.name), mode: CHAMFER_OUT[f.mode], distance: L(f.distance), distance2: L(f.distance2), angle: A(f.angle), flip: f.flip };
      case 'shell': return { faces_to_remove: f.faces.map((x) => x.name), thickness: L(f.thickness), outward: f.outward };
      case 'hole': return {
        sketch: f.sketch, kind: f.kind, diameter: L(f.diameter), end: END_OUT[f.end], depth: f.end === 'blind' ? L(f.depth) : undefined,
        to_face: f.end === 'toObject' ? f.toFace?.name : undefined,
        ...(f.kind === 'counterbore' ? { cb_diameter: L(f.cbDiameter), cb_depth: L(f.cbDepth) } : {}),
        ...(f.kind === 'doubleCounterbore' ? {
          cb_diameter: L(f.cbDiameter), cb_depth: L(f.cbDepth),
          cb2_diameter: L(f.cb2Diameter ?? f.cbDiameter), cb2_depth: L(f.cb2Depth ?? f.cbDepth),
        } : {}),
        ...(f.kind === 'countersink' ? { cs_diameter: L(f.csDiameter), cs_angle: A(f.csAngle) } : {}),
        ...(f.kind === 'counterdrill' ? {
          cd_diameter: L(f.cdDiameter ?? f.diameter), cd_depth: L(f.cdDepth ?? f.depth), cd_angle: A(f.cdAngle ?? 90),
        } : {}),
        ...(f.kind === 'spotface' ? { sf_diameter: L(f.sfDiameter ?? f.diameter), sf_depth: L(f.sfDepth ?? f.depth) } : {}),
        ...(f.kind === 'tapped' ? {
          thread_size: f.threadSize ?? 'Custom', thread_pitch: L(f.threadPitch ?? f.diameter), thread_class: f.threadClass ?? '6H',
          tap_drill_diameter: L(f.tapDrillDiameter ?? f.diameter),
        } : {}),
        drill_point: f.tip ?? 'flat',
        drill_point_angle: f.tip === 'drill' && f.end === 'blind' ? A(f.tipAngle ?? 118) : undefined,
        reverse: f.flip,
      };
      case 'linearPattern': return {
        features: f.seeds, direction: axisSpec(f.dir1.ref), spacing: L(f.dir1.spacing), count: C(f.dir1.count), reverse: f.dir1.flip,
        direction2: f.dir2 ? { direction: axisSpec(f.dir2.ref), spacing: L(f.dir2.spacing), count: C(f.dir2.count), reverse: f.dir2.flip } : null,
      };
      case 'circularPattern': return { features: f.seeds, axis: axisSpec(f.axis), count: C(f.count), angle: A(f.angle), equal_spacing: f.equal, reverse: f.flip };
      case 'mirror': return { features: f.seeds, plane: planeSpec(f.plane) };
      case 'plane': {
        const kind = f.kind ?? 'offset';
        if (kind === 'midplane') return { kind, reference: planeSpec(f.ref), second_reference: planeSpec(f.ref2 ?? null), reverse: f.flip };
        if (kind === 'angle') return { kind, reference: planeSpec(f.ref), axis: axisSpec(f.axis ?? null), angle: A(f.angle ?? 45), reverse: f.flip };
        if (kind === 'tangent') return { kind, face: f.face?.name ?? null, point: f.point ?? null, reverse: f.flip };
        if (kind === 'twoEdges') return { kind, edges: (f.edges ?? []).map((e) => e.name), reverse: f.flip };
        if (kind === 'threePoints') return { kind, points: f.points ?? [], reverse: f.flip };
        return { kind, reference: planeSpec(f.ref), offset: L(f.offset), reverse: f.flip };
      }
      case 'loft': return { profiles: f.profiles, cut: f.cut, ruled: f.ruled };
      case 'sweep': return { profile: f.profile, path: f.path, cut: f.cut };
      case 'draft': return { faces: f.faces.map((x) => x.name), neutral_plane: planeSpec(f.neutral), angle: A(f.angle), reverse: f.flip };
      case 'shaft': return {
        segments: f.segments.map((s) => ({ diameter: L(s.diameter), length: L(s.length) })),
        end_chamfer: L(f.endChamfer),
        keyway: f.keyway ? { segment: f.keyway.segment, width: L(f.keyway.width), depth: L(f.keyway.depth), length: L(f.keyway.length) } : null,
        material: f.material, power: f.power, speed: f.speed, service_factor: f.serviceFactor, allowable_shear: f.allowableShear,
      };
      case 'spurGear': return {
        module: L(f.module), teeth: C(f.teeth), pressure_angle: A(f.pressureAngle), face_width: L(f.faceWidth), bore: L(f.bore),
        hub_diameter: L(f.hubDiameter), hub_length: L(f.hubLength), material: f.material,
        power: f.power, speed: f.speed, service_factor: f.serviceFactor,
      };
      case 'bevelGear': return {
        module: L(f.module), teeth: C(f.teeth), mate_teeth: C(f.mateTeeth), face_width: L(f.faceWidth), bore: L(f.bore),
        pressure_angle: A(f.pressureAngle), material: f.material, power: f.power, speed: f.speed, service_factor: f.serviceFactor,
      };
      case 'wormGear': return {
        module: L(f.module), worm_starts: C(f.wormStarts), wheel_teeth: C(f.wheelTeeth), worm_diameter: L(f.wormDiameter),
        worm_length: L(f.wormLength), face_width: L(f.faceWidth), bore: L(f.bore), material: f.material,
        power: f.power, speed: f.speed, service_factor: f.serviceFactor,
      };
      case 'vBelt': return {
        pulley1: L(f.pulley1), pulley2: L(f.pulley2), center_distance: L(f.centerDistance), belt_width: L(f.beltWidth),
        belt_thickness: L(f.beltThickness), grooves: C(f.grooves), material: f.material,
        power: f.power, speed: f.speed, service_factor: f.serviceFactor,
      };
      case 'syncBelt': return {
        tooth_pitch: L(f.toothPitch), pulley1: C(f.pulley1), pulley2: C(f.pulley2), center_distance: L(f.centerDistance),
        belt_width: L(f.beltWidth), belt_thickness: L(f.beltThickness), material: f.material,
        power: f.power, speed: f.speed, service_factor: f.serviceFactor,
      };
      case 'sprocket': return {
        pitch: L(f.pitch), teeth: C(f.teeth), roller_diameter: L(f.rollerDiameter), tooth_width: L(f.toothWidth), bore: L(f.bore),
        hub_diameter: L(f.hubDiameter), hub_length: L(f.hubLength), material: f.material,
        power: f.power, speed: f.speed, service_factor: f.serviceFactor,
      };
      case 'coil': return { profile: f.profile, pitch: L(f.pitch), revolutions: C(f.revolutions), height: L(f.height), by_height: f.byHeight, left: f.left, cut: f.cut };
      case 'axis': return { kind: f.kind ?? 'cylinder', face: f.face?.name ?? null, edge: f.edge?.name ?? null, points: f.points ?? [], plane: planeSpec(f.ref ?? null), point: f.point ?? null, reverse: f.flip === true };
      case 'point': return { kind: f.kind ?? 'vertex', point: f.point ?? null, edge: f.edge?.name ?? null, face: f.face?.name ?? null, edge2: f.edge2?.name ?? null, plane: planeSpec(f.plane ?? null) };
      case 'import': return { format: f.format, file: f.fileName };
    }
  }
}
