/**
 * Nestly sync server: HTTP API (see docs/SYNC_PROTOCOL.md), server-sent events
 * and optional static hosting of the built web app. Zero dependencies.
 */
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { COLLECTIONS } from '../../core/src/types.ts';
import type { Change, CollectionName } from '../../core/src/types.ts';
import { Store } from './db.ts';
import type { Membership } from './db.ts';

export interface AppOptions {
  /** SQLite file path, or `:memory:`. */
  dbPath: string;
  /** Directory with the built web app; served for non-`/api` GET/HEAD requests. */
  staticDir?: string | null;
  /** Value of `Access-Control-Allow-Origin` (default `*`). */
  corsOrigin?: string;
  /** Use the first `X-Forwarded-For` entry as client IP (behind a reverse proxy). */
  trustProxy?: boolean;
  /** Per-IP rate limiting (default on). */
  rateLimit?: boolean;
}

export interface App {
  server: http.Server;
  close(): Promise<void>;
}

/* ---------------------------------- limits ---------------------------------- */

const MAX_BODY_BYTES = 4 * 1024 * 1024;
const MAX_RECORD_BYTES = 64 * 1024;
const MAX_CHANGES = 2000;
const PAGE_SIZE = 1000;
const HEARTBEAT_MS = 25_000;
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT_GENERAL = 300;
const RATE_LIMIT_INVITE = 30;

const ID_RE = /^[A-Za-z0-9_:.\-]{1,128}$/;
const ENTITY_ID_RE = /^[A-Za-z0-9_\-]{8,64}$/;
const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const INVITE_RE = new RegExp(`^[${INVITE_ALPHABET}]{6}$`);

const VERSION = readVersion();

function readVersion(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/* ------------------------------ errors & replies ----------------------------- */

class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly headers: http.OutgoingHttpHeaders;
  constructor(status: number, code: string, message?: string, headers: http.OutgoingHttpHeaders = {}) {
    super(message ?? code);
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

const badRequest = (message: string) => new HttpError(400, 'bad_request', message);
const unauthorized = (message: string) => new HttpError(401, 'unauthorized', message);
const notFound = (message = 'Not found') => new HttpError(404, 'not_found', message);

function sendJson(res: http.ServerResponse, status: number, body: unknown, headers: http.OutgoingHttpHeaders = {}): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(payload);
}

function sendError(res: http.ServerResponse, err: unknown): void {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  if (!(err instanceof HttpError)) {
    console.error('Unhandled error:', err);
    sendJson(res, 500, { error: 'internal', message: 'Internal server error' });
    return;
  }
  sendJson(res, err.status, { error: err.code, message: err.message }, err.headers);
}

/* --------------------------------- request body ------------------------------ */

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    // `Connection: close` stops the server from reading the rest of an oversized upload.
    const tooLarge = () =>
      new HttpError(413, 'too_large', `Request body exceeds ${MAX_BODY_BYTES} bytes`, { Connection: 'close' });
    if (Number(req.headers['content-length'] ?? 0) > MAX_BODY_BYTES) {
      req.resume();
      reject(tooLarge());
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let overflow = false;
    req.on('data', (chunk: Buffer) => {
      if (overflow) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        overflow = true;
        chunks.length = 0;
        reject(tooLarge());
      } else {
        chunks.push(chunk);
      }
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
    // No-op once settled; prevents a hanging handler if the client disconnects.
    req.on('close', () => reject(badRequest('Request aborted')));
  });
}

async function readJsonObject(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const text = await readBody(req);
  if (text.trim() === '') return {};
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw badRequest('Body is not valid JSON');
  }
  if (!isPlainObject(value)) throw badRequest('Body must be a JSON object');
  return value;
}

/* ---------------------------------- validation ------------------------------- */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCollection(value: unknown): value is CollectionName {
  return typeof value === 'string' && (COLLECTIONS as readonly string[]).includes(value);
}

function requireEntityId(value: unknown, field: string): string {
  if (typeof value !== 'string' || !ENTITY_ID_RE.test(value)) {
    throw badRequest(`${field} must match ${ENTITY_ID_RE.source}`);
  }
  return value;
}

