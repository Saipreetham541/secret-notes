import React, { useCallback, useEffect, useRef, useState } from 'react';
import { DecoyApp } from './decoy/DecoyApp.jsx';
import { VaultApp } from './vault/VaultApp.jsx';
import { socket } from './net/socket.js';
import { tryUnlock } from './vault/unlock.js';
import { hideAllowed } from './vault/panic.js';
import { looksLikePhrase } from '../../shared/vaultcrypto.js';

const IDLE_LOCK_MS = 5 * 60 * 1000;

export function App() {
  const [session, setSession] = useState(null);
  const sessionRef = useRef(null);
  const unlocking = useRef(false);

  useEffect(() => socket.start(), []);

  const lock = useCallback(() => {
    sessionRef.current?.destroy();
    sessionRef.current = null;
    setSession(null);
  }, []);

  const onSearchEnter = useCallback(async (query) => {
    if (unlocking.current || sessionRef.current || !looksLikePhrase(query)) return;
    unlocking.current = true;
    try {
      const s = await tryUnlock(query);
      if (s) {
        sessionRef.current = s;
        setSession(s);
      }
    } catch {
      // Any failure is indistinguishable from "no such vault".
    } finally {
      unlocking.current = false;
    }
  }, []);

  // Panic: Esc, switching tabs/apps, closing the page, or 5 minutes idle.
  useEffect(() => {
    if (!session) return;
    let idle = setTimeout(lock, IDLE_LOCK_MS);
    const activity = () => {
      clearTimeout(idle);
      idle = setTimeout(lock, IDLE_LOCK_MS);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') lock();
      else activity();
    };
    const onHidden = () => document.visibilityState === 'hidden' && !hideAllowed() && lock();
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', activity, true);
    window.addEventListener('pagehide', lock);
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      clearTimeout(idle);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', activity, true);
      window.removeEventListener('pagehide', lock);
      document.removeEventListener('visibilitychange', onHidden);
    };
  }, [session, lock]);

  return session ? <VaultApp session={session} onLock={lock} /> : <DecoyApp onSearchEnter={onSearchEnter} />;
}
