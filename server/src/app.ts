/**
 * Nestly sync server: HTTP API (see docs/SYNC_PROTOCOL.md), server-sent events,
 * Web Push notifications and optional static hosting of the built web app.
 * Zero dependencies.
 */
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { COLLECTIONS } from '../../core/src/types.ts';
import type { Change, CollectionName } from '../../core/src/types.ts';
import { Store } from './db.ts';
import type { Membership, PushSubscriptionRow } from './db.ts';
import { decodeSubscriptionKeys, generateVapidKeys, sendPush, vapidPrivateKeyObject } from './push.ts';
import type { SendOptions, VapidKeys } from './push.ts';
import { activityMessage, normalizeLang, reminderMessage } from './push-text.ts';
import type { HouseholdInfo, PushMessage } from './push-text.ts';
import { dueChores, dueDeadlines, localDateHour } from './reminders.ts';
import type { ReminderData } from './reminders.ts';

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
  /** Daily chore/contract reminders via Web Push, checked every 10 minutes (default on). */
  reminders?: boolean;
  /** VAPID `sub` claim: a `mailto:` or `https:` contact (default `mailto:push@nestly.app`). */
  pushSubject?: string;
  /**
   * VAPID key pair (base64url: 65-byte uncompressed public point, 32-byte private
   * scalar). If absent, the pair stored in the database is used, or a new one is
   * generated and stored on first start.
   */
  vapidKeys?: VapidKeys | null;
  /** Accept push endpoints on any https host, not only the known browser push services. */
  pushAnyHost?: boolean;
}

export interface App {
  server: http.Server;
  /**
   * Sends the daily reminders that are due at `now` (default: the current time).
   * Resolves to the number of pushes the push services accepted.
   */
  runReminders(now?: Date): Promise<number>;
  /** Resolves once all background push deliveries started so far are done. */
  pushIdle(): Promise<void>;
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
/** Activities older than this when they reach the server do not notify (offline backlog). */
const ACTIVITY_PUSH_MAX_AGE_MS = 10 * 60_000;
/** Upper bound on activity notifications triggered by one request. */
const MAX_ACTIVITY_PUSHES = 10;
const PUSH_CONCURRENCY = 8;
const REMINDER_INTERVAL_MS = 10 * 60_000;
/** Local hour from which the daily reminder is sent. */
const REMINDER_HOUR = 9;
const REMINDER_TTL_S = 12 * 60 * 60;
const MAX_ENDPOINT_LENGTH = 2048;
const DEFAULT_PUSH_SUBJECT = 'mailto:push@nestly.app';
const VAPID_META_KEY = 'vapid_keys';

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

/* ------------------------------------- push ---------------------------------- */

/** Hosts of the browser push services (Chrome/Edge/Samsung via FCM, Firefox, Safari, legacy Edge). */
const PUSH_SERVICE_SUFFIXES = ['.googleapis.com', '.push.services.mozilla.com', '.push.apple.com', '.notify.windows.com'];

/**
 * Push endpoints must be https on a known push service (so the server can't be used to
 * POST to arbitrary hosts); plain http is only accepted for loopback hosts (local
 * development and tests with a fake push service). `anyHost` lifts the host check.
 */
function parsePushEndpoint(value: unknown, anyHost = false): string {
  const invalid = () => badRequest('subscription.endpoint must be an https:// URL');
  if (typeof value !== 'string' || value.length > MAX_ENDPOINT_LENGTH) throw invalid();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalid();
  }
  const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) throw invalid();
  if (url.username || url.password) throw invalid();
  const host = url.hostname.toLowerCase();
  if (!loopback && !anyHost && !PUSH_SERVICE_SUFFIXES.some((s) => host.endsWith(s))) {
    throw badRequest('subscription.endpoint is not a known push service');
  }
  return value;
}

