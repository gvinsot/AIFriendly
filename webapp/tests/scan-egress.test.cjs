require('./register.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const dns = require('node:dns');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const tls = require('node:tls');
const { spawnSync } = require('node:child_process');

// Résolution DNS simulée : les cibles ont des adresses publiques, le faux proxy
// les redirige vers des serveurs locaux. Rien ne sort de la machine.
const PUBLIC_IP = '93.184.216.34';
const SECOND_IP = '93.184.216.35';
let records = {};
const answer = host => (records[host] || []).map(address => ({ address, family: net.isIP(address) }));
const realLookup = dns.lookup;
dns.lookup = (host, options, callback) => {
  // Serveurs locaux du test : net.Server.listen() passe aussi par dns.lookup.
  if (typeof options === 'function' || net.isIP(host)) return realLookup(host, options, callback);
  const found = answer(host);
  if (!found.length) return callback(Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }));
  callback(null, found);
};
dns.promises.lookup = async host => answer(host);

const { scanFetch, safeFetch, ScanEgressError, SsrfBlockedError } = require('../lib/ssrf-guard.ts');

const USER = 'service-user';
const PASSWORD = 'p@ss:word/1';
const proxyUrl = (port, password = PASSWORD) => `socks5://${USER}:${encodeURIComponent(password)}@127.0.0.1:${port}`;

/** Faux serveur SOCKS5 (RFC 1928/1929) : relie chaque CONNECT au serveur local choisi. */
function startSocks({ upstream, replyFor = () => 0, stall = false }) {
  const log = { auths: [], connects: [] };
  const sockets = new Set();
  const server = net.createServer(socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    if (stall) return;
    let buffer = Buffer.alloc(0);
    let stage = 'greeting';
    const onData = chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      if (stage === 'greeting') {
        if (buffer.length < 2 || buffer.length < 2 + buffer[1]) return;
        buffer = buffer.subarray(2 + buffer[1]);
        stage = 'auth';
        socket.write(Buffer.from([5, 2]));
      }
      if (stage === 'auth') {
        if (buffer.length < 2) return;
        const userLength = buffer[1];
        if (buffer.length < 3 + userLength) return;
        const passLength = buffer[2 + userLength];
        if (buffer.length < 3 + userLength + passLength) return;
        const user = buffer.subarray(2, 2 + userLength).toString();
        const pass = buffer.subarray(3 + userLength, 3 + userLength + passLength).toString();
        buffer = buffer.subarray(3 + userLength + passLength);
        log.auths.push({ user, pass });
        if (user !== USER || pass !== PASSWORD) { socket.end(Buffer.from([1, 1])); return; }
        stage = 'connect';
        socket.write(Buffer.from([1, 0]));
      }
      if (stage === 'connect') {
        if (buffer.length < 4) return;
        const atyp = buffer[3];
        const length = atyp === 1 ? 4 : atyp === 4 ? 16 : 1 + buffer[4];
        if (buffer.length < 4 + length + 2) return;
        const host = atyp === 1 ? [...buffer.subarray(4, 8)].join('.') : atyp === 3 ? buffer.subarray(5, 4 + length).toString() : 'ipv6';
        const port = buffer.readUInt16BE(4 + length);
        const rest = buffer.subarray(4 + length + 2);
        log.connects.push({ atyp, host, port });
        const reply = replyFor(host, port);
        const answerWith = code => Buffer.from([5, code, 0, 1, 0, 0, 0, 0, 0, 0]);
        if (reply !== 0) { socket.end(answerWith(reply)); return; }
        stage = 'tunnel';
        socket.off('data', onData);
        const remote = net.connect(upstream(port), '127.0.0.1', () => {
          socket.write(answerWith(0));
          if (rest.length) remote.write(rest);
          socket.pipe(remote).pipe(socket);
        });
        remote.on('error', () => socket.destroy());
        socket.on('close', () => remote.destroy());
      }
    };
    socket.on('data', onData);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({
    log,
    port: server.address().port,
    close: () => new Promise(done => { sockets.forEach(s => s.destroy()); server.close(done); }),
  })));
}

function startHttp(handler) {
  const server = http.createServer(handler);
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({
    port: server.address().port,
    close: () => new Promise(done => { server.closeAllConnections(); server.close(done); }),
  })));
}

test.beforeEach(() => {
  records = { 'audit.example': [PUBLIC_IP] };
  delete process.env.SCAN_ALLOW_DIRECT;
});
test.afterEach(() => { delete process.env.SCAN_PROXY_SECRET; });

