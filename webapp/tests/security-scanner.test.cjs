require('./register.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const original = Module.prototype.require;
const requests = [];
Module.prototype.require = function(id) {
  if (id === './ssrf-guard') return { ScanEgressError: class extends Error {}, isScanProxied: () => false, scanFetch: async (input, init = {}) => {
    const url = new URL(input);
    requests.push({ url, init });
    return new Response(url.pathname === '/' ? '<html><body>Fixture</body></html>' : 'Not found', { status: url.pathname === '/' ? 200 : 404 });
  } };
  return original.call(this, id);
};
const { scanSecurity } = require('../lib/security-scanner.ts');
Module.prototype.require = original;

test('standard scan remains deterministic and never sends mutating methods or attack payloads', async () => {
  const result = await scanSecurity('https://audit.example/', { depth: 'full' });
  assert.ok(result.details.tests.length > 0);
  assert.ok(requests.length > 0);
  for (const { url, init } of requests) {
    assert.equal(init.method || 'GET', 'GET');
    assert.equal(init.body, undefined);
    assert.ok(!/DROP|UNION|passwd|win\.ini|<b>|OR '1'/i.test(decodeURIComponent(url.search)));
  }
  assert.ok(!result.details.tests.some(t => ['sql-injection', 'path-traversal', 'method-delete', 'method-put'].includes(t.id)));
});
