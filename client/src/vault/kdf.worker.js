// Runs Argon2id off the main thread so a phrase-shaped search never freezes the UI.
import { deriveVaultKeys } from '../../../shared/vaultcrypto.js';

self.onmessage = async (e) => {
  const { id, phrase } = e.data;
  try {
    const keys = await deriveVaultKeys(phrase);
    self.postMessage({ id, keys }, [keys.enc.buffer]);
  } catch (err) {
    self.postMessage({ id, error: String(err?.message || err) });
  }
};
