'use strict';

/**
 * A compact RADIUS dictionary covering the standard attributes from
 * RFC 2865 (Authentication) and RFC 2866 (Accounting), which is the set
 * NTRadPing exposed for its "Additional RADIUS Attributes" picker.
 *
 * Each attribute: { id, name, type }
 *   type ∈ 'string' | 'ipaddr' | 'integer' | 'octets' | 'date'
 *
 * Some integer attributes carry named enum VALUEs (e.g. Service-Type).
 */

const ATTRIBUTES = [
  { id: 1, name: 'User-Name', type: 'string' },
  { id: 2, name: 'User-Password', type: 'octets' },
  { id: 3, name: 'CHAP-Password', type: 'octets' },
  { id: 4, name: 'NAS-IP-Address', type: 'ipaddr' },
  { id: 5, name: 'NAS-Port', type: 'integer' },
  { id: 6, name: 'Service-Type', type: 'integer' },
  { id: 7, name: 'Framed-Protocol', type: 'integer' },
  { id: 8, name: 'Framed-IP-Address', type: 'ipaddr' },
  { id: 9, name: 'Framed-IP-Netmask', type: 'ipaddr' },
  { id: 10, name: 'Framed-Routing', type: 'integer' },
  { id: 11, name: 'Filter-Id', type: 'string' },
  { id: 12, name: 'Framed-MTU', type: 'integer' },
  { id: 13, name: 'Framed-Compression', type: 'integer' },
  { id: 14, name: 'Login-IP-Host', type: 'ipaddr' },
  { id: 15, name: 'Login-Service', type: 'integer' },
  { id: 16, name: 'Login-TCP-Port', type: 'integer' },
  { id: 18, name: 'Reply-Message', type: 'string' },
  { id: 19, name: 'Callback-Number', type: 'string' },
  { id: 20, name: 'Callback-Id', type: 'string' },
  { id: 22, name: 'Framed-Route', type: 'string' },
  { id: 23, name: 'Framed-IPX-Network', type: 'integer' },
  { id: 24, name: 'State', type: 'octets' },
  { id: 25, name: 'Class', type: 'octets' },
  { id: 26, name: 'Vendor-Specific', type: 'octets' },
  { id: 27, name: 'Session-Timeout', type: 'integer' },
  { id: 28, name: 'Idle-Timeout', type: 'integer' },
  { id: 29, name: 'Termination-Action', type: 'integer' },
  { id: 30, name: 'Called-Station-Id', type: 'string' },
  { id: 31, name: 'Calling-Station-Id', type: 'string' },
  { id: 32, name: 'NAS-Identifier', type: 'string' },
  { id: 33, name: 'Proxy-State', type: 'octets' },
  { id: 34, name: 'Login-LAT-Service', type: 'string' },
  { id: 35, name: 'Login-LAT-Node', type: 'string' },
  { id: 36, name: 'Login-LAT-Group', type: 'octets' },
  { id: 37, name: 'Framed-AppleTalk-Link', type: 'integer' },
  { id: 38, name: 'Framed-AppleTalk-Network', type: 'integer' },
  { id: 39, name: 'Framed-AppleTalk-Zone', type: 'string' },
  { id: 40, name: 'Acct-Status-Type', type: 'integer' },
  { id: 41, name: 'Acct-Delay-Time', type: 'integer' },
  { id: 42, name: 'Acct-Input-Octets', type: 'integer' },
  { id: 43, name: 'Acct-Output-Octets', type: 'integer' },
  { id: 44, name: 'Acct-Session-Id', type: 'string' },
  { id: 45, name: 'Acct-Authentic', type: 'integer' },
  { id: 46, name: 'Acct-Session-Time', type: 'integer' },
  { id: 47, name: 'Acct-Input-Packets', type: 'integer' },
  { id: 48, name: 'Acct-Output-Packets', type: 'integer' },
  { id: 49, name: 'Acct-Terminate-Cause', type: 'integer' },
  { id: 50, name: 'Acct-Multi-Session-Id', type: 'string' },
  { id: 51, name: 'Acct-Link-Count', type: 'integer' },
  { id: 60, name: 'CHAP-Challenge', type: 'octets' },
  { id: 61, name: 'NAS-Port-Type', type: 'integer' },
  { id: 62, name: 'Port-Limit', type: 'integer' },
  { id: 63, name: 'Login-LAT-Port', type: 'string' },
  { id: 77, name: 'Connect-Info', type: 'string' },
  { id: 87, name: 'NAS-Port-Id', type: 'string' },
  { id: 95, name: 'NAS-IPv6-Address', type: 'octets' },
  { id: 80, name: 'Message-Authenticator', type: 'octets' }
];