test('without a proxy, scans are refused instead of leaving through the server IP', async () => {
  let reached = false;
  const previous = dns.lookup;
  dns.lookup = (...args) => { reached = true; previous(...args); };
  try {
    await assert.rejects(scanFetch('http://audit.example/'), err => err instanceof ScanEgressError && err.reason === 'not_configured');
    assert.equal(reached, false, 'no connection attempt');
  } finally { dns.lookup = previous; }
});

test('an invalid proxy URL is refused without echoing its value', async () => {
  process.env.SCAN_PROXY_SECRET = `http://${USER}:hunter2-secret@127.0.0.1:1080`;
  await assert.rejects(scanFetch('http://audit.example/'), err => {
    assert.ok(err instanceof ScanEgressError);
    assert.equal(err.reason, 'not_configured');
    assert.ok(!err.message.includes('hunter2-secret'));
    return true;
  });
});

test('HTTP goes through SOCKS5 with credentials, sends the validated IP and keeps the Host header', async () => {
  const seen = [];
  const web = await startHttp((req, res) => {
    seen.push({ host: req.headers.host, url: req.url, ua: req.headers['user-agent'] });
    if (req.url.startsWith('/start')) { res.writeHead(302, { location: '/end' }); res.end(); return; }
    res.end('tunnel-ok');
  });
  const proxy = await startSocks({ upstream: () => web.port });
  process.env.SCAN_PROXY_SECRET = proxyUrl(proxy.port);
  try {
    const res = await scanFetch('http://audit.example/start?x=1', { headers: { 'User-Agent': 'AIFriendly/1.0 (SecurityScan)' } });
    assert.equal(await res.text(), 'tunnel-ok');
    assert.equal(res.url, 'http://audit.example/end');
    assert.deepEqual(proxy.log.auths[0], { user: USER, pass: PASSWORD });
    // Le nom n'est jamais confié au proxy : ATYP 1 (IPv4), adresse déjà validée.
    assert.deepEqual(proxy.log.connects[0], { atyp: 1, host: PUBLIC_IP, port: 80 });
    assert.equal(proxy.log.connects.length, 2, 'the redirect also goes through the proxy');
    assert.equal(seen[0].host, 'audit.example');
    assert.equal(seen[0].url, '/start?x=1');
    assert.equal(seen[0].ua, 'AIFriendly/1.0 (SecurityScan)');
  } finally { await proxy.close(); await web.close(); }
});

test('safeFetch without the scan egress never contacts the proxy', async () => {
  const proxy = await startSocks({ upstream: () => 1 });
  process.env.SCAN_PROXY_SECRET = proxyUrl(proxy.port);
  records = {};
  try {
    await assert.rejects(safeFetch('http://audit.example/'));
    assert.equal(proxy.log.auths.length, 0);
  } finally { await proxy.close(); }
});

test('wrong credentials stop the scan and never appear in the error', async () => {
  const proxy = await startSocks({ upstream: () => 1 });
  process.env.SCAN_PROXY_SECRET = proxyUrl(proxy.port, 'wrong-password-value');
  try {
    await assert.rejects(scanFetch('http://audit.example/'), err => {
      assert.ok(err instanceof ScanEgressError);
      assert.equal(err.reason, 'unavailable');
      assert.ok(!err.message.includes('wrong-password-value'));
      return true;
    });
  } finally { await proxy.close(); }
});

test('an unreachable proxy stops the scan', async () => {
  const closed = await startSocks({ upstream: () => 1 });
  const port = closed.port;
  await closed.close();
  process.env.SCAN_PROXY_SECRET = proxyUrl(port);
  await assert.rejects(scanFetch('http://audit.example/'), err => err instanceof ScanEgressError && err.reason === 'unavailable');
});

test('a target refused by the proxy is a normal failure, and the next address is tried', async () => {
  const web = await startHttp((_req, res) => res.end('second-address'));
  const proxy = await startSocks({ upstream: () => web.port, replyFor: host => (host === PUBLIC_IP ? 5 : 0) });
  process.env.SCAN_PROXY_SECRET = proxyUrl(proxy.port);
  records = { 'audit.example': [PUBLIC_IP, SECOND_IP] };
  try {
    const res = await scanFetch('http://audit.example/');
    assert.equal(await res.text(), 'second-address');

    records = { 'audit.example': [PUBLIC_IP] };
    await assert.rejects(scanFetch('http://audit.example/'), err => !(err instanceof ScanEgressError));
  } finally { await proxy.close(); await web.close(); }
});

