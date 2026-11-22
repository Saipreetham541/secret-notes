// Creates a new vault and prints its phrase. There is deliberately no way to
// create a vault from the web UI. Share the phrase only in person or over an
// end-to-end encrypted messenger, then delete that message.
//
//   npm run new-vault
import crypto from 'node:crypto';
import { generateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { deriveVaultKeys, normalizePhrase } from '../shared/vaultcrypto.js';
import { openDb } from '../server/db.js';

// 7 random BIP-39 words (2048-word list) = 77 bits of entropy.
const words = generateMnemonic(wordlist, 128).split(' ').slice(0, 7);
const phrase = normalizePhrase(words.join(' '));

const keys = await deriveVaultKeys(phrase);
const authHash = crypto.createHash('sha256').update(keys.auth).digest('hex');
const db = await openDb();
await db.createVault(keys.lookup, authHash);

console.log('\nNew vault created. Its phrase (type it into the search box, then press Enter):\n');
console.log('   ' + phrase.split(' ').join('-') + '\n');
console.log('Nobody, including the server, can recover this phrase. Write it down somewhere safe.\n');
process.exit(0);
