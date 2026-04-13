// __mocks__/expo-crypto.js
'use strict';

const { createHash } = require('crypto');

module.exports = {
  digestStringAsync: jest.fn(async (algorithm, data) => {
    const algo = algorithm.replace('SHA-', 'sha').toLowerCase();
    return createHash(algo).update(data).digest('hex');
  }),
  getRandomBytesAsync: jest.fn(async (byteCount) => {
    const { randomBytes } = require('crypto');
    return new Uint8Array(randomBytes(byteCount));
  }),
  CryptoDigestAlgorithm: {
    SHA1: 'SHA-1',
    SHA256: 'SHA-256',
    SHA384: 'SHA-384',
    SHA512: 'SHA-512',
    MD5: 'MD5',
  },
  CryptoEncoding: {
    HEX: 'hex',
    BASE64: 'base64',
  },
};