import { beforeEach, describe, expect, it, vi } from 'vitest';

function fakeLocalStorage() {
  const m = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    length: 0,
  };
}

const saved = {
  form: 1,
  'parametric:projects': JSON.stringify([
    { id: 'project-saved', name: 'Relaunched', created: 1, modified: 2 },
  ]),
  'parametric:project-parts': JSON.stringify({ 'local:part-1': 'project-saved' }),
  'parametric:active-project': 'project-saved',
  'parametric:resource-center': '[]',
};

beforeEach(() => {
  fakeLocalStorage();
  vi.resetModules();
});

describe('desktop workspace hydration', () => {
  it('restores projects from the workspace file before the home page reads them', async () => {
    const writes: unknown[] = [];
    (globalThis as unknown as { window?: unknown }).window = {
      desktopAPI: { workspace: { read: () => saved, write: async (state: unknown) => { writes.push(state); return true; } } },
    };
    const lib = await import('../src/platform/workspace-library');
    expect(lib.localProjects().map((p) => p.name)).toEqual(['Relaunched']);
    expect(lib.activeProject()?.id).toBe('project-saved');
    expect(lib.projectForPart('local:part-1')).toBe('project-saved');
  });

  it('mirrors every metadata change into the workspace file', async () => {
    let state: unknown = null;
    (globalThis as unknown as { window?: unknown }).window = {
      desktopAPI: { workspace: { read: () => null, write: async (s: unknown) => { state = s; return true; } } },
    };
    const lib = await import('../src/platform/workspace-library');
    lib.createLocalProject('Mirrored');
    await new Promise((r) => setTimeout(r, 0));
    expect(state).toMatchObject({ form: 1 });
    expect(JSON.parse((state as Record<string, string>)['parametric:projects'])[0].name).toBe('Mirrored');
  });
});

describe('adopting pre-existing parts', () => {
  it('creates a project for parts when no project index exists yet', async () => {
    localStorage.setItem('parametric:local-parts', JSON.stringify([
      { id: 'a', name: 'Bracket', modified: 1, size: 10 },
      { id: 'b', name: 'Plate', modified: 2, size: 20 },
    ]));
    delete (globalThis as { window?: unknown }).window;
    const lib = await import('../src/platform/workspace-library');
    const projects = lib.localProjects();
    expect(projects).toHaveLength(1);
    expect(projects[0].name).toBe('Recovered Project');
    expect(lib.projectForPart('local:a')).toBe(projects[0].id);
    expect(lib.projectForPart('local:b')).toBe(projects[0].id);
  });
});