/** Validates a `changes` array per the protocol; any invalid change rejects the request. */
function parseChanges(value: unknown, householdId: string): Change[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw badRequest('changes must be an array');
  if (value.length > MAX_CHANGES) throw badRequest(`At most ${MAX_CHANGES} changes per request`);
  return value.map((raw: unknown, i): Change => {
    const fail = (message: string) => badRequest(`changes[${i}]: ${message}`);
    if (!isPlainObject(raw)) throw fail('must be an object');
    const { c, id, u, data } = raw;
    if (!isCollection(c)) throw fail('unknown collection');
    if (typeof id !== 'string' || !ID_RE.test(id)) throw fail(`id must match ${ID_RE.source}`);
    if (typeof u !== 'number' || !Number.isFinite(u) || u <= 0) throw fail('u must be a finite, positive number');
    if (!isPlainObject(data)) throw fail('data must be an object');
    if (data.id !== id) throw fail('data.id must equal id');
    if (Buffer.byteLength(JSON.stringify(data)) > MAX_RECORD_BYTES) throw fail(`data exceeds ${MAX_RECORD_BYTES} bytes`);
    if (c === 'household' && id !== householdId) throw fail('household record id must equal the household id');
    return { c, id, u, data };
  });
}

function parseSince(value: unknown): number {
  if (value === undefined || value === null) return 0;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw badRequest('since must be a non-negative integer');
  }
  return value;
}

/* ------------------------------- invites & tokens ---------------------------- */

function generateInviteCode(): string {
  let code = '';
  for (let i = 0; i < 6; i++) code += INVITE_ALPHABET[crypto.randomInt(INVITE_ALPHABET.length)];
  return code;
}

/** Uppercases and strips spaces/dashes; returns null if the result is not a valid code. */
function normalizeInviteCode(raw: string): string | null {
  const code = raw.toUpperCase().replace(/[\s-]+/g, '');
  return INVITE_RE.test(code) ? code : null;
}

const newToken = () => crypto.randomBytes(32).toString('base64url');
const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

/* --------------------------------- rate limiting ----------------------------- */

/** Fixed-window counter per key. */
class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();
  private readonly limit: number;

  constructor(limit: number) {
    this.limit = limit;
  }

  /** Counts a hit; returns 0 if allowed, otherwise the seconds until the window resets. */
  hit(key: string, now = Date.now()): number {
    let entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + RATE_WINDOW_MS };
      this.hits.set(key, entry);
    }
    entry.count++;
    return entry.count > this.limit ? Math.ceil((entry.resetAt - now) / 1000) : 0;
  }

  prune(now = Date.now()): void {
    for (const [key, entry] of this.hits) if (entry.resetAt <= now) this.hits.delete(key);
  }
}

/* --------------------------------- static files ------------------------------ */

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

async function statOrNull(file: string): Promise<fs.Stats | null> {
  try {
    return await fs.promises.stat(file);
  } catch {
    return null;
  }
}

