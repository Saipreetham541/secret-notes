// Pre-compresses the built app (brotli + gzip) so slow home uploads send as
// few bytes as possible. The server picks the best version each browser accepts.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const DIST = path.resolve('dist');
const COMPRESSIBLE = /\.(js|css|html|svg|json|webmanifest|txt)$/;

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]
  );
}

let before = 0, after = 0;
for (const file of walk(DIST)) {
  if (!COMPRESSIBLE.test(file)) continue;
  const buf = fs.readFileSync(file);
  const br = zlib.brotliCompressSync(buf, {
    params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length },
  });
  fs.writeFileSync(file + '.br', br);
  fs.writeFileSync(file + '.gz', zlib.gzipSync(buf, { level: 9 }));
  before += buf.length;
  after += br.length;
}
console.log(`compressed app: ${(before / 1024).toFixed(0)} KB -> ${(after / 1024).toFixed(0)} KB (brotli)`);
