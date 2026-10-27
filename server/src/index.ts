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
 *   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY
 *                Web Push key pair, base64url (65-byte uncompressed P-256 point /
 *                32-byte private scalar, as printed by `web-push generate-vapid-keys`).
 *                Default: generated on first start and stored in the database.
 *   VAPID_SUBJECT  contact for push services (default mailto:push@nestly.app)
 *   REMINDERS    `0` → no daily push reminders
 *   PUSH_ALLOW_ANY_HOST  `1` → accept push endpoints outside the known push services
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

const vapidPublicKey = env.VAPID_PUBLIC_KEY?.trim();
const vapidPrivateKey = env.VAPID_PRIVATE_KEY?.trim();
if (!vapidPublicKey !== !vapidPrivateKey) {
  console.error('Set both VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY, or neither');
  process.exit(1);
}

let app: ReturnType<typeof createApp>;
try {
  app = createApp({
    dbPath,
    staticDir,
    corsOrigin: env.CORS_ORIGIN || '*',
    trustProxy: env.TRUST_PROXY === '1',
    rateLimit: env.RATE_LIMIT !== '0',
    reminders: env.REMINDERS !== '0',
    pushAnyHost: env.PUSH_ALLOW_ANY_HOST === '1',
    pushSubject: env.VAPID_SUBJECT || undefined,
    vapidKeys: vapidPublicKey && vapidPrivateKey ? { publicKey: vapidPublicKey, privateKey: vapidPrivateKey } : null,
  });
} catch (err) {
  console.error(`Could not start: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

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
