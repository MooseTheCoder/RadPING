'use strict';

/* Lightweight assertions — run with: node test/radius.test.js
   No test framework needed; exits non-zero on first failure. */

const assert = require('assert');
const crypto = require('crypto');
const packet = require('../src/radius/packet');
const dict = require('../src/radius/dictionary');

let passed = 0;
function ok(name, fn) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

console.log('RADIUS packet tests');

// --- User-Password encryption round-trips (RFC 2865 §5.2) ---
function decryptUserPassword(enc, secret, authenticator) {
  const secretBuf = Buffer.from(secret, 'utf8');
  const out = Buffer.alloc(enc.length);
  let last = authenticator;
  for (let i = 0; i < enc.length; i += 16) {
    const b = packet.md5(secretBuf, last);
    for (let j = 0; j < 16; j++) out[i + j] = enc[i + j] ^ b[j];
    last = enc.subarray(i, i + 16);
  }
  // strip trailing nulls
  let end = out.length;
  while (end > 0 && out[end - 1] === 0) end--;
  return out.subarray(0, end).toString('utf8');
}

ok('User-Password round-trips (short password)', () => {
  const auth = crypto.randomBytes(16);
  const enc = packet.encryptUserPassword('secret123', 'testing123', auth);
  assert.strictEqual(enc.length % 16, 0);
  assert.strictEqual(decryptUserPassword(enc, 'testing123', auth), 'secret123');
});

ok('User-Password round-trips (multi-block password)', () => {
  const auth = crypto.randomBytes(16);
  const pw = 'this-password-is-definitely-longer-than-sixteen-bytes!!';
  const enc = packet.encryptUserPassword(pw, 'sharedSecret', auth);
  assert.strictEqual(enc.length % 16, 0);
  assert.ok(enc.length >= pw.length);
  assert.strictEqual(decryptUserPassword(enc, 'sharedSecret', auth), pw);
});

ok('User-Password differs from plaintext', () => {
  const auth = crypto.randomBytes(16);
  const enc = packet.encryptUserPassword('hello', 'sec', auth);
  assert.notStrictEqual(enc.toString('utf8'), 'hello');
});

// --- Access-Request build + Response authenticator validation ---
ok('buildRequest uses provided authenticator for Access-Request', () => {
  const auth = crypto.randomBytes(16);
  const built = packet.buildRequest({
    code: 1,
    identifier: 42,
    secret: 'testing123',
    attributes: [{ id: 1, value: Buffer.from('alice', 'utf8') }],
    authenticator: auth
  });
  assert.ok(built.authenticator.equals(auth));
  assert.strictEqual(built.buffer[0], 1);
  assert.strictEqual(built.buffer[1], 42);
  assert.strictEqual(built.buffer.readUInt16BE(2), built.buffer.length);
  assert.ok(built.buffer.subarray(4, 20).equals(auth));
});

ok('decodeResponse validates a correctly-signed Access-Accept', () => {
  const secret = 'testing123';
  const reqAuth = crypto.randomBytes(16);

  // Server-side: craft an Access-Accept signed with the request authenticator.
  const attrs = packet.encodeAttribute(18, Buffer.from('Welcome', 'utf8')); // Reply-Message
  const len = 20 + attrs.length;
  const header = Buffer.alloc(20);
  header[0] = 2; // Access-Accept
  header[1] = 42;
  header.writeUInt16BE(len, 2);
  reqAuth.copy(header, 4);
  const respAuth = packet.md5(
    header.subarray(0, 4),
    reqAuth,
    attrs,
    Buffer.from(secret, 'utf8')
  );
  respAuth.copy(header, 4);
  const respBuf = Buffer.concat([header, attrs]);

  const decoded = packet.decodeResponse(respBuf, reqAuth, secret);
  assert.strictEqual(decoded.code, 2);
  assert.strictEqual(decoded.codeName, 'Access-Accept');
  assert.strictEqual(decoded.authenticatorValid, true);
  assert.strictEqual(decoded.attributes.length, 1);
  assert.strictEqual(decoded.attributes[0].name, 'Reply-Message');
  assert.strictEqual(decoded.attributes[0].value, 'Welcome');
});

ok('decodeResponse flags a wrong secret', () => {
  const reqAuth = crypto.randomBytes(16);
  const attrs = Buffer.alloc(0);
  const header = Buffer.alloc(20);
  header[0] = 3; header[1] = 1; header.writeUInt16BE(20, 2);
  const respAuth = packet.md5(header.subarray(0, 4), reqAuth, attrs, Buffer.from('rightsecret', 'utf8'));
  respAuth.copy(header, 4);
  const decoded = packet.decodeResponse(header, reqAuth, 'wrongsecret');
  assert.strictEqual(decoded.authenticatorValid, false);
});

