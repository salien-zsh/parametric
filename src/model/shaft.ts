import { tr } from '../i18n';
// Mechanical sizing for the shaft generator: torsional stress and the smallest
// diameter that carries the design torque at the allowable shear stress.

export interface ShaftMaterial {
  id: string;
  name: string;
  /** Allowable torsional shear stress, MPa. */
  allowableShear: number;
}

export const SHAFT_MATERIALS: ShaftMaterial[] = [
  { id: 'steel45', name: tr("45 steel"), allowableShear: 40 },
  { id: '40cr', name: '40Cr', allowableShear: 55 },
  { id: '20crmnti', name: '20CrMnTi', allowableShear: 60 },
  { id: 'al6061', name: tr("6061-T6 aluminium"), allowableShear: 20 },
  { id: 'custom', name: tr("Custom"), allowableShear: 40 },
];

export interface ShaftSizing {
  /** Nominal torque, N·m. */
  torque: number;
  /** Torque with the service factor, N·m. */
  designTorque: number;
  /** Smallest solid diameter for the design torque, mm. */
  minDiameter: number;
  /** Torsional shear stress of each segment, MPa. */
  stress: number[];
  /** stress / allowable for each segment. */
  utilization: number[];
  maxUtilization: number;
}

/**
 * Sizes a solid round shaft in torsion. Power is in kW and speed in rpm; the
 * returning diameters are millimetres, stresses MPa.
 */
export function sizeShaft(
  powerKw: number,
  speedRpm: number,
  serviceFactor: number,
  allowableShear: number,
  diameters: number[],
): ShaftSizing | null {
  if (!(powerKw > 0) || !(speedRpm > 0) || !(serviceFactor > 0) || !(allowableShear > 0)) return null;
  const torque = (9550 * powerKw) / speedRpm;
  const designTorque = torque * serviceFactor;
  const minDiameter = Math.cbrt((16 * designTorque * 1000) / (Math.PI * allowableShear));
  const stress = diameters.map((d) => (d > 0 ? (16 * designTorque * 1000) / (Math.PI * d ** 3) : Infinity));
  const utilization = stress.map((s) => s / allowableShear);
  return { torque, designTorque, minDiameter, stress, utilization, maxUtilization: Math.max(0, ...utilization.filter(Number.isFinite)) };
}
