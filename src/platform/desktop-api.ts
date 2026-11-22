// Optional preload bridge provided by the Electron desktop shell.

export interface DesktopProjectFile {
  name: string;
  path: string;
  size: number;
  modified: number;
}

export interface DesktopProjectBridge {
  chooseFolder(): Promise<{ path: string; name: string } | null>;
  list(root: string): Promise<DesktopProjectFile[]>;
  read(root: string, file: string): Promise<Blob>;
  write(root: string, file: string, data: Uint8Array): Promise<DesktopProjectFile>;
  delete(root: string, file: string): Promise<void>;
}

export interface DesktopAPI {
  info(): Promise<{ userData: string; partsDir: string; version: string; port: number }>;
  openExternal(url: string): Promise<void>;
  projects?: DesktopProjectBridge;
  updates?: {
    check(): Promise<boolean>;
    state(): Promise<unknown>;
    install(): Promise<boolean>;
    onStatus(fn: (state: unknown) => void): () => void;
  };
  isDesktop?: boolean;
}

declare global {
  interface Window { desktopAPI?: DesktopAPI }
}

export const desktopAPI = (): DesktopAPI | null =>
  typeof window === 'undefined' ? null : window.desktopAPI ?? null;