test('DNS rebinding at connection time is refused before anything reaches the proxy', async () => {
  const proxy = await startSocks({ upstream: () => 1 });
  process.env.SCAN_PROXY_SECRET = proxyUrl(proxy.port);
  // Première résolution publique (assertPublicUrl), seconde interne (connexion).
  const original = dns.lookup;
  dns.lookup = (_host, _options, callback) => callback(null, [{ address: '127.0.0.1', family: 4 }]);
  try {
    await assert.rejects(scanFetch('http://audit.example/'), SsrfBlockedError);
    assert.equal(proxy.log.connects.length, 0);
  } finally { dns.lookup = original; await proxy.close(); }
});

test('a redirect outside the allowed scope is not followed', async () => {
  const seen = [];
  const web = await startHttp((req, res) => {
    seen.push(req.headers.host);
    res.writeHead(302, { location: 'http://victim.example/.env' });
    res.end();
  });
  const proxy = await startSocks({ upstream: () => web.port });
  process.env.SCAN_PROXY_SECRET = proxyUrl(proxy.port);
  records = { 'audit.example': [PUBLIC_IP], 'victim.example': [SECOND_IP] };
  try {
    await assert.rejects(
      scanFetch('http://audit.example/', { allowRedirect: url => url.hostname === 'audit.example' }),
      SsrfBlockedError
    );
    assert.deepEqual(seen, ['audit.example']);
    assert.equal(proxy.log.connects.length, 1);
  } finally { await proxy.close(); await web.close(); }
});

test('aborting during a stalled proxy handshake returns promptly', async () => {
  const proxy = await startSocks({ upstream: () => 1, stall: true });
  process.env.SCAN_PROXY_SECRET = proxyUrl(proxy.port);
  const started = Date.now();
  try {
    await assert.rejects(scanFetch('http://audit.example/', { signal: AbortSignal.timeout(100) }), err => !(err instanceof ScanEgressError));
    assert.ok(Date.now() - started < 5000);
  } finally { await proxy.close(); }
});

test('HTTPS stays end to end through the tunnel and the certificate is checked against the requested name', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aifriendly-tls-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const keyFile = path.join(dir, 'key.pem');
  const certFile = path.join(dir, 'cert.pem');
  const made = spawnSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', keyFile, '-out', certFile, '-days', '1', '-subj', '/CN=audit.example', '-addext', 'subjectAltName=DNS:audit.example'], { stdio: 'ignore' });
  if (made.status !== 0) return t.skip('openssl unavailable');
  const key = fs.readFileSync(keyFile);
  const cert = fs.readFileSync(certFile);

  const seen = [];
  const web = https.createServer({ key, cert }, (req, res) => {
    seen.push({ host: req.headers.host, servername: req.socket.servername, alpn: req.socket.alpnProtocol });
    res.end('tls-ok');
  });
  await new Promise(resolve => web.listen(0, '127.0.0.1', resolve));
  const proxy = await startSocks({ upstream: () => web.address().port });
  process.env.SCAN_PROXY_SECRET = proxyUrl(proxy.port);
  records = { 'audit.example': [PUBLIC_IP], 'other.example': [PUBLIC_IP] };

  const realConnect = tls.connect;
  t.after(() => { tls.connect = realConnect; });
  try {
    // Certificat inconnu : refusé, comme en connexion directe.
    await assert.rejects(scanFetch('https://audit.example/'), err => !(err instanceof ScanEgressError));
    assert.equal(seen.length, 0);

    tls.connect = (options, ...rest) => realConnect({ ...options, ca: cert }, ...rest);
    const res = await scanFetch('https://audit.example/path');
    assert.equal(await res.text(), 'tls-ok');
    assert.equal(seen[0].host, 'audit.example');
    assert.equal(seen[0].servername, 'audit.example');
    assert.deepEqual(proxy.log.connects.at(-1), { atyp: 1, host: PUBLIC_IP, port: 443 });

    // Autorité de confiance mais mauvais nom : le contrôle porte sur le nom demandé, pas sur l'IP.
    await assert.rejects(scanFetch('https://other.example/'), err => /other\.example|altnames|ERR_TLS_CERT/i.test(`${err.code} ${err.message}`));
    assert.equal(seen.length, 1);
  } finally {
    await proxy.close();
    web.closeAllConnections();
    await new Promise(resolve => web.close(resolve));
  }
});
