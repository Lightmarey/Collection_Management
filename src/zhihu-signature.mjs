import { createHash } from 'node:crypto';

const VERSION = '101_3_3.0';
const REQUEST_KIND = 'fetch';
const BLOCK_BYTES = 16;
const INITIAL_MASK = 42;
const KEY = Buffer.from('059053f7d15e01d7', 'utf8');
const SUBSTITUTION = Buffer.from(
  '14dff507f802c2d15706e3fdf080de5bed097d9de65dfccd5a4f90c79fc5baa7' +
  '27259cc6262a2ba8d9990f6750bd47bf6154f75f24450e230cab1c72b29456b6' +
  '20539e6d16ff5eee97554d7cfe12041a7bb0e8c183ac8f8e961e0a92a23ee0d' +
  'ac4e501c0d51b6e38e7b48a6bf2bb3678132c75e4d7cb35effb7f510b8560c' +
  'c8429734937f99366307a916a764abe1d10ae05b1813f71631fa14cf622d30d3' +
  'c44cfa0416f52a543a9e13970f49b33ecc8e93a3d2f6489b9401146eaa3db6c' +
  'aaa63b95346918d44ead2d0074e27788ce87afc3195c79d07e8b034b8d158262' +
  'f1289a42b831b52ef35865b7081748bc68b3d286fac9a459d8cadc32dd988c21' +
  'ebd6',
  'hex',
);
const ROUND_WORDS = Buffer.from(
  '45c629323d15f2fe5442e14feb8921c0d256542eae28cbdef7782b08ee48a8837' +
  '33e8d1ac61cdffbe7c6016a1b713876df5eeb0a8f44a6ca9beb07a37e564e94' +
  '870bcbcb794d026ca54f723affaabf19fb5d9cc3832a8363b5e884fa5e2b60c' +
  'f4ec93b521b3a7714ad0d330ff2551fdf13ab7196d0f96ade15ab9f7d8be5d8' +
  '7b',
  'hex',
);
const OUTPUT_ALPHABET = '6fpLRqJO8M/c3jnYxFkUVC4ZIG12SiH=5v0mXDazWBTsuw7QetbKdoPyAl+hN9rgE';

function rotateLeft(value, bits) {
  return ((value << bits) | (value >>> (32 - bits))) >>> 0;
}

function transformWord(value) {
  const substituted = (
    (SUBSTITUTION[(value >>> 24) & 0xff] << 24)
    | (SUBSTITUTION[(value >>> 16) & 0xff] << 16)
    | (SUBSTITUTION[(value >>> 8) & 0xff] << 8)
    | SUBSTITUTION[value & 0xff]
  ) >>> 0;
  return (
    substituted
    ^ rotateLeft(substituted, 2)
    ^ rotateLeft(substituted, 10)
    ^ rotateLeft(substituted, 18)
    ^ rotateLeft(substituted, 24)
  ) >>> 0;
}

function transformBlock(block) {
  const words = new Uint32Array(36);
  for (let index = 0; index < 4; index += 1) words[index] = block.readUInt32BE(index * 4);
  for (let round = 0; round < 32; round += 1) {
    const roundWord = ROUND_WORDS.readUInt32BE(round * 4);
    words[round + 4] = (words[round] ^ transformWord(words[round + 1] ^ words[round + 2] ^ words[round + 3] ^ roundWord)) >>> 0;
  }
  const output = Buffer.allocUnsafe(BLOCK_BYTES);
  for (let index = 0; index < 4; index += 1) output.writeUInt32BE(words[35 - index], index * 4);
  return output;
}

function encryptDigest(digest, seed = 12) {
  const prefix = Buffer.from([seed, 0]);
  const plain = Buffer.concat([prefix, Buffer.from(digest, 'utf8')]);
  const padding = BLOCK_BYTES - (plain.length % BLOCK_BYTES);
  const padded = Buffer.concat([plain, Buffer.alloc(padding, padding)]);
  const output = Buffer.allocUnsafe(padded.length);
  let previous = null;

  for (let offset = 0; offset < padded.length; offset += BLOCK_BYTES) {
    const block = Buffer.allocUnsafe(BLOCK_BYTES);
    for (let index = 0; index < BLOCK_BYTES; index += 1) {
      block[index] = padded[offset + index] ^ (previous ? previous[index] : KEY[index] ^ INITIAL_MASK);
    }
    previous = transformBlock(block);
    previous.copy(output, offset);
  }
  return output;
}

function encodeCipher(bytes) {
  const paddedLength = Math.ceil(bytes.length / 3) * 3;
  const padded = Buffer.alloc(paddedLength);
  bytes.copy(padded);
  let output = '';
  let byteIndex = 0;

  for (let cursor = padded.length - 1; cursor >= 0; cursor -= 3) {
    const low = padded[cursor] ^ ((58 >>> (8 * (byteIndex++ % 4))) & 0xff);
    const middle = padded[cursor - 1] ^ ((58 >>> (8 * (byteIndex++ % 4))) & 0xff);
    const high = padded[cursor - 2] ^ ((58 >>> (8 * (byteIndex++ % 4))) & 0xff);
    const value = (high << 16) | (middle << 8) | low;
    output += OUTPUT_ALPHABET[value & 63]
      + OUTPUT_ALPHABET[(value >>> 6) & 63]
      + OUTPUT_ALPHABET[(value >>> 12) & 63]
      + OUTPUT_ALPHABET[(value >>> 18) & 63];
  }
  return output;
}


function signatureValue(finalUrl, dC0, seed) {
  const url = new URL(finalUrl);
  const requestTarget = `${url.pathname}${url.search}`;
  const digest = createHash('md5').update(`${VERSION}+${requestTarget}+${dC0}`).digest('hex');
  return `2.0_${encodeCipher(encryptDigest(digest, seed))}`;
}

export function signZhihuRequest(finalUrl, dC0, xsrfToken) {
  if (typeof dC0 !== 'string' || dC0.length === 0) throw new TypeError('d_c0 is required');
  if (xsrfToken !== undefined && (typeof xsrfToken !== 'string' || xsrfToken.length === 0)) throw new TypeError('_xsrf is required');
  const url = new URL(finalUrl);
  if (url.protocol !== 'https:' || !/(^|\.)zhihu\.com$/i.test(url.hostname)) throw new TypeError('unsupported Zhihu URL');
  return Object.freeze({
    'x-zse-93': VERSION,
    'x-zse-96': signatureValue(url.href, dC0, 12),
    'x-requested-with': REQUEST_KIND,
    ...(xsrfToken ? { 'x-xsrftoken': xsrfToken } : {}),
  });
}
