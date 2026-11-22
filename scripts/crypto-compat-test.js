// Proves shared/vaultcrypto.js produces exactly what libsodium produced, so
// vaults created before the switch still open.  node scripts/crypto-compat-test.js
import assert from 'node:assert/strict';
import _sodium from 'libsodium-wrappers-sumo';
import { deriveVaultKeys, seal, open, normalizePhrase, getSodium } from '../shared/vaultcrypto.js';
import { webcrypto } from 'node:crypto';
globalThis.crypto ??= webcrypto; // Node 18 has no global Web Crypto

await _sodium.ready;
const na = _sodium;
const s = await getSodium();

function sodiumDerive(phrase) {
  const master = na.crypto_pwhash(32, normalizePhrase(phrase), na.from_string('notes/v1/salt..!'), 3, 64 * 1024 * 1024, na.crypto_pwhash_ALG_ARGON2ID13);
  return {
    lookup: na.to_hex(na.crypto_kdf_derive_from_key(32, 1, 'vaultkdf', master)),
    auth: na.to_hex(na.crypto_kdf_derive_from_key(32, 2, 'vaultkdf', master)),
    enc: na.crypto_kdf_derive_from_key(32, 3, 'vaultkdf', master),
  };
}

for (const phrase of ['build slam depart illegal solar usage risk', 'Otter-Lamp-violet crane ninety abc', 'a b c d e f']) {
  const want = sodiumDerive(phrase);
  const got = await deriveVaultKeys(phrase);
  assert.equal(got.lookup, want.lookup);
  assert.equal(got.auth, want.auth);
  assert.deepEqual(Array.from(got.enc), Array.from(want.enc));

  // New seal -> libsodium open, and libsodium seal -> new open.
  const msg = na.randombytes_buf(1000);
  const sealed = seal(s, got.enc, msg, 'up:abc');
  const n = sealed.subarray(0, 24);
  assert.deepEqual(Array.from(na.crypto_aead_xchacha20poly1305_ietf_decrypt(null, sealed.subarray(24), 'up:abc', n, want.enc)), Array.from(msg));
  const nonce = na.randombytes_buf(24);
  const ct = na.crypto_aead_xchacha20poly1305_ietf_encrypt(msg, 'f:x:0', null, nonce, want.enc);
  const theirs = new Uint8Array(24 + ct.length);
  theirs.set(nonce); theirs.set(ct, 24);
  assert.deepEqual(Array.from(open(s, got.enc, theirs, 'f:x:0')), Array.from(msg));
  assert.throws(() => open(s, got.enc, theirs, 'f:x:1')); // wrong context must fail
}

const big = na.randombytes_buf(300000);
assert.deepEqual(Array.from(s.from_base64(s.to_base64(big))), Array.from(big));
assert.equal(s.to_base64(big), Buffer.from(big).toString('base64'));
console.log('crypto compat: all checks passed (identical to libsodium)');
