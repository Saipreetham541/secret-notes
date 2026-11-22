// Relay + storage server. It only ever sees ciphertext, a vault lookup id and a
// hash of the vault's auth token. It never sees phrases or encryption keys.
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { openDb } from './db.js';
import { openBlobStore } from './blobs.js';
import { encodeFrame, decodeFrame, MAX_FRAME } from '../shared/frame.js';
import { CHUNK_SEALED_BYTES } from '../shared/vaultcrypto.js';

const PORT = Number(process.env.PORT || 8787);
const PROD = process.env.NODE_ENV === 'production';
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
// Listen only on this machine by default; the tunnel (Tailscale Funnel) is the
// only way in from outside. Set HOST=0.0.0.0 to expose it directly instead.
const HOST = process.env.HOST || '127.0.0.1';
const DIST = path.resolve('dist');

const db = await openDb();
const blobs = await openBlobStore();

// ---------- auth + rate limiting ----------

const HEX64 = /^[0-9a-f]{64}$/;
const HEX32 = /^[0-9a-f]{32}$/;

function hashAuth(authHex) {
  return crypto.createHash('sha256').update(authHex).digest('hex');
}

async function checkVault(id, auth) {
  if (!HEX64.test(id ?? '') || !HEX64.test(auth ?? '')) return false;
  const stored = await db.getVaultAuthHash(id);
  const given = hashAuth(auth);
  // Compare even when the vault doesn't exist so timing doesn't reveal existence.
  const a = Buffer.from(stored ?? '0'.repeat(64), 'hex');
  const b = Buffer.from(given, 'hex');
  return crypto.timingSafeEqual(a, b) && stored !== null;
}

// Failed unlock attempts per IP: 10 per 15 minutes, then everything fails silently.
const FAIL_LIMIT = 10;
const FAIL_WINDOW_MS = 15 * 60 * 1000;
const failures = new Map(); // ip -> [timestamps]

function blocked(ip) {
  const now = Date.now();
  const list = (failures.get(ip) || []).filter((t) => now - t < FAIL_WINDOW_MS);
  failures.set(ip, list);
  return list.length >= FAIL_LIMIT;
}
function recordFailure(ip) {
  const list = failures.get(ip) || [];
  list.push(Date.now());
  failures.set(ip, list);
}
setInterval(() => {
  for (const [ip] of failures) blocked(ip);
  for (const [ip, list] of failures) if (!list.length) failures.delete(ip);
}, 60_000).unref();

// Behind a tunnel every connection comes from 127.0.0.1, so the visitor's real
// address must come from X-Forwarded-For. Only the right-most entry is used:
// that's the one the proxy itself appended, so visitors can't fake it.
let reportedIpSource = false;
function clientIp(req) {
  const peer = req.socket.remoteAddress || 'unknown';
  const fromLoopback = peer === '127.0.0.1' || peer === '::1' || peer === '::ffff:127.0.0.1';
  if (TRUST_PROXY && fromLoopback) {
    const fwd = String(req.headers['x-forwarded-for'] || '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
    if (!reportedIpSource) {
      reportedIpSource = true;
      console.log(
        fwd.length
          ? 'visitor addresses: OK (the tunnel passes them through, so rate limits apply per person)'
          : 'visitor addresses: NOT available (the tunnel sends none, so failed-unlock limits are shared by everyone)'
      );
    }
    if (fwd.length) return fwd[fwd.length - 1];
  }
  return peer;
}

async function authorize(ip, id, auth) {
  if (blocked(ip)) return false;
  const ok = await checkVault(id, auth);
  if (!ok) recordFailure(ip);
  return ok;
}

// ---------- HTTP ----------

const SECURITY_HEADERS = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "media-src 'self' blob:",
    "connect-src 'self'",
    "worker-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; '),
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
};
if (PROD) SECURITY_HEADERS['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
  res.end(body);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const parts = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('too large'));
        req.destroy();
      } else parts.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(parts)));
    req.on('error', reject);
  });
}

async function handleBlob(req, res, id) {
  const ip = clientIp(req);
  const vault = String(req.headers['x-v'] || '');
  const auth = String(req.headers['x-a'] || '');
  if (!(await authorize(ip, vault, auth))) return send(res, 404, '');
  const noStore = { 'Cache-Control': 'no-store' };

  if (req.method === 'POST' && !id) {
    const body = await readBody(req, CHUNK_SEALED_BYTES);
    if (body.length !== CHUNK_SEALED_BYTES) return send(res, 400, '');
    const newId = crypto.randomBytes(16).toString('hex');
    await blobs.put(newId, body);
    await db.addBlob(newId, vault);
    return send(res, 200, JSON.stringify({ id: newId }), { 'Content-Type': 'application/json', ...noStore });
  }
  if (!id || !HEX32.test(id) || (await db.blobVault(id)) !== vault) return send(res, 404, '');
  if (req.method === 'GET') {
    const buf = await blobs.get(id);
    return send(res, 200, buf, { 'Content-Type': 'application/octet-stream', ...noStore });
  }
  if (req.method === 'DELETE') {
    await blobs.del(id);
    await db.deleteBlob(id);
    return send(res, 204, '');
  }
  return send(res, 405, '');
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain',
};

