// Photos and files: re-encoded (images, to strip EXIF/GPS), split into chunks,
// padded so every stored object is exactly 256 KiB, encrypted, then uploaded.
// Only the encrypted Yjs doc knows names, types and which chunks belong together.
import {
  seal,
  open,
  CHUNK_PLAIN_BYTES,
  CHUNK_DATA_BYTES,
} from '../../../shared/vaultcrypto.js';
import { randomId } from './session.js';

const MAX_IMAGE_EDGE = 2560;
const THUMB_EDGE = 480;
const PARALLEL = 3;

function headers(session) {
  return { 'x-v': session.id, 'x-a': session.auth };
}

async function uploadChunk(session, sealed) {
  const res = await fetch('/api/b', { method: 'POST', headers: headers(session), body: sealed });
  if (!res.ok) throw new Error('upload failed');
  return (await res.json()).id;
}

async function uploadBytes(session, bytes, attId, onChunk) {
  const count = Math.max(1, Math.ceil(bytes.length / CHUNK_DATA_BYTES));
  const ids = new Array(count);
  let next = 0;
  async function worker() {
    while (next < count) {
      const i = next++;
      const slice = bytes.subarray(i * CHUNK_DATA_BYTES, (i + 1) * CHUNK_DATA_BYTES);
      const plain = new Uint8Array(CHUNK_PLAIN_BYTES);
      new DataView(plain.buffer).setUint32(0, slice.length);
      plain.set(slice, 4);
      ids[i] = await uploadChunk(session, seal(session.s, session.key, plain, `f:${attId}:${i}`));
      onChunk?.();
    }
  }
  await Promise.all(Array.from({ length: Math.min(PARALLEL, count) }, worker));
  return ids;
}

async function downloadBytes(session, attId, chunkIds) {
  const parts = await Promise.all(
    chunkIds.map(async (id, i) => {
      const res = await fetch(`/api/b/${id}`, { headers: headers(session), cache: 'no-store' });
      if (!res.ok) throw new Error('download failed');
      const plain = open(session.s, session.key, new Uint8Array(await res.arrayBuffer()), `f:${attId}:${i}`);
      const len = new DataView(plain.buffer, plain.byteOffset).getUint32(0);
      return plain.slice(4, 4 + len);
    })
  );
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

async function reencode(bitmap, maxEdge, quality) {
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = new OffscreenCanvas(w, h);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
  return { bytes: new Uint8Array(await blob.arrayBuffer()), w, h };
}

// Returns attachment metadata to store in the note.
export async function prepareAndUpload(session, file, onProgress) {
  const id = randomId(session.s);
  let bytes;
  let mime = file.type || 'application/octet-stream';
  let name = file.name || 'file';
  let thumb = null;
  let dims = null;

  const isImage = /^image\/(jpeg|png|webp|bmp|avif)$/.test(mime);
  if (isImage) {
    try {
      const bitmap = await createImageBitmap(file);
      const full = await reencode(bitmap, MAX_IMAGE_EDGE, 0.88);
      const small = await reencode(bitmap, THUMB_EDGE, 0.75);
      bitmap.close();
      bytes = full.bytes;
      dims = { w: full.w, h: full.h };
      thumb = small.bytes;
      mime = 'image/jpeg';
      name = name.replace(/\.[^.]+$/, '') + '.jpg';
    } catch {
      bytes = null; // fall back to storing the original as a plain file
    }
  }
  if (!bytes) bytes = new Uint8Array(await file.arrayBuffer());

  const total = Math.max(1, Math.ceil(bytes.length / CHUNK_DATA_BYTES)) + (thumb ? 1 : 0);
  let done = 0;
  const tick = () => onProgress?.(++done / total);

  const thumbChunks = thumb ? await uploadBytes(session, thumb, `${id}:t`, tick) : null;
  const chunks = await uploadBytes(session, bytes, id, tick);
  return {
    id,
    name,
    mime,
    size: bytes.length,
    chunks,
    thumbChunks,
    ...(dims || {}),
    added: Date.now(),
  };
}

// Object URL for the decrypted file (or its thumbnail), cached for the session
// and revoked when the vault locks.
export function fileUrl(session, meta, which = 'full') {
  const useThumb = which === 'thumb' && meta.thumbChunks;
  const key = `${meta.id}:${useThumb ? 't' : 'f'}`;
  if (!session.urlCache.has(key)) {
    const p = downloadBytes(session, useThumb ? `${meta.id}:t` : meta.id, useThumb ? meta.thumbChunks : meta.chunks).then(
      (bytes) => URL.createObjectURL(new Blob([bytes], { type: useThumb ? 'image/jpeg' : meta.mime }))
    );
    p.catch(() => session.urlCache.delete(key));
    session.urlCache.set(key, p);
  }
  return session.urlCache.get(key);
}

export async function deleteChunks(session, meta) {
  const ids = [...(meta.chunks || []), ...(meta.thumbChunks || [])];
  await Promise.all(
    ids.map((id) => fetch(`/api/b/${id}`, { method: 'DELETE', headers: headers(session) }).catch(() => {}))
  );
}
