/**
 * Client-side crypto helpers.
 *
 * All encryption/decryption happens here via the Web Crypto API
 * (`SubtleCrypto`), so the server only ever sees ciphertext. This module has
 * no framework/browser-only dependencies (only `globalThis.crypto`,
 * `TextEncoder`/`TextDecoder`, and optionally `Buffer`), so it can be
 * imported unmodified both by the browser (as an ES module) and by
 * `node:test` for unit testing (Node's webcrypto exposes the same
 * `crypto.subtle` API globally).
 */

const PBKDF2_ITERATIONS = 100000;
const AES_KEY_LENGTH = 256;
const IV_LENGTH_BYTES = 12;

/**
 * @returns {SubtleCrypto}
 */
function getSubtle() {
  const subtle = globalThis.crypto && globalThis.crypto.subtle;
  if (!subtle) {
    throw new Error('SubtleCrypto is not available in this environment');
  }
  return subtle;
}

/**
 * Decodes a base64 string into raw bytes.
 *
 * @param {string} base64
 * @returns {Uint8Array}
 */
export function base64ToBytes(base64) {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(base64, 'base64'));
  }

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Encodes raw bytes as a base64 string.
 *
 * @param {Uint8Array | ArrayBuffer} data
 * @returns {string}
 */
export function bytesToBase64(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);

  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }

  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Normalizes string/ArrayBuffer/Uint8Array input into raw bytes.
 *
 * @param {string | ArrayBuffer | Uint8Array} data
 * @returns {Uint8Array}
 */
function toBytes(data) {
  if (typeof data === 'string') {
    return new TextEncoder().encode(data);
  }
  if (data instanceof Uint8Array) {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  throw new TypeError('data must be a string, Uint8Array, or ArrayBuffer');
}

/**
 * Derives an AES-256-GCM `CryptoKey` from a passphrase using PBKDF2.
 *
 * @param {string} passphrase
 * @param {string} saltB64 - non-secret salt (base64), e.g. from GET /api/salt.
 * @returns {Promise<CryptoKey>}
 */
export async function deriveKey(passphrase, saltB64) {
  const subtle = getSubtle();

  const baseKey = await subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: base64ToBytes(saltB64),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: AES_KEY_LENGTH },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypts a string/bytes field with AES-GCM, generating a fresh random IV.
 *
 * @param {CryptoKey} key
 * @param {string | ArrayBuffer | Uint8Array} data
 * @returns {Promise<{ ciphertext: string, iv: string }>} base64-encoded ciphertext + IV.
 */
export async function encryptField(key, data) {
  const subtle = getSubtle();
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_LENGTH_BYTES));

  const ciphertext = await subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    toBytes(data)
  );

  return {
    ciphertext: bytesToBase64(ciphertext),
    iv: bytesToBase64(iv),
  };
}

/**
 * Decrypts an AES-GCM field back into raw bytes.
 *
 * Throws if the key/IV/ciphertext don't match (e.g. wrong passphrase) -
 * AES-GCM authentication makes tampering/wrong-key attempts fail loudly
 * instead of returning garbage.
 *
 * @param {CryptoKey} key
 * @param {string} ciphertextB64
 * @param {string} ivB64
 * @returns {Promise<Uint8Array>}
 */
export async function decryptField(key, ciphertextB64, ivB64) {
  const subtle = getSubtle();

  const plaintext = await subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(ivB64) },
    key,
    base64ToBytes(ciphertextB64)
  );

  return new Uint8Array(plaintext);
}

/**
 * Convenience wrapper around `decryptField` for text fields (e.g. titles).
 *
 * @param {CryptoKey} key
 * @param {string} ciphertextB64
 * @param {string} ivB64
 * @returns {Promise<string>}
 */
export async function decryptText(key, ciphertextB64, ivB64) {
  const bytes = await decryptField(key, ciphertextB64, ivB64);
  return new TextDecoder().decode(bytes);
}
