require('./register.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

class ScanEgressError extends Error {
  constructor(reason, message) { super(message); this.reason = reason; }
}

// Real WAF helpers, loaded before the stub replaces the module.
const { looksBlockedByWaf, WAF_BLOCKED_MESSAGE } = require('../lib/ssrf-guard.ts');

let requests = [];
let proxied = false;
let respond = () => null;
const stub = {
  ScanEgressError,
  looksBlockedByWaf,
  WAF_BLOCKED_MESSAGE,
  isScanProxied: () => proxied,
  scanFetch: async (input, init = {}) => {
    const url = new URL(input);
    requests.push({ url, init });
    const custom = respond(url, init);
    if (custom instanceof Error) throw custom;
    if (custom) return custom;
    return new Response(url.pathname === '/' ? '<html><body>Fixture</body></html>' : 'Not found', { status: url.pathname === '/' ? 200 : 404 });
  },
};
const original = Module.prototype.require;
Module.prototype.require = function (id) {
  return id === './ssrf-guard' ? stub : original.call(this, id);
};
const { scanSecurity } = require('../lib/security-scanner.ts');
Module.prototype.require = original;

const SENSITIVE = /\.env|\.git|backup|admin|phpinfo|swagger|openapi|server-status|\.sql/i;

test.beforeEach(() => { requests = []; proxied = false; respond = () => null; });

test('passive scan reads public information only: no sensitive path, forged Origin or JSONP probe', async () => {
  const result = await scanSecurity('https://any-site.example/', { depth: 'passive' });
  const paths = requests.map(r => r.url.pathname);
  assert.ok(!paths.some(p => SENSITIVE.test(p)), paths.join(' '));
  assert.ok(requests.every(r => !r.url.search.includes('callback')));
  assert.ok(requests.every(r => !r.init.headers?.Origin));
  assert.ok(new Set(paths).size <= 4, paths.join(' '));
  assert.ok(result.details.tests.some(t => t.id === 'probes-skipped'));
});

test('full scan probes sensitive paths and limits their redirects to the verified domain', async () => {
  await scanSecurity('https://audit.example/', { depth: 'full' });
  const probes = requests.filter(r => SENSITIVE.test(r.url.pathname));
  assert.ok(probes.length > 0);
  for (const { init } of probes) {
    assert.equal(init.allowRedirect(new URL('https://audit.example/x')), true);
    assert.equal(init.allowRedirect(new URL('https://www.audit.example/x')), true);
    assert.equal(init.allowRedirect(new URL('https://victim.example/.env')), false);
    assert.equal(init.allowRedirect(new URL('https://audit.example.victim.example/')), false);
  }
});

test('a verified site redirecting to another domain does not turn the probes onto that domain', async () => {
  respond = (url) => {
    if (url.pathname !== '/') return null;
    const res = new Response('<html><body>Elsewhere</body></html>', { status: 200 });
    Object.defineProperty(res, 'url', { value: 'https://victim.example/' });
    return res;
  };
  const result = await scanSecurity('https://attacker.example/', { depth: 'full' });
  const onVictim = requests.filter(r => r.url.hostname === 'victim.example');
  assert.ok(!onVictim.some(r => SENSITIVE.test(r.url.pathname)), onVictim.map(r => r.url.pathname).join(' '));
  assert.ok(result.details.tests.some(t => t.id === 'probes-skipped'));
});

test('a redirect to the www variant of the verified domain keeps the probes', async () => {
  respond = (url) => {
    if (url.pathname !== '/') return null;
    const res = new Response('<html><body>Home</body></html>', { status: 200 });
    Object.defineProperty(res, 'url', { value: 'https://www.audit.example/' });
    return res;
  };
  const result = await scanSecurity('https://audit.example/', { depth: 'full' });
  assert.ok(requests.some(r => SENSITIVE.test(r.url.pathname)));
  assert.ok(!result.details.tests.some(t => t.id === 'probes-skipped'));
});

test('a VPN failure on the first request rejects the scan instead of storing a score of 0', async () => {
  respond = () => new ScanEgressError('unavailable', 'Proxy VPN injoignable.');
  await assert.rejects(scanSecurity('https://audit.example/', { depth: 'full' }), ScanEgressError);
});

test('a VPN failure during concurrent probes also rejects the scan', async () => {
  respond = (url) => (url.pathname.includes('.env') ? new ScanEgressError('unavailable', 'Proxy VPN injoignable.') : null);
  await assert.rejects(scanSecurity('https://audit.example/', { depth: 'full' }), ScanEgressError);
});

test('other scan errors keep their previous behaviour', async () => {
  respond = (url) => (url.pathname === '/' ? new Error('ECONNREFUSED') : null);
  const result = await scanSecurity('https://audit.example/', { depth: 'full' });
  assert.equal(result.score, 0);
  assert.equal(result.details.tests[0].id, 'scan-error');
});

test('behind the VPN, a WAF block page produces an explicit refusal and no score', async () => {
  proxied = true;
  respond = () => new Response('<title>Just a moment...</title>', { status: 403 });
  await assert.rejects(scanSecurity('https://audit.example/', { depth: 'full' }), err => err instanceof ScanEgressError && err.reason === 'blocked');
});

test('behind the VPN, cf-mitigated marks a block even with a neutral body', async () => {
  proxied = true;
  respond = () => new Response('nope', { status: 403, headers: { 'cf-mitigated': 'challenge' } });
  await assert.rejects(scanSecurity('https://audit.example/', { depth: 'full' }), err => err.reason === 'blocked');
});

test('a plain 503 or a normal page is still scanned behind the VPN', async () => {
  proxied = true;
  respond = (url) => (url.pathname === '/' ? new Response('Maintenance in progress', { status: 503 }) : null);
  const result = await scanSecurity('https://audit.example/', { depth: 'passive' });
  assert.notEqual(result.details.tests[0].id, 'scan-error');
});
