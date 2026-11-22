// One always-on WebSocket, opened when the app loads whether or not a vault is
// ever used. It sends padded heartbeats at random 15–30 s intervals, so the
// traffic of someone using a vault looks the same as someone just taking notes.
import { encodeFrame, decodeFrame } from '../../../shared/frame.js';

class Socket {
  ws = null;
  pending = new Map();
  nextR = 1;
  listeners = new Set();
  openWaiters = [];
  backoff = 1000;
  hbTimer = null;
  started = false;

  start() {
    if (this.started) return;
    this.started = true;
    this.connect();
  }

  get online() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  connect() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}/ws`);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => {
      this.backoff = 1000;
      this.scheduleHeartbeat();
      this.openWaiters.splice(0).forEach((fn) => fn());
      this.emit({ t: 'open' });
    };
    ws.onmessage = (e) => {
      let msg;
      try {
        msg = decodeFrame(e.data);
      } catch {
        return;
      }
      const waiter = msg.r && this.pending.get(msg.r);
      if (waiter) {
        this.pending.delete(msg.r);
        clearTimeout(waiter.timer);
        waiter.resolve(msg);
      } else {
        this.emit(msg);
      }
    };
    ws.onclose = () => {
      clearTimeout(this.hbTimer);
      if (this.ws === ws) this.ws = null;
      for (const w of this.pending.values()) {
        clearTimeout(w.timer);
        w.reject(new Error('disconnected'));
      }
      this.pending.clear();
      this.emit({ t: 'close' });
      setTimeout(() => this.connect(), this.backoff * (0.5 + Math.random()));
      this.backoff = Math.min(this.backoff * 2, 30000);
    };
  }

  scheduleHeartbeat() {
    clearTimeout(this.hbTimer);
    this.hbTimer = setTimeout(() => {
      this.request({ t: 'hb' }).catch(() => {});
      this.scheduleHeartbeat();
    }, 15000 + Math.random() * 15000);
  }

  whenOpen() {
    if (this.online) return Promise.resolve();
    return new Promise((resolve) => this.openWaiters.push(resolve));
  }

  async request(msg, timeoutMs = 20000) {
    await this.whenOpen();
    const r = this.nextR++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(r);
        reject(new Error('timeout'));
      }, timeoutMs);
      this.pending.set(r, { resolve, reject, timer });
      this.ws.send(encodeFrame({ ...msg, r }));
    });
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(msg) {
    for (const fn of this.listeners) fn(msg);
  }
}

export const socket = new Socket();
