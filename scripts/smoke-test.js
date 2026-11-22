// Acts as a second vault member from the command line to check the server
// end to end: unlock, read notes, push a live edit, round-trip an encrypted chunk.
//   node scripts/smoke-test.js "<phrase>" [http://localhost:8787]
import WebSocket from 'ws';
import * as Y from 'yjs';
import { deriveVaultKeys, getSodium, seal, open, CHUNK_SEALED_BYTES, CHUNK_PLAIN_BYTES } from '../shared/vaultcrypto.js';
import { encodeFrame, decodeFrame } from '../shared/frame.js';
import { webcrypto } from 'node:crypto';
globalThis.crypto ??= webcrypto; // Node 18 has no global Web Crypto

const [phrase, base = 'http://localhost:8787'] = process.argv.slice(2);
const s = await getSodium();
const keys = await deriveVaultKeys(phrase);
const ad = `up:${keys.lookup}`;
const ws = new WebSocket(base.replace(/^http/, 'ws') + '/ws');
const waiters = new Map();
let r = 1;
const req = (m) => new Promise((res) => { const id = r++; waiters.set(id, res); ws.send(encodeFrame({ ...m, r: id })); });
ws.on('message', (d) => { const m = decodeFrame(d); if (waiters.has(m.r)) { waiters.get(m.r)(m); waiters.delete(m.r); } else console.log('push:', m.t, m.n ?? ''); });
await new Promise((res) => ws.on('open', res));

const bad = await req({ t: 'join', id: 'ab'.repeat(32), a: 'cd'.repeat(32) });
console.log('wrong vault reply:', bad.t, '(should be hb)');

const joined = await req({ t: 'join', id: keys.lookup, a: keys.auth });
console.log('join reply:', joined.t, 'updates:', joined.updates.length);
const doc = new Y.Doc();
for (const u of joined.updates) Y.applyUpdate(doc, open(s, keys.enc, Buffer.from(u.d, 'base64'), ad));
const notes = doc.getMap('notes');
notes.forEach((n) => console.log('note:', JSON.stringify(n.get('title').toString()), '/', JSON.stringify(n.get('body').toString())));

doc.on('update', (u) => req({ t: 'up', d: Buffer.from(seal(s, keys.enc, u, ad)).toString('base64') }).then((a) => console.log('edit ack seq', a.s)));
const first = [...notes.values()][0];
if (first) first.get('body').insert(first.get('body').length, ' Hotel too (from peer).');

const plain = new Uint8Array(CHUNK_PLAIN_BYTES);
plain.set(Buffer.from('\0\0\0\x05hello'), 0);
const h = { 'x-v': keys.lookup, 'x-a': keys.auth };
const up = await fetch(base + '/api/b', { method: 'POST', headers: h, body: seal(s, keys.enc, plain, 'f:t:0') });
const { id } = await up.json();
const got = new Uint8Array(await (await fetch(base + '/api/b/' + id, { headers: h })).arrayBuffer());
console.log('blob size on server:', got.length, '=', CHUNK_SEALED_BYTES, '| decrypts:', Buffer.from(open(s, keys.enc, got, 'f:t:0').slice(4, 9)).toString());
console.log('blob w/o auth:', (await fetch(base + '/api/b/' + id)).status);
await fetch(base + '/api/b/' + id, { method: 'DELETE', headers: h });

setTimeout(() => process.exit(0), 1500);
