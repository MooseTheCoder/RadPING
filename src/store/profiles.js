'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * A tiny JSON-file profile store for RADIUS server connection details.
 *
 * Each profile: { id, name, server, port, secret, timeout, retries }
 *
 * The store is deliberately Electron-agnostic so it can be unit-tested with
 * plain Node. Secret encryption is injected via an optional `cipher`:
 *   cipher = { encrypt(plaintext) -> string, decrypt(stored) -> plaintext }
 * When provided, secrets are ciphertext on disk and plaintext in memory.
 * When omitted, secrets are stored as-is (plaintext).
 */
function createProfileStore(filePath, cipher) {
  const encrypt = cipher && cipher.encrypt ? cipher.encrypt : (s) => s;
  const decrypt = cipher && cipher.decrypt ? cipher.decrypt : (s) => s;

  function safeDecrypt(stored) {
    if (!stored) return '';
    try {
      return decrypt(stored);
    } catch (_) {
      // Encryption key unavailable / value written under a different scheme.
      return '';
    }
  }

  function readAll() {
    let raw;
    try {
      raw = fs.readFileSync(filePath, 'utf8');
    } catch (_) {
      return []; // no file yet
    }
    let list;
    try {
      list = JSON.parse(raw);
    } catch (_) {
      return []; // corrupt file — treat as empty rather than throwing
    }
    if (!Array.isArray(list)) return [];
    return list.map((p) => ({ ...p, secret: safeDecrypt(p.secret) }));
  }

  function writeAll(list) {
    const onDisk = list.map((p) => ({ ...p, secret: p.secret ? encrypt(p.secret) : '' }));
    const dir = path.dirname(filePath);
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (_) { /* already exists */ }
    const tmp = filePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(onDisk, null, 2), 'utf8');
    fs.renameSync(tmp, filePath); // atomic replace
  }

  function sanitize(p) {
    return {
      name: String((p && p.name) || '').trim(),
      server: String((p && p.server) || '').trim(),
      port: clampInt(p && p.port, 1, 65535, 1812),
      secret: String((p && p.secret) || ''),
      timeout: clampInt(p && p.timeout, 1, 3600, 5),
      retries: clampInt(p && p.retries, 0, 100, 0)
    };
  }

  return {
    list() {
      return readAll();
    },

    /**
     * Upsert by name (case-insensitive): saving over an existing name updates
     * that profile; a new name creates a new one. Returns the saved profile.
     */
    save(input) {
      const p = sanitize(input);
      if (!p.name) throw new Error('Profile name is required');
      const list = readAll();
      const idx = list.findIndex((x) => x.name.toLowerCase() === p.name.toLowerCase());
      if (idx >= 0) {
        list[idx] = { ...list[idx], ...p };
        writeAll(list);
        return list[idx];
      }
      const created = { id: crypto.randomUUID(), ...p };
      list.push(created);
      writeAll(list);
      return created;
    },

    remove(id) {
      const list = readAll();
      const next = list.filter((x) => x.id !== id);
      writeAll(next);
      return { ok: true, removed: list.length - next.length };
    }
  };
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const i = Math.round(n);
  if (i < min) return min;
  if (i > max) return max;
  return i;
}

module.exports = { createProfileStore };
