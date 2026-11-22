// WebSocket framing: every message is JSON, length-prefixed and zero-padded up
// to a fixed bucket size. A heartbeat, a failed unlock and a small edit all
// look like the same 1 KiB frame on the wire.
const BUCKETS = [1024, 4096, 16384, 65536, 262144, 1048576, 4194304, 16777216, 67108864];
export const MAX_FRAME = BUCKETS[BUCKETS.length - 1];

const enc = new TextEncoder();
const dec = new TextDecoder();

export function encodeFrame(obj) {
  const body = enc.encode(JSON.stringify(obj));
  const need = body.length + 4;
  const size = BUCKETS.find((b) => b >= need);
  if (!size) throw new Error('frame too large');
  const out = new Uint8Array(size);
  new DataView(out.buffer).setUint32(0, body.length);
  out.set(body, 4);
  return out;
}

export function decodeFrame(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (u8.length < 4 || !BUCKETS.includes(u8.length)) throw new Error('bad frame');
  const len = new DataView(u8.buffer, u8.byteOffset, u8.byteLength).getUint32(0);
  if (len > u8.length - 4) throw new Error('bad frame');
  return JSON.parse(dec.decode(u8.subarray(4, 4 + len)));
}
