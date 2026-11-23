// Geometry for the power-transmission generators. Every part is built at the
// origin in its own axis system and then moved into place by the drive that
// contains it, so a feature can be edited without touching the others.
//
// Teeth are sampled involute profiles (the true involute, evaluated at a few
// points per flank) extruded or lofted; grooves and seats are polylines. The
// parts are meant to be dimensionally right and look like the real thing, not
// to be a certified cutting-tool model.

import * as R from 'replicad';
import { tr } from '../i18n';
import type {
  BevelGearFeature, SpurGearFeature, SprocketFeature, SyncBeltFeature, VBeltFeature, WormGearFeature,
} from '../model/types';
import { compound, cut, fuse, translated, type Sh } from './occ';

export interface PtContext {
  num: (p: unknown) => number;
  fail: (message: string) => never;
}

type V3 = [number, number, number];

const V = R.Vector;
const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

const polar = (r: number, a: number): [number, number] => [r * Math.cos(a), r * Math.sin(a)];
const rotate2 = ([x, y]: [number, number], a: number): [number, number] => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** A closed planar face from points in the XY plane. */
function face2d(points: [number, number][]): R.Face {
  const cleaned: [number, number][] = [];
  for (const p of points) {
    const last = cleaned[cleaned.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 1e-9) cleaned.push(p);
  }
  if (cleaned.length > 2) {
    const first = cleaned[0], last = cleaned[cleaned.length - 1];
    if (Math.hypot(first[0] - last[0], first[1] - last[1]) < 1e-9) cleaned.pop();
  }
  return R.makePolygon(cleaned);
}

/** A closed polygon whose points are already in 3D (must be planar). */
function face3d(points: V3[]): R.Face {
  return R.makePolygon(points);
}

function extrudeZ(face: R.Face, height: number, z = 0): Sh {
  return R.basicFaceExtrusion(face, new V([0, 0, height])).translate([0, 0, z]) as unknown as Sh;
}

/** Boolean cut with a cylinder along `dir` starting at `from`. */
function drill(shape: Sh, radius: number, from: V3, dir: V3, length: number): Sh {
  return cut(shape, R.makeCylinder(radius, length, from, dir) as unknown as Sh);
}

function addCylinder(shape: Sh, radius: number, from: V3, dir: V3, length: number): Sh {
  return fuse(shape, R.makeCylinder(radius, length, from, dir) as unknown as Sh);
}

/** Involute of the tooth flank, sampled from the base circle to the tip. */
function involuteFlank(rb: number, rStart: number, ra: number, halfPitch: number, invAlpha: number, samples: number): { r: number; theta: number }[] {
  const out: { r: number; theta: number }[] = [];
  const n = Math.max(2, samples);
  for (let i = 0; i <= n; i++) {
    const r = rStart + ((ra - rStart) * i) / n;
    const t = Math.sqrt(Math.max(0, (r / rb) ** 2 - 1));
    const inv = t - Math.atan(t);
    out.push({ r, theta: halfPitch + invAlpha - inv });
  }
  return out;
}

/**
 * Outline of an involute gear with `count` teeth, whose flanks are shaped for
 * `shapeCount` teeth (a bevel gear uses its virtual tooth count here).
 */
function involuteGearPoints(module: number, count: number, shapeCount: number, pressureAngle: number): [number, number][] {
  const alpha = Math.max(10, Math.min(30, pressureAngle)) * DEG;
  const rp = (module * shapeCount) / 2;
  const rb = rp * Math.cos(alpha);
  const ra = rp + module;
  const rf = Math.max(module * 0.2, rp - 1.25 * module);
  const rStart = Math.max(rb, rf);
  const halfPitch = Math.PI / (2 * shapeCount);
  const invAlpha = Math.tan(alpha) - alpha;
  const samples = count > 40 ? 5 : 7;
  const flank = involuteFlank(rb, rStart, ra, halfPitch, invAlpha, samples);
  const tipHalf = flank[flank.length - 1].theta;
  const rootHalf = flank[0].theta;
  const points: [number, number][] = [];
  for (let i = 0; i < count; i++) {
    const a = (TAU * i) / count;
    // Left flank from the root circle up to the tip, then the tip arc, then
    // the right flank back down; the root circle joins the next tooth.
    points.push(rotate2(polar(rStart, -rootHalf), a));
    for (const f of flank) points.push(rotate2(polar(f.r, -f.theta), a));
    for (let k = 1; k <= 2; k++) points.push(rotate2(polar(ra, -tipHalf + (2 * tipHalf * k) / 3), a));
    for (let k = flank.length - 1; k >= 0; k--) points.push(rotate2(polar(flank[k].r, flank[k].theta), a));
    points.push(rotate2(polar(rStart, rootHalf), a));
  }
  return points;
}