function serveStatic(req, res) {
  const url = new URL(req.url, 'http://x');
  let file = path.join(DIST, path.normalize(decodeURIComponent(url.pathname)));
  if (!file.startsWith(DIST)) return send(res, 404, '');
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
  if (!fs.existsSync(file)) return send(res, 404, 'Run `npm run build` first.');
  const ext = path.extname(file);
  const immutable = url.pathname.startsWith('/assets/');
  const headers = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    Vary: 'Accept-Encoding',
  };
  // Serve the pre-compressed copy made at build time when the browser accepts it.
  const accepts = String(req.headers['accept-encoding'] || '');
  for (const [enc, suffix] of [['br', '.br'], ['gzip', '.gz']]) {
    if (accepts.includes(enc) && fs.existsSync(file + suffix)) {
      return send(res, 200, readCached(file + suffix), { ...headers, 'Content-Encoding': enc });
    }
  }
  send(res, 200, readCached(file), headers);
}

// Built files never change while the server runs, so keep them in memory.
const fileCache = new Map();
function readCached(file) {
  if (!fileCache.has(file)) fileCache.set(file, fs.readFileSync(file));
  return fileCache.get(file);
}

const server = http.createServer(async (req, res) => {
  try {
    const m = req.url.match(/^\/api\/b(?:\/([^/?]+))?\/?(?:\?.*)?$/);
    if (m) return await handleBlob(req, res, m[1]);
    if (req.url.startsWith('/api/')) return send(res, 404, '');
    if (PROD) return serveStatic(req, res);
    send(res, 404, '');
  } catch (e) {
    console.error(e);
    if (!res.headersSent) send(res, 500, '');
  }
});

// ---------- WebSocket relay ----------

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: MAX_FRAME });
const rooms = new Map(); // vaultId -> Set<ws>

function sendFrame(ws, obj) {
  if (ws.readyState === ws.OPEN) ws.send(encodeFrame(obj));
}
function broadcastPeers(vaultId) {
  const room = rooms.get(vaultId);
  if (!room) return;
  for (const peer of room) sendFrame(peer, { t: 'peers', n: room.size });
}
function leave(ws) {
  const id = ws.vaultId;
  if (!id) return;
  ws.vaultId = null;
  const room = rooms.get(id);
  if (!room) return;
  room.delete(ws);
  if (room.size === 0) rooms.delete(id);
  else broadcastPeers(id);
}

const b64 = (buf) => Buffer.from(buf).toString('base64');
const MAX_UPDATE_BYTES = 16 * 1024 * 1024;
function fromB64(s) {
  if (typeof s !== 'string' || s.length > (MAX_UPDATE_BYTES * 4) / 3 + 4) return null;
  const buf = Buffer.from(s, 'base64');
  return buf.length > 40 ? buf : null; // at least nonce + tag
}

wss.on('connection', (ws, req) => {
  ws.ip = clientIp(req);
  ws.vaultId = null;
  ws.lastSeen = Date.now();
  // Messages are handled one at a time so a client sees its own ordering.
  let chain = Promise.resolve();

  ws.on('message', (raw, isBinary) => {
    ws.lastSeen = Date.now();
    chain = chain.then(() => handle(raw, isBinary)).catch((e) => console.error('ws', e.message));
  });

  async function handle(raw, isBinary) {
    if (!isBinary) return ws.close();
    let msg;
    try {
      msg = decodeFrame(raw);
    } catch {
      return ws.close();
    }
    const r = msg.r;
    switch (msg.t) {
      case 'hb':
        return sendFrame(ws, { t: 'hb', r });
      case 'join': {
        const ok = await authorize(ws.ip, msg.id, msg.a);
        // A failed unlock gets the same reply as a heartbeat.
        if (!ok) return sendFrame(ws, { t: 'hb', r });
        leave(ws);
        ws.vaultId = msg.id;
        if (!rooms.has(msg.id)) rooms.set(msg.id, new Set());
        rooms.get(msg.id).add(ws);
        const updates = await db.listUpdates(msg.id);
        sendFrame(ws, { t: 'joined', r, updates: updates.map((u) => ({ s: u.seq, d: b64(u.data) })) });
        return broadcastPeers(msg.id);
      }
      case 'up': {
        if (!ws.vaultId) return sendFrame(ws, { t: 'hb', r });
        const data = fromB64(msg.d);
        if (!data) return;
        const s = await db.addUpdate(ws.vaultId, data);
        for (const peer of rooms.get(ws.vaultId) || []) {
          if (peer !== ws) sendFrame(peer, { t: 'up', s, d: msg.d });
        }
        return sendFrame(ws, { t: 'ack', r, s });
      }
      case 'compact': {
        if (!ws.vaultId || !Number.isSafeInteger(msg.upto)) return;
        const data = fromB64(msg.d);
        if (!data) return;
        const s = await db.compact(ws.vaultId, msg.upto, data);
        return sendFrame(ws, { t: 'ack', r, s });
      }
      case 'leave':
        leave(ws);
        return sendFrame(ws, { t: 'hb', r });
      default:
        return;
    }
  }

  ws.on('close', () => leave(ws));
  ws.on('error', () => leave(ws));
});

// Drop sockets that stopped heart-beating.
setInterval(() => {
  const cutoff = Date.now() - 120_000;
  for (const ws of wss.clients) if (ws.lastSeen < cutoff) ws.terminate();
}, 30_000).unref();

server.listen(PORT, HOST, () =>
  console.log(`server listening on http://${HOST}:${PORT}${PROD ? ' (production)' : ''}`)
);
