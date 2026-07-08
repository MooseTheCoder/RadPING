'use strict';

const crypto = require('crypto');
const dict = require('./dictionary');
const vendors = require('./vendors');

/**
 * RADIUS packet encoding / decoding (RFC 2865 §3).
 *
 *   0                   1                   2                   3
 *   0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
 *  +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
 *  |     Code      |  Identifier   |            Length             |
 *  +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
 *  |                         Authenticator ...                     |
 *  +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
 *  |  Attributes ...
 */

function md5(...buffers) {
  const h = crypto.createHash('md5');
  for (const b of buffers) h.update(b);
  return h.digest();
}

/**
 * Encrypt a User-Password per RFC 2865 §5.2 (the "hidden" PAP algorithm).
 * Returns a buffer whose length is a multiple of 16.
 */
function encryptUserPassword(password, secret, requestAuthenticator) {
  const secretBuf = Buffer.from(secret, 'utf8');
  let pass = Buffer.from(password, 'utf8');

  // Pad to a multiple of 16 with null bytes (min length 16).
  const padLen = Math.max(16, Math.ceil(pass.length / 16) * 16);
  const padded = Buffer.alloc(padLen, 0);
  pass.copy(padded);

  const result = Buffer.alloc(padLen);
  let last = requestAuthenticator;
  for (let i = 0; i < padLen; i += 16) {
    const b = md5(secretBuf, last);
    const chunk = Buffer.alloc(16);
    for (let j = 0; j < 16; j++) {
      chunk[j] = padded[i + j] ^ b[j];
    }
    chunk.copy(result, i);
    last = chunk; // c(i) feeds the next block
  }
  return result;
}

/**
 * Build a CHAP-Password value (RFC 2865 §5.3): CHAP-Ident || MD5(Ident || password || challenge).
 */
function buildChapPassword(password, chapIdent, challenge) {
  const digest = md5(
    Buffer.from([chapIdent]),
    Buffer.from(password, 'utf8'),
    challenge
  );
  return Buffer.concat([Buffer.from([chapIdent]), digest]);
}

/**
 * Encode one attribute's value from a string per the dictionary type.
 * Returns a Buffer, or throws on malformed input.
 */
function encodeValue(type, attrName, raw) {
  switch (type) {
    case 'string':
      return Buffer.from(raw, 'utf8');

    case 'ipaddr': {
      const parts = String(raw).trim().split('.');
      if (parts.length !== 4) throw new Error(`Invalid IPv4 address: "${raw}"`);
      const buf = Buffer.alloc(4);
      for (let i = 0; i < 4; i++) {
        const n = Number(parts[i]);
        if (!Number.isInteger(n) || n < 0 || n > 255) {
          throw new Error(`Invalid IPv4 address: "${raw}"`);
        }
        buf[i] = n;
      }
      return buf;
    }

    case 'integer':
    case 'date': {
      let n = dict.resolveValueNumber(attrName, raw);
      if (n === null) {
        n = Number(raw);
        if (!Number.isInteger(n) || n < 0) {
          throw new Error(`Invalid integer for ${attrName}: "${raw}"`);
        }
      }
      const buf = Buffer.alloc(4);
      buf.writeUInt32BE(n >>> 0, 0);
      return buf;
    }

    case 'octets':
    default: {
      // Accept hex (with optional 0x / spaces / colons) or fall back to raw string bytes.
      const cleaned = String(raw).replace(/^0x/i, '').replace(/[\s:]/g, '');
      if (cleaned.length > 0 && cleaned.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(cleaned)) {
        return Buffer.from(cleaned, 'hex');
      }
      return Buffer.from(raw, 'utf8');
    }
  }
}

/**
 * Encode a single Type-Length-Value attribute. Splits values longer than
 * 253 bytes into repeated attributes of the same type (RFC 2865 allows this).
 */
function encodeAttribute(typeId, valueBuf) {
  const chunks = [];
  let offset = 0;
  do {
    const slice = valueBuf.subarray(offset, offset + 253);
    const attr = Buffer.alloc(2 + slice.length);
    attr[0] = typeId;
    attr[1] = 2 + slice.length;
    slice.copy(attr, 2);
    chunks.push(attr);
    offset += 253;
  } while (offset < valueBuf.length);
  return Buffer.concat(chunks);
}

/**
 * Build a request packet.
 *
 * @param {object} opts
 * @param {number} opts.code           packet code (1 = Access-Request, 4 = Accounting-Request)
 * @param {number} opts.identifier     1-byte id
 * @param {string} opts.secret         shared secret
 * @param {Array}  opts.attributes     [{ id, value(Buffer) }]  already-encoded attribute values
 * @param {Buffer} [opts.authenticator] for Access-Request, the 16-byte Request
 *                                       Authenticator that the password was hidden
 *                                       with (must match). Ignored for accounting.
 * @returns {{ buffer: Buffer, authenticator: Buffer }}
 */
