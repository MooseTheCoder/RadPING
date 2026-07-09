'use strict';

/**
 * Minimal version comparison for the GitHub-release update check.
 * Compares dotted numeric versions, ignoring a leading "v" and any
 * pre-release/build suffix (e.g. "1.2.0-beta.1" is treated as "1.2.0").
 */

function normalize(v) {
  return String(v || '').trim().replace(/^v/i, '').split(/[-+]/)[0];
}

/** Returns 1 if a > b, -1 if a < b, 0 if equal. */
function compareVersions(a, b) {
  const pa = normalize(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = normalize(b).split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

/** True when `latest` is a strictly newer version than `current`. */
function isNewer(latest, current) {
  return compareVersions(latest, current) > 0;
}

module.exports = { normalize, compareVersions, isNewer };
