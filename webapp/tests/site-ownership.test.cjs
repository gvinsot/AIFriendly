require('./register.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const dnsPromises = require('node:dns/promises');
const Module = require('node:module');

class SsrfBlockedError extends Error {
  constructor(message) { super(message); this.name = 'SsrfBlockedError'; }
}

let fileResponse = () => new Response('Not found', { status: 404 });
let fileCalls = [];
let txt = async () => { throw Object.assign(new Error('none'), { code: 'ENOTFOUND' }); };
dnsPromises.resolveTxt = (...args) => txt(...args);

const stub = {
  safeFetch: async (input, init) => {
    fileCalls.push({ input, init });
    return fileResponse(input, init);
  },
  readBodyLimited: async (res) => ({ text: await res.text() }),
  unbracketHostname: (host) => host.replace(/^\[|\]$/g, ''),
};
const original = Module.prototype.require;
Module.prototype.require = function (id) {
  return id === './ssrf-guard' ? stub : original.call(this, id);
};
const ownership = require('../lib/site-ownership.ts');
Module.prototype.require = original;

const TOKEN = 'abc123';
const VALUE = `aifriendly-verify=${TOKEN}`;
const DAY = 24 * 60 * 60 * 1000;
const now = new Date('2026-11-08T12:00:00Z');
const site = (overrides = {}) => ({
  id: 's1',
  url: 'https://audit.example/app',
  ownershipToken: TOKEN,
  ownershipVerifiedAt: new Date(now.getTime() - DAY),
  ownershipVerifiedHost: 'audit.example',
  ...overrides,
});
const db = () => {
  const updates = [];
  return { updates, site: { update: async (args) => { updates.push(args); return args; } } };
};

test.beforeEach(() => {
  fileCalls = [];
  fileResponse = () => new Response('Not found', { status: 404 });
  txt = async () => { throw Object.assign(new Error('none'), { code: 'ENOTFOUND' }); };
});

test('the DNS proof is read on the dedicated name and split TXT chunks are joined', async () => {
  const names = [];
  txt = async (name) => { names.push(name); return [['unrelated'], [VALUE.slice(0, 10), VALUE.slice(10)]]; };
  const proof = await ownership.checkOwnershipProof('https://audit.example/app', TOKEN);
  assert.deepEqual(proof, { status: 'verified', method: 'dns' });
  assert.deepEqual(names, ['_aifriendly-verify.audit.example']);
  assert.equal(fileCalls.length, 0);
});

test('another token in DNS does not prove anything', async () => {
  txt = async () => [['aifriendly-verify=someone-else']];
  assert.deepEqual(await ownership.checkOwnershipProof('https://audit.example/', TOKEN), { status: 'absent' });
});

test('the file proof is read at the origin root, with an exact match', async () => {
  fileResponse = () => new Response(`  ${VALUE}\n`, { status: 200 });
  const proof = await ownership.checkOwnershipProof('https://audit.example/app/page', TOKEN);
  assert.deepEqual(proof, { status: 'verified', method: 'file' });
  assert.equal(fileCalls[0].input, 'https://audit.example/.well-known/aifriendly-verification.txt');
});

test('a page merely quoting the token, or an error status, is not a proof', async () => {
  fileResponse = () => new Response(`<html>Your token is ${VALUE}</html>`, { status: 200 });
  assert.equal((await ownership.checkOwnershipProof('https://audit.example/', TOKEN)).status, 'absent');
  fileResponse = () => new Response(VALUE, { status: 403 });
  assert.equal((await ownership.checkOwnershipProof('https://audit.example/', TOKEN)).status, 'absent');
});

test('the file check only follows redirects on the same host', async () => {
  await ownership.checkOwnershipProof('http://audit.example/', TOKEN);
  const { allowRedirect } = fileCalls[0].init;
  assert.equal(allowRedirect(new URL('https://audit.example/.well-known/aifriendly-verification.txt')), true);
  assert.equal(allowRedirect(new URL('https://attacker.example/proof.txt')), false);
});

test('a refused redirect counts as absent, an outage as unreachable', async () => {
  fileResponse = () => { throw new SsrfBlockedError(); };
  assert.equal((await ownership.checkOwnershipProof('https://audit.example/', TOKEN)).status, 'absent');
  fileResponse = () => { throw new Error('ECONNRESET'); };
  assert.equal((await ownership.checkOwnershipProof('https://audit.example/', TOKEN)).status, 'unreachable');
  fileResponse = () => new Response('Not found', { status: 404 });
  txt = async () => { throw Object.assign(new Error('servfail'), { code: 'ESERVFAIL' }); };
  assert.equal((await ownership.checkOwnershipProof('https://audit.example/', TOKEN)).status, 'unreachable');
});

test('an IP address has no DNS proof to offer', async () => {
  const instructions = ownership.ownershipInstructions('https://93.184.216.34/', TOKEN);
  assert.equal(instructions.dns, null);
  assert.equal(instructions.file.url, 'https://93.184.216.34/.well-known/aifriendly-verification.txt');
  assert.equal(ownership.ownershipInstructions('https://audit.example/x', TOKEN).dns.name, '_aifriendly-verify.audit.example');
});

test('a verification only covers the verified host', () => {
  assert.equal(ownership.isOwnershipVerified(site()), true);
  assert.equal(ownership.isOwnershipVerified(site({ url: 'https://audit.example/other-path' })), true);
  assert.equal(ownership.isOwnershipVerified(site({ url: 'https://victim.example/' })), false);
  assert.equal(ownership.isOwnershipVerified(site({ url: 'https://audit.example:8443/' })), false);
  assert.equal(ownership.isOwnershipVerified(site({ ownershipVerifiedAt: null })), false);
  assert.equal(ownership.isOwnershipVerified(site({ ownershipToken: null })), false);
});

test('an unverified site is refused without any network check', async () => {
  const fake = db();
  assert.equal(await ownership.ensureSiteOwnership(fake, site({ ownershipVerifiedAt: null }), now), false);
  assert.equal(fileCalls.length, 0);
});

test('a recent verification is trusted without a new check', async () => {
  const fake = db();
  assert.equal(await ownership.ensureSiteOwnership(fake, site(), now), true);
  assert.equal(fileCalls.length, 0);
  assert.equal(fake.updates.length, 0);
});

test('after 30 days, a proof still present renews the verification', async () => {
  txt = async () => [[VALUE]];
  const fake = db();
  const old = site({ ownershipVerifiedAt: new Date(now.getTime() - 31 * DAY) });
  assert.equal(await ownership.ensureSiteOwnership(fake, old, now), true);
  assert.deepEqual(fake.updates[0].data, { ownershipVerifiedAt: now, ownershipMethod: 'dns' });
});

test('after 30 days, a proof that disappeared revokes the verification', async () => {
  const fake = db();
  const old = site({ ownershipVerifiedAt: new Date(now.getTime() - 31 * DAY) });
  assert.equal(await ownership.ensureSiteOwnership(fake, old, now), false);
  assert.deepEqual(fake.updates[0].data, { ownershipVerifiedAt: null, ownershipVerifiedHost: null, ownershipMethod: null });
});

test('after 30 days, an outage refuses this scan but does not revoke', async () => {
  fileResponse = () => { throw new Error('ECONNRESET'); };
  const fake = db();
  const old = site({ ownershipVerifiedAt: new Date(now.getTime() - 31 * DAY) });
  assert.equal(await ownership.ensureSiteOwnership(fake, old, now), false);
  assert.equal(fake.updates.length, 0);
});
