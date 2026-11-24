import { describe, expect, it } from 'vitest';
import { fitCandidates, fitOwner, isGoodFit } from '../src/model/assembly-fit';
import type { FitEdge, FitFace } from '../src/model/assembly-fit';

const face = (name: string, component: string, center: [number, number, number], normal: [number, number, number], area = 100): FitFace => ({
  name, component, type: 'plane', center, normal, area,
});
const cylinder = (name: string, component: string, p: [number, number, number], d: [number, number, number], area = 100): FitFace => ({
  name, component, type: 'cylinder', center: p, axis: { p, d }, area,
});
const circle = (name: string, component: string, center: [number, number, number], axis: [number, number, number]): FitEdge => ({
  name, component, type: 'circle', mid: center, center, axis,
});

describe('assembly fit suggestions', () => {
  it('matches opposed faces as a coincident fit', () => {
    const faces = [
      face('plate/top', 'c1', [0, 0, 20], [0, 0, 1]),
      face('plate/bottom', 'c2', [0, 0, 26], [0, 0, -1]),
    ];
    const [best] = fitCandidates({ faces, edges: [] }, [{ a: 'c1', b: 'c2' }]);
    expect(best.fit).toBe('coincident');
    expect(best.mate).toBe(true);
    expect(best.jointType).toBe('planar');
    expect(best.a.name).toBe('plate/top');
    expect(best.b.name).toBe('plate/bottom');
    expect(best.distance).toBeCloseTo(6, 6);
    expect(isGoodFit(best)).toBe(true);
  });

  it('prefers nearby, well aligned faces and allows flush fits', () => {
    const faces = [
      face('a/up', 'a', [0, 0, 10], [0, 0, 1]),
      face('b/up', 'b', [0, 0, 12], [0, 0, 1]),
      face('b/tilted', 'b', [0, 0, 14], [0.3, 0, 0.95]),
    ];
    const [best] = fitCandidates({ faces, edges: [] }, [{ a: 'a', b: 'b' }]);
    expect(best.fit).toBe('flush');
    expect(best.mate).toBe(false);
    expect(best.b.name).toBe('b/up');
    expect(best.score).toBeGreaterThan(0.7);
  });

  it('prefers faces in contact over merely parallel side faces', () => {
    const faces = [
      face('base/top', 'a', [0, 0, 10], [0, 0, 1]),
      face('lid/bottom', 'b', [0, 0, 34], [0, 0, -1]),
      face('base/side', 'a', [30, 20, 5], [1, 0, 0]),
      face('lid/side', 'b', [32, 21, 38], [1, 0, 0]),
    ];
    const [best] = fitCandidates({ faces, edges: [] }, [{ a: 'a', b: 'b' }]);
    expect(best.fit).toBe('coincident');
    expect(best.a.name).toBe('base/top');
    expect(best.b.name).toBe('lid/bottom');
  });

  it('matches coaxial cylinders and circular edges', () => {
    const faces = [cylinder('hole', 'c1', [0, 0, 0], [0, 0, 1])];
    const edges = [circle('boss', 'c2', [2, 0, 4], [0, 0, 1])];
    const [best] = fitCandidates({ faces, edges }, [{ a: 'c1', b: 'c2' }]);
    expect(best.fit).toBe('concentric');
    expect(best.jointType).toBe('cylindrical');
    expect(best.distance).toBeCloseTo(2, 6);
    expect(best.a).toEqual({ kind: 'face', name: 'hole' });
    expect(best.b).toEqual({ kind: 'edge', name: 'boss' });
  });

  it('ignores faces and axes outside the tolerance and other pairs', () => {
    const faces = [
      face('a/top', 'a', [0, 0, 0], [0, 0, 1]),
      face('b/side', 'b', [0, 0, 5], [1, 0, 0]),
      face('c/top', 'c', [0, 0, 5], [0, 0, -1]),
    ];
    expect(fitCandidates({ faces, edges: [] }, [{ a: 'c', b: 'b' }])).toEqual([]);
    const cross = fitCandidates({ faces, edges: [] }, [{ a: 'a', b: 'b' }, { a: 'a', b: 'c' }]);
    expect(cross.every((c) => c.aComponent === 'a')).toBe(true);
    expect(cross.length).toBe(1);
  });

  it('reads nested sub-assembly faces as their top component', () => {
    expect(fitOwner('c3/c1')).toBe('c3');
    expect(fitOwner(undefined)).toBeNull();
    const faces = [face('top', 'c3/c1', [0, 0, 0], [0, 0, 1]), face('bottom', 'c2', [0, 0, 3], [0, 0, -1])];
    const [best] = fitCandidates({ faces, edges: [] }, [{ a: 'c3', b: 'c2' }]);
    expect(best.aComponent).toBe('c3');
    expect(best.distance).toBeCloseTo(3, 6);
  });

  it('limits and sorts suggestions', () => {
    const faces: FitFace[] = [];
    for (let i = 0; i < 8; i++) faces.push(face(`a${i}`, 'a', [0, 0, 0], [0, 0, 1]), face(`b${i}`, 'b', [0, 0, i + 1], [0, 0, -1]));
    const out = fitCandidates({ faces, edges: [] }, [{ a: 'a', b: 'b' }], 4);
    expect(out).toHaveLength(4);
    for (let i = 1; i < out.length; i++) expect(out[i - 1].score).toBeGreaterThanOrEqual(out[i].score);
  });
});
