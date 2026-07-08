'use strict';

const dgram = require('dgram');
const net = require('net');
const crypto = require('crypto');
const dns = require('dns');
const { promisify } = require('util');
const packet = require('./packet');
const dict = require('./dictionary');

const lookup = promisify(dns.lookup);

let identifierCounter = crypto.randomBytes(1)[0];
function nextIdentifier() {
  identifierCounter = (identifierCounter + 1) & 0xff;
  return identifierCounter;
}

/**
 * Assemble the encoded attribute list for a request from the UI config.
 * Handles User-Name, PAP/CHAP password, and the free-form additional attributes.
 */
function assembleAttributes(config, requestAuthenticator) {
  const attributes = [];

  if (config.username !== undefined && config.username !== '') {
    attributes.push({ id: 1, value: Buffer.from(config.username, 'utf8') });
  }

  // Password handling only applies to Access-Request.
  if (config.code === 1 && config.password) {
    if (config.authMethod === 'chap') {
      const chapIdent = crypto.randomBytes(1)[0];
      // Use the Request Authenticator as the CHAP challenge (RFC 2865 §2.2).
      const chapPassword = packet.buildChapPassword(
        config.password,
        chapIdent,
        requestAuthenticator
      );
      attributes.push({ id: 3, value: chapPassword }); // CHAP-Password
    } else {
      const enc = packet.encryptUserPassword(
        config.password,
        config.secret,
        requestAuthenticator
      );
      attributes.push({ id: 2, value: enc }); // User-Password
    }
  }

  // Additional attributes from the UI (each { name/id, value }).
  for (const extra of config.attributes || []) {
    let def = null;
    if (extra.id !== undefined && extra.id !== null && extra.id !== '') {
      def = dict.attrById(Number(extra.id));
    }
    if (!def && extra.name) {
      def = dict.attrByName(extra.name);
    }
    if (!def) continue;

    const valueBuf = packet.encodeValue(def.type, def.name, extra.value);
    attributes.push({ id: def.id, value: valueBuf });
  }

  return attributes;
}

async function resolveHost(host) {
  if (net.isIP(host)) return { address: host, family: net.isIP(host) };
  const res = await lookup(host);
  return { address: res.address, family: res.family };
}

/**
 * Send a RADIUS request and wait for a reply, retrying on timeout.
 *
 * @param {object} config
 * @param {string} config.server
 * @param {number} config.port
 * @param {string} config.secret
 * @param {number} config.code        1 = Access-Request, 4 = Accounting-Request
 * @param {string} config.authMethod  'pap' | 'chap'
 * @param {string} config.username
 * @param {string} config.password
 * @param {number} config.timeout     seconds to wait per attempt
 * @param {number} config.retries     number of resends after the first attempt
 * @param {Array}  config.attributes  additional attributes
 * @returns {Promise<object>}         structured result
 */
async function send(config) {
  const startedAll = Date.now();
  const identifier = nextIdentifier();

  const resolved = await resolveHost(config.server);

  // The User-Password / CHAP-Challenge encoding needs the Request Authenticator,
  // so generate it up front and hand the same value to buildRequest. For an
  // Access-Request the authenticator is random and independent of the attributes.
  // For an Accounting-Request the authenticator is derived from the attributes, so
  // we assemble with a zero placeholder and let buildRequest compute the real one.
  const authenticator =
    config.code === 4 ? Buffer.alloc(16, 0) : crypto.randomBytes(16);

  const attributes = assembleAttributes(config, authenticator);

  const built = packet.buildRequest({
    code: config.code,
    identifier,
    secret: config.secret,
    attributes,
    authenticator
  });

  const timeoutMs = Math.max(1, Number(config.timeout) || 5) * 1000;
  const maxAttempts = Math.max(0, Number(config.retries) || 0) + 1;

  const socket = dgram.createSocket(resolved.family === 6 ? 'udp6' : 'udp4');
  const attemptsLog = [];

  const cleanup = () => {
    try { socket.close(); } catch (_) { /* already closed */ }
  };

  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const attemptStart = Date.now();
      const reply = await sendOnce(
        socket,
        built.buffer,
        resolved.address,
        config.port,
        timeoutMs
      );

      if (reply) {
        const rttMs = Date.now() - attemptStart;
        const decoded = packet.decodeResponse(
          reply,
          built.authenticator,
          config.secret
        );
        attemptsLog.push({ attempt, timedOut: false, rttMs });
        return {
          ok: true,
          request: {
            code: config.code,
            codeName: dict.CODES[config.code],
            identifier,
            server: `${resolved.address}:${config.port}`,
            lengthBytes: built.buffer.length,
            hex: built.buffer.toString('hex')
          },
          response: {
            ...decoded,
            hex: reply.toString('hex')
          },
          attempts: attemptsLog,
          totalMs: Date.now() - startedAll
        };
      }

      attemptsLog.push({ attempt, timedOut: true, rttMs: Date.now() - attemptStart });
    }

    return {
      ok: false,
      error: `No response after ${maxAttempts} attempt${maxAttempts === 1 ? '' : 's'} (timeout ${config.timeout}s).`,
      request: {
        code: config.code,
        codeName: dict.CODES[config.code],
        identifier,
        server: `${resolved.address}:${config.port}`,
        lengthBytes: built.buffer.length,
        hex: built.buffer.toString('hex')
      },
      attempts: attemptsLog,
      totalMs: Date.now() - startedAll
    };
  } finally {
    cleanup();
  }
}

function sendOnce(socket, buffer, address, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      socket.removeListener('message', onMessage);
      socket.removeListener('error', onError);
      resolve(null); // timed out
    }, timeoutMs);

    const onMessage = (msg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.removeListener('message', onMessage);
      socket.removeListener('error', onError);
      resolve(msg);
    };

    const onError = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.removeListener('message', onMessage);
      socket.removeListener('error', onError);
      reject(err);
    };

    socket.on('message', onMessage);
    socket.on('error', onError);
    socket.send(buffer, 0, buffer.length, port, address, (err) => {
      if (err && !settled) {
        settled = true;
        clearTimeout(timer);
        socket.removeListener('message', onMessage);
        socket.removeListener('error', onError);
        reject(err);
      }
    });
  });
}

module.exports = { send };
