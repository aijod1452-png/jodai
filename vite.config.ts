// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { VitePWA } from 'vite-plugin-pwa';
import { readFile, writeFile } from 'node:fs/promises';
import { pwaOptions, prioritizePrivateRoute } from './pwa.config';

export default defineConfig({
  vite: {
    plugins: [
      VitePWA(pwaOptions),
      {
        name: 'jodai-generated-pwa-privacy-order', apply: 'build', enforce: 'post',
        closeBundle: { order: 'post', sequential: true, async handler() {
          const path = 'dist/client/sw.js';
          // R12 build fix: SSR/multi-pass builds close before the worker exists.
          if (!existsSync(path)) return;
          const generated = await readFile(path, 'utf8');
          await writeFile(path, prioritizePrivateRoute(generated));
        } },
      },
    ],
  },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
