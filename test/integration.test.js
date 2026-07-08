'use strict';

/* Spins up a mock RADIUS server on localhost and drives the real client.
   Run with: node test/integration.test.js */

const dgram = require('dgram');
const crypto = require('crypto');
const assert = require('assert');
const packet = require('../src/radius/packet');
const client = require('../src/radius/client');

const SECRET = 'testing123';
const GOOD_USER = 'alice';
const GOOD_PASS = 'wonderland';

function decryptUserPassword(enc, secret, authenticator) {
  const secretBuf = Buffer.from(secret, 'utf8');
  const out = Buffer.alloc(enc.length);
  let last = authenticator;
  for (let i = 0; i < enc.length; i += 16) {
    const b = packet.md5(secretBuf, last);
    for (let j = 0; j < 16; j++) out[i + j] = enc[i + j] ^ b[j];
    last = enc.subarray(i, i + 16);
  }
  let end = out.length;
  while (end > 0 && out[end - 1] === 0) end--;
  return out.subarray(0, end).toString('utf8');
}

function parseAttrs(buf) {
  const attrs = {};
  let off = 20;
  const len = buf.readUInt16BE(2);
  while (off + 2 <= len) {
    const t = buf[off];
    const l = buf[off + 1];
    if (l < 2) break;
    attrs[t] = buf.subarray(off + 2, off + l);
    off += l;
  }
  return attrs;
}

function makeServer({ dropFirst = false } = {}) {
  const sock = dgram.createSocket('udp4');
  let seen = 0;
  sock.on('message', (msg, rinfo) => {
    seen++;
    if (dropFirst && seen === 1) return; // force a client retry

    const code = msg[0];
    const id = msg[1];
    const reqAuth = msg.subarray(4, 20);
    const attrs = parseAttrs(msg);

    let replyCode = 3; // Access-Reject by default
    const replyAttrs = [];

    if (code === 1) {
      const userName = attrs[1] ? attrs[1].toString('utf8') : '';
      const pwEnc = attrs[2];
      if (pwEnc) {
        const pw = decryptUserPassword(pwEnc, SECRET, reqAuth);
        if (userName === GOOD_USER && pw === GOOD_PASS) {
          replyCode = 2; // Access-Accept
          replyAttrs.push(packet.encodeAttribute(18, Buffer.from('Login OK', 'utf8')));
          replyAttrs.push(packet.encodeAttribute(27, (() => { const b = Buffer.alloc(4); b.writeUInt32BE(3600, 0); return b; })())); // Session-Timeout
        } else {
          replyAttrs.push(packet.encodeAttribute(18, Buffer.from('Access denied', 'utf8')));
        }
      }
    } else if (code === 4) {
      replyCode = 5; // Accounting-Response
    }

    const attrBuf = Buffer.concat(replyAttrs);
    const len = 20 + attrBuf.length;
    const header = Buffer.alloc(20);
    header[0] = replyCode;
    header[1] = id;
    header.writeUInt16BE(len, 2);
    const respAuth = packet.md5(header.subarray(0, 4), reqAuth, attrBuf, Buffer.from(SECRET, 'utf8'));
    respAuth.copy(header, 4);
    sock.send(Buffer.concat([header, attrBuf]), rinfo.port, rinfo.address);
  });
  return sock;
}

function listen(sock) {
  return new Promise((res) => sock.bind(0, '127.0.0.1', () => res(sock.address().port)));
}

async function main() {
  let passed = 0;
  const ok = (n) => { passed++; console.log(`  ✓ ${n}`); };
  console.log('RADIUS integration tests');

  // 1. Successful PAP auth
  {
    const server = makeServer();
    const port = await listen(server);
    const res = await client.send({
      server: '127.0.0.1', port, secret: SECRET, code: 1, authMethod: 'pap',
      username: GOOD_USER, password: GOOD_PASS, timeout: 2, retries: 1, attributes: []
    });
    server.close();
    assert.strictEqual(res.ok, true, 'should get a reply');
    assert.strictEqual(res.response.codeName, 'Access-Accept');
    assert.strictEqual(res.response.authenticatorValid, true, 'response authenticator must validate');
    const names = res.response.attributes.map((a) => a.name);
    assert.ok(names.includes('Reply-Message'));
    assert.ok(names.includes('Session-Timeout'));
    const st = res.response.attributes.find((a) => a.name === 'Session-Timeout');
    assert.strictEqual(st.value, '3600');
    ok('PAP Access-Accept with valid authenticator and reply attributes');
  }

  // 2. Rejected auth (wrong password)
  {
    const server = makeServer();
    const port = await listen(server);
    const res = await client.send({
      server: '127.0.0.1', port, secret: SECRET, code: 1, authMethod: 'pap',
      username: GOOD_USER, password: 'wrong', timeout: 2, retries: 0, attributes: []
    });
    server.close();
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.response.codeName, 'Access-Reject');
    ok('Wrong password yields Access-Reject');
  }

  // 3. Retry then succeed (server drops first packet)
  {
    const server = makeServer({ dropFirst: true });
    const port = await listen(server);
    const res = await client.send({
      server: '127.0.0.1', port, secret: SECRET, code: 1, authMethod: 'pap',
      username: GOOD_USER, password: GOOD_PASS, timeout: 1, retries: 2, attributes: []
    });
    server.close();
    assert.strictEqual(res.ok, true, 'should succeed after retry');
    assert.strictEqual(res.response.codeName, 'Access-Accept');
    assert.ok(res.attempts.length >= 2, 'should record a retry');
    assert.strictEqual(res.attempts[0].timedOut, true);
    ok('Retries after a dropped packet');
  }

  // 4. Timeout when nothing listens
  {
    const res = await client.send({
      server: '127.0.0.1', port: 1, secret: SECRET, code: 1, authMethod: 'pap',
      username: 'x', password: 'y', timeout: 1, retries: 0, attributes: []
    });
    assert.strictEqual(res.ok, false);
    assert.ok(/No response|EACCES|error/i.test(res.error), 'expected a failure error');
    ok('Timeout / unreachable is reported as failure');
  }

  // 5. Additional attribute encoding reaches the server intact
  {
    const server = dgram.createSocket('udp4');
    let received = null;
    server.on('message', (msg, rinfo) => {
      received = parseAttrs(msg);
      const id = msg[1];
      const reqAuth = msg.subarray(4, 20);
      const header = Buffer.alloc(20);
      header[0] = 2; header[1] = id; header.writeUInt16BE(20, 2);
      const a = packet.md5(header.subarray(0, 4), reqAuth, Buffer.alloc(0), Buffer.from(SECRET, 'utf8'));
      a.copy(header, 4);
      server.send(header, rinfo.port, rinfo.address);
    });
    const port = await listen(server);
    await client.send({
      server: '127.0.0.1', port, secret: SECRET, code: 1, authMethod: 'pap',
      username: 'bob', password: 'pw', timeout: 2, retries: 0,
      attributes: [
        { id: 4, value: '192.168.1.5' },   // NAS-IP-Address
        { id: 6, value: 'Framed-User' }     // Service-Type (named enum)
      ]
    });
    server.close();
    assert.ok(received[4] && received[4].equals(Buffer.from([192, 168, 1, 5])), 'NAS-IP-Address encoded');
    assert.ok(received[6] && received[6].readUInt32BE(0) === 2, 'Service-Type=Framed-User encoded');
    ok('Additional attributes are encoded and transmitted correctly');
  }

  console.log(`\n${passed} passed\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