/** Trapezoid teeth as used on synchronous pulleys and timing belts. */
function trapezoidTeethPoints(count: number, ra: number, rf: number, toothHalfTip: number, toothHalfRoot: number): [number, number][] {
  const halfPitch = Math.PI / count;
  const points: [number, number][] = [];
  const arc = (r: number, from: number, to: number, n: number) => {
    for (let i = 0; i <= n; i++) points.push(polar(r, from + ((to - from) * i) / n));
  };
  for (let i = 0; i < count; i++) {
    const a = (TAU * i) / count;
    arc(rf, a - halfPitch, a - toothHalfRoot, 2);
    points.push(polar(ra, a - toothHalfTip));
    arc(ra, a - toothHalfTip, a + toothHalfTip, 2);
    points.push(polar(rf, a + toothHalfRoot));
    arc(rf, a + toothHalfRoot, a + halfPitch, 2);
  }
  return points;
}

// ---------- spur gear ----------

export function buildSpurGear(ctx: PtContext, f: SpurGearFeature): Sh {
  const module = ctx.num(f.module);
  const teeth = Math.round(ctx.num(f.teeth));
  const alpha = ctx.num(f.pressureAngle) || 20;
  const width = ctx.num(f.faceWidth);
  const bore = Math.max(0, ctx.num(f.bore));
  const hubDiameter = Math.max(0, ctx.num(f.hubDiameter ?? 0));
  const hubLength = Math.max(0, ctx.num(f.hubLength ?? 0));
  if (!(module > 0)) ctx.fail(tr("The module must be greater than zero"));
  if (!(teeth >= 5 && teeth <= 120)) ctx.fail(tr("Teeth must be between 5 and 120"));
  if (!(width > 0)) ctx.fail(tr("The face width must be greater than zero"));
  const rootRadius = (module * teeth) / 2 - 1.25 * module;
  if (bore >= rootRadius * 2) ctx.fail(tr("The bore must be smaller than the root diameter"));
  if (hubDiameter > 0 && hubDiameter <= bore) ctx.fail(tr("The hub diameter must be larger than the bore"));
  if (hubDiameter > 0 && !(hubLength > 0)) ctx.fail(tr("The hub length must be greater than zero"));
  if (hubDiameter > 0 && hubDiameter / 2 >= rootRadius - module * 0.5) ctx.fail(tr("The hub is too large for the gear body"));

  let gear = extrudeZ(face2d(involuteGearPoints(module, teeth, teeth, alpha)), width);
  if (hubDiameter > 0) {
    gear = addCylinder(gear, hubDiameter / 2, [-hubLength / 2, 0, -hubLength / 2], [0, 0, 1], width + hubLength);
  }
  if (bore > 0) gear = drill(gear, bore / 2, [0, 0, -hubLength - 1], [0, 0, 1], width + 2 * hubLength + 2);
  return translated(gear, [0, 0, -width / 2]);
}

// ---------- bevel gear ----------

