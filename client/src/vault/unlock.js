import { socket } from '../net/socket.js';
import { getSodium } from '../../../shared/vaultcrypto.js';
import { VaultSession } from './session.js';

let worker = null;
let nextId = 1;

function derive(phrase) {
  worker ??= new Worker(new URL('./kdf.worker.js', import.meta.url), { type: 'module', name: 'w' });
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const onMessage = (e) => {
      if (e.data.id !== id) return;
      worker.removeEventListener('message', onMessage);
      if (e.data.error) reject(new Error(e.data.error));
      else resolve(e.data.keys);
    };
    worker.addEventListener('message', onMessage);
    worker.postMessage({ id, phrase });
  });
}

// Resolves to an open VaultSession, or null if the phrase doesn't match a vault.
// A miss looks exactly like a heartbeat on the network and changes nothing on screen.
export async function tryUnlock(phrase) {
  const s = await getSodium();
  const keys = await derive(phrase);
  let reply;
  try {
    reply = await socket.request({ t: 'join', id: keys.lookup, a: keys.auth });
  } catch {
    reply = null;
  }
  if (reply?.t !== 'joined') {
    s.memzero(keys.enc);
    return null;
  }
  return new VaultSession(s, keys, reply.updates);
}