// Named enum values for integer attributes: { [attrName]: { NAME: number } }
const VALUES = {
  'Service-Type': {
    'Login-User': 1,
    'Framed-User': 2,
    'Callback-Login-User': 3,
    'Callback-Framed-User': 4,
    'Outbound-User': 5,
    'Administrative-User': 6,
    'NAS-Prompt-User': 7,
    'Authenticate-Only': 8,
    'Callback-NAS-Prompt': 9,
    'Call-Check': 10,
    'Callback-Administrative': 11
  },
  'Framed-Protocol': {
    'PPP': 1,
    'SLIP': 2,
    'ARAP': 3,
    'Gandalf-SLML': 4,
    'Xylogics-IPX-SLIP': 5,
    'X.75-Synchronous': 6
  },
  'Framed-Compression': {
    'None': 0,
    'Van-Jacobson-TCP-IP': 1,
    'IPX-Header-Compression': 2,
    'Stac-LZS': 3
  },
  'Login-Service': {
    'Telnet': 0,
    'Rlogin': 1,
    'TCP-Clear': 2,
    'PortMaster': 3,
    'LAT': 4
  },
  'Acct-Status-Type': {
    'Start': 1,
    'Stop': 2,
    'Interim-Update': 3,
    'Accounting-On': 7,
    'Accounting-Off': 8
  },
  'Acct-Authentic': {
    'RADIUS': 1,
    'Local': 2,
    'Remote': 3
  },
  'Acct-Terminate-Cause': {
    'User-Request': 1,
    'Lost-Carrier': 2,
    'Lost-Service': 3,
    'Idle-Timeout': 4,
    'Session-Timeout': 5,
    'Admin-Reset': 6,
    'Admin-Reboot': 7,
    'Port-Error': 8,
    'NAS-Error': 9,
    'NAS-Request': 10,
    'NAS-Reboot': 11
  },
  'NAS-Port-Type': {
    'Async': 0,
    'Sync': 1,
    'ISDN-Sync': 2,
    'ISDN-Async-V.120': 3,
    'ISDN-Async-V.110': 4,
    'Virtual': 5,
    'PIAFS': 6,
    'HDLC-Clear-Channel': 7,
    'X.25': 8,
    'X.75': 9,
    'G.3-Fax': 10,
    'SDSL': 11,
    'ADSL-CAP': 12,
    'ADSL-DMT': 13,
    'IDSL': 14,
    'Ethernet': 15,
    'xDSL': 16,
    'Cable': 17,
    'Wireless-Other': 18,
    'Wireless-802.11': 19
  },
  'Termination-Action': {
    'Default': 0,
    'RADIUS-Request': 1
  },
  'Framed-Routing': {
    'None': 0,
    'Broadcast': 1,
    'Listen': 2,
    'Broadcast-Listen': 3
  }
};

// RADIUS packet codes.
const CODES = {
  1: 'Access-Request',
  2: 'Access-Accept',
  3: 'Access-Reject',
  4: 'Accounting-Request',
  5: 'Accounting-Response',
  11: 'Access-Challenge',
  12: 'Status-Server',
  13: 'Status-Client'
};

// Fast lookup maps.
const byId = new Map(ATTRIBUTES.map((a) => [a.id, a]));
const byName = new Map(ATTRIBUTES.map((a) => [a.name.toLowerCase(), a]));

function attrById(id) {
  return byId.get(id) || null;
}

function attrByName(name) {
  return byName.get(String(name).toLowerCase()) || null;
}

function valueName(attrName, num) {
  const map = VALUES[attrName];
  if (!map) return null;
  for (const [name, n] of Object.entries(map)) {
    if (n === num) return name;
  }
  return null;
}

function resolveValueNumber(attrName, raw) {
  const map = VALUES[attrName];
  if (map && Object.prototype.hasOwnProperty.call(map, raw)) {
    return map[raw];
  }
  return null;
}

module.exports = {
  ATTRIBUTES,
  VALUES,
  CODES,
  attrById,
  attrByName,
  valueName,
  resolveValueNumber
};