export function buildBevelGear(ctx: PtContext, f: BevelGearFeature): Sh {
  const module = ctx.num(f.module);
  const teeth = Math.round(ctx.num(f.teeth));
  const mate = Math.round(ctx.num(f.mateTeeth));
  const width = ctx.num(f.faceWidth);
  const bore = Math.max(0, ctx.num(f.bore));
  const alpha = ctx.num(f.pressureAngle) || 20;
  if (!(module > 0)) ctx.fail(tr("The module must be greater than zero"));
  if (!(teeth >= 5 && teeth <= 100) || !(mate >= 5 && mate <= 100)) ctx.fail(tr("Teeth must be between 5 and 100"));
  if (!(width > 0)) ctx.fail(tr("The face width must be greater than zero"));
  const delta = Math.atan(teeth / mate);
  const coneDistance = (module / 2) * Math.hypot(teeth, mate);
  if (width > coneDistance / 3) ctx.fail(tr("The face width cannot be more than a third of the cone distance"));
  const virtualTeeth = teeth / Math.cos(delta);
  const cosDelta = Math.cos(delta);
  const largePoints = involuteGearPoints(module, teeth, virtualTeeth, alpha).map(([x, y]) => [x * cosDelta, y * cosDelta] as [number, number]);
  const k = (coneDistance - width) / coneDistance;
  const smallPoints = largePoints.map(([x, y]) => [x * k, y * k] as [number, number]);
  if (bore >= Math.min(...largePoints.map(([x, y]) => Math.hypot(x, y))) * 0.9) ctx.fail(tr("The bore is too large for the gear"));
  const w1 = face2d(largePoints).outerWire();
  const w2 = face2d(smallPoints).outerWire().translate([0, 0, width]) as unknown as R.Wire;
  let gear = R.loft([w1, w2], { ruled: true }) as unknown as Sh;
  if (bore > 0) gear = drill(gear, bore / 2, [0, 0, -1], [0, 0, 1], width + 2);
  return translated(gear, [0, 0, -width / 2]);
}

// ---------- worm gear ----------

export function buildWormGear(ctx: PtContext, f: WormGearFeature): Sh {
  const module = ctx.num(f.module);
  const starts = Math.round(ctx.num(f.wormStarts));
  const wheelTeeth = Math.round(ctx.num(f.wheelTeeth));
  const wormDiameter = ctx.num(f.wormDiameter);
  const wormLength = ctx.num(f.wormLength);
  const width = ctx.num(f.faceWidth);
  const bore = Math.max(0, ctx.num(f.bore));
  if (!(module > 0)) ctx.fail(tr("The module must be greater than zero"));
  if (!(starts >= 1 && starts <= 4)) ctx.fail(tr("The worm must have 1 to 4 starts"));
  if (!(wheelTeeth >= 8 && wheelTeeth <= 120)) ctx.fail(tr("The wheel teeth must be between 8 and 120"));
  if (!(wormDiameter > 0)) ctx.fail(tr("The worm diameter must be greater than zero"));
  if (!(wormLength >= 2 * Math.PI * module)) ctx.fail(tr("The worm length must cover at least one turn of thread"));
  if (!(width > 0)) ctx.fail(tr("The face width must be greater than zero"));

  const wheelPitchDiameter = module * wheelTeeth;
  const center = (wormDiameter + wheelPitchDiameter) / 2;
  if (bore >= wheelPitchDiameter / 2 - module) ctx.fail(tr("The bore is too large for the wheel"));

  // Wheel: an involute disc with a cylindrical throat where the worm wraps.
  let wheel = extrudeZ(face2d(involuteGearPoints(module, wheelTeeth, wheelTeeth, 20)), width);
  wheel = cut(wheel, R.makeCylinder(wormDiameter / 2 + 0.15, wheelPitchDiameter * 1.6, [0, center, -width], [0, 0, 1]) as unknown as Sh);
  if (bore > 0) wheel = drill(wheel, bore / 2, [0, 0, -width / 2 - 1], [0, 0, 1], width + 2);
  wheel = translated(wheel, [0, 0, -width / 2]);

  // Worm: a cylinder along X with a helical thread swept around it.
  const axialPitch = Math.PI * module;
  const rootRadius = Math.max(module, wormDiameter / 2 - 1.25 * module);
  const helixRadius = Math.max(rootRadius * 0.6, wormDiameter / 2 - 1.25 * module);
  const x0 = -wormLength / 2;
  let worm = R.makeCylinder(rootRadius, wormLength, [x0, center, 0], [1, 0, 0]) as unknown as Sh;
  const helix = R.makeHelix(axialPitch, wormLength, helixRadius, [x0, center, 0], [1, 0, 0]);
  const start: V3 = [x0, center, helixRadius];
  // The helix turns clockwise seen along +X: the tangent at the start point is
  // (pitch / 2pi, -r, 0).
  const v = axialPitch / TAU;
  const tangent = unit([v, -helixRadius, 0]);
  const radial: V3 = [0, 0, 1];
  const axial = unit(cross(tangent, radial));
  const threadHalf = 0.32 * axialPitch;
  const threadDepth = 1.25 * module;
  const section: [number, number][] = [
    [-threadDepth, -threadHalf],
    [0.85 * module, -0.18 * axialPitch],
    [0.85 * module, 0.18 * axialPitch],
    [-threadDepth, threadHalf],
  ];
  const sectionFace = face3d(section.map(([u, w]) => [
    start[0] + u * radial[0] + w * axial[0],
    start[1] + u * radial[1] + w * axial[1],
    start[2] + u * radial[2] + w * axial[2],
  ]));
  const thread = R.genericSweep(sectionFace.outerWire(), helix, { frenet: true }) as unknown as Sh;
  worm = fuse(worm, thread);
  if (bore > 0) worm = drill(worm, Math.min(bore / 2, rootRadius * 0.8), [x0 - 1, center, 0], [1, 0, 0], wormLength + 2);

  return compound([wheel, worm]);
}

