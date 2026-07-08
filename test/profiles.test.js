'use strict';

/* Profile store tests. Run with: node test/profiles.test.js */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createProfileStore } = require('../src/store/profiles');

let passed = 0;
function ok(name, fn) { fn(); passed++; console.log(`  ✓ ${name}`); }

function tmpFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'radping-')), 'profiles.json');
}

console.log('Profile store tests');

ok('empty store lists nothing', () => {
  const store = createProfileStore(tmpFile());
  assert.deepStrictEqual(store.list(), []);
});

ok('save creates a profile with an id', () => {
  const store = createProfileStore(tmpFile());
  const p = store.save({ name: 'Lab', server: '10.0.0.1', port: 1812, secret: 's3cret', timeout: 5, retries: 2 });
  assert.ok(p.id, 'should have an id');
  assert.strictEqual(p.name, 'Lab');
  assert.strictEqual(p.server, '10.0.0.1');
  assert.strictEqual(p.retries, 2);
  assert.strictEqual(store.list().length, 1);
});

ok('save upserts by name (case-insensitive)', () => {
  const store = createProfileStore(tmpFile());
  const a = store.save({ name: 'Prod', server: '1.1.1.1', secret: 'x' });
  const b = store.save({ name: 'prod', server: '2.2.2.2', secret: 'y' });
  assert.strictEqual(a.id, b.id, 'same name updates the same profile');
  assert.strictEqual(store.list().length, 1);
  assert.strictEqual(store.list()[0].server, '2.2.2.2');
});

ok('distinct names create distinct profiles', () => {
  const store = createProfileStore(tmpFile());
  store.save({ name: 'A', server: 'a', secret: '1' });
  store.save({ name: 'B', server: 'b', secret: '2' });
  assert.strictEqual(store.list().length, 2);
});

ok('remove deletes by id', () => {
  const store = createProfileStore(tmpFile());
  const p = store.save({ name: 'Temp', server: 'x', secret: '1' });
  const res = store.remove(p.id);
  assert.strictEqual(res.removed, 1);
  assert.strictEqual(store.list().length, 0);
});

ok('save requires a name', () => {
  const store = createProfileStore(tmpFile());
  assert.throws(() => store.save({ name: '   ', server: 'x' }), /name is required/i);
});

ok('persists across store instances (same file)', () => {
  const file = tmpFile();
  createProfileStore(file).save({ name: 'Keep', server: 'k', port: 1812, secret: 'pw' });
  const reopened = createProfileStore(file);
  assert.strictEqual(reopened.list().length, 1);
  assert.strictEqual(reopened.list()[0].name, 'Keep');
});

ok('port/timeout/retries are clamped to sane values', () => {
  const store = createProfileStore(tmpFile());
  const p = store.save({ name: 'Clamp', server: 's', secret: 'x', port: 999999, timeout: -3, retries: 5000 });
  assert.strictEqual(p.port, 65535);
  assert.strictEqual(p.timeout, 1);
  assert.strictEqual(p.retries, 100);
});

ok('cipher encrypts secret on disk, decrypts in memory', () => {
  const file = tmpFile();
  // A trivial reversible "cipher" for the test.
  const cipher = {
    encrypt: (s) => 'ENC(' + Buffer.from(s, 'utf8').toString('base64') + ')',
    decrypt: (s) => Buffer.from(String(s).replace(/^ENC\(|\)$/g, ''), 'base64').toString('utf8')
  };
  const store = createProfileStore(file, cipher);
  store.save({ name: 'Sec', server: 's', secret: 'topsecret' });

  // On disk the secret must be ciphertext, never plaintext.
  const onDisk = fs.readFileSync(file, 'utf8');
  assert.ok(!onDisk.includes('topsecret'), 'plaintext secret must not be on disk');
  assert.ok(onDisk.includes('ENC('), 'secret should be encrypted on disk');

  // In memory it round-trips back to plaintext.
  assert.strictEqual(store.list()[0].secret, 'topsecret');
});

ok('corrupt file is treated as empty, not fatal', () => {
  const file = tmpFile();
  fs.writeFileSync(file, '{ this is not json');
  const store = createProfileStore(file);
  assert.deepStrictEqual(store.list(), []);
  // and is recoverable by saving
  store.save({ name: 'Recover', server: 'r', secret: '1' });
  assert.strictEqual(store.list().length, 1);
});

console.log(`\n${passed} passed\n`);
