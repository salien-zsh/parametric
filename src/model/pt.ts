import { tr } from '../i18n';
// Power-transmission sizing for the Mechanical generators: gear geometry, the
// forces and speeds that come out of a power and a speed, and the simple
// strength checks shown in the feature panels.
//
// Formulas are the usual textbook ones (torsion, Lewis bending, pitch-line
// velocity, belt length and wrap angle) with power in kW, speed in rpm and
// dimensions in millimetres, so stresses come out in MPa and forces in N.

export interface PTMaterial {
  id: string;
  name: string;
  /** Allowable tooth bending stress, MPa. */
  allowableBending: number;
}

export const PT_MATERIALS: PTMaterial[] = [
  { id: 'steel45', name: tr("45 steel"), allowableBending: 180 },
  { id: '40cr', name: '40Cr', allowableBending: 240 },
  { id: '20crmnti', name: '20CrMnTi', allowableBending: 320 },
  { id: 'castiron', name: tr("Cast iron HT200"), allowableBending: 90 },
  { id: 'al6061', name: tr("6061-T6 aluminium"), allowableBending: 100 },
  { id: 'custom', name: tr("Custom"), allowableBending: 180 },
];

export const materialById = (id: string): PTMaterial => PT_MATERIALS.find((m) => m.id === id) ?? PT_MATERIALS[0];

/** Design torque of a drive, N·m. */
export function designTorque(powerKw: number, speedRpm: number, serviceFactor: number): number | null {
  if (!(powerKw > 0) || !(speedRpm > 0) || !(serviceFactor > 0)) return null;
  return ((9550 * powerKw) / speedRpm) * serviceFactor;
}

/** Pitch-line velocity of a rotating part, m/s. */
export const pitchSpeed = (pitchDiameter: number, speedRpm: number): number => (Math.PI * pitchDiameter * speedRpm) / 60000;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Lewis form factor for a 20-degree full-depth involute tooth. */
export const lewisFactor = (teeth: number): number => 0.154 - 0.912 / clamp(teeth, 12, 400);

export interface SpurGearSizing {
  torque: number;
  designTorque: number;
  /** Pitch, base, outer and root diameters, mm. */
  pitchDiameter: number;
  baseDiameter: number;
  outerDiameter: number;
  rootDiameter: number;
  addendum: number;
  dedendum: number;
  /** Tangential and radial forces at the pitch circle, N. */
  tangentialForce: number;
  radialForce: number;
  /** Pitch-line velocity, m/s. */
  velocity: number;
  /** Tooth bending stress (Lewis), MPa. */
  bendingStress: number;
  /** bendingStress / allowable. */
  utilization: number;
}

/** Sizes a spur gear from its module, tooth count and face width. */
export function sizeSpurGear(
  module: number, teeth: number, pressureAngle: number, faceWidth: number,
  powerKw: number, speedRpm: number, serviceFactor: number, allowableBending: number,
): SpurGearSizing | null {
  const torque = designTorque(powerKw, speedRpm, serviceFactor);
  if (!(module > 0) || !(teeth >= 5) || !(faceWidth > 0) || !(allowableBending > 0) || torque === null) return null;
  const alpha = (clamp(pressureAngle || 20, 10, 30) * Math.PI) / 180;
  const pitchDiameter = module * Math.round(teeth);
  const baseDiameter = pitchDiameter * Math.cos(alpha);
  const outerDiameter = pitchDiameter + 2 * module;
  const rootDiameter = Math.max(module, pitchDiameter - 2.5 * module);
  const tangentialForce = (2000 * torque) / pitchDiameter;
  const radialForce = tangentialForce * Math.tan(alpha);
  const bendingStress = tangentialForce / (faceWidth * module * lewisFactor(teeth));
  return {
    torque: torque / serviceFactor,
    designTorque: torque,
    pitchDiameter,
    baseDiameter,
    outerDiameter,
    rootDiameter,
    addendum: module,
    dedendum: 1.25 * module,
    tangentialForce,
    radialForce,
    velocity: pitchSpeed(pitchDiameter, speedRpm),
    bendingStress,
    utilization: bendingStress / allowableBending,
  };
}

