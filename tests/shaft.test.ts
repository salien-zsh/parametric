import { describe, expect, it } from 'vitest';
import { SHAFT_MATERIALS, sizeShaft } from '../src/model/shaft';

describe('shaft sizing', () => {
  it('sizes a solid shaft in torsion', () => {
    const s = sizeShaft(5, 1450, 1.2, 40, [20, 30, 20])!;
    const torque = (9550 * 5) / 1450;
    expect(s.torque).toBeCloseTo(torque, 9);
    expect(s.designTorque).toBeCloseTo(torque * 1.2, 9);
    expect(s.minDiameter).toBeCloseTo(Math.cbrt((16 * torque * 1.2 * 1000) / (Math.PI * 40)), 9);
    expect(s.stress[0]).toBeCloseTo((16 * torque * 1.2 * 1000) / (Math.PI * 20 ** 3), 9);
    expect(s.maxUtilization).toBeCloseTo(s.stress[0] / 40, 9);
  });

  it('reports nothing for an incomplete load case', () => {
    expect(sizeShaft(0, 1450, 1, 40, [20])).toBeNull();
    expect(sizeShaft(5, 0, 1, 40, [20])).toBeNull();
    expect(sizeShaft(5, 1450, 0, 40, [20])).toBeNull();
    expect(sizeShaft(5, 1450, 1, 0, [20])).toBeNull();
  });

  it('offers common shaft materials and their allowable shear stress', () => {
    expect(SHAFT_MATERIALS.map((m) => m.id)).toEqual(['steel45', '40cr', '20crmnti', 'al6061', 'custom']);
    for (const m of SHAFT_MATERIALS) expect(m.allowableShear).toBeGreaterThan(0);
  });
});
