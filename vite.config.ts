import { defineConfig } from 'vitest/config';

/** Give the dev server a friendly *.localhost address while leaving builds unchanged. */
function puterLocalhost(name: string) {
  return {
    name: 'puter-localhost',
    apply: 'serve' as const,
    configureServer(server: { httpServer?: { on: (event: string, listener: () => void) => void }; resolvedUrls?: { local: string[] } | null }) {
      server.httpServer?.on('listening', () => {
        const local = server.resolvedUrls?.local[0];
        if (!local) return;
        const url = new URL(local);
        url.hostname = `${name}.puter.localhost`;
        server.resolvedUrls!.local = [url.href];
      });
    },
  };
}

export default defineConfig({
  plugins: [puterLocalhost('parametric')],
  base: './',
  build: {
    target: 'es2022',
    cssTarget: 'safari16',
    // The geometry kernel is a large, separately cached WebAssembly module.
    chunkSizeWarningLimit: 1200,
    assetsInlineLimit: 0,
  },
  server: {
    host: '127.0.0.1',
    port: 5581,
    strictPort: true,
  },
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    exclude: ['replicad-opencascadejs'],
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
