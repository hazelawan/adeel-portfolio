import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const workerSource = await readFile(new URL('admin-sw.js', root), 'utf8');
const pwaSource = await readFile(new URL('admin-pwa.js', root), 'utf8');
const htmlSource = await readFile(new URL('admin.html', root), 'utf8');
const manifest = JSON.parse(await readFile(new URL('admin.webmanifest', root), 'utf8'));

function workerHarness() {
  const listeners = {};
  const calls = [];
  const context = vm.createContext({
    URL,
    Promise,
    Response,
    fetch: async (...args) => { calls.push(args); throw new Error('offline'); },
    self: {
      location: { href: 'https://studio.example.test/admin-sw.js', origin: 'https://studio.example.test' },
      addEventListener: (name, fn) => { listeners[name] = fn; }
    }
  });
  vm.runInContext(workerSource, context);
  return {listeners, calls};
}

function request(url, {method = 'GET', mode = 'navigate'} = {}) {
  return {url, method, mode};
}

test('service worker contains no persistence or cache-storage APIs', () => {
  const executable = workerSource.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
  assert.doesNotMatch(executable, /\b(?:caches|CacheStorage|indexedDB|localStorage|sessionStorage)\b/i);
  assert.doesNotMatch(executable, /\b(?:skipWaiting|clients\.claim)\s*\(/);
});

test('registration is restricted to secure, non-recovery admin page URLs', () => {
  assert.match(htmlSource, /<link\s+rel="manifest"\s+href="\.\/admin\.webmanifest"/i);
  assert.match(pwaSource, /navigator\.serviceWorker\.register\('\.\/admin-sw\.js',\s*\{\s*scope:\s*'\.\/admin\.html'/);
  assert.match(pwaSource, /if \(params\.has\('secret'\) \|\| params\.has\('userId'\)\) return;/);
  assert.match(pwaSource, /window\.isSecureContext/);
  assert.doesNotMatch(pwaSource, /scope:\s*['"]\.\/?['"]/);
});

test('worker handles only same-origin GET admin document navigations', async () => {
  const h = workerHarness();
  const fetchHandler = h.listeners.fetch;
  assert.ok(fetchHandler, 'fetch listener registered');
  const bypass = [
    request('https://studio.example.test/api/content'),
    request('https://studio.example.test/auth/session'),
    request('https://api.example.test/v1/documents'),
    request('https://studio.example.test/admin.html', {mode: 'cors'}),
    request('https://studio.example.test/admin.html', {method: 'POST'}),
    request('https://studio.example.test/index.html'),
    request('https://studio.example.test/sites/example/index.html'),
    request('https://studio.example.test/admin.js'),
  ];
  for (const req of bypass) {
    let responded = false;
    fetchHandler({request: req, respondWith() { responded = true; }});
    assert.equal(responded, false, `${req.method} ${req.mode} ${req.url} should bypass`);
  }
  assert.equal(h.calls.length, 0);
  const req = request('https://studio.example.test/admin.html?userId=private&token=secret');
  let responsePromise;
  fetchHandler({request: req, respondWith(promise) { responsePromise = promise; }});
  assert.ok(responsePromise, 'admin navigation is handled');
  const response = await responsePromise;
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0][0], req);
  assert.equal(h.calls[0][1].cache, 'no-store');
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match(response.headers.get('content-type'), /text\/html/i);
  assert.match(response.headers.get('content-security-policy'), /default-src 'none'/);
  const body = await response.text();
  assert.match(body, /You’re offline/);
  assert.match(body, /Connect to the internet/);
  assert.doesNotMatch(body, /private-value|secret-value|token-value/i);
});

test('manifest has stable relative admin identity, standalone display and required icons', () => {
  assert.equal(manifest.id, './admin.html');
  assert.equal(manifest.start_url, './admin.html?source=homescreen');
  assert.equal(manifest.scope, './');
  assert.equal(manifest.display, 'standalone');
  assert.doesNotMatch(manifest.start_url, /(?:secret|userId|token|auth)=/i);
  assert.ok(!new URL(manifest.start_url, 'https://studio.example.test/').searchParams.has('secret'));
  for (const [size, purpose] of [['192x192', 'any'], ['512x512', 'any'], ['512x512', 'maskable']]) {
    assert.ok(manifest.icons.some(icon => icon.sizes === size && icon.purpose.split(/\s+/).includes(purpose) && icon.src.startsWith('./')),
      `relative ${size} ${purpose} icon exists`);
  }
});

test('install affordance is user initiated; beforeinstallprompt is deferred until click', async () => {
  const windowListeners = {};
  const buttonListeners = {};
  const docListeners = {};
  const buttons = [{hidden: false, textContent: '', addEventListener: (name, fn) => { buttonListeners[name] = fn; }}];
  const help = {open: false, showModal() { this.open = true; }, close() { this.open = false; }, addEventListener: (name, fn) => { docListeners[name] = fn; }};
  const status = {hidden: true, textContent: ''};
  const matchMedia = {matches: false, addEventListener() {}};
  const calls = [];
  const document = {
    querySelectorAll: () => buttons,
    getElementById: id => ({'install-help': help, 'install-help-close': {addEventListener: (n, fn) => { docListeners.close = fn; }}, 'connection-status': status, 'tab-nav': {querySelector: () => null, querySelectorAll: () => [], scrollWidth: 0, clientWidth: 0}}[id])
  };
  help.addEventListener = (name, fn) => { docListeners[name] = fn; };
  const navigator = {onLine: true, serviceWorker: {register: (...args) => { calls.push(args); return Promise.resolve(); }}};
  const window = {navigator, matchMedia: () => matchMedia, isSecureContext: true, addEventListener: (name, fn) => { windowListeners[name] = fn; }};
  const context = vm.createContext({window, navigator, document, URLSearchParams, location: {search: ''}, Array, Promise, MutationObserver: class { observe() {} }});
  vm.runInContext(pwaSource, context);
  assert.equal(buttons[0].hidden, false);
  let prompted = 0;
  let prevented = 0;
  windowListeners.beforeinstallprompt({preventDefault() { prevented++; }, prompt() { prompted++; return Promise.resolve(); }, userChoice: Promise.resolve({outcome: 'accepted'})});
  assert.equal(prevented, 1);
  assert.equal(prompted, 0, 'prompt cannot run without user click');
  assert.equal(buttons[0].textContent, 'Install admin app');
  await buttonListeners.click();
  assert.equal(prompted, 1);
  assert.equal(help.open, false);
});
