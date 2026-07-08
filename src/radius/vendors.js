'use strict';

/**
 * Vendor dictionary for decoding Vendor-Specific Attributes (attr 26).
 *
 *   vendorId -> { name, attributes: { vendorType -> { name, type } } }
 *   type ∈ 'string' | 'integer' | 'ipaddr' | 'octets'
 *
 * A frozen set of BUILTINS covers the vendors most commonly seen in
 * authentication testing. User-imported dictionaries are layered on top via
 * register(); reset() drops back to the built-ins so a removed dictionary can
 * be un-merged by re-applying the remaining ones.
 *
 * Any vendor / sub-attribute not present here is still decoded structurally
 * (vendor id + sub-type + value) by the packet decoder — the dictionary only
 * adds friendly names and value typing on top of that.
 */

const BUILTINS = {
  9: {
    name: 'Cisco',
    attributes: {
      1: { name: 'Cisco-AVPair', type: 'string' },
      2: { name: 'Cisco-NAS-Port', type: 'string' },
      21: { name: 'Cisco-Abort-Cause', type: 'string' },
      23: { name: 'Cisco-Remote-Address', type: 'string' },
      24: { name: 'Cisco-Command-Code', type: 'octets' }
    }
  },
  311: {
    name: 'Microsoft',
    attributes: {
      1: { name: 'MS-CHAP-Response', type: 'octets' },
      2: { name: 'MS-CHAP-Error', type: 'string' },
      7: { name: 'MS-MPPE-Encryption-Policy', type: 'integer' },
      8: { name: 'MS-MPPE-Encryption-Types', type: 'integer' },
      10: { name: 'MS-CHAP-Domain', type: 'string' },
      11: { name: 'MS-CHAP-Challenge', type: 'octets' },
      12: { name: 'MS-CHAP-MPPE-Keys', type: 'octets' },
      16: { name: 'MS-MPPE-Send-Key', type: 'octets' },
      17: { name: 'MS-MPPE-Recv-Key', type: 'octets' },
      25: { name: 'MS-CHAP2-Response', type: 'octets' },
      26: { name: 'MS-CHAP2-Success', type: 'octets' },
      28: { name: 'MS-Primary-DNS-Server', type: 'ipaddr' },
      29: { name: 'MS-Secondary-DNS-Server', type: 'ipaddr' }
    }
  },
  2636: {
    name: 'Juniper',
    attributes: {
      1: { name: 'Juniper-Local-User-Name', type: 'string' },
      2: { name: 'Juniper-Allow-Commands', type: 'string' },
      3: { name: 'Juniper-Deny-Commands', type: 'string' }
    }
  },
  12356: {
    name: 'Fortinet',
    attributes: {
      1: { name: 'Fortinet-Group-Name', type: 'string' },
      2: { name: 'Fortinet-Client-IP-Address', type: 'ipaddr' },
      3: { name: 'Fortinet-Vdom-Name', type: 'string' },
      10: { name: 'Fortinet-Access-Profile', type: 'string' }
    }
  },
  14823: {
    name: 'Aruba',
    attributes: {
      1: { name: 'Aruba-User-Role', type: 'string' },
      2: { name: 'Aruba-User-Vlan', type: 'integer' },
      3: { name: 'Aruba-Priv-Admin-User', type: 'integer' },
      4: { name: 'Aruba-Admin-Role', type: 'string' },
      6: { name: 'Aruba-Essid-Name', type: 'string' }
    }
  },
  14988: {
    name: 'MikroTik',
    attributes: {
      1: { name: 'Mikrotik-Recv-Limit', type: 'integer' },
      2: { name: 'Mikrotik-Xmit-Limit', type: 'integer' },
      3: { name: 'Mikrotik-Group', type: 'string' },
      8: { name: 'Mikrotik-Rate-Limit', type: 'string' },
      10: { name: 'Mikrotik-Realm', type: 'string' },
      11: { name: 'Mikrotik-Address-List', type: 'string' },
      17: { name: 'Mikrotik-Recv-Limit-Gigawords', type: 'integer' },
      18: { name: 'Mikrotik-Xmit-Limit-Gigawords', type: 'integer' }
    }
  },
  14122: {
    name: 'WISPr',
    attributes: {
      1: { name: 'WISPr-Location-ID', type: 'string' },
      2: { name: 'WISPr-Location-Name', type: 'string' },
      3: { name: 'WISPr-Logoff-URL', type: 'string' },
      4: { name: 'WISPr-Redirection-URL', type: 'string' },
      7: { name: 'WISPr-Bandwidth-Max-Up', type: 'integer' },
      8: { name: 'WISPr-Bandwidth-Max-Down', type: 'integer' }
    }
  }
};

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

// The live, merged working set. Starts as a copy of the built-ins.
let vendors = clone(BUILTINS);

function byId(vendorId) {
  return vendors[vendorId] || null;
}

/**
 * Merge additional vendor definitions on top of the current set (used by
 * imported dictionaries). Later registrations win per sub-attribute.
 */
function register(defs) {
  for (const [id, def] of Object.entries(defs || {})) {
    const existing = vendors[id];
    if (!existing) {
      vendors[id] = { name: def.name || `Vendor-${id}`, attributes: { ...(def.attributes || {}) } };
    } else {
      if (def.name) existing.name = def.name;
      Object.assign(existing.attributes, def.attributes || {});
    }
  }
}

// Drop all imported definitions, back to the built-ins.
function reset() {
  vendors = clone(BUILTINS);
}

// Names of the built-in vendors (for display in the UI).
function builtinNames() {
  return Object.values(BUILTINS).map((v) => v.name);
}

module.exports = { BUILTINS, byId, register, reset, builtinNames };