function etagMatches(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  const bare = (tag: string) => tag.trim().replace(/^W\//, '');
  return header.split(',').some((tag) => tag.trim() === '*' || bare(tag) === bare(etag));
}

/**
 * Serves a file from `root`. Unknown paths without a file extension fall back
 * to `index.html` so client-side routes work on reload.
 */
async function serveStatic(req: http.IncomingMessage, res: http.ServerResponse, root: string, pathname: string) {
  let rel: string;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    throw badRequest('Malformed URL');
  }
  if (rel.includes('\0')) throw badRequest('Malformed URL');

  let file = path.join(root, rel);
  // path.join resolves `..` segments (e.g. from an encoded `..%2f`); refuse anything outside root.
  if (file !== root && !file.startsWith(root + path.sep)) throw notFound();

  let stat = await statOrNull(file);
  if (stat?.isDirectory()) {
    file = path.join(file, 'index.html');
    stat = await statOrNull(file);
  }
  if (!stat?.isFile()) {
    if (path.extname(rel) !== '') throw notFound();
    file = path.join(root, 'index.html');
    stat = await statOrNull(file);
    if (!stat?.isFile()) throw notFound();
  }

  const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
  const headers: http.OutgoingHttpHeaders = {
    // Always revalidate: index.html and sw.js must never be served stale, and
    // the ETag keeps revalidation cheap for everything else.
    'Cache-Control': 'no-cache',
    ETag: etag,
    'Last-Modified': stat.mtime.toUTCString(),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  };
  if (path.basename(file) === 'sw.js') headers['Service-Worker-Allowed'] = '/';

  if (etagMatches(req.headers['if-none-match'], etag)) {
    res.writeHead(304, headers);
    res.end();
    return;
  }

  res.writeHead(200, {
    ...headers,
    'Content-Type': CONTENT_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
    'Content-Length': stat.size,
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  fs.createReadStream(file)
    .on('error', () => res.destroy())
    .pipe(res);
}

/* ------------------------------------- app ----------------------------------- */

/** An authenticated device: its membership plus the hash of the token it used. */
type Session = Membership & { tokenHash: string };

interface Listener {
  res: http.ServerResponse;
  tokenHash: string;
}

export function createApp(options: AppOptions): App {
  const store = new Store(options.dbPath);
  const corsOrigin = options.corsOrigin ?? '*';
  const trustProxy = options.trustProxy ?? false;
  const staticRoot =
    options.staticDir && fs.existsSync(options.staticDir) ? path.resolve(options.staticDir) : null;
  const limiters =
    options.rateLimit === false
      ? null
      : { general: new RateLimiter(RATE_LIMIT_GENERAL), invite: new RateLimiter(RATE_LIMIT_INVITE) };

  /* ------------------------------ SSE listeners ------------------------------ */

  /** Open event streams per household. */
  const listeners = new Map<string, Set<Listener>>();

  const sseFrame = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

  function removeListener(householdId: string, listener: Listener): void {
    const set = listeners.get(householdId);
    if (!set?.delete(listener)) return;
    if (set.size === 0) listeners.delete(householdId);
  }

  // Writing to an ended response emits an unhandled 'error', so check first.
  function writeTo(listener: Listener, chunk: string): void {
    if (!listener.res.writableEnded && !listener.res.destroyed) listener.res.write(chunk);
  }

  function broadcastSync(householdId: string, by: string): void {
    const set = listeners.get(householdId);
    if (!set) return;
    const frame = sseFrame('sync', { cursor: store.head(householdId), by });
    for (const listener of set) writeTo(listener, frame);
  }

  const heartbeat = setInterval(() => {
    for (const set of listeners.values()) for (const listener of set) writeTo(listener, ': heartbeat\n\n');
  }, HEARTBEAT_MS);
  heartbeat.unref();

  const pruneTimer = setInterval(() => {
    limiters?.general.prune();
    limiters?.invite.prune();
  }, RATE_WINDOW_MS);
  pruneTimer.unref();

  /* ---------------------------------- helpers -------------------------------- */

  function clientIp(req: http.IncomingMessage): string {
    if (trustProxy) {
      const forwarded = req.headers['x-forwarded-for'];
      const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
      if (first) return first;
    }
    return req.socket.remoteAddress ?? 'unknown';
  }

  function checkRateLimit(req: http.IncomingMessage, pathname: string): void {
    if (!limiters) return;
    const ip = clientIp(req);
    const retryAfter =
      limiters.general.hit(ip) || (pathname.startsWith('/api/invites/') ? limiters.invite.hit(ip) : 0);
    if (retryAfter > 0) {
      throw new HttpError(429, 'rate_limited', 'Too many requests', { 'Retry-After': String(retryAfter) });
    }
  }

  /** Resolves the bearer token (header, or `?token=` for SSE) to a membership of `householdId`. */
  function authenticate(req: http.IncomingMessage, householdId: string, queryToken: string | null = null): Session {
    const header = req.headers.authorization;
    const token = (header && /^Bearer\s+(\S+)\s*$/i.exec(header)?.[1]) || queryToken;
    if (!token) throw unauthorized('Missing bearer token');
    const tokenHash = hashToken(token);
    const membership = store.membership(tokenHash);
    if (!membership || membership.householdId !== householdId) throw unauthorized('Invalid token');
    return { ...membership, tokenHash };
  }

  function uniqueInviteCode(): string {
    // 32^6 ≈ 1e9 codes, so collisions are rare; retry a few times to be safe.
    for (let attempt = 0; attempt < 20; attempt++) {
      const code = generateInviteCode();
      if (store.householdIdForInvite(code) === undefined) return code;
    }
    throw new Error('Could not allocate a unique invite code');
  }

  function inviteHouseholdId(rawCode: string): string {
    let decoded: string;
    try {
      decoded = decodeURIComponent(rawCode);
    } catch {
      throw notFound('Unknown invite code');
    }
    const code = normalizeInviteCode(decoded);
    const householdId = code && store.householdIdForInvite(code);
    if (!householdId) throw notFound('Unknown invite code');
    return householdId;
  }

  /* --------------------------------- handlers -------------------------------- */

  async function createHousehold(req: http.IncomingMessage, res: http.ServerResponse) {
    const body = await readJsonObject(req);
    const householdId = requireEntityId(body.householdId, 'householdId');
    const memberId = requireEntityId(body.memberId, 'memberId');
    const changes = parseChanges(body.changes, householdId);
    // parseChanges guarantees a household change has id === householdId.
    if (!changes.some((change) => change.c === 'household')) throw badRequest('changes must contain the household record');

    const token = newToken();
    const created = store.transaction(() => {
      if (store.householdExists(householdId)) return null;
      const inviteCode = uniqueInviteCode();
      store.insertHousehold(householdId, inviteCode);
      store.applyChanges(householdId, changes);
      store.addMembership(hashToken(token), householdId, memberId);
      return { inviteCode, cursor: store.head(householdId) };
    });
    if (!created) throw new HttpError(409, 'conflict', 'Household already exists');
    sendJson(res, 201, { token, ...created });
  }

  function previewInvite(res: http.ServerResponse, rawCode: string) {
    const householdId = inviteHouseholdId(rawCode);
    const household = store.record(householdId, 'household', householdId)?.data ?? {};
    const claimed = store.claimedMemberIds(householdId);
    const str = (value: unknown) => (typeof value === 'string' ? value : undefined);
    const members = store
      .records(householdId, 'members')
      .filter(({ data }) => data.deleted !== true && data.leftAt == null)
      .sort((a, b) => (Number(a.data.createdAt) || 0) - (Number(b.data.createdAt) || 0) || a.id.localeCompare(b.id))
      .map(({ id, data }) => ({
        id,
        name: str(data.name) ?? '',
        emoji: str(data.emoji),
        color: str(data.color),
        claimed: claimed.has(id),
      }));
    sendJson(res, 200, { householdId, name: str(household.name) ?? '', emoji: str(household.emoji), members });
  }

  async function joinHousehold(req: http.IncomingMessage, res: http.ServerResponse, rawCode: string) {
    const body = await readJsonObject(req);
    const householdId = inviteHouseholdId(rawCode);
    const memberId = requireEntityId(body.memberId, 'memberId');
    const changes = parseChanges(body.changes, householdId);

    const token = newToken();
    const accepted = store.transaction(() => {
      if (store.isMemberClaimed(householdId, memberId)) return null;
      const count = store.applyChanges(householdId, changes);
      store.addMembership(hashToken(token), householdId, memberId);
      return count;
    });
    if (accepted === null) throw new HttpError(409, 'member_claimed', 'Another device already joined as this member');
    if (accepted > 0) broadcastSync(householdId, memberId);
    // The joining device has no data yet, so its first pull starts at 0.
    sendJson(res, 200, { householdId, memberId, token, cursor: 0 });
  }

  async function sync(req: http.IncomingMessage, res: http.ServerResponse, url: URL, auth: Membership) {
    let since: number;
    if (req.method === 'POST') {
      const body = await readJsonObject(req);
      since = parseSince(body.since);
      const changes = parseChanges(body.changes, auth.householdId);
      if (store.applyChanges(auth.householdId, changes) > 0) broadcastSync(auth.householdId, auth.memberId);
    } else {
      const raw = url.searchParams.get('since');
      since = parseSince(raw !== null && /^\d+$/.test(raw) ? Number(raw) : (raw ?? undefined));
    }
    sendJson(res, 200, store.pull(auth.householdId, since, PAGE_SIZE));
  }

  function openEvents(res: http.ServerResponse, auth: Session) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no', // disable proxy buffering (nginx)
    });
    res.write(sseFrame('hello', { cursor: store.head(auth.householdId), memberId: auth.memberId }));

    const listener: Listener = { res, tokenHash: auth.tokenHash };
    const set = listeners.get(auth.householdId) ?? new Set();
    listeners.set(auth.householdId, set);
    set.add(listener);
    res.on('close', () => removeListener(auth.householdId, listener));
  }

  function rotateInvite(res: http.ServerResponse, householdId: string) {
    const inviteCode = store.transaction(() => {
      const code = uniqueInviteCode();
      store.setInviteCode(householdId, code);
      return code;
    });
    sendJson(res, 200, { inviteCode });
  }

  function leave(res: http.ServerResponse, auth: Session) {
    store.revokeMembership(auth.tokenHash);
    // End this device's event streams; its token is no longer valid.
    for (const listener of listeners.get(auth.householdId) ?? []) {
      if (listener.tokenHash !== auth.tokenHash) continue;
      removeListener(auth.householdId, listener);
      listener.res.end();
    }
    sendJson(res, 200, { ok: true });
  }

  /* ---------------------------------- routing -------------------------------- */

  function allow(req: http.IncomingMessage, ...methods: string[]): void {
    if (!methods.includes(req.method ?? '')) {
      throw new HttpError(405, 'bad_request', 'Method not allowed', { Allow: methods.join(', ') });
    }
  }

  async function handleApi(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<void> {
    res.setHeader('Access-Control-Allow-Origin', corsOrigin);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Max-Age': '86400',
      });
      res.end();
      return;
    }
    checkRateLimit(req, url.pathname);

    const [, , resource, param, action, ...rest] = url.pathname.split('/');
    if (rest.length > 0) throw notFound();

    if (resource === 'health' && param === undefined) {
      allow(req, 'GET');
      return sendJson(res, 200, { ok: true, version: VERSION });
    }

    if (resource === 'invites' && param) {
      if (action === undefined) {
        allow(req, 'GET');
        return previewInvite(res, param);
      }
      if (action === 'join') {
        allow(req, 'POST');
        return joinHousehold(req, res, param);
      }
    }

    if (resource === 'households') {
      if (param === undefined) {
        allow(req, 'POST');
        return createHousehold(req, res);
      }
      const householdId = param;
      switch (action) {
        case 'sync':
          allow(req, 'GET', 'POST');
          return sync(req, res, url, authenticate(req, householdId));
        case 'events':
          allow(req, 'GET');
          return openEvents(res, authenticate(req, householdId, url.searchParams.get('token')));
        case 'invite':
          allow(req, 'GET', 'POST');
          authenticate(req, householdId);
          if (req.method === 'POST') return rotateInvite(res, householdId);
          return sendJson(res, 200, { inviteCode: store.inviteCode(householdId) });
        case 'leave':
          allow(req, 'POST');
          return leave(res, authenticate(req, householdId));
      }
    }

    throw notFound();
  }

  async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    let url: URL;
    try {
      // Prefixing keeps a path like `//x` from being parsed as a host.
      url = new URL(`http://localhost${req.url?.startsWith('/') ? req.url : '/'}`);
    } catch {
      throw badRequest('Malformed URL');
    }
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return handleApi(req, res, url);
    if (staticRoot && (req.method === 'GET' || req.method === 'HEAD')) {
      return serveStatic(req, res, staticRoot, url.pathname);
    }
    throw notFound();
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((err: unknown) => sendError(res, err));
  });

  return {
    server,
    close() {
      clearInterval(heartbeat);
      clearInterval(pruneTimer);
      return new Promise<void>((resolve, reject) => {
        const done = (err?: Error) => {
          store.close();
          if (err) reject(err);
          else resolve();
        };
        if (!server.listening) return done();
        server.close(done);
        // Event streams never end on their own; drop them so close() can finish.
        for (const set of listeners.values()) for (const listener of set) listener.res.destroy();
        listeners.clear();
        server.closeIdleConnections();
      });
    },
  };
}
