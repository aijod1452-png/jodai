export const FIXED_PWA_ASSETS = [
  'offline.html', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png',
  'favicon.png', 'manifest.json',
];

// These callbacks are serialized into the generated worker: keep them self-contained.
export function privatePwaRequest({ request, url }: { request: Request; url: URL }) {
  return request.headers.has('x-session-token') || request.headers.has('authorization') ||
    /^\/(?:api|_server|~oauth)(?:\/|$)/.test(url.pathname) ||
    url.searchParams.has('_data') || url.hostname === 'supabase.co' ||
    url.hostname.endsWith('.supabase.co');
}

export function publicPwaNavigation({ request, url }: { request: Request; url: URL }) {
  return request.mode === 'navigate' && url.origin === self.location.origin &&
    !request.headers.has('x-session-token') && !request.headers.has('authorization') &&
    !/^\/(?:api|_server|~oauth)(?:\/|$)/.test(url.pathname) && !url.searchParams.has('_data');
}

export function hashedPwaAsset({ request, url }: { request: Request; url: URL }) {
  return url.origin === self.location.origin &&
    /^\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.(?:js|css|woff2?|png|jpg|webp)$/.test(url.pathname) &&
    !request.headers.has('x-session-token') && !request.headers.has('authorization') &&
    !url.searchParams.has('_data');
}

export function refusePwaRegistration({ production, hostname, framed, search }: {
  production: boolean; hostname: string; framed: boolean; search: string;
}) {
  const host = hostname.toLowerCase();
  const lovableDomain = /\.(?:lovable\.app|gpt-eng\.com|gptengineer\.run)$/.test(host);
  const label = host.split('.')[0] ?? '';
  return !production || framed || new URLSearchParams(search).get('sw') === 'off' ||
    (lovableDomain && /^(?:id-preview|preview)(?:-[a-z0-9]+)?--.+$/.test(label)) ||
    (lovableDomain && /^project--610453ed-062a-4b84-a8b3-63b7c00cbf46-dev$/.test(label)) ||
    /^(?:.+\.)?lovableproject(?:-dev)?\.com$/.test(host) ||
    /^(?:.+\.)?beta\.lovable\.dev$/.test(host);
}