import type { VitePWAOptions } from 'vite-plugin-pwa';
import { FIXED_PWA_ASSETS, hashedPwaAsset, privatePwaRequest, publicPwaNavigation } from './src/hub/pwa-policy';

export const pwaOptions: Partial<VitePWAOptions> = {
  strategies: 'generateSW', filename: 'sw.js', outDir: 'dist/client',
  registerType: 'autoUpdate', injectRegister: null, manifest: false,
  includeAssets: [], devOptions: { enabled: false },
  workbox: {
    // Readable output allows a fail-closed ordering check; this does not enable dev workers.
    mode: 'development', cacheId: 'jodai', skipWaiting: true, clientsClaim: true,
    cleanupOutdatedCaches: true, globPatterns: FIXED_PWA_ASSETS,
    navigateFallback: undefined, ignoreURLParametersMatching: [], directoryIndex: null,
    runtimeCaching: [
      { urlPattern: privatePwaRequest, handler: 'NetworkOnly' },
      {
        urlPattern: publicPwaNavigation, handler: 'NetworkFirst',
        options: {
          cacheName: 'jodai-navigation',
          // Navigation HTML can include user data: network-first with NO HTML writes.
          plugins: [{ cacheWillUpdate: async () => null }],
          precacheFallback: { fallbackURL: '/offline.html' },
        },
      },
      {
        urlPattern: hashedPwaAsset, handler: 'CacheFirst',
        options: { cacheName: 'jodai-assets', cacheableResponse: { statuses: [200] }, expiration: { maxEntries: 80, maxAgeSeconds: 2592000 } },
      },
    ],
  },
};

/** Workbox normally routes precache first. Move its generated privacy route ahead
 * of precache so even requests for public icons carrying a session bypass caches.
 * No handwritten worker, fetch listener, or alternative worker generator.
 */
export function prioritizePrivateRoute(worker: string) {
  const start = worker.indexOf('workbox.registerRoute(');
  const end = worker.indexOf('\nworkbox.registerRoute(', start + 1);
  const precache = worker.indexOf('workbox.precacheAndRoute(');
  if (start < 0 || end < start || precache < 0 || !worker.slice(start, end).includes('workbox.NetworkOnly')) {
    throw new Error('PWA privacy route ordering could not be verified; refusing worker output');
  }
  if (start < precache) return worker;
  return worker.slice(0, precache) + worker.slice(start, end) + '\n' +
    worker.slice(precache, start) + worker.slice(end);
}