// ---------- belt drives ----------

interface BeltPath {
  /** Centre-line samples with their outward normal. */
  points: [number, number][];
  normals: [number, number][];
}

/** Centre line of an open belt around two pulleys on the X axis. */
function beltPath(r1: number, r2: number, center: number): BeltPath {
  const phi = Math.asin(Math.max(-0.99, Math.min(0.99, (r2 - r1) / center)));
  const points: [number, number][] = [];
  const normals: [number, number][] = [];
  const upper1: [number, number] = [-r1 * Math.sin(phi), r1 * Math.cos(phi)];
  const upper2: [number, number] = [center - r2 * Math.sin(phi), r2 * Math.cos(phi)];
  const lower1: [number, number] = [-r1 * Math.sin(phi), -r1 * Math.cos(phi)];
  const lower2: [number, number] = [center - r2 * Math.sin(phi), -r2 * Math.cos(phi)];
  const push = (p: [number, number], n: [number, number]) => {
    points.push(p);
    normals.push(n);
  };
  // Upper run, left to right.
  const lineSteps = 12;
  for (let i = 0; i < lineSteps; i++) {
    const t = i / lineSteps;
    push([upper1[0] + (upper2[0] - upper1[0]) * t, upper1[1] + (upper2[1] - upper1[1]) * t], [Math.sin(phi), Math.cos(phi)]);
  }
  // Around the second pulley, clockwise through the far side.
  const a0 = Math.atan2(upper2[1], upper2[0]);
  const sweep2 = TAU - 2 * (Math.PI / 2 + phi);
  const arcSteps = Math.max(8, Math.round(sweep2 * 8));
  for (let i = 0; i <= arcSteps; i++) {
    const a = a0 - (sweep2 * i) / arcSteps;
    push([center + r2 * Math.cos(a), r2 * Math.sin(a)], [Math.cos(a), Math.sin(a)]);
  }
  // Lower run, right to left.
  for (let i = 0; i < lineSteps; i++) {
    const t = i / lineSteps;
    push([lower2[0] + (lower1[0] - lower2[0]) * t, lower2[1] + (lower1[1] - lower2[1]) * t], [-Math.sin(phi), -Math.cos(phi)]);
  }
  // Around the first pulley, clockwise through the far side.
  const b0 = Math.atan2(lower1[1], lower1[0]);
  const sweep1 = TAU - 2 * (Math.PI / 2 - phi);
  const arcSteps1 = Math.max(8, Math.round(sweep1 * 8));
  for (let i = 0; i <= arcSteps1; i++) {
    const a = b0 - (sweep1 * i) / arcSteps1;
    push([r1 * Math.cos(a), r1 * Math.sin(a)], [Math.cos(a), Math.sin(a)]);
  }
  return { points, normals };
}

/** The belt itself: a band of the path, offset half a thickness each way. */
function beltBand(path: BeltPath, thickness: number, width: number): Sh {
  const outer: [number, number][] = path.points.map((p, i) => [p[0] + (thickness / 2) * path.normals[i][0], p[1] + (thickness / 2) * path.normals[i][1]]);
  const inner: [number, number][] = path.points.map((p, i) => [p[0] - (thickness / 2) * path.normals[i][0], p[1] - (thickness / 2) * path.normals[i][1]]);
  const face = R.makeFace(face2d(outer).outerWire(), [face2d(inner).outerWire()]);
  return extrudeZ(face, width, -width / 2);
}

/**
 * A sheave with V grooves: a revolved disc whose rim is cut into `grooves`
 * trapezoidal grooves of the given belt section.
 */