function buildRequest({ code, identifier, secret, attributes, authenticator: providedAuth }) {
  const attrBufs = attributes.map((a) => encodeAttribute(a.id, a.value));
  const attrBuf = Buffer.concat(attrBufs);
  const length = 20 + attrBuf.length;

  let authenticator;
  const header = Buffer.alloc(20);
  header[0] = code;
  header[1] = identifier & 0xff;
  header.writeUInt16BE(length, 2);

  if (code === 4 || code === 5) {
    // Accounting-Request: authenticator = MD5(Code+ID+Length+16 zero bytes+Attributes+Secret).
    const zero = Buffer.alloc(16, 0);
    zero.copy(header, 4);
    authenticator = md5(
      header.subarray(0, 4),
      zero,
      attrBuf,
      Buffer.from(secret, 'utf8')
    );
    authenticator.copy(header, 4);
  } else {
    // Access-Request: authenticator = 16 random bytes. Reuse the one the
    // password was hidden with so encryption and packet stay consistent.
    authenticator = providedAuth || crypto.randomBytes(16);
    authenticator.copy(header, 4);
  }

  return { buffer: Buffer.concat([header, attrBuf]), authenticator };
}

/**
 * Decode a received packet into a structured object, and validate the
 * Response Authenticator against the request we sent.
 */
function decodeResponse(buffer, requestAuthenticator, secret) {
  if (buffer.length < 20) throw new Error('Response too short to be a RADIUS packet');

  const code = buffer[0];
  const identifier = buffer[1];
  const length = buffer.readUInt16BE(2);
  const authenticator = buffer.subarray(4, 20);

  const attributes = [];
  let offset = 20;
  const end = Math.min(length, buffer.length);
  while (offset + 2 <= end) {
    const typeId = buffer[offset];
    const attrLen = buffer[offset + 1];
    if (attrLen < 2 || offset + attrLen > end) break;
    const value = buffer.subarray(offset + 2, offset + attrLen);
    if (typeId === 26) {
      // Vendor-Specific: expand the container into its vendor sub-attributes.
      for (const row of decodeVsa(value)) attributes.push(row);
    } else {
      attributes.push(decodeAttribute(typeId, value));
    }
    offset += attrLen;
  }

  // Validate: expected = MD5(Code+ID+Length+RequestAuth+Attributes+Secret).
  const check = md5(
    buffer.subarray(0, 4),
    requestAuthenticator,
    buffer.subarray(20, end),
    Buffer.from(secret, 'utf8')
  );
  const authenticatorValid = check.equals(authenticator);

  return {
    code,
    codeName: dict.CODES[code] || `Unknown (${code})`,
    identifier,
    length,
    authenticatorValid,
    attributes
  };
}

function decodeAttribute(typeId, value) {
  const def = dict.attrById(typeId);
  const name = def ? def.name : `Attribute-${typeId}`;
  const type = def ? def.type : 'octets';

  return {
    id: typeId,
    name,
    type,
    value: decodeTypedValue(name, type, value),
    hex: value.toString('hex')
  };
}

/**
 * Render a raw attribute value as a display string according to its type.
 * Shared by standard attributes and vendor sub-attributes.
 */
function decodeTypedValue(name, type, value) {
  switch (type) {
    case 'string':
      return value.toString('utf8');
    case 'ipaddr':
      return value.length === 4 ? Array.from(value).join('.') : '0x' + value.toString('hex');
    case 'integer':
    case 'date': {
      if (value.length === 4) {
        const n = value.readUInt32BE(0);
        const named = dict.valueName(name, n);
        return named ? `${named} (${n})` : String(n);
      }
      return '0x' + value.toString('hex');
    }
    case 'octets':
    default:
      return '0x' + value.toString('hex');
  }
}

/**
 * Decode a Vendor-Specific attribute (attr 26) value into one row per vendor
 * sub-attribute. The value is a 4-byte Vendor-Id followed by sub-attributes in
 * the standard type/length/value format (RFC 2865 §5.26).
 *
 * If the payload doesn't parse as standard TLV (some vendors use non-standard
 * layouts), it falls back to a single row showing the vendor and raw payload.
 */
function decodeVsa(value) {
  if (value.length < 5) {
    return [{ id: 26, name: 'Vendor-Specific', type: 'octets', value: '0x' + value.toString('hex'), hex: value.toString('hex') }];
  }

  const vendorId = value.readUInt32BE(0);
  const vendor = vendors.byId(vendorId);
  const vendorName = vendor ? vendor.name : `Vendor-${vendorId}`;

  const rows = [];
  let offset = 4;
  let parsedOk = true;
  while (offset + 2 <= value.length) {
    const vType = value[offset];
    const vLen = value[offset + 1];
    if (vLen < 2 || offset + vLen > value.length) {
      parsedOk = false;
      break;
    }
    const vValue = value.subarray(offset + 2, offset + vLen);
    const def = vendor && vendor.attributes[vType];
    const name = def ? def.name : `${vendorName}-${vType}`;
    const type = def ? def.type : 'octets';
    rows.push({
      id: `26/${vType}`,
      vendorId,
      vendorName,
      vendorType: vType,
      name,
      type,
      value: decodeTypedValue(name, type, vValue),
      hex: vValue.toString('hex')
    });
    offset += vLen;
  }

  if (!parsedOk || rows.length === 0) {
    return [{
      id: 26,
      vendorId,
      vendorName,
      name: `${vendorName}-VSA`,
      type: 'octets',
      value: '0x' + value.subarray(4).toString('hex'),
      hex: value.toString('hex')
    }];
  }
  return rows;
}

module.exports = {
  md5,
  encryptUserPassword,
  buildChapPassword,
  encodeValue,
  encodeAttribute,
  buildRequest,
  decodeResponse,
  decodeVsa
};
