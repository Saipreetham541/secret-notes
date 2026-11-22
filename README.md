# Notes

A plain, local-only notes app. Type a vault phrase into **Search** and press
**Enter** to open a shared, end-to-end encrypted vault (notes, photos, files)
that syncs live between everyone who knows the phrase.

## Run it

```bash
npm install
npm run build
npm run new-vault      # prints a 7-word phrase (run while the server is stopped)
npm start              # http://localhost:8787
```

For development with hot reload: `npm run dev` (open http://localhost:5173).

## Using it

- **Open the vault:** type the phrase in Search and press Enter. You can separate
  the words with spaces or dashes; capitals don't matter. A wrong phrase just
  looks like a search with no results.
- **Lock (panic):** press **Esc**, click the *Private* pill, or switch tabs or apps.
  It also locks after 5 minutes idle. Locking returns you to the normal notes
  and wipes the key and decrypted data from memory.
- **Attach:** click the paperclip, drag and drop files, or paste images. Photos are
  re-encoded first, which strips location and camera (EXIF) data.
- To share the vault, give people the phrase in person or over Signal. There's no
  way to remove one person: to cut someone off, make a new vault and move over.

## How it's protected

| Piece | What happens |
|---|---|
| Phrase | Argon2id (64 MiB) produces a key, which is split into a *lookup id*, an *auth token* and the *encryption key*. The phrase never leaves the browser. |
| Server | Stores only the lookup id, a SHA-256 of the auth token, and ciphertext. It cannot read anything. |
| Notes | A Yjs CRDT document. Every update is encrypted with XChaCha20-Poly1305 before upload. |
| Files | Split into chunks and padded so every stored object is exactly 256 KiB, then encrypted. |
| Network | One WebSocket is always open, with padded heartbeats every 15–30 s. Unlock attempts, failed unlocks and edits all look like heartbeat-sized frames. |
| Guessing | 10 failed unlocks per IP per 15 min, then every attempt fails silently. |
| Browser | Nothing from the vault goes into localStorage or the service-worker cache. The URL never changes. Spellcheck is off in vault fields. |

**What it can't protect against:** someone reading the app's source can tell it
*supports* vaults, though not whether you have one. Malware on your device,
screenshots, or someone watching you type the phrase also defeat it.

## Hosting from your laptop (Tailscale Funnel)

Only you install anything. Your friends just open an `https://…ts.net` link.

**One-time setup:**

1. Install Tailscale and sign in (a free account works):
   ```bash
   curl -fsSL https://tailscale.com/install.sh | sh
   sudo tailscale up
   ```
2. Let your user run Funnel without `sudo`:
   ```bash
   sudo tailscale set --operator=$USER
   ```
3. Create your vault. The server must be stopped while you do this:
   ```bash
   npm run new-vault
   ```

**Every time you want it online:**

```bash
npm run host
```

This builds the app, starts the server (reachable only from this laptop), keeps
the laptop from sleeping, and opens the public link. It prints the link, which
is the same every time. Press **Ctrl+C** to take it offline.

The first time, `tailscale funnel` may print a link to enable HTTPS and Funnel
for your account. Open it, approve, then run `npm run host` again. The very
first visit can take up to a minute while the certificate is issued.

When the server starts, it prints `visitor addresses: OK` once someone connects.
That means wrong-phrase limits apply to each person separately. If it says
`NOT available`, everyone shares one limit, so 10 wrong guesses in total would
block unlocking for 15 minutes.

**Good to know:**
- The vault is only reachable while your laptop is on and running `npm run host`.
  Closing the lid may still put the laptop to sleep.
- Everything is stored in `data/`. Back it up now and then; it's all encrypted.
- The `ts.net` address is public: anyone with the link sees a plain notes app.
  The vault stays invisible without the phrase.

## Deploying elsewhere

The app must be served over HTTPS (needed for `wss://`, the service worker and
HSTS). Environment variables:

| Variable | Purpose |
|---|---|
| `PORT` | default `8787` |
| `HOST` | default `127.0.0.1` (this machine only). Use `0.0.0.0` to accept connections directly from other machines. |
| `DATABASE_URL` | Postgres connection string. If unset, uses embedded Postgres (PGlite) in `./data/db`. |
| `S3_BUCKET`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_REGION` | Cloudflare R2 or any S3-compatible store. If unset, files are stored in `./data/blobs`. |
| `TRUST_PROXY=1` | Set this when running behind a reverse proxy, so rate limiting sees real client IPs. |
| `DATA_DIR` | default `./data` |

`node scripts/smoke-test.js "<phrase>"` acts as a second member and checks
unlock, live edits and encrypted file storage end to end.

Never change the constants in `shared/vaultcrypto.js` after creating vaults:
doing so makes every existing vault unreachable.
