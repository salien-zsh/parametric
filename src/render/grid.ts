// The planar grid drawn on reference planes and on the plane being sketched.
//
// Spacing follows the zoom so squares stay readable: the grid snaps to a
// 1, 2 or 5 times a power of ten step, like a CAD sketch grid, and every fifth
// line is stronger. The same step is used for grid snapping, so a snapped point
// always lands on a drawn crossing.

import { type Frame, type Vec2, toWorld } from '../math/vec';

/** World size of one grid square for the given zoom (world units per pixel). */
export function gridSpacing(pixelSize: number, targetPx = 40): number {
  const raw = Math.max(1e-9, Math.abs(pixelSize) * Math.max(8, targetPx));
  const decade = 10 ** Math.floor(Math.log10(raw));
  const mantissa = raw / decade;
  // The nearest of 1, 2, 5, 10 in ratio, so squares stay near the target size.
  const nice = mantissa <= 1.5 ? 1 : mantissa <= 3.5 ? 2 : mantissa <= 7 ? 5 : 10;
  return nice * decade;
}

export interface GridSegments {
  /** Batch of thin lines (x, y, z pairs). */
  minor: number[];
  /** Every fifth line, drawn stronger. */
  major: number[];
  step: number;
}

/**
 * Lines of a square grid around `center` in a plane frame, extended `half`
 * world units each way. Lines lie on multiples of `step` in sketch coordinates,
 * so they line up across drawings and with grid snapping.
 */
export function planeGrid(fr: Frame, center: Vec2, half: number, step: number): GridSegments {
  const minor: number[] = [], major: number[] = [];
  if (!(step > 0) || !(half > 0)) return { minor, major, step };
  const lo = Math.ceil((center[0] - half) / step), hi = Math.floor((center[0] + half) / step);
  const loY = Math.ceil((center[1] - half) / step), hiY = Math.floor((center[1] + half) / step);
  // A very oblique view or a bad zoom must not queue thousands of lines.
  if (hi - lo > 400 || hiY - loY > 400) return { minor, major, step };
  const x0 = center[0] - half, x1 = center[0] + half;
  const y0 = center[1] - half, y1 = center[1] + half;
  for (let i = lo; i <= hi; i++) {
    const x = i * step;
    const out = i % 5 === 0 ? major : minor;
    out.push(...toWorld(fr, [x, y0]), ...toWorld(fr, [x, y1]));
  }
  for (let i = loY; i <= hiY; i++) {
    const y = i * step;
    const out = i % 5 === 0 ? major : minor;
    out.push(...toWorld(fr, [x0, y]), ...toWorld(fr, [x1, y]));
  }
  return { minor, major, step };
}