export interface BevelGearSizing {
  torque: number;
  designTorque: number;
  /** Pitch cone angles of the pinion and of its mate, degrees. */
  coneAngle: number;
  mateConeAngle: number;
  /** Cone distance at the back of the teeth, mm. */
  coneDistance: number;
  /** Recommended maximum face width, mm. */
  maxFaceWidth: number;
  pitchDiameter: number;
  matePitchDiameter: number;
  outerDiameter: number;
  /** Ratio mate teeth / teeth. */
  ratio: number;
  /** Mean pitch diameter of the tooth, mm. */
  meanPitchDiameter: number;
  tangentialForce: number;
  radialForce: number;
  velocity: number;
  bendingStress: number;
  utilization: number;
}

/** Sizes a straight bevel gear on a 90-degree shaft angle. */
export function sizeBevelGear(
  module: number, teeth: number, mateTeeth: number, faceWidth: number, pressureAngle: number,
  powerKw: number, speedRpm: number, serviceFactor: number, allowableBending: number,
): BevelGearSizing | null {
  const torque = designTorque(powerKw, speedRpm, serviceFactor);
  const z1 = Math.round(teeth), z2 = Math.round(mateTeeth);
  if (!(module > 0) || !(z1 >= 5) || !(z2 >= 5) || !(faceWidth > 0) || !(allowableBending > 0) || torque === null) return null;
  const alpha = (clamp(pressureAngle || 20, 10, 30) * Math.PI) / 180;
  const coneAngle = (Math.atan(z1 / z2) * 180) / Math.PI;
  const coneDistance = (module / 2) * Math.hypot(z1, z2);
  const maxFaceWidth = coneDistance / 3;
  const pitchDiameter = module * z1;
  const meanPitchDiameter = pitchDiameter * (1 - (0.5 * faceWidth) / coneDistance);
  const tangentialForce = (2000 * torque) / meanPitchDiameter;
  const bendingStress = tangentialForce / (faceWidth * module * lewisFactor(z1 / Math.cos((coneAngle * Math.PI) / 180)));
  return {
    torque: torque / serviceFactor,
    designTorque: torque,
    coneAngle,
    mateConeAngle: 90 - coneAngle,
    coneDistance,
    maxFaceWidth,
    pitchDiameter,
    matePitchDiameter: module * z2,
    outerDiameter: module * z1 + 2 * module * Math.cos((coneAngle * Math.PI) / 180),
    ratio: z2 / z1,
    meanPitchDiameter,
    tangentialForce,
    radialForce: tangentialForce * Math.tan(alpha),
    velocity: pitchSpeed(meanPitchDiameter, speedRpm),
    bendingStress,
    utilization: bendingStress / allowableBending,
  };
}

export interface WormGearSizing {
  torque: number;
  designTorque: number;
  ratio: number;
  /** Lead angle on the worm pitch cylinder, degrees. */
  leadAngle: number;
  centerDistance: number;
  wormPitchDiameter: number;
  wheelPitchDiameter: number;
  /** Axial pitch of the worm, mm. */
  axialPitch: number;
  /** Sliding speed in the mesh, m/s. */
  slidingSpeed: number;
  wheelTorque: number;
  tangentialForce: number;
}

/** Sizes a worm and wheel pair from the axial module and the worm geometry. */
export function sizeWormGear(
  module: number, wormStarts: number, wheelTeeth: number, wormDiameter: number, wormLength: number, faceWidth: number,
  powerKw: number, speedRpm: number, serviceFactor: number,
): WormGearSizing | null {
  const torque = designTorque(powerKw, speedRpm, serviceFactor);
  const z1 = Math.round(wormStarts), z2 = Math.round(wheelTeeth);
  if (!(module > 0) || !(z1 >= 1) || !(z2 >= 8) || !(wormDiameter > 0) || !(wormLength > 0) || !(faceWidth > 0) || torque === null) return null;
  const wheelPitchDiameter = module * z2;
  const leadAngle = (Math.atan((z1 * module) / wormDiameter) * 180) / Math.PI;
  const ratio = z2 / z1;
  const gamma = (leadAngle * Math.PI) / 180;
  return {
    torque: torque / serviceFactor,
    designTorque: torque,
    ratio,
    leadAngle,
    centerDistance: (wormDiameter + wheelPitchDiameter) / 2,
    wormPitchDiameter: wormDiameter,
    wheelPitchDiameter,
    axialPitch: Math.PI * module,
    slidingSpeed: (Math.PI * wormDiameter * speedRpm) / (60000 * Math.max(0.2, Math.cos(gamma))),
    wheelTorque: torque * ratio,
    tangentialForce: (2000 * torque * ratio) / Math.max(1e-6, wheelPitchDiameter * (1 - 0.25)),
  };
}

