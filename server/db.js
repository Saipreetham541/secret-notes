// Postgres when DATABASE_URL is set; otherwise embedded Postgres (PGlite) in ./data/db
// so the app runs locally with zero setup. Same SQL for both.
import path from 'node:path';
import fs from 'node:fs';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS vaults (
  id         TEXT PRIMARY KEY,
  auth_hash  TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS updates (
  seq      BIGSERIAL PRIMARY KEY,
  vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
  data     BYTEA NOT NULL
);
CREATE INDEX IF NOT EXISTS updates_vault_seq ON updates (vault_id, seq);
CREATE TABLE IF NOT EXISTS blobs (
  id         TEXT PRIMARY KEY,
  vault_id   TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS blobs_vault ON blobs (vault_id);
`;

async function connect() {
  if (process.env.DATABASE_URL) {
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    return {
      query: (sql, params) => pool.query(sql, params),
      async tx(fn) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const r = await fn({ query: (s, p) => client.query(s, p) });
          await client.query('COMMIT');
          return r;
        } catch (e) {
          await client.query('ROLLBACK');
          throw e;
        } finally {
          client.release();
        }
      },
      exec: (sql) => pool.query(sql),
    };
  }
  const { PGlite } = await import('@electric-sql/pglite');
  const dir = path.resolve(process.env.DATA_DIR || 'data', 'db');
  fs.mkdirSync(dir, { recursive: true });
  // The embedded database allows only one process at a time.
  const lock = path.join(dir, '..', 'db.lock');
  try {
    const pid = Number(fs.readFileSync(lock, 'utf8'));
    if (pid && pid !== process.pid) {
      process.kill(pid, 0); // throws if that process is gone
      throw new Error(`The embedded database is in use by process ${pid}. Stop the server first (or set DATABASE_URL to use Postgres).`);
    }
  } catch (e) {
    if (e.code !== 'ENOENT' && e.code !== 'ESRCH') throw e;
  }
  fs.writeFileSync(lock, String(process.pid));
  process.on('exit', () => {
    try { if (fs.readFileSync(lock, 'utf8') === String(process.pid)) fs.rmSync(lock); } catch {}
  });
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(0));
  const db = new PGlite(dir);
  await db.waitReady;
  return {
    query: (sql, params) => db.query(sql, params),
    tx: (fn) => db.transaction((t) => fn({ query: (s, p) => t.query(s, p) })),
    exec: (sql) => db.exec(sql),
  };
}

const toBuf = (v) => (Buffer.isBuffer(v) ? v : Buffer.from(v));

export async function openDb() {
  const db = await connect();
  await db.exec(SCHEMA);
  return {
    async createVault(id, authHash) {
      await db.query('INSERT INTO vaults (id, auth_hash) VALUES ($1, $2)', [id, authHash]);
    },
    async getVaultAuthHash(id) {
      const r = await db.query('SELECT auth_hash FROM vaults WHERE id = $1', [id]);
      return r.rows[0]?.auth_hash ?? null;
    },
    async listUpdates(vaultId) {
      const r = await db.query('SELECT seq, data FROM updates WHERE vault_id = $1 ORDER BY seq', [vaultId]);
      return r.rows.map((row) => ({ seq: Number(row.seq), data: toBuf(row.data) }));
    },
    async addUpdate(vaultId, data) {
      const r = await db.query('INSERT INTO updates (vault_id, data) VALUES ($1, $2) RETURNING seq', [vaultId, data]);
      return Number(r.rows[0].seq);
    },
    // Replace every update up to `upto` with a single merged snapshot.
    async compact(vaultId, upto, data) {
      return db.tx(async (t) => {
        await t.query('DELETE FROM updates WHERE vault_id = $1 AND seq <= $2', [vaultId, upto]);
        const r = await t.query('INSERT INTO updates (vault_id, data) VALUES ($1, $2) RETURNING seq', [vaultId, data]);
        return Number(r.rows[0].seq);
      });
    },
    async addBlob(id, vaultId) {
      await db.query('INSERT INTO blobs (id, vault_id) VALUES ($1, $2)', [id, vaultId]);
    },
    async blobVault(id) {
      const r = await db.query('SELECT vault_id FROM blobs WHERE id = $1', [id]);
      return r.rows[0]?.vault_id ?? null;
    },
    async deleteBlob(id) {
      await db.query('DELETE FROM blobs WHERE id = $1', [id]);
    },
  };
}
