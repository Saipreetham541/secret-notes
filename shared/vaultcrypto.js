// Shared by the browser (main thread + KDF worker) and the Node scripts.
// Changing any constant here makes every existing vault unreachable.
//
// Built on small audited libraries instead of libsodium (which added ~1 MB to
// every page load). The output is byte-for-byte identical to libsodium's
// crypto_pwhash (Argon2id), crypto_kdf_derive_from_key (BLAKE2b) and
// crypto_aead_xchacha20poly1305_ietf; scripts/crypto-compat-test.js proves it.
import { argon2id } from 'hash-wasm';
import { blake2b } from '@noble/hashes/blake2b';
import { xchacha20poly1305 } from '@noble/ciphers/chacha';

const enc = new TextEncoder();

// Small helper object passed around as `s` (it replaced a libsodium instance).
const helpers = {
  base64_variants: { ORIGINAL: 1 }, // accepted and ignored; always standard base64
  randombytes_buf: (n) => crypto.getRandomValues(new Uint8Array(n)),
  memzero: (u8) => u8.fill(0),
  to_hex: (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join(''),
  to_base64(u8) {
    let bin = '';
    for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(bin);
  },
  from_base64(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  },
};

export async function getSodium() {
  return helpers;
}

// Argon2id cost: 64 MiB, 3 passes, 1 lane (libsodium's crypto_pwhash parameters).
const OPSLIMIT = 3;
const MEMLIMIT_KIB = 64 * 1024;

// The phrase alone decides the vault, so the salt has to be a fixed constant.
// That is safe only because phrases are long and random (see looksLikePhrase).
const SALT_TEXT = 'notes/v1/salt..!'; // exactly 16 bytes
const KDF_CONTEXT = 'vaultkdf'; // exactly 8 bytes

export const MIN_WORDS = 6;
export const MAX_WORDS = 12;

export function normalizePhrase(input) {
  return String(input)
    .trim()
    .toLowerCase()
    .split(/[\s\-_.,]+/)
    .filter(Boolean)
    .join(' ');
}

// Only phrase-shaped searches trigger an unlock attempt. Anything else is
// treated purely as a normal search and never leaves the browser.
export function looksLikePhrase(input) {
  const words = normalizePhrase(input).split(' ');
  return (
    words.length >= MIN_WORDS &&
    words.length <= MAX_WORDS &&
    words.every((w) => /^[a-z]{3,12}$/.test(w))
  );
}

// libsodium crypto_kdf_derive_from_key: BLAKE2b keyed with the master key,
// salt = subkey id (8 bytes little-endian) + 8 zero bytes,
// personalization = context (8 bytes) + 8 zero bytes.
function kdfDerive(master, subkeyId, context) {
  const salt = new Uint8Array(16);
  new DataView(salt.buffer).setBigUint64(0, BigInt(subkeyId), true);
  const personalization = new Uint8Array(16);
  personalization.set(enc.encode(context));
  return blake2b(new Uint8Array(0), { key: master, salt, personalization, dkLen: 32 });
}

// phrase -> Argon2id master key -> three independent subkeys:
//   lookup: vault id the server indexes by
//   auth:   proves knowledge of the phrase to the server (stored only as a hash)
//   enc:    encrypts everything; never leaves the browser
export async function deriveVaultKeys(phrase) {
  const master = await argon2id({
    password: normalizePhrase(phrase),
    salt: enc.encode(SALT_TEXT),
    parallelism: 1,
    iterations: OPSLIMIT,
    memorySize: MEMLIMIT_KIB,
    hashLength: 32,
    outputType: 'binary',
  });
  const lookup = kdfDerive(master, 1, KDF_CONTEXT);
  const auth = kdfDerive(master, 2, KDF_CONTEXT);
  const encKey = kdfDerive(master, 3, KDF_CONTEXT);
  master.fill(0);
  const out = { lookup: helpers.to_hex(lookup), auth: helpers.to_hex(auth), enc: encKey };
  lookup.fill(0);
  auth.fill(0);
  return out;
}

const NONCE_BYTES = 24;
const adBytes = (ad) => (typeof ad === 'string' ? enc.encode(ad) : ad);

// XChaCha20-Poly1305. Output = nonce(24) || ciphertext || tag(16).
export function seal(s, key, plaintext, ad = '') {
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const ct = xchacha20poly1305(key, nonce, adBytes(ad)).encrypt(plaintext);
  const out = new Uint8Array(NONCE_BYTES + ct.length);
  out.set(nonce, 0);
  out.set(ct, NONCE_BYTES);
  return out;
}

// Throws if the data was tampered with or the key/ad is wrong.
export function open(s, key, sealed, ad = '') {
  return xchacha20poly1305(key, sealed.subarray(0, NONCE_BYTES), adBytes(ad)).decrypt(sealed.subarray(NONCE_BYTES));
}

// Every encrypted file chunk on the server is exactly this many bytes,
// so stored objects reveal nothing about real file sizes beyond a chunk count.
export const CHUNK_SEALED_BYTES = 256 * 1024;
export const CHUNK_OVERHEAD = 24 + 16; // nonce + tag
export const CHUNK_PLAIN_BYTES = CHUNK_SEALED_BYTES - CHUNK_OVERHEAD; // includes 4-byte length prefix
export const CHUNK_DATA_BYTES = CHUNK_PLAIN_BYTES - 4;