export interface BeltSizing {
  ratio: number;
  speed: number;
  torque: number;
  designTorque: number;
  /** Wrap angle on each pulley, degrees. */
  wrap1: number;
  wrap2: number;
  /** Belt length around the two pulleys, mm. */
  length: number;
  /** Belt speed, m/s. */
  beltSpeed: number;
  /** Power per belt width, kW/m. */
  powerPerWidth: number;
}

/** Sizes a two-pulley belt drive from its pulley diameters and centre distance. */
export function sizeBelt(
  d1: number, d2: number, center: number, width: number, thickness: number,
  powerKw: number, speedRpm: number, serviceFactor: number,
): BeltSizing | null {
  const torque = designTorque(powerKw, speedRpm, serviceFactor);
  if (!(d1 > 0) || !(d2 > 0) || !(center > 0) || !(width > 0) || !(thickness > 0) || torque === null) return null;
  // A belt can only reach both pulleys if the centre distance clears the radii.
  if (center <= (d1 + d2) / 2) return null;
  const wrap1 = 180 - (360 / Math.PI) * Math.asin(clamp((d2 - d1) / (2 * center), -0.99, 0.99));
  const length = 2 * center + (Math.PI * (d1 + d2)) / 2 + (d2 - d1) ** 2 / (4 * center);
  return {
    ratio: d2 / d1,
    speed: speedRpm,
    torque: torque / serviceFactor,
    designTorque: torque,
    wrap1,
    wrap2: 360 - wrap1,
    length,
    beltSpeed: pitchSpeed(d1, speedRpm),
    powerPerWidth: powerKw / (width / 1000),
  };
}

export interface SyncBeltSizing extends BeltSizing {
  /** Pitch diameters of the two pulleys, mm. */
  pitch1: number;
  pitch2: number;
  /** Teeth in mesh on the small pulley. */
  teethInMesh: number;
  /** Belt pitch length in pitches. */
  beltTeeth: number;
}

/** Sizes a synchronous belt drive from tooth pitch and pulley tooth counts. */
export function sizeSyncBelt(
  toothPitch: number, z1: number, z2: number, center: number, width: number, thickness: number,
  powerKw: number, speedRpm: number, serviceFactor: number,
): SyncBeltSizing | null {
  const a = Math.round(z1), b = Math.round(z2);
  if (!(toothPitch > 0) || !(a >= 8) || !(b >= 8) || !(center > 0) || !(width > 0) || !(thickness > 0)) return null;
  const pitch1 = (toothPitch * a) / Math.PI;
  const pitch2 = (toothPitch * b) / Math.PI;
  const base = sizeBelt(pitch1, pitch2, center, width, thickness, powerKw, speedRpm, serviceFactor);
  if (!base) return null;
  return {
    ...base,
    pitch1,
    pitch2,
    teethInMesh: Math.floor((base.wrap1 / 360) * a),
    beltTeeth: Math.round(base.length / toothPitch),
  };
}

export interface SprocketSizing {
  torque: number;
  designTorque: number;
  pitchDiameter: number;
  outerDiameter: number;
  rootDiameter: number;
  /** Tangential force on the chain, N. */
  tangentialForce: number;
  /** Chain speed, m/s. */
  chainSpeed: number;
  /** Roller seating angle, degrees. */
  seatingAngle: number;
}

/** Sizes a roller chain sprocket. */
export function sizeSprocket(
  pitch: number, teeth: number, rollerDiameter: number,
  powerKw: number, speedRpm: number, serviceFactor: number,
): SprocketSizing | null {
  const torque = designTorque(powerKw, speedRpm, serviceFactor);
  const z = Math.round(teeth);
  if (!(pitch > 0) || !(z >= 6) || !(rollerDiameter > 0) || torque === null) return null;
  const pitchDiameter = pitch / Math.sin(Math.PI / z);
  return {
    torque: torque / serviceFactor,
    designTorque: torque,
    pitchDiameter,
    outerDiameter: pitch * (0.6 + 1 / Math.tan(Math.PI / z)),
    rootDiameter: Math.max(1, pitchDiameter - rollerDiameter),
    tangentialForce: (2000 * torque) / pitchDiameter,
    chainSpeed: (z * pitch * speedRpm) / 60000,
    seatingAngle: 180 / z,
  };
}
