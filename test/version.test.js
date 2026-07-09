'use strict';

/* Version-compare tests. Run with: node test/version.test.js */

const assert = require('assert');
const { compareVersions, isNewer, normalize } = require('../src/util/version');

let passed = 0;
function ok(name, fn) { fn(); passed++; console.log(`  ✓ ${name}`); }

console.log('Version compare tests');

ok('normalize strips leading v and pre-release suffix', () => {
  assert.strictEqual(normalize('v0.1.1'), '0.1.1');
  assert.strictEqual(normalize('V2.0.0'), '2.0.0');
  assert.strictEqual(normalize('1.2.0-beta.1'), '1.2.0');
  assert.strictEqual(normalize('1.2.0+build7'), '1.2.0');
});

ok('compareVersions orders correctly', () => {
  assert.strictEqual(compareVersions('0.1.1', '0.1.0'), 1);
  assert.strictEqual(compareVersions('0.1.0', '0.1.1'), -1);
  assert.strictEqual(compareVersions('1.0.0', '1.0.0'), 0);
  assert.strictEqual(compareVersions('2.0.0', '1.9.9'), 1);
  assert.strictEqual(compareVersions('1.10.0', '1.9.0'), 1); // numeric, not lexical
});

ok('handles v-prefixes and differing segment counts', () => {
  assert.strictEqual(compareVersions('v0.2.0', '0.1.0'), 1);
  assert.strictEqual(compareVersions('1.0', '1.0.0'), 0);
  assert.strictEqual(compareVersions('1.0.1', '1.0'), 1);
});

ok('isNewer reflects the real scenario (v0.1.1 release vs 0.1.0 app)', () => {
  assert.strictEqual(isNewer('v0.1.1', '0.1.0'), true);
  assert.strictEqual(isNewer('0.1.0', '0.1.0'), false);
  assert.strictEqual(isNewer('0.0.9', '0.1.0'), false);
});

console.log(`\n${passed} passed\n`);
