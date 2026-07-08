'use strict';

/* FreeRADIUS dictionary parser + vendor register/reset tests.
   Run with: node test/dictparser.test.js */

const assert = require('assert');
const { parseDictionary } = require('../src/radius/dictparser');
const vendors = require('../src/radius/vendors');
const packet = require('../src/radius/packet');

let passed = 0;
function ok(name, fn) { fn(); passed++; console.log(`  ✓ ${name}`); }

console.log('Dictionary parser tests');

const CISCO = `
# Cisco dictionary (excerpt)
VENDOR          Cisco           9

BEGIN-VENDOR    Cisco
ATTRIBUTE       Cisco-AVPair            1       string
ATTRIBUTE       Cisco-NAS-Port          2       string
ATTRIBUTE       Cisco-Disconnect-Cause  195     integer
END-VENDOR      Cisco
`;

ok('parses VENDOR + BEGIN/END-VENDOR attributes', () => {
  const r = parseDictionary(CISCO);
  assert.strictEqual(r.vendorCount, 1);
  assert.strictEqual(r.attrCount, 3);
  assert.strictEqual(r.vendors[9].name, 'Cisco');
  assert.strictEqual(r.vendors[9].attributes[1].name, 'Cisco-AVPair');
  assert.strictEqual(r.vendors[9].attributes[1].type, 'string');
  assert.strictEqual(r.vendors[9].attributes[195].type, 'integer');
});

ok('parses the old 4-column vendor form', () => {
  const txt = `
VENDOR Acme 64512
ATTRIBUTE Acme-Policy 3 string Acme
ATTRIBUTE Acme-Limit  4 integer Acme
`;
  const r = parseDictionary(txt);
  assert.strictEqual(r.vendors[64512].attributes[3].name, 'Acme-Policy');
  assert.strictEqual(r.vendors[64512].attributes[4].type, 'integer');
});

ok('parses the OID (26.vid.subtype) form', () => {
  const txt = `
VENDOR Widget 40000
ATTRIBUTE Widget-Thing 26.40000.5 ipaddr
`;
  const r = parseDictionary(txt);
  assert.strictEqual(r.vendors[40000].attributes[5].name, 'Widget-Thing');
  assert.strictEqual(r.vendors[40000].attributes[5].type, 'ipaddr');
});

ok('ignores base (non-vendor) attributes and comments', () => {
  const txt = `
# base attributes should be skipped
ATTRIBUTE User-Name 1 string
ATTRIBUTE NAS-Port  5 integer
VENDOR Foo 100
BEGIN-VENDOR Foo
ATTRIBUTE Foo-Bar 1 string
END-VENDOR Foo
`;
  const r = parseDictionary(txt);
  assert.strictEqual(r.vendorCount, 1);
  assert.strictEqual(r.attrCount, 1);
  assert.strictEqual(r.vendors[100].attributes[1].name, 'Foo-Bar');
});

ok('maps unknown types to octets and counts VALUE lines', () => {
  const txt = `
VENDOR Foo 100
BEGIN-VENDOR Foo
ATTRIBUTE Foo-Key 1 octets
ATTRIBUTE Foo-V6  2 ipv6addr
ATTRIBUTE Foo-Enum 3 integer
VALUE Foo-Enum Enabled 1
VALUE Foo-Enum Disabled 0
END-VENDOR Foo
`;
  const r = parseDictionary(txt);
  assert.strictEqual(r.vendors[100].attributes[1].type, 'octets');
  assert.strictEqual(r.vendors[100].attributes[2].type, 'octets'); // ipv6addr -> octets
  assert.strictEqual(r.valueCount, 2);
});

ok('resolves $INCLUDE via the supplied resolver', () => {
  const main = `
VENDOR Foo 100
$INCLUDE foo.inc
`;
  const inc = `
BEGIN-VENDOR Foo
ATTRIBUTE Foo-Bar 1 string
END-VENDOR Foo
`;
  const r = parseDictionary(main, { resolveInclude: (f) => (f === 'foo.inc' ? inc : null) });
  assert.strictEqual(r.vendors[100].attributes[1].name, 'Foo-Bar');
});

ok('collects warnings but does not throw on junk', () => {
  const r = parseDictionary('VENDOR\nATTRIBUTE incomplete\n$INCLUDE missing.inc');
  assert.ok(Array.isArray(r.warnings));
  assert.ok(r.warnings.length >= 1);
  assert.strictEqual(r.vendorCount, 0);
});

ok('modern uintN / intN types decode as integers, not raw hex', () => {
  const r = parseDictionary(`
VENDOR Widget 6527
BEGIN-VENDOR Widget
ATTRIBUTE Access-Profile-ID 53 uint32
ATTRIBUTE Widget-Flag      54 uint8
ATTRIBUTE Widget-Counter   55 uint64
END-VENDOR Widget
`);
  assert.strictEqual(r.vendors[6527].attributes[53].type, 'integer');
  assert.strictEqual(r.vendors[6527].attributes[54].type, 'integer');
  assert.strictEqual(r.vendors[6527].attributes[55].type, 'integer');

  vendors.register(r.vendors);
  const decode = (vType, hex) => {
    const vid = Buffer.alloc(4); vid.writeUInt32BE(6527, 0);
    const val = Buffer.from(hex, 'hex');
    const sub = Buffer.concat([Buffer.from([vType, 2 + val.length]), val]);
    return packet.decodeVsa(Buffer.concat([vid, sub]))[0].value;
  };
  assert.strictEqual(decode(53, '000001f3'), '499');          // uint32
  assert.strictEqual(decode(54, '07'), '7');                  // uint8
  assert.strictEqual(decode(55, '0000000100000000'), '4294967296'); // uint64
  vendors.reset();
});

// --- register / reset round-trip against the live vendor set ---
ok('register() makes an imported vendor decode by name; reset() removes it', () => {
  const r = parseDictionary(`
VENDOR Acme 64599
BEGIN-VENDOR Acme
ATTRIBUTE Acme-Role 7 string
END-VENDOR Acme
`);
  // Before registering: unknown vendor decodes structurally.
  const vid = Buffer.alloc(4); vid.writeUInt32BE(64599, 0);
  const sub = Buffer.concat([Buffer.from([7, 2 + 4]), Buffer.from('boss', 'utf8')]);
  const vsa = Buffer.concat([vid, sub]);

  let rows = packet.decodeVsa(vsa);
  assert.strictEqual(rows[0].name, 'Vendor-64599-7');

  vendors.register(r.vendors);
  rows = packet.decodeVsa(vsa);
  assert.strictEqual(rows[0].name, 'Acme-Role');
  assert.strictEqual(rows[0].value, 'boss');

  vendors.reset();
  rows = packet.decodeVsa(vsa);
  assert.strictEqual(rows[0].name, 'Vendor-64599-7', 'reset should un-merge imported vendors');

  // Built-ins survive reset.
  assert.strictEqual(vendors.byId(9).name, 'Cisco');
});

console.log(`\n${passed} passed\n`);