function vSheave(ctx: PtContext, diameter: number, width: number, thickness: number, grooves: number): Sh {
  const pitchRadius = diameter / 2;
  const outerRadius = pitchRadius + thickness / 2;
  const grooveDepth = thickness;
  const bottomRadius = Math.max(thickness * 0.6, outerRadius - grooveDepth);
  const axialWidth = width + thickness * 1.5;
  const groovePitch = width / grooves;
  const topWidth = groovePitch * 0.82;
  const taper = grooveDepth * Math.tan(19 * DEG);
  if (topWidth - 2 * taper <= 0.2) ctx.fail(tr("The belt is too thick for the groove spacing"));
  const profile: [number, number][] = [];
  const boreRadius = Math.max(width * 0.16, diameter * 0.05);
  profile.push([boreRadius, -axialWidth / 2], [outerRadius, -axialWidth / 2]);
  for (let i = 0; i < grooves; i++) {
    const zc = -width / 2 + (i + 0.5) * groovePitch;
    profile.push(
      [outerRadius, zc - topWidth / 2],
      [bottomRadius, zc - topWidth / 2 + taper],
      [bottomRadius, zc + topWidth / 2 - taper],
      [outerRadius, zc + topWidth / 2],
    );
  }
  profile.push([outerRadius, axialWidth / 2], [boreRadius, axialWidth / 2]);
  const face = face3d(profile.map(([r, z]) => [r, 0, z] as V3));
  return R.revolution(face, [0, 0, 0], [0, 0, 1], 360) as unknown as Sh;
}

/** A synchronous pulley: trapezoid teeth around a rim with a bore. */
function timingPulley(ctx: PtContext, pitchDiameter: number, teeth: number, toothPitch: number, width: number, thickness: number): Sh {
  const ra = pitchDiameter / 2 + toothPitch * 0.3;
  const rf = Math.max(toothPitch * 0.5, pitchDiameter / 2 - toothPitch * 0.55);
  if (rf >= ra) ctx.fail(tr("The pulley is too small for this tooth pitch"));
  const points = trapezoidTeethPoints(teeth, ra, rf, (Math.PI / teeth) * 0.28, (Math.PI / teeth) * 0.42);
  let pulley = extrudeZ(face2d(points), width + thickness, -width / 2 - thickness / 2);
  const bore = Math.max(toothPitch * 0.4, pitchDiameter * 0.08);
  pulley = drill(pulley, bore / 2, [0, 0, -width], [0, 0, 1], width * 2 + 4);
  return pulley;
}

export function buildVBelt(ctx: PtContext, f: VBeltFeature): Sh {
  const d1 = ctx.num(f.pulley1);
  const d2 = ctx.num(f.pulley2);
  const center = ctx.num(f.centerDistance);
  const width = ctx.num(f.beltWidth);
  const thickness = ctx.num(f.beltThickness);
  const grooves = Math.round(ctx.num(f.grooves));
  if (!(d1 > 0) || !(d2 > 0)) ctx.fail(tr("Pulley diameters must be greater than zero"));
  if (!(center > (d1 + d2) / 2)) ctx.fail(tr("The centre distance must clear both pulleys"));
  if (!(width > 0) || !(thickness > 0)) ctx.fail(tr("The belt width and thickness must be greater than zero"));
  if (!(grooves >= 1 && grooves <= 12)) ctx.fail(tr("The groove count must be between 1 and 12"));
  if (width / grooves < thickness * 0.9) ctx.fail(tr("The belt is too thick for its width"));
  const sheave1 = vSheave(ctx, d1, width, thickness, grooves);
  const sheave2 = translated(vSheave(ctx, d2, width, thickness, grooves), [center, 0, 0]);
  const belt = beltBand(beltPath(d1 / 2, d2 / 2, center), thickness, width);
  return translated(compound([sheave1, sheave2, belt]), [-center / 2, 0, 0]);
}

