// Sizing math for the power-transmission generators: the numbers the panels
// report have to match the textbook formulas they claim to use.
import { describe, expect, it } from 'vitest';
import {
  designTorque, lewisFactor, materialById, pitchSpeed, sizeBevelGear, sizeBelt, sizeSpurGear, sizeSprocket, sizeSyncBelt, sizeWormGear,
} from '../src/model/pt';

describe('transmission sizing', () => {
  it('computes the design torque from power and speed', () => {
    const t = designTorque(5, 1450, 1.2)!;
    expect(t).toBeCloseTo(((9550 * 5) / 1450) * 1.2, 6);
    expect(designTorque(0, 1450, 1.2)).toBeNull();
    expect(designTorque(5, 0, 1.2)).toBeNull();
  });

  it('sizes an involute spur gear', () => {
    const s = sizeSpurGear(2, 24, 20, 20, 5, 1450, 1.2, 180)!;
    expect(s.pitchDiameter).toBeCloseTo(48, 6);
    expect(s.outerDiameter).toBeCloseTo(52, 6);
    expect(s.rootDiameter).toBeCloseTo(43, 6);
    expect(s.addendum).toBeCloseTo(2, 6);
    expect(s.dedendum).toBeCloseTo(2.5, 6);
    expect(s.baseDiameter).toBeCloseTo(48 * Math.cos((20 * Math.PI) / 180), 6);
    expect(s.tangentialForce).toBeCloseTo((2000 * s.designTorque) / 48, 6);
    expect(s.velocity).toBeCloseTo((Math.PI * 48 * 1450) / 60000, 6);
    const expected = s.tangentialForce / (20 * 2 * lewisFactor(24));
    expect(s.bendingStress).toBeCloseTo(expected, 6);
    expect(s.utilization).toBeCloseTo(expected / 180, 6);
  });

  it('scales the Lewis factor with the tooth count', () => {
    expect(lewisFactor(20)).toBeCloseTo(0.154 - 0.912 / 20, 9);
    expect(lewisFactor(80)).toBeGreaterThan(lewisFactor(20));
    // Very small gears are clamped, not extrapolated.
    expect(lewisFactor(5)).toBeCloseTo(lewisFactor(12), 9);
  });

  it('sizes a straight bevel gear on a right angle', () => {
    const s = sizeBevelGear(3, 20, 40, 18, 20, 5, 1450, 1.2, 180)!;
    expect(s.coneAngle).toBeCloseTo((Math.atan(20 / 40) * 180) / Math.PI, 6);
    expect(s.mateConeAngle).toBeCloseTo(90 - s.coneAngle, 6);
    expect(s.coneDistance).toBeCloseTo(1.5 * Math.hypot(20, 40), 6);
    expect(s.maxFaceWidth).toBeCloseTo(s.coneDistance / 3, 6);
    expect(s.pitchDiameter).toBeCloseTo(60, 6);
    expect(s.matePitchDiameter).toBeCloseTo(120, 6);
    expect(s.ratio).toBeCloseTo(2, 6);
    expect(s.meanPitchDiameter).toBeLessThan(s.pitchDiameter);
  });

  it('sizes a worm pair', () => {
    const s = sizeWormGear(2, 1, 40, 20, 45, 20, 3, 1450, 1.2)!;
    expect(s.ratio).toBeCloseTo(40, 6);
    expect(s.leadAngle).toBeCloseTo((Math.atan(2 / 20) * 180) / Math.PI, 6);
    expect(s.centerDistance).toBeCloseTo(50, 6);
    expect(s.wheelPitchDiameter).toBeCloseTo(80, 6);
    expect(s.axialPitch).toBeCloseTo(Math.PI * 2, 6);
    expect(s.wheelTorque).toBeCloseTo(s.designTorque * 40, 6);
  });

  it('sizes a V-belt drive', () => {
    const s = sizeBelt(100, 180, 400, 25, 8, 5, 1450, 1.2)!;
    expect(s.ratio).toBeCloseTo(1.8, 6);
    expect(s.length).toBeCloseTo(2 * 400 + (Math.PI * 280) / 2 + 6400 / 1600, 6);
    expect(s.wrap1).toBeCloseTo(180 - (360 / Math.PI) * Math.asin(80 / 800), 6);
    expect(s.wrap2).toBeCloseTo(360 - s.wrap1, 6);
    expect(s.beltSpeed).toBeCloseTo(pitchSpeed(100, 1450), 6);
    // A belt cannot reach pulleys that touch each other.
    expect(sizeBelt(100, 180, 140, 25, 8, 5, 1450, 1.2)).toBeNull();
  });

  it('sizes a synchronous belt drive', () => {
    const s = sizeSyncBelt(8, 24, 40, 400, 20, 6, 5, 1450, 1.2)!;
    expect(s.pitch1).toBeCloseTo((8 * 24) / Math.PI, 6);
    expect(s.pitch2).toBeCloseTo((8 * 40) / Math.PI, 6);
    expect(s.beltTeeth).toBe(Math.round(s.length / 8));
    expect(s.teethInMesh).toBeGreaterThan(0);
    expect(s.teethInMesh).toBeLessThan(24);
  });

  it('sizes a sprocket', () => {
    const s = sizeSprocket(12.7, 19, 7.92, 3, 500, 1.2)!;
    expect(s.pitchDiameter).toBeCloseTo(12.7 / Math.sin(Math.PI / 19), 6);
    expect(s.outerDiameter).toBeCloseTo(12.7 * (0.6 + 1 / Math.tan(Math.PI / 19)), 6);
    expect(s.rootDiameter).toBeCloseTo(s.pitchDiameter - 7.92, 6);
    expect(s.chainSpeed).toBeCloseTo((19 * 12.7 * 500) / 60000, 6);
    expect(sizeSprocket(12.7, 3, 7.92, 3, 500, 1.2)).toBeNull();
  });

  it('falls back to the default material for an unknown id', () => {
    expect(materialById('nope').id).toBe('steel45');
    expect(materialById('40cr').allowableBending).toBe(240);
  });
});
