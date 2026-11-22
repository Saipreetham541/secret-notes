// Encrypted file chunks. Cloudflare R2 (or any S3-compatible store) when
// S3_BUCKET is set; otherwise files on local disk under ./data/blobs.
import fs from 'node:fs/promises';
import path from 'node:path';

export async function openBlobStore() {
  if (process.env.S3_BUCKET) {
    const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = await import('@aws-sdk/client-s3');
    const client = new S3Client({
      region: process.env.S3_REGION || 'auto',
      endpoint: process.env.S3_ENDPOINT, // e.g. https://<account>.r2.cloudflarestorage.com
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
      },
    });
    const Bucket = process.env.S3_BUCKET;
    return {
      put: (id, buf) => client.send(new PutObjectCommand({ Bucket, Key: id, Body: buf })),
      async get(id) {
        const r = await client.send(new GetObjectCommand({ Bucket, Key: id }));
        return Buffer.from(await r.Body.transformToByteArray());
      },
      del: (id) => client.send(new DeleteObjectCommand({ Bucket, Key: id })),
    };
  }
  const dir = path.resolve(process.env.DATA_DIR || 'data', 'blobs');
  await fs.mkdir(dir, { recursive: true });
  const file = (id) => path.join(dir, id);
  return {
    put: (id, buf) => fs.writeFile(file(id), buf),
    get: (id) => fs.readFile(file(id)),
    del: (id) => fs.rm(file(id), { force: true }),
  };
}
