// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest';
import { generateSW } from 'workbox-build';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pwaOptions, prioritizePrivateRoute } from '../../pwa.config';
import { FIXED_PWA_ASSETS, privatePwaRequest, publicPwaNavigation, hashedPwaAsset, refusePwaRegistration } from '../hub/pwa-policy';

afterEach(() => vi.unstubAllGlobals());
const props = (path: string, headers: Record<string, string> = {}) => {
  const url = new URL(path, 'https://jodai.lovable.app');
  return { url, request: new Request(url, { headers }) };
};

describe('R12 private request exclusions', () => {
  it.each(['/api/public/hub/status', '/api', '/_server/function', '/_server', '/?_data=', '/~oauth/callback', 'https://example.supabase.co/storage/v1/object/test', 'https://supabase.co/test'])('bypasses all caches for %s', (path) => {
    expect(privatePwaRequest(props(path))).toBe(true);
  });
  it('bypasses session headers even on precached public icons', () => {
    expect(privatePwaRequest(props('/icon-192.png', { 'x-session-token': 'test-only' }))).toBe(true);
    expect(privatePwaRequest(props('/assets/main-12345678.js', { Authorization: 'test-only' }))).toBe(true);
    expect(privatePwaRequest(props('/icon-192.png'))).toBe(false);
  });
  it('only caches same-origin hashed public assets', () => {
    vi.stubGlobal('self', { location: { origin: 'https://jodai.lovable.app' } });
    expect(hashedPwaAsset(props('/assets/main-12345678.js'))).toBe(true);
    expect(hashedPwaAsset(props('/assets/main.js'))).toBe(false);
    expect(hashedPwaAsset(props('https://other.example/assets/main-12345678.js'))).toBe(false);
    expect(hashedPwaAsset(props('/assets/main-12345678.js?_data=1'))).toBe(false);
    expect(hashedPwaAsset(props('/assets/main-12345678.js', { 'x-session-token': 'test-only' }))).toBe(false);
  });
  it('network-first navigation excludes authenticated and data routes', () => {
    vi.stubGlobal('self', { location: { origin: 'https://jodai.lovable.app' } });
    const navigation = (path: string, headers = {}) => {
      const { request, url } = props(path, headers);
      Object.defineProperty(request, 'mode', { value: 'navigate' });
      return { request, url };
    };
    expect(publicPwaNavigation(navigation('/'))).toBe(true);
    expect(publicPwaNavigation(navigation('/api/test'))).toBe(false);
    expect(publicPwaNavigation(navigation('/?_data=1'))).toBe(false);
    expect(publicPwaNavigation(navigation('/', { 'x-session-token': 'test-only' }))).toBe(false);
  });
});

describe('R12 preview safety', () => {
  const allowed = { production: true, hostname: 'jodai.lovable.app', framed: false, search: '' };
  it.each([
    'id-preview--610453ed-062a-4b84-a8b3-63b7c00cbf46.lovable.app',
    'preview-v2--shop.lovable.app', 'preview--shop.gpt-eng.com',
    'id-preview-3--shop.gptengineer.run',
    'project--610453ed-062a-4b84-a8b3-63b7c00cbf46-dev.lovable.app',
    'lovableproject.com', 'a.lovableproject.com', 'lovableproject-dev.com',
    'a.lovableproject-dev.com', 'beta.lovable.dev', 'a.beta.lovable.dev',
  ])('refuses preview %s', (hostname) => {
    expect(refusePwaRegistration({ ...allowed, hostname })).toBe(true);
  });
  it('refuses dev, iframe and sw=off; keeps published/custom origins eligible', () => {
    expect(refusePwaRegistration({ ...allowed, production: false })).toBe(true);
    expect(refusePwaRegistration({ ...allowed, framed: true })).toBe(true);
    expect(refusePwaRegistration({ ...allowed, search: '?sw=off' })).toBe(true);
    expect(refusePwaRegistration(allowed)).toBe(false);
    expect(refusePwaRegistration({ ...allowed, hostname: 'preview-v2--shop.example.com' })).toBe(false);
  });
  it('unregisters only /sw.js and leaves messaging workers alone in dev', async () => {
    const oldApp = { active: { scriptURL: 'https://jodai.lovable.app/sw.js' }, unregister: vi.fn().mockResolvedValue(true) };
    const messaging = { active: { scriptURL: 'https://jodai.lovable.app/firebase-messaging-sw.js' }, unregister: vi.fn() };
    const register = vi.fn();
    vi.stubGlobal('window', { self: 1, top: 1, location: { hostname: 'jodai.lovable.app', origin: 'https://jodai.lovable.app', search: '' } });
    vi.stubGlobal('navigator', { serviceWorker: { getRegistrations: vi.fn().mockResolvedValue([oldApp, messaging]), register } });
    vi.stubEnv('SSR', false);
    const { registerAppWorker } = await import('../hub/pwa-registration');
    await registerAppWorker();
    expect(register).not.toHaveBeenCalled();
    expect(oldApp.unregister).toHaveBeenCalledOnce();
    expect(messaging.unregister).not.toHaveBeenCalled();
  });
});

describe('R12 actual generated worker', () => {
  it('generates fixed precache, network-first fallback and orders privacy before precache', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'jodai-pwa-'));
    try {
      const result = await generateSW({ ...pwaOptions.workbox, globDirectory: 'public', swDest: join(folder, 'sw.js') });
      expect(result.warnings).toEqual([]);
      const worker = prioritizePrivateRoute(await readFile(join(folder, 'sw.js'), 'utf8'));
      expect(worker.indexOf('workbox.registerRoute(')).toBeLessThan(worker.indexOf('workbox.precacheAndRoute('));
      expect(worker).toContain('workbox.NetworkOnly');
      expect(worker).toContain('workbox.NetworkFirst');
      expect(worker).toContain('fallbackURL: "/offline.html"');
      for (const asset of FIXED_PWA_ASSETS) expect(worker).toContain(`"url": "${asset}"`);
      expect(worker).not.toContain('"url": "index.html"');
      const options = pwaOptions.workbox?.runtimeCaching?.[1]?.options;
      const cacheWillUpdate = options?.plugins?.[0]?.cacheWillUpdate;
      expect(cacheWillUpdate).toBeTypeOf('function');
      if (cacheWillUpdate) expect(await cacheWillUpdate({ request: new Request('https://jodai.lovable.app'), response: new Response('private'), event: {} as Parameters<NonNullable<typeof cacheWillUpdate>>[0]['event'], state: {} })).toBeNull();
      expect(pwaOptions.injectRegister).toBeNull();
      expect(pwaOptions.devOptions?.enabled).toBe(false);
    } finally { await rm(folder, { recursive: true, force: true }); }
  }, 30000);
  it('fails closed when generation format changes', () => {
    expect(() => prioritizePrivateRoute('unexpected worker')).toThrow('refusing worker output');
  });
});