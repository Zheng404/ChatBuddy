import test from 'node:test';
import assert from 'node:assert/strict';

import { decryptBackup, encryptBackup, isEncryptedBackup } from '../chatbuddy/localBackupEncryption';

test('isEncryptedBackup - identifies encrypted bytes', async () => {
  const plaintext = new TextEncoder().encode('Hello world');
  const ciphertext = await encryptBackup(plaintext, 'test-password');
  assert.equal(isEncryptedBackup(ciphertext), true);
});

test('isEncryptedBackup - returns false for plaintext bytes', () => {
  const plaintext = new TextEncoder().encode('Hello world');
  assert.equal(isEncryptedBackup(plaintext), false);
});

test('isEncryptedBackup - returns false for empty buffer', () => {
  assert.equal(isEncryptedBackup(new Uint8Array(0)), false);
});

test('encryptBackup - throws when password is empty', async () => {
  const plaintext = new TextEncoder().encode('Hello');
  await assert.rejects(() => encryptBackup(plaintext, ''), /password/i);
});

test('decryptBackup - round-trip restores original bytes', async () => {
  const plaintext = new TextEncoder().encode('The quick brown fox jumps over the lazy dog');
  const password = 'super-secret-passphrase';
  const ciphertext = await encryptBackup(plaintext, password);
  const decrypted = await decryptBackup(ciphertext, password);
  assert.deepEqual(Array.from(decrypted), Array.from(plaintext));
});

test('decryptBackup - handles binary data correctly', async () => {
  const plaintext = new Uint8Array(1024);
  for (let i = 0; i < plaintext.length; i++) {
    plaintext[i] = i % 256;
  }
  const password = 'binary-test-password';
  const ciphertext = await encryptBackup(plaintext, password);
  const decrypted = await decryptBackup(ciphertext, password);
  assert.deepEqual(Array.from(decrypted), Array.from(plaintext));
});

test('decryptBackup - throws on wrong password', async () => {
  const plaintext = new TextEncoder().encode('Sensitive content');
  const ciphertext = await encryptBackup(plaintext, 'correct-password');
  await assert.rejects(() => decryptBackup(ciphertext, 'wrong-password'));
});

test('decryptBackup - throws on tampered ciphertext', async () => {
  const plaintext = new TextEncoder().encode('Sensitive content');
  const password = 'test-password';
  const ciphertext = await encryptBackup(plaintext, password);
  // Flip one bit in the encrypted payload portion
  const tampered = new Uint8Array(ciphertext);
  tampered[tampered.length - 1] ^= 0x01;
  await assert.rejects(() => decryptBackup(tampered, password));
});

test('decryptBackup - throws on non-encrypted bytes', async () => {
  const plaintext = new TextEncoder().encode('not encrypted');
  await assert.rejects(() => decryptBackup(plaintext, 'password'), /encrypted/i);
});

test('decryptBackup - throws when password is empty', async () => {
  const plaintext = new TextEncoder().encode('Hello');
  const ciphertext = await encryptBackup(plaintext, 'real-password');
  await assert.rejects(() => decryptBackup(ciphertext, ''), /password/i);
});

test('encryptBackup - produces different ciphertext on each call (random IV/salt)', async () => {
  const plaintext = new TextEncoder().encode('Same plaintext');
  const password = 'same-password';
  const c1 = await encryptBackup(plaintext, password);
  const c2 = await encryptBackup(plaintext, password);
  assert.notDeepEqual(Array.from(c1), Array.from(c2));
});
