// An unlocked vault: a Yjs document whose every update is encrypted before it
// leaves the browser and decrypted when it arrives. The server relays and
// stores opaque bytes; the CRDT merges concurrent edits from 2–4 people.
import * as Y from 'yjs';
import { socket } from '../net/socket.js';
import { seal, open } from '../../../shared/vaultcrypto.js';

export const REMOTE = Symbol('remote');
const COMPACT_AFTER = 40; // merge the update log into one snapshot past this many entries

export class VaultSession {
  constructor(s, keys, updates) {
    this.s = s;
    this.key = keys.enc;
    this.id = keys.lookup;
    this.auth = keys.auth;
    this.ad = `up:${keys.lookup}`;
    this.doc = new Y.Doc();
    this.peers = 1;
    this.online = true;
    this.listeners = new Set();
    this.urlCache = new Map();
    this.closed = false;

    const maxSeq = this.applyAll(updates);
    this.doc.on('update', (update, origin) => {
      if (origin !== REMOTE) this.push(update);
    });
    this.off = socket.on((m) => this.onMessage(m));
    if (updates.length > COMPACT_AFTER) this.compact(maxSeq);
  }

  get notes() {
    return this.doc.getMap('notes');
  }

  applyAll(updates) {
    let maxSeq = 0;
    Y.transact(
      this.doc,
      () => {
        for (const u of updates) {
          maxSeq = Math.max(maxSeq, u.s);
          this.applyEncrypted(u.d);
        }
      },
      REMOTE
    );
    return maxSeq;
  }

  applyEncrypted(b64) {
    try {
      const plain = open(this.s, this.key, this.s.from_base64(b64, this.s.base64_variants.ORIGINAL), this.ad);
      Y.applyUpdate(this.doc, plain, REMOTE);
    } catch {
      // Tampered or corrupt update; ignore it rather than lose the session.
    }
  }

  encrypt(bytes) {
    return this.s.to_base64(seal(this.s, this.key, bytes, this.ad), this.s.base64_variants.ORIGINAL);
  }

  push(update) {
    if (this.closed) return;
    socket.request({ t: 'up', d: this.encrypt(update) }).catch(() => {
      // Lost while offline; the full state is re-sent on reconnect.
      this.needsResync = true;
    });
  }

  compact(upto) {
    const state = Y.encodeStateAsUpdate(this.doc);
    socket.request({ t: 'compact', upto, d: this.encrypt(state) }).catch(() => {});
  }

  async onMessage(m) {
    if (this.closed) return;
    if (m.t === 'up') this.applyEncrypted(m.d);
    else if (m.t === 'peers') this.set({ peers: m.n });
    else if (m.t === 'close') this.set({ online: false, peers: 1 });
    else if (m.t === 'open') {
      // Reconnected: rejoin, catch up, then send everything we have (Yjs dedupes).
      const reply = await socket.request({ t: 'join', id: this.id, a: this.auth }).catch(() => null);
      if (this.closed || reply?.t !== 'joined') return;
      this.applyAll(reply.updates);
      this.needsResync = false;
      this.push(Y.encodeStateAsUpdate(this.doc));
      this.set({ online: true });
    }
  }

  set(patch) {
    Object.assign(this, patch);
    for (const fn of this.listeners) fn();
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // Panic/lock: forget everything that was decrypted.
  destroy() {
    if (this.closed) return;
    this.closed = true;
    socket.request({ t: 'leave' }).catch(() => {});
    this.off();
    for (const p of this.urlCache.values()) p.then((url) => URL.revokeObjectURL(url)).catch(() => {});
    this.urlCache.clear();
    this.doc.destroy();
    this.s.memzero(this.key);
    this.listeners.clear();
  }
}

// ---------- document model ----------

export function randomId(s) {
  return s.to_hex(s.randombytes_buf(12));
}

export function createNote(session) {
  const id = randomId(session.s);
  const note = new Y.Map();
  session.doc.transact(() => {
    note.set('title', new Y.Text());
    note.set('body', new Y.Text());
    note.set('files', new Y.Array());
    note.set('created', Date.now());
    note.set('updated', Date.now());
    session.notes.set(id, note);
  });
  return id;
}

export function listNotes(session) {
  const out = [];
  session.notes.forEach((note, id) => {
    const body = note.get('body')?.toString() ?? '';
    out.push({
      id,
      title: note.get('title')?.toString() ?? '',
      preview: body.slice(0, 140),
      body,
      updated: note.get('updated') ?? 0,
      fileCount: note.get('files')?.length ?? 0,
    });
  });
  return out.sort((a, b) => b.updated - a.updated);
}
