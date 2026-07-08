'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Persists imported vendor dictionaries. Each entry stores the PARSED vendor
 * definitions (not the raw file), so reloading on launch needs no re-parse and
 * no access to $INCLUDE siblings that may no longer be reachable.
 *
 * Entry: { id, name, vendors, vendorCount, attrCount, importedAt }
 */
function createDictionaryStore(filePath) {
  function readAll() {
    let raw;
    try {
      raw = fs.readFileSync(filePath, 'utf8');
    } catch (_) {
      return [];
    }
    try {
      const list = JSON.parse(raw);
      return Array.isArray(list) ? list : [];
    } catch (_) {
      return [];
    }
  }

  function writeAll(list) {
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
    } catch (_) { /* exists */ }
    const tmp = filePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(list, null, 2), 'utf8');
    fs.renameSync(tmp, filePath);
  }

  return {
    /** Full entries, including the parsed `vendors` maps (used at startup). */
    listFull() {
      return readAll();
    },

    /** Lightweight metadata for the UI (omits the bulky vendors map). */
    list() {
      return readAll().map(({ vendors, ...meta }) => meta);
    },

    add(entry) {
      const list = readAll();
      const record = {
        id: crypto.randomUUID(),
        name: String(entry.name || 'dictionary'),
        vendors: entry.vendors || {},
        vendorCount: Number(entry.vendorCount) || 0,
        attrCount: Number(entry.attrCount) || 0,
        importedAt: entry.importedAt || null
      };
      list.push(record);
      writeAll(list);
      const { vendors, ...meta } = record;
      return meta;
    },

    remove(id) {
      const list = readAll();
      const next = list.filter((x) => x.id !== id);
      writeAll(next);
      return { ok: true, removed: list.length - next.length };
    }
  };
}

module.exports = { createDictionaryStore };