// --- Value encoding ---
ok('encodeValue ipaddr', () => {
  assert.ok(packet.encodeValue('ipaddr', 'NAS-IP-Address', '10.0.0.1').equals(Buffer.from([10, 0, 0, 1])));
});
ok('encodeValue integer resolves named enum', () => {
  const buf = packet.encodeValue('integer', 'Service-Type', 'Framed-User');
  assert.strictEqual(buf.readUInt32BE(0), 2);
});
ok('encodeValue integer numeric', () => {
  assert.strictEqual(packet.encodeValue('integer', 'NAS-Port', '7').readUInt32BE(0), 7);
});
ok('encodeValue octets hex', () => {
  assert.ok(packet.encodeValue('octets', 'State', '0xdeadbeef').equals(Buffer.from('deadbeef', 'hex')));
});
ok('dictionary lookups', () => {
  assert.strictEqual(dict.attrByName('User-Name').id, 1);
  assert.strictEqual(dict.attrById(4).name, 'NAS-IP-Address');
  assert.strictEqual(dict.CODES[2], 'Access-Accept');
});

// --- CHAP-Password ---
ok('CHAP-Password is ident + 16-byte digest', () => {
  const challenge = crypto.randomBytes(16);
  const cp = packet.buildChapPassword('pass', 7, challenge);
  assert.strictEqual(cp.length, 17);
  assert.strictEqual(cp[0], 7);
  const expected = packet.md5(Buffer.from([7]), Buffer.from('pass', 'utf8'), challenge);
  assert.ok(cp.subarray(1).equals(expected));
});

// --- Vendor-Specific Attribute decoding ---
function buildVsa(vendorId, subType, valueBuf) {
  // VSA value = 4-byte Vendor-Id + [subType, subLen, value...]
  const sub = Buffer.concat([Buffer.from([subType, valueBuf.length + 2]), valueBuf]);
  const vid = Buffer.alloc(4);
  vid.writeUInt32BE(vendorId, 0);
  return Buffer.concat([vid, sub]);
}

ok('decodeVsa names a known Cisco sub-attribute (Cisco-AVPair)', () => {
  const vsa = buildVsa(9, 1, Buffer.from('shell:priv-lvl=15', 'utf8'));
  const rows = packet.decodeVsa(vsa);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].name, 'Cisco-AVPair');
  assert.strictEqual(rows[0].value, 'shell:priv-lvl=15');
  assert.strictEqual(rows[0].vendorId, 9);
  assert.strictEqual(rows[0].id, '26/1');
});

ok('decodeVsa decodes an integer sub-attribute (WISPr bandwidth)', () => {
  const v = Buffer.alloc(4); v.writeUInt32BE(1000000, 0);
  const rows = packet.decodeVsa(buildVsa(14122, 8, v));
  assert.strictEqual(rows[0].name, 'WISPr-Bandwidth-Max-Down');
  assert.strictEqual(rows[0].value, '1000000');
});

ok('decodeVsa handles multiple sub-attributes in one container', () => {
  const a = Buffer.concat([Buffer.from([1, 2 + 5]), Buffer.from('role1', 'utf8')]); // Aruba-User-Role
  const vlan = Buffer.alloc(4); vlan.writeUInt32BE(42, 0);
  const b = Buffer.concat([Buffer.from([2, 2 + 4]), vlan]);                          // Aruba-User-Vlan
  const vid = Buffer.alloc(4); vid.writeUInt32BE(14823, 0);
  const rows = packet.decodeVsa(Buffer.concat([vid, a, b]));
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].name, 'Aruba-User-Role');
  assert.strictEqual(rows[0].value, 'role1');
  assert.strictEqual(rows[1].name, 'Aruba-User-Vlan');
  assert.strictEqual(rows[1].value, '42');
});

ok('decodeVsa structurally decodes an UNKNOWN vendor (no dict, still not a blob)', () => {
  const rows = packet.decodeVsa(buildVsa(64512, 3, Buffer.from('custom', 'utf8')));
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].name, 'Vendor-64512-3'); // named by vendor id + sub-type
  assert.strictEqual(rows[0].value, '0x' + Buffer.from('custom', 'utf8').toString('hex'));
});

ok('decodeResponse expands a VSA into named rows end-to-end', () => {
  const secret = 'testing123';
  const reqAuth = crypto.randomBytes(16);
  const vsa = buildVsa(9, 1, Buffer.from('ip:addr-pool=main', 'utf8'));
  const attrs = packet.encodeAttribute(26, vsa);
  const len = 20 + attrs.length;
  const header = Buffer.alloc(20);
  header[0] = 2; header[1] = 7; header.writeUInt16BE(len, 2);
  reqAuth.copy(header, 4);
  const respAuth = packet.md5(header.subarray(0, 4), reqAuth, attrs, Buffer.from(secret, 'utf8'));
  respAuth.copy(header, 4);
  const decoded = packet.decodeResponse(Buffer.concat([header, attrs]), reqAuth, secret);
  const av = decoded.attributes.find((a) => a.name === 'Cisco-AVPair');
  assert.ok(av, 'Cisco-AVPair should be present');
  assert.strictEqual(av.value, 'ip:addr-pool=main');
});

console.log(`\n${passed} passed\n`);