export function buildSyncBelt(ctx: PtContext, f: SyncBeltFeature): Sh {
  const toothPitch = ctx.num(f.toothPitch);
  const z1 = Math.round(ctx.num(f.pulley1));
  const z2 = Math.round(ctx.num(f.pulley2));
  const center = ctx.num(f.centerDistance);
  const width = ctx.num(f.beltWidth);
  const thickness = ctx.num(f.beltThickness);
  if (!(toothPitch > 0)) ctx.fail(tr("The tooth pitch must be greater than zero"));
  if (!(z1 >= 8 && z2 >= 8)) ctx.fail(tr("Synchronous pulleys need at least 8 teeth"));
  const pitch1 = (toothPitch * z1) / Math.PI;
  const pitch2 = (toothPitch * z2) / Math.PI;
  if (!(center > (pitch1 + pitch2) / 2)) ctx.fail(tr("The centre distance must clear both pulleys"));
  if (!(width > 0) || !(thickness > 0)) ctx.fail(tr("The belt width and thickness must be greater than zero"));
  const pulley1 = timingPulley(ctx, pitch1, z1, toothPitch, width, thickness);
  const pulley2 = translated(timingPulley(ctx, pitch2, z2, toothPitch, width, thickness), [center, 0, 0]);
  // The belt wraps the outside of the toothed pulleys, not their pitch circle.
  const wrap1 = pitch1 / 2 + toothPitch * 0.3 + thickness / 2;
  const wrap2 = pitch2 / 2 + toothPitch * 0.3 + thickness / 2;
  const belt = beltBand(beltPath(wrap1, wrap2, center), thickness, width);
  return translated(compound([pulley1, pulley2, belt]), [-center / 2, 0, 0]);
}

// ---------- sprocket ----------

/** Seat arc around a pitch point: the roller sits in this concave seat. */
export function buildSprocket(ctx: PtContext, f: SprocketFeature): Sh {
  const pitch = ctx.num(f.pitch);
  const teeth = Math.round(ctx.num(f.teeth));
  const roller = ctx.num(f.rollerDiameter);
  const width = ctx.num(f.toothWidth);
  const bore = Math.max(0, ctx.num(f.bore));
  const hubDiameter = Math.max(0, ctx.num(f.hubDiameter ?? 0));
  const hubLength = Math.max(0, ctx.num(f.hubLength ?? 0));
  if (!(pitch > 0)) ctx.fail(tr("The chain pitch must be greater than zero"));
  if (!(teeth >= 6 && teeth <= 120)) ctx.fail(tr("Teeth must be between 6 and 120"));
  if (!(roller > 0 && roller < pitch)) ctx.fail(tr("The roller diameter must be smaller than the chain pitch"));
  if (!(width >= roller * 0.5)) ctx.fail(tr("The tooth width must be at least half the roller diameter"));
  const pitchRadius = pitch / (2 * Math.sin(Math.PI / teeth));
  const seatRadius = roller / 2;
  const tipRadius = pitchRadius + pitch * 0.3;
  const beta = (Math.PI / teeth) * 0.58;
  const tipHalf = (Math.PI / teeth) * 0.3;
  const points: [number, number][] = [];
  for (let i = 0; i < teeth; i++) {
    const a = (TAU * i) / teeth;
    const cx = pitchRadius * Math.cos(a), cy = pitchRadius * Math.sin(a);
    // Roller seat: a concave arc centred on the pitch point.
    for (let k = 0; k <= 6; k++) {
      const ang = a + Math.PI - beta + (2 * beta * k) / 6;
      points.push([cx + seatRadius * Math.cos(ang), cy + seatRadius * Math.sin(ang)]);
    }
    // Rounded tooth tip between two seats.
    const tipAngle = a + Math.PI / teeth;
    for (let k = 0; k <= 2; k++) {
      const ang = tipAngle - tipHalf + (2 * tipHalf * k) / 2;
      points.push([tipRadius * Math.cos(ang), tipRadius * Math.sin(ang)]);
    }
  }
  const rootRadius = pitchRadius - roller * 0.5;
  if (bore >= rootRadius * 2) ctx.fail(tr("The bore must be smaller than the root diameter"));
  if (hubDiameter > 0 && hubDiameter <= bore) ctx.fail(tr("The hub diameter must be larger than the bore"));
  let part = extrudeZ(face2d(points), width);
  if (hubDiameter > 0) part = addCylinder(part, hubDiameter / 2, [0, 0, -hubLength / 2], [0, 0, 1], width + hubLength);
  if (bore > 0) part = drill(part, bore / 2, [0, 0, -hubLength - 1], [0, 0, 1], width + 2 * hubLength + 2);
  return translated(part, [0, 0, -width / 2]);
}

/** Re-exported for the panels: the pitch radius a sprocket sits on. */
export const sprocketPitchRadius = (pitch: number, teeth: number): number => pitch / (2 * Math.sin(Math.PI / Math.max(6, Math.round(teeth))));