/** Configured keys, else the pair stored in `meta`, else a new pair (stored for next time). */
function loadVapidKeys(store: Store, configured: VapidKeys | null | undefined): VapidKeys {
  if (configured) {
    vapidPrivateKeyObject(configured); // throws for malformed or mismatched keys
    return { publicKey: configured.publicKey, privateKey: configured.privateKey };
  }
  return store.transaction(() => {
    const stored = store.getMeta(VAPID_META_KEY);
    if (stored) {
      try {
        const keys = JSON.parse(stored) as VapidKeys;
        vapidPrivateKeyObject(keys);
        return { publicKey: keys.publicKey, privateKey: keys.privateKey };
      } catch {
        console.warn('Stored VAPID keys are invalid; generating new ones (existing push subscriptions stop working)');
      }
    }
    const keys = generateVapidKeys();
    store.setMeta(VAPID_META_KEY, JSON.stringify(keys));
    return keys;
  });
}

/** Runs async jobs with at most `limit` in flight; results keep the job order. */
async function runLimited<T>(jobs: Array<() => Promise<T>>, limit: number): Promise<T[]> {
  const results: T[] = new Array(jobs.length);
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const i = next++;
      results[i] = await jobs[i]!();
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, worker));
  return results;
}

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
  memberId: string;
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
  let closed = false;
  let vapidKeys: VapidKeys;
  try {
    vapidKeys = loadVapidKeys(store, options.vapidKeys);
  } catch (err) {
    store.close();
    throw err;
  }
  const pushSubject = options.pushSubject || DEFAULT_PUSH_SUBJECT;

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

  /* ----------------------------------- push ---------------------------------- */

  /** Background deliveries, so tests (and callers) can wait for them. */
  const pushTasks = new Set<Promise<unknown>>();

  function track(task: Promise<unknown>): void {
    const tracked = task
      .catch((err: unknown) => console.error('Push delivery failed:', err))
      .finally(() => pushTasks.delete(tracked));
    pushTasks.add(tracked);
  }

  /** Sends one message; deletes the subscription if the push service reports it gone. */
  async function deliver(sub: PushSubscriptionRow, message: PushMessage, opts?: SendOptions): Promise<boolean> {
    const result = await sendPush(sub, JSON.stringify(message), vapidKeys, pushSubject, opts);
    if (result.gone && !closed) store.deletePushSubscription(sub.endpoint);
    return result.status >= 200 && result.status < 300;
  }

  function householdInfo(householdId: string): HouseholdInfo {
    const household = store.record(householdId, 'household', householdId)?.data ?? {};
    const str = (value: unknown) => (typeof value === 'string' ? value : '');
    const memberNames = new Map<string, string>();
    for (const { id, data } of store.records(householdId, 'members')) {
      if (typeof data.name === 'string') memberNames.set(id, data.name);
    }
    return { name: str(household.name), emoji: str(household.emoji), currency: str(household.currency) || 'EUR', memberNames };
  }

  /**
   * Notifies the other members about activity records that `pusherId` just
   * created. Runs after the response is sent and never affects the request.
   */
  function notifyActivities(householdId: string, pusherId: string, created: readonly Change[]): void {
    const now = Date.now();
    const activities = created
      .filter((change) => change.c === 'activity')
      .map((change) => change.data)
      .filter((data) => typeof data.createdAt === 'number' && now - data.createdAt < ACTIVITY_PUSH_MAX_AGE_MS)
      .slice(-MAX_ACTIVITY_PUSHES);
    if (activities.length === 0) return;
    track(
      (async () => {
        await new Promise((resolve) => setImmediate(resolve));
        if (closed) return;
        const subs = store.pushSubscriptions(householdId);
        if (subs.length === 0) return;
        const info = householdInfo(householdId);
        const jobs: Array<() => Promise<boolean>> = [];
        for (const activity of activities) {
          for (const sub of subs) {
            if (sub.memberId === activity.actorId || sub.memberId === pusherId) continue;
            const message = activityMessage(activity, info, sub.memberId, normalizeLang(sub.lang));
            if (message) jobs.push(() => deliver(sub, message));
          }
        }
        await runLimited(jobs, PUSH_CONCURRENCY);
      })(),
    );
  }

  /**
   * For every subscription whose household-local time is past 09:00 and that
   * has not been checked today: marks it checked and sends one reminder with
   * the member's due chores and close contract deadlines (if any).
   */
  async function runReminders(now: Date = new Date()): Promise<number> {
    if (closed) return 0;
    const byHousehold = new Map<string, PushSubscriptionRow[]>();
    for (const sub of store.allPushSubscriptions()) {
      const list = byHousehold.get(sub.householdId) ?? [];
      list.push(sub);
      byHousehold.set(sub.householdId, list);
    }
    const jobs: Array<() => Promise<boolean>> = [];
    const collect = (householdId: string, subs: PushSubscriptionRow[]) => {
      const household = store.record(householdId, 'household', householdId)?.data ?? {};
      const { date, hour } = localDateHour(now, household.timezone);
      if (hour < REMINDER_HOUR) return;
      const pending = subs.filter((sub) => sub.lastReminder !== date);
      if (pending.length === 0) return;
      const data: ReminderData = {
        members: store.records(householdId, 'members').map((r) => r.data),
        chores: store.liveRecords(householdId, 'chores'),
        contracts: store.liveRecords(householdId, 'contracts'),
        events: store.liveRecords(householdId, 'events'),
      };
      const info = householdInfo(householdId);
      const deadlines = dueDeadlines(data.contracts, date);
      for (const sub of pending) {
        store.setLastReminder(sub.endpoint, date);
        const member = data.members.find((m) => m.id === sub.memberId);
        if (member && (member.deleted === true || member.leftAt != null)) continue;
        const message = reminderMessage({ chores: dueChores(data, sub.memberId, date), deadlines }, info, normalizeLang(sub.lang));
        if (message) jobs.push(() => deliver(sub, message, { topic: 'reminder', ttl: REMINDER_TTL_S }));
      }
    };
    for (const [householdId, subs] of byHousehold) {
      try {
        collect(householdId, subs);
      } catch (err) {
        // Malformed records in one household must not stop the others' reminders.
        console.error(`Reminders for household ${householdId} failed:`, err);
      }
    }
    const results = await runLimited(jobs, PUSH_CONCURRENCY);
    return results.filter(Boolean).length;
  }

  let reminderRun: Promise<unknown> | null = null;
  const reminderTimer =
    options.reminders === false
      ? null
      : setInterval(() => {
          if (reminderRun || closed) return;
          reminderRun = runReminders()
            .catch((err: unknown) => console.error('Reminder run failed:', err))
            .finally(() => (reminderRun = null));
        }, REMINDER_INTERVAL_MS);
  reminderTimer?.unref();

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
    const created: Change[] = [];
    const accepted = store.transaction(() => {
      if (store.isMemberClaimed(householdId, memberId)) return null;
      const count = store.applyChanges(householdId, changes, created);
      store.addMembership(hashToken(token), householdId, memberId);
      return count;
    });
    if (accepted === null) throw new HttpError(409, 'member_claimed', 'Another device already joined as this member');
    if (accepted > 0) broadcastSync(householdId, memberId);
    // The joining device has no data yet, so its first pull starts at 0.
    sendJson(res, 200, { householdId, memberId, token, cursor: 0 });
    notifyActivities(householdId, memberId, created);
  }

  async function sync(req: http.IncomingMessage, res: http.ServerResponse, url: URL, auth: Membership) {
    let since: number;
    const created: Change[] = [];
    if (req.method === 'POST') {
      const body = await readJsonObject(req);
      since = parseSince(body.since);
      const changes = parseChanges(body.changes, auth.householdId);
      if (store.applyChanges(auth.householdId, changes, created) > 0) broadcastSync(auth.householdId, auth.memberId);
    } else {
      const raw = url.searchParams.get('since');
      since = parseSince(raw !== null && /^\d+$/.test(raw) ? Number(raw) : (raw ?? undefined));
    }
    sendJson(res, 200, store.pull(auth.householdId, since, PAGE_SIZE));
    notifyActivities(auth.householdId, auth.memberId, created);
  }

  function openEvents(res: http.ServerResponse, auth: Session) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no', // disable proxy buffering (nginx)
    });
    res.write(sseFrame('hello', { cursor: store.head(auth.householdId), memberId: auth.memberId }));

    const listener: Listener = { res, tokenHash: auth.tokenHash, memberId: auth.memberId };
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
    store.transaction(() => {
      store.revokeMembership(auth.tokenHash);
      store.deletePushSubscriptionsForToken(auth.tokenHash);
    });
    // End this device's event streams; its token is no longer valid.
    for (const listener of listeners.get(auth.householdId) ?? []) {
      if (listener.tokenHash !== auth.tokenHash) continue;
      removeListener(auth.householdId, listener);
      listener.res.end();
    }
    sendJson(res, 200, { ok: true });
  }

  /** Frees a member profile whose device is lost, so it can be claimed again with an invite. */
  async function release(req: http.IncomingMessage, res: http.ServerResponse, auth: Session) {
    const body = await readJsonObject(req);
    const memberId = body.memberId;
    if (typeof memberId !== 'string' || !ID_RE.test(memberId)) throw badRequest('memberId is invalid');
    if (memberId === auth.memberId) throw badRequest('use /leave to sign out this device');
    const revoked = store.transaction(() => {
      store.deletePushSubscriptionsForMember(auth.householdId, memberId);
      return store.revokeMember(auth.householdId, memberId);
    });
    for (const listener of listeners.get(auth.householdId) ?? []) {
      if (listener.memberId !== memberId) continue;
      removeListener(auth.householdId, listener);
      listener.res.end();
    }
    sendJson(res, 200, { ok: true, revoked });
  }

  /** Registers (or refreshes) this device's push subscription. */
  async function subscribePush(req: http.IncomingMessage, res: http.ServerResponse, auth: Session) {
    const body = await readJsonObject(req);
    const subscription = body.subscription;
    if (!isPlainObject(subscription)) throw badRequest('subscription must be an object');
    const endpoint = parsePushEndpoint(subscription.endpoint, options.pushAnyHost);
    const keys = isPlainObject(subscription.keys) ? subscription.keys : {};
    const decoded = decodeSubscriptionKeys(keys.p256dh, keys.auth);
    if (!decoded) {
      throw badRequest('subscription.keys needs base64url p256dh (65-byte P-256 point) and auth (16 bytes)');
    }
    store.upsertPushSubscription({
      endpoint,
      householdId: auth.householdId,
      memberId: auth.memberId,
      tokenHash: auth.tokenHash,
      p256dh: decoded.uaPublic.toString('base64url'),
      auth: decoded.authSecret.toString('base64url'),
      lang: normalizeLang(body.lang),
    });
    sendJson(res, 200, { ok: true });
  }

  async function unsubscribePush(req: http.IncomingMessage, res: http.ServerResponse, auth: Session) {
    const body = await readJsonObject(req);
    const endpoint = body.endpoint;
    if (typeof endpoint !== 'string' || endpoint === '' || endpoint.length > MAX_ENDPOINT_LENGTH) {
      throw badRequest('endpoint is required');
    }
    store.deletePushSubscription(endpoint, auth.householdId);
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
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
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

    if (resource === 'push' && param === 'key' && action === undefined) {
      allow(req, 'GET');
      return sendJson(res, 200, { publicKey: vapidKeys.publicKey });
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
        case 'release':
          allow(req, 'POST');
          return release(req, res, authenticate(req, householdId));
        case 'push':
          allow(req, 'POST', 'DELETE');
          if (req.method === 'DELETE') return unsubscribePush(req, res, authenticate(req, householdId));
          return subscribePush(req, res, authenticate(req, householdId));
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
    runReminders,
    async pushIdle() {
      while (pushTasks.size > 0) await Promise.all(pushTasks);
    },
    close() {
      closed = true;
      clearInterval(heartbeat);
      clearInterval(pruneTimer);
      if (reminderTimer) clearInterval(reminderTimer);
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
