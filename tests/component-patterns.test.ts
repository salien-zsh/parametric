import { describe, expect, it } from 'vitest';
import { componentInstanceCount, circularStep, patternMultiplier, patternSteps } from '../src/model/assembly';
import { newAssembly, newDocument, parseDocument, serializeDocument } from '../src/model/document';
import type { ComponentPattern } from '../src/model/types';

const circular = (over: Partial<ComponentPattern> = {}): ComponentPattern => ({
  id: 'p1', name: 'Pattern1', type: 'circular', components: ['c1'], axis: 'z', angle: 360, count: 4, ...over,
});
const rectangular = (over: Partial<ComponentPattern> = {}): ComponentPattern => ({
  id: 'p2', name: 'Pattern2', type: 'rectangular', components: ['c1'],
  dir1: 'x', spacing1: 10, count1: 3, dir2: 'y', spacing2: 20, count2: 2, ...over,
});

describe('component pattern steps', () => {
  it('spreads a full turn evenly and the seed counts as one', () => {
    expect(circularStep(360, 4)).toBe(90);
    expect(patternSteps(circular())).toEqual([
      { rotation: 90, offset: [0, 0, 0] },
      { rotation: 180, offset: [0, 0, 0] },
      { rotation: 270, offset: [0, 0, 0] },
    ]);
  });

  it('puts the last copy on the angle of a partial sweep', () => {
    expect(circularStep(90, 3)).toBe(45);
    expect(patternSteps(circular({ angle: 90, count: 3 })).map((s) => s.rotation)).toEqual([45, 90]);
    expect(patternSteps(circular({ count: 1 }))).toEqual([]);
  });

  it('builds a rectangular grid, skipping the seed', () => {
    const steps = patternSteps(rectangular());
    expect(steps).toHaveLength(5);
    expect(steps).toContainEqual({ rotation: 0, offset: [10, 0, 0] });
    expect(steps).toContainEqual({ rotation: 0, offset: [20, 20, 0] });
    expect(steps).not.toContainEqual({ rotation: 0, offset: [0, 0, 0] });
  });

  it('works along one direction when the second is off', () => {
    const steps = patternSteps(rectangular({ dir2: null }));
    expect(steps.map((s) => s.offset)).toEqual([[10, 0, 0], [20, 0, 0]]);
  });
});

describe('pattern instance counts', () => {
  it('counts the copies, and multiplies several patterns', () => {
    expect(patternMultiplier(circular())).toBe(4);
    expect(patternMultiplier(rectangular())).toBe(6);
    expect(patternMultiplier(rectangular({ dir2: null }))).toBe(3);
    expect(componentInstanceCount([circular()], 'c1')).toBe(4);
    expect(componentInstanceCount([circular(), rectangular({ count1: 2, count2: 3 })], 'c1')).toBe(24);
    expect(componentInstanceCount([circular()], 'c2')).toBe(1);
    expect(componentInstanceCount(undefined, 'c1')).toBe(1);
  });
});

describe('component patterns in the document', () => {
  it('round-trips and rejects a bad pattern', () => {
    const assembly = newAssembly('Array');
    const part = newDocument('Bolt');
    assembly.components = [{ id: 'c1', name: 'Bolt1', part, transform: { position: [0, 0, 0], rotation: [0, 0, 0] }, visible: true, fixed: false }];
    assembly.componentPatterns = [circular({ components: ['c1'] })];
    const back = parseDocument(serializeDocument(assembly));
    expect(back.componentPatterns).toEqual([circular({ components: ['c1'] })]);
    const bad = { ...circular(), components: ['missing'] };
    expect(() => parseDocument(JSON.stringify({ ...assembly, componentPatterns: [bad] }))).toThrow(/component pattern/);
  });
});
