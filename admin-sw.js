/* Wanhar Admin: network-only by design. No Cache Storage, IndexedDB or
 * localStorage. Never store documents, recovery URLs, auth or API responses.
 * Registered only for admin.html, not the public portfolio or /sites/.
 * No skipWaiting/clients.claim/reload: never interrupt unsaved work. */
'use strict';
const ADMIN_PATH = new URL('./admin.html', self.location.href).pathname;
self.addEventListener('install', event => {
  // An intentionally empty installation; the admin requires the network.
  event.waitUntil(Promise.resolve());
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  // All subresources, Appwrite/Supabase calls, auth, uploads and mutations
  // bypass this worker entirely. There is no runtime or precache store.
  if (request.method !== 'GET' || request.mode !== 'navigate' ||
      url.origin !== self.location.origin || url.pathname !== ADMIN_PATH) return;
  event.respondWith(fetch(request, { cache: 'no-store' }).catch(() => new Response(
    '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark light"><title>Wanhar Admin · Offline</title><style>body{margin:0;min-height:100svh;display:grid;place-items:center;background:#0b0d0c;color:#edf3ee;font:16px/1.6 system-ui,sans-serif}main{max-width:30rem;padding:32px}small{color:#b9e888;letter-spacing:.12em}h1{font-size:32px;line-height:1.15}p{color:#a8b4ac}a{display:inline-block;background:#b9e888;color:#122017;border-radius:12px;padding:12px 20px;text-decoration:none;font-weight:700}</style><main><small>WANHAR STUDIO</small><h1>You’re offline.</h1><p>Connect to the internet to open your private workspace. For your privacy, website data, messages and sign-in responses are never stored by this app’s service worker.</p><a href="./admin.html">Try again</a></main></html>',
    { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'" } }
  )));
});
