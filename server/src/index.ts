/**
 * Server entry point: `node server/src/index.ts`.
 *
 * Environment:
 *   PORT         listen port (default 8787)
 *   HOST         listen address (default 0.0.0.0)
 *   DB_PATH      SQLite file (default <repo>/server/data/nestly.db)
 *   STATIC_DIR   built web app to serve (default <repo>/app/dist if it exists)
 *   CORS_ORIGIN  Access-Control-Allow-Origin (default *)
 *   TRUST_PROXY  `1` → client IP from the first X-Forwarded-For entry
 *   RATE_LIMIT   `0` → disable per-IP rate limiting
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.ts';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const env = process.env;

const port = Number(env.PORT || 8787);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error(`Invalid PORT: ${env.PORT}`);
  process.exit(1);
}
const host = env.HOST || '0.0.0.0';

const dbPath = env.DB_PATH || path.join(repoRoot, 'server', 'data', 'nestly.db');
if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });

const defaultStaticDir = path.join(repoRoot, 'app', 'dist');
let staticDir = env.STATIC_DIR || (fs.existsSync(defaultStaticDir) ? defaultStaticDir : null);
if (staticDir && !fs.existsSync(staticDir)) {
  console.warn(`STATIC_DIR ${staticDir} does not exist; static hosting is off`);
  staticDir = null;
}

const app = createApp({
  dbPath,
  staticDir,
  corsOrigin: env.CORS_ORIGIN || '*',
  trustProxy: env.TRUST_PROXY === '1',
  rateLimit: env.RATE_LIMIT !== '0',
});

app.server.on('error', (err) => {
  console.error(`Server error: ${err.message}`);
  process.exit(1);
});

app.server.listen(port, host, () => {
  const address = app.server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  const shownHost = host === '0.0.0.0' || host === '::' ? 'localhost' : host;
  console.log(
    `Nestly server listening on http://${shownHost}:${actualPort} (db: ${dbPath}, static: ${staticDir ?? 'off'})`,
  );
});

let shuttingDown = false;
function shutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) process.exit(1); // second signal: give up waiting
  shuttingDown = true;
  console.log(`${signal} received, shutting down`);
  setTimeout(() => process.exit(1), 5000).unref();
  app.close().then(
    () => process.exit(0),
    (err: unknown) => {
      console.error(err);
      process.exit(1);
    },
  );
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
