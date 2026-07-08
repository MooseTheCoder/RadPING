'use strict';

/**
 * A parser for FreeRADIUS-format dictionary files, scoped to what RadPING needs
 * for Vendor-Specific Attribute decoding: VENDOR declarations and the vendor
 * ATTRIBUTE definitions inside them.
 *
 * Supported syntax:
 *   VENDOR       <name> <id> [format=...]
 *   BEGIN-VENDOR <name>
 *     ATTRIBUTE  <name> <subtype>        <type> [flags...]
 *   END-VENDOR   <name>
 *   ATTRIBUTE    <name> <subtype>        <type> <vendor-name>   (old 4-column form)
 *   ATTRIBUTE    <name> 26.<vid>.<subtype> <type>               (OID form)
 *   VALUE        <attr> <name> <number>                          (enum values)
 *   $INCLUDE     <file>                                          (if a resolver is given)
 *   # comments and blank lines are ignored.
 *
 * Base (non-vendor) attributes are intentionally ignored — RadPING ships its own
 * standard dictionary and this parser only augments vendor decoding.
 *
 * Returns: { vendors, vendorCount, attrCount, valueCount, warnings }
 *   vendors: { [vendorId]: { name, attributes: { [subType]: { name, type } } } }
 */
function parseDictionary(text, options = {}) {
  const resolveInclude = typeof options.resolveInclude === 'function' ? options.resolveInclude : null;

  const vendors = {};                 // id -> { name, attributes }
  const vendorIdByName = {};          // lowercased name -> id
  const warnings = [];
  const vendorStack = [];             // BEGIN-VENDOR / END-VENDOR nesting
  let attrCount = 0;
  let valueCount = 0;

  function warn(msg) {
    if (warnings.length < 100) warnings.push(msg);
  }

  function ensureVendor(id, name) {
    if (!vendors[id]) vendors[id] = { name: name || `Vendor-${id}`, attributes: {} };
    else if (name) vendors[id].name = name;
    return vendors[id];
  }

  function currentVendorId() {
    for (let i = vendorStack.length - 1; i >= 0; i--) {
      if (vendorStack[i] != null) return vendorStack[i];
    }
    return null;
  }

  function process(body, depth) {
    if (depth > 16) {
      warn('Stopped: $INCLUDE nested too deeply');
      return;
    }
    for (const rawLine of body.split(/\r?\n/)) {
      const line = rawLine.replace(/#.*$/, '').trim();
      if (!line) continue;
      const parts = line.split(/\s+/);
      const kw = parts[0].toUpperCase();

      switch (kw) {
        case 'VENDOR': {
          const name = parts[1];
          const id = parseInt(parts[2], 10);
          if (name && Number.isInteger(id)) {
            vendorIdByName[name.toLowerCase()] = id;
            ensureVendor(id, name);
          } else {
            warn(`Ignored malformed VENDOR line: "${line}"`);
          }
          break;
        }
        case 'BEGIN-VENDOR': {
          const id = vendorIdByName[(parts[1] || '').toLowerCase()];
          if (id === undefined) warn(`BEGIN-VENDOR for undeclared vendor "${parts[1]}"`);
          vendorStack.push(id === undefined ? null : id);
          break;
        }
        case 'END-VENDOR':
          vendorStack.pop();
          break;
        case 'ATTRIBUTE':
          parseAttribute(parts, line);
          break;
        case 'VALUE':
          if (parts.length >= 4) valueCount++;
          break;
        case '$INCLUDE': {
          if (!resolveInclude) { warn(`$INCLUDE not resolved: "${parts[1]}"`); break; }
          const included = resolveInclude(parts[1]);
          if (included != null) process(included, depth + 1);
          else warn(`Could not read $INCLUDE "${parts[1]}"`);
          break;
        }
        default:
          // BEGIN-PROTOCOL, FLAGS, ATTRIBUTE nested TLVs, etc. — not needed here.
          break;
      }
    }
  }

  function parseAttribute(parts, line) {
    const name = parts[1];
    const oid = parts[2];
    const rawType = (parts[3] || '').toLowerCase();
    if (!name || !oid || !rawType) {
      warn(`Ignored malformed ATTRIBUTE line: "${line}"`);
      return;
    }

    let vendorId;
    let subType;

    if (oid.indexOf('.') >= 0) {
      const segs = oid.split('.');
      if (segs.length === 3 && segs[0] === '26') {
        vendorId = parseInt(segs[1], 10);
        subType = parseInt(segs[2], 10);
      } else {
        return; // base OID or nested TLV — out of scope
      }
    } else {
      subType = parseInt(oid, 10);
      vendorId = currentVendorId();
      if (vendorId == null && parts[4]) {
        // Old 4-column form: ATTRIBUTE name subtype type <vendor-name>
        const byName = vendorIdByName[parts[4].toLowerCase()];
        if (byName !== undefined) vendorId = byName;
      }
      if (vendorId == null) return; // a base attribute — ignored
    }

    if (!Number.isInteger(vendorId) || !Number.isInteger(subType)) {
      warn(`Ignored ATTRIBUTE with bad number: "${line}"`);
      return;
    }

    ensureVendor(vendorId).attributes[subType] = { name, type: mapType(rawType) };
    attrCount++;
  }

  process(String(text || ''), 0);

  return {
    vendors,
    vendorCount: Object.keys(vendors).length,
    attrCount,
    valueCount,
    warnings
  };
}

// Map FreeRADIUS attribute types onto the four RadPING display types.
function mapType(t) {
  switch (t) {
    case 'string':
    case 'text':
      return 'string';
    case 'ipaddr':
    case 'ipv4addr':
      return 'ipaddr';
    // Integer family. Legacy FreeRADIUS names (integer, byte, short) and the
    // modern fixed-width names (uint8/16/32/64, int8/16/32/64) all decode as
    // an unsigned integer of their byte width.
    case 'integer':
    case 'integer64':
    case 'byte':
    case 'short':
    case 'signed':
    case 'time_delta':
    case 'bool':
    case 'uint8':
    case 'uint16':
    case 'uint32':
    case 'uint64':
    case 'int8':
    case 'int16':
    case 'int32':
    case 'int64':
      return 'integer';
    case 'date':
      return 'date';
    default:
      return 'octets'; // octets, ipv6addr, ether, tlv, struct, abinary, …
  }
}

module.exports = { parseDictionary, mapType };
