import { refusePwaRegistration } from './pwa-policy';

export async function registerAppWorker() {
  if (import.meta.env.SSR || typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
  const refused = refusePwaRegistration({ production: import.meta.env.PROD,
    hostname: window.location.hostname.toLowerCase(), framed: window.self !== window.top,
    search: window.location.search });
  if (refused) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.filter((registration) =>
      [registration.active, registration.waiting, registration.installing].some((worker) =>
        worker && new URL(worker.scriptURL).origin === window.location.origin && new URL(worker.scriptURL).pathname === '/sw.js'
      )).map((registration) => registration.unregister()));
    return;
  }
  const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
  await registration.update();
}