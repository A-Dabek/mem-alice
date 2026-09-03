import { test } from 'node:test';
import assert from 'node:assert/strict';

import { deriveKey, encryptField, decryptField, decryptText, base64ToBytes, bytesToBase64 } from './crypto.js';

test('base64ToBytes/bytesToBase64 round-trip', () => {
  const original = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
  const base64 = bytesToBase64(original);
  const decoded = base64ToBytes(base64);

  assert.deepEqual(Array.from(decoded), Array.from(original));
});

test('encryptField/decryptText round-trip returns the original string', async () => {
  const key = await deriveKey('correct-passphrase', bytesToBase64(new Uint8Array(16)));
  const { ciphertext, iv } = await encryptField(key, 'My first milestone');

  const decrypted = await decryptText(key, ciphertext, iv);

  assert.equal(decrypted, 'My first milestone');
});

test('encryptField/decryptField round-trip returns the original bytes', async () => {
  const key = await deriveKey('correct-passphrase', bytesToBase64(new Uint8Array(16)));
  const photoBytes = new Uint8Array([10, 20, 30, 40, 50]);

  const { ciphertext, iv } = await encryptField(key, photoBytes);
  const decrypted = await decryptField(key, ciphertext, iv);

  assert.deepEqual(Array.from(decrypted), Array.from(photoBytes));
});

test('decrypting with the wrong key throws instead of returning garbage', async () => {
  const saltB64 = bytesToBase64(new Uint8Array(16));
  const correctKey = await deriveKey('correct-passphrase', saltB64);
  const wrongKey = await deriveKey('wrong-passphrase', saltB64);

  const { ciphertext, iv } = await encryptField(correctKey, 'secret title');

  await assert.rejects(() => decryptField(wrongKey, ciphertext, iv));
});

test('two encryptField calls on the same data use different IVs', async () => {
  const key = await deriveKey('correct-passphrase', bytesToBase64(new Uint8Array(16)));

  const first = await encryptField(key, 'same title');
  const second = await encryptField(key, 'same title');

  assert.notEqual(first.iv, second.iv);
});
