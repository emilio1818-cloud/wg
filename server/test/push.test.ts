import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.ts';
import type { App, AppOptions } from '../src/app.ts';
import {
  MAX_PAYLOAD_BYTES,
  encryptPayload,
  generateVapidKeys,
  sanitizeTopic,
  sendPush,
  vapidAuthorization,
  vapidPrivateKeyObject,
} from '../src/push.ts';
import type { VapidKeys } from '../src/push.ts';
import type { Change, CollectionName } from '../../core/src/types.ts';

/* ------------------------- independent RFC 8291 receiver ------------------------- */

const hmac = (key: Buffer, data: Buffer) => crypto.createHmac('sha256', key).update(data).digest();
/** HKDF-Expand for a single block (length ≤ 32). */
const expand = (prk: Buffer, info: string | Buffer, length: number) =>
  hmac(prk, Buffer.concat([Buffer.from(info), Buffer.from([1])])).subarray(0, length);

/** A browser-side subscription: ECDH key pair plus auth secret. */
interface Browser {
  ecdh: crypto.ECDH;
  auth: Buffer;
  keys: { p256dh: string; auth: string };
}

function browser(): Browser {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = crypto.randomBytes(16);
  return { ecdh, auth, keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } };
}

/** Decrypts an `aes128gcm` Web Push body the way a user agent does (RFC 8291 §3.4, RFC 8188 §2). */
function decrypt(body: Buffer, ua: crypto.ECDH, authSecret: Buffer): Buffer {
  const salt = body.subarray(0, 16);
  const rs = body.readUInt32BE(16);
  const idlen = body[20]!;
  const asPublic = body.subarray(21, 21 + idlen);
  const record = body.subarray(21 + idlen);
  assert.equal(idlen, 65, 'keyid is the 65-byte application server key');
  assert.ok(record.length <= rs, 'single record fits the record size');

  const ecdhSecret = ua.computeSecret(asPublic);
  const prkKey = hmac(authSecret, ecdhSecret);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), asPublic]);
  const ikm = expand(prkKey, keyInfo, 32);
  const prk = hmac(salt, ikm);
  const cek = expand(prk, 'Content-Encoding: aes128gcm\0', 16);
  const nonce = expand(prk, 'Content-Encoding: nonce\0', 12);

  const decipher = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(record.subarray(-16));
  const padded = Buffer.concat([decipher.update(record.subarray(0, -16)), decipher.final()]);
  let end = padded.length - 1;
  while (end >= 0 && padded[end] === 0) end--;
  assert.equal(padded[end], 2, 'last record ends with the 0x02 delimiter');
  return padded.subarray(0, end);
}

function decryptJson(body: Buffer, b: Browser) {
  return JSON.parse(decrypt(body, b.ecdh, b.auth).toString('utf8'));
}

/** Parses `vapid t=<jwt>, k=<key>` and verifies the ES256 signature with the public key. */
function verifyVapid(header: string, publicKey: string) {
  const match = /^vapid t=([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+), k=([A-Za-z0-9_-]+)$/.exec(header);
  assert.ok(match, `unexpected Authorization header: ${header}`);
  const [, jwt, k] = match;
  assert.equal(k, publicKey);
  const [h, c, sig] = jwt!.split('.');
  const pub = Buffer.from(publicKey, 'base64url');
  const key = crypto.createPublicKey({
    format: 'jwk',
    key: { kty: 'EC', crv: 'P-256', x: pub.subarray(1, 33).toString('base64url'), y: pub.subarray(33).toString('base64url') },
  });
  const valid = crypto.verify('sha256', Buffer.from(`${h}.${c}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig!, 'base64url'));
  assert.ok(valid, 'JWT signature verifies with the VAPID public key');
  return {
    header: JSON.parse(Buffer.from(h!, 'base64url').toString()),
    claims: JSON.parse(Buffer.from(c!, 'base64url').toString()) as { aud: string; exp: number; sub: string },
  };
}

/* ------------------------------- fake push service ------------------------------- */

interface PushRequest {
  path: string;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

interface FakePushService {
  base: string;
  requests: PushRequest[];
  /** Status to answer per path (default 201). */
  status: Map<string, number>;
  to(pathname: string): PushRequest[];
  close(): Promise<void>;
}

async function fakePushService(): Promise<FakePushService> {
  const requests: PushRequest[] = [];
  const status = new Map<string, number>();
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      requests.push({ path: req.url ?? '', headers: req.headers, body: Buffer.concat(chunks) });
      res.writeHead(status.get(req.url ?? '') ?? 201);
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    requests,
    status,
    to: (pathname) => requests.filter((r) => r.path === pathname),
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}

/* ------------------------------------ harness ------------------------------------ */

interface Running {
  app: App;
  base: string;
  close(): Promise<void>;
}

async function start(options: Partial<AppOptions> = {}): Promise<Running> {
  const app = createApp({ dbPath: ':memory:', rateLimit: false, reminders: false, ...options });
  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const { port } = app.server.address() as AddressInfo;
  return { app, base: `http://127.0.0.1:${port}`, close: () => app.close() };
}

interface Reply {
  status: number;
  headers: Headers;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
}

async function request(
  base: string,
  method: string,
  url: string,
  opts: { body?: unknown; token?: string; headers?: Record<string, string> } = {},
): Promise<Reply> {
  const headers: Record<string, string> = { ...opts.headers };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  let body: string | undefined;
  if (opts.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
  }
  const res = await fetch(base + url, { method, headers, body });
  const text = await res.text();
  const isJson = res.headers.get('content-type')?.includes('application/json');
  return { status: res.status, headers: res.headers, body: isJson && text ? JSON.parse(text) : text };
}

let idCounter = 0;
const uid = (prefix: string) => `${prefix}_${(++idCounter).toString(36).padStart(8, '0')}`;

function rec(c: CollectionName, id: string, u: number, fields: Record<string, unknown> = {}): Change {
  return { c, id, u, data: { id, createdAt: u, updatedAt: u, ...fields } };
}

interface Device {
  householdId: string;
  memberId: string;
  token: string;
}

interface Household {
  householdId: string;
  inviteCode: string;
  a: Device;
  b: Device;
}

/** Household "Sonnenallee 12" with Anna (creator, device a) and Ben (joined, device b). */
async function createHousehold(base: string, householdFields: Record<string, unknown> = {}, extra: Change[] = []): Promise<Household> {
  const householdId = uid('h');
  const anna = uid('m');
  const ben = uid('m');
  const created = await request(base, 'POST', '/api/households', {
    body: {
      householdId,
      memberId: anna,
      changes: [
        rec('household', householdId, 1000, { name: 'Sonnenallee 12', emoji: '🏡', currency: 'EUR', ...householdFields }),
        rec('members', anna, 1000, { name: 'Anna', color: '#f97316', claimed: true }),
        ...extra,
      ],
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const joined = await request(base, 'POST', `/api/invites/${created.body.inviteCode}/join`, {
    body: { memberId: ben, changes: [rec('members', ben, 1001, { name: 'Ben', color: '#22c55e', claimed: true })] },
  });
  assert.equal(joined.status, 200, JSON.stringify(joined.body));
  return {
    householdId,
    inviteCode: created.body.inviteCode,
    a: { householdId, memberId: anna, token: created.body.token },
    b: { householdId, memberId: ben, token: joined.body.token },
  };
}

function subscribe(base: string, device: Device, endpoint: string, b: Browser, lang = 'de') {
  return request(base, 'POST', `/api/households/${device.householdId}/push`, {
    token: device.token,
    body: { subscription: { endpoint, expirationTime: null, keys: b.keys }, lang },
  });
}

function push(base: string, device: Device, changes: Change[]) {
  return request(base, 'POST', `/api/households/${device.householdId}/sync`, { token: device.token, body: { since: 0, changes } });
}

let activityCounter = 0;
function activity(actorId: string, type: string, fields: Record<string, unknown> = {}, createdAt = Date.now()): Change {
  const id = `act_${++activityCounter}`;
  return { c: 'activity', id, u: createdAt, data: { id, createdAt, updatedAt: createdAt, type, actorId, ...fields } };
}

/** Euro amounts as Intl formats them (narrow no-break space before €). */
const eur = (cents: number, locale = 'de-DE') =>
  new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR' }).format(cents / 100);

function tempDbPath(): { file: string; cleanup(): void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nestly-push-'));
  return { file: path.join(dir, 'test.db'), cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

/* ------------------------------------- crypto ------------------------------------ */

describe('push crypto', () => {
  it('generates VAPID keys as a 65-byte public point and a 32-byte private scalar', () => {
    const keys = generateVapidKeys();
    const pub = Buffer.from(keys.publicKey, 'base64url');
    const priv = Buffer.from(keys.privateKey, 'base64url');
    assert.match(keys.publicKey, /^[A-Za-z0-9_-]{87}$/);
    assert.match(keys.privateKey, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(pub.length, 65);
    assert.equal(pub[0], 4);
    assert.equal(priv.length, 32);
    // The public key is the private scalar's point.
    const ecdh = crypto.createECDH('prime256v1');
    ecdh.setPrivateKey(priv);
    assert.deepEqual(ecdh.getPublicKey(), pub);

    const other = generateVapidKeys();
    assert.notEqual(other.privateKey, keys.privateKey);
    assert.throws(() => vapidPrivateKeyObject({ publicKey: other.publicKey, privateKey: keys.privateKey }), /does not match/);
    assert.throws(() => vapidPrivateKeyObject({ publicKey: 'abc', privateKey: keys.privateKey }), /public key/);
    assert.throws(() => vapidPrivateKeyObject({ publicKey: keys.publicKey, privateKey: 'abc' }), /private key/);
  });

  it('the test decryptor reproduces the RFC 8291 example', () => {
    const ua = crypto.createECDH('prime256v1');
    ua.setPrivateKey(Buffer.from('q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94', 'base64url'));
    const message = Buffer.from(
      'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
      'base64url',
    );
    const plaintext = decrypt(message, ua, Buffer.from('BTBZMqHH6r4Tts7J_aSIgg', 'base64url'));
    assert.equal(plaintext.toString(), 'When I grow up, I want to be a watermelon');
  });

  it('encrypts payloads that a user agent can decrypt (aes128gcm round trip)', () => {
    const b = browser();
    for (const text of ['', 'hi', JSON.stringify({ title: '🏡 WG', body: 'Lena hat „Pizza“ eingetragen · 24,90 €' }), 'x'.repeat(MAX_PAYLOAD_BYTES)]) {
      const payload = Buffer.from(text);
      const body = encryptPayload(payload, b.keys.p256dh, b.keys.auth);
      assert.equal(body.length, 86 + payload.length + 1 + 16, 'header + plaintext + delimiter + tag');
      assert.equal(body.readUInt32BE(16), 4096);
      assert.equal(body[20], 65);
      assert.deepEqual(decrypt(body, b.ecdh, b.auth), payload);
    }
    // Fresh salt and ephemeral key every time.
    const one = encryptPayload(Buffer.from('same'), b.keys.p256dh, b.keys.auth);
    const two = encryptPayload(Buffer.from('same'), b.keys.p256dh, b.keys.auth);
    assert.notDeepEqual(one.subarray(0, 86), two.subarray(0, 86));
    // Another subscriber cannot decrypt it.
    const eve = browser();
    assert.throws(() => decrypt(one, eve.ecdh, eve.auth));
  });

  it('rejects oversized payloads and invalid subscription keys', () => {
    const b = browser();
    assert.throws(() => encryptPayload(Buffer.alloc(MAX_PAYLOAD_BYTES + 1), b.keys.p256dh, b.keys.auth), RangeError);
    assert.throws(() => encryptPayload(Buffer.from('x'), b.keys.p256dh.slice(0, -2), b.keys.auth), /Invalid/);
    assert.throws(() => encryptPayload(Buffer.from('x'), b.keys.p256dh, crypto.randomBytes(15).toString('base64url')), /Invalid/);
    const offCurve = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]).toString('base64url');
    assert.throws(() => encryptPayload(Buffer.from('x'), offCurve, b.keys.auth), /Invalid/);
  });

  it('signs an ES256 VAPID JWT for the endpoint origin', () => {
    const keys = generateVapidKeys();
    const now = Date.UTC(2026, 9, 27, 12, 0, 0);
    const header = vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc:def?x=1', keys, 'mailto:push@nestly.app', now);
    const jwt = verifyVapid(header, keys.publicKey);
    assert.deepEqual(jwt.header, { typ: 'JWT', alg: 'ES256' });
    assert.deepEqual(jwt.claims, { aud: 'https://fcm.googleapis.com', exp: now / 1000 + 12 * 3600, sub: 'mailto:push@nestly.app' });

    const tampered = header.replace(/t=([^.]+)\.([^.]+)\./, (_m, h: string) => {
      const claims = Buffer.from(JSON.stringify({ aud: 'https://evil.example', exp: 1, sub: 'x' })).toString('base64url');
      return `t=${h}.${claims}.`;
    });
    assert.throws(() => verifyVapid(tampered, keys.publicKey), /signature/);
  });

  it('sends with the Web Push headers and never throws on network errors', async () => {
    const fake = await fakePushService();
    try {
      const keys = generateVapidKeys();
      const b = browser();
      fake.status.set('/gone', 410);
      const sub = { endpoint: `${fake.base}/ok`, ...b.keys };
      const ok = await sendPush(sub, '{"title":"t"}', keys, 'mailto:test@example.com', { topic: 'act expense/added äöü-very-long-topic-name-1234567890' });
      assert.deepEqual(ok, { status: 201, gone: false });
      const [req] = fake.to('/ok');
      assert.equal(req!.headers.ttl, '86400');
      assert.equal(req!.headers.urgency, 'normal');
      assert.equal(req!.headers['content-encoding'], 'aes128gcm');
      assert.equal(req!.headers['content-type'], 'application/octet-stream');
      assert.equal(req!.headers.topic, 'actexpenseadded-very-long-topic-');
      assert.equal(req!.headers.topic!.length, 32);
      assert.equal(verifyVapid(req!.headers.authorization!, keys.publicKey).claims.aud, fake.base);
      assert.deepEqual(decryptJson(req!.body, b), { title: 't' });

      assert.deepEqual(await sendPush({ ...sub, endpoint: `${fake.base}/gone` }, '{}', keys, 'mailto:x@y.z', { ttl: 60 }), {
        status: 410,
        gone: true,
      });
      assert.equal(fake.to('/gone')[0]!.headers.ttl, '60');

      // Nothing listens on port 1; invalid keys fail before sending.
      assert.deepEqual(await sendPush({ ...sub, endpoint: 'http://127.0.0.1:1/x' }, '{}', keys, 'mailto:x@y.z'), { status: 0, gone: false });
      assert.deepEqual(await sendPush({ ...sub, auth: 'AAAA' }, '{}', keys, 'mailto:x@y.z'), { status: 0, gone: false });
      assert.equal(sanitizeTopic('a b/c'), 'abc');
    } finally {
      await fake.close();
    }
  });
});

/* ------------------------------- activity notifications ------------------------------ */

describe('activity notifications', () => {
  let srv: Running;
  let fake: FakePushService;
  let db: { file: string; cleanup(): void };
  let sql: DatabaseSync;
  let publicKey: string;

  const subscriptionCount = (endpoint: string) =>
    (sql.prepare('SELECT COUNT(*) AS n FROM push_subscriptions WHERE endpoint = ?').get(endpoint) as { n: number }).n;

  before(async () => {
    db = tempDbPath();
    fake = await fakePushService();
    srv = await start({ dbPath: db.file });
    sql = new DatabaseSync(db.file);
    publicKey = (await request(srv.base, 'GET', '/api/push/key')).body.publicKey;
  });
  after(async () => {
    sql.close();
    await srv.close();
    await fake.close();
    db.cleanup();
  });
  beforeEach(() => {
    fake.requests.length = 0;
  });

  it('notifies other members of a new expense, encrypted for their device', async () => {
    const h = await createHousehold(srv.base);
    const ben = browser();
    const anna = browser();
    assert.deepEqual((await subscribe(srv.base, h.b, `${fake.base}/push/b`, ben)).body, { ok: true });
    assert.equal((await subscribe(srv.base, h.a, `${fake.base}/push/a`, anna)).status, 200);

    const res = await push(srv.base, h.a, [activity(h.a.memberId, 'expense_added', { title: 'Pizza', amount: 2490 })]);
    assert.equal(res.status, 200);
    await srv.app.pushIdle();

    assert.equal(fake.to('/push/a').length, 0, 'the actor is not notified');
    const received = fake.to('/push/b');
    assert.equal(received.length, 1);
    const [req] = received;
    assert.equal(req!.headers['content-encoding'], 'aes128gcm');
    assert.equal(req!.headers['content-type'], 'application/octet-stream');
    assert.equal(req!.headers.ttl, '86400');
    assert.equal(req!.headers.urgency, 'normal');
    const jwt = verifyVapid(req!.headers.authorization!, publicKey);
    assert.equal(jwt.claims.aud, fake.base);
    assert.equal(jwt.claims.sub, 'mailto:push@nestly.app');
    assert.deepEqual(decryptJson(req!.body, ben), {
      title: '🏡 Sonnenallee 12',
      body: `Anna hat „Pizza“ eingetragen · ${eur(2490)}`,
      tag: `act-expense_added-${h.a.memberId}`,
      url: './#/money?tab=history',
    });
  });

  it('composes texts per type and language, and skips the actor and the pushing member', async () => {
    const h = await createHousehold(srv.base);
    const ben = browser();
    const anna = browser();
    await subscribe(srv.base, h.b, `${fake.base}/texts/b`, ben, 'en');
    await subscribe(srv.base, h.a, `${fake.base}/texts/a`, anna, 'de');

    // Anna records that Ben paid her: Ben is the actor, Anna pushes → nobody else to notify.
    await push(srv.base, h.a, [activity(h.b.memberId, 'transfer_added', { targetId: h.a.memberId, amount: 2000 })]);
    await srv.app.pushIdle();
    assert.equal(fake.requests.length, 0);

    // Ben pays Anna, from his own device: Anna is notified in German, second person.
    await push(srv.base, h.b, [activity(h.b.memberId, 'transfer_added', { targetId: h.a.memberId, amount: 2000 })]);
    await srv.app.pushIdle();
    assert.equal(fake.to('/texts/b').length, 0);
    const transfer = decryptJson(fake.to('/texts/a')[0]!.body, anna);
    assert.equal(transfer.body, `Ben hat dir ${eur(2000)} gezahlt`);
    assert.equal(transfer.url, './#/money?tab=history');

    // English texts for Ben.
    fake.requests.length = 0;
    await push(srv.base, h.a, [
      activity(h.a.memberId, 'items_added', { title: 'Coffee', count: 1 }),
      activity(h.a.memberId, 'items_added', { title: 'Supermarket', count: 3 }),
      activity(h.a.memberId, 'chore_done', { title: 'Vacuum', emoji: '🧹', points: 30 }),
      activity(h.a.memberId, 'expense_edited', { title: 'Pizza', amount: 100 }),
      activity(h.a.memberId, 'recurring_booked', { title: 'Rent', amount: 100 }),
      activity(h.a.memberId, 'note_added'),
    ]);
    await srv.app.pushIdle();
    const bodies = fake.to('/texts/b').map((r) => decryptJson(r.body, ben));
    assert.deepEqual(
      bodies.map((m) => [m.body, m.url]).sort(),
      [
        ['Anna added 3 items to the list', './#/shopping'],
        ['Anna did “Vacuum” 🧹', './#/chores'],
        ['Anna needs “Coffee”', './#/shopping'],
        ['Anna pinned something to the board', './#/wg/board'],
      ],
    );
    assert.ok(bodies.every((m) => m.title === '🏡 Sonnenallee 12'));
  });

  it('only notifies for new, recent activity records', async () => {
    const h = await createHousehold(srv.base);
    const ben = browser();
    await subscribe(srv.base, h.b, `${fake.base}/recent/b`, ben);

    const old = activity(h.a.memberId, 'expense_added', { title: 'Old', amount: 1 }, Date.now() - 11 * 60_000);
    await push(srv.base, h.a, [old, rec('expenses', uid('e'), Date.now(), { title: 'Not an activity' })]);
    await srv.app.pushIdle();
    assert.equal(fake.requests.length, 0);

    const fresh = activity(h.a.memberId, 'event_added', { title: 'Party' });
    await push(srv.base, h.a, [fresh]);
    await srv.app.pushIdle();
    assert.equal(fake.to('/recent/b').length, 1);
    assert.equal(decryptJson(fake.to('/recent/b')[0]!.body, ben).body, 'Anna hat „Party“ in den Kalender eingetragen');

    // An update of an existing activity record (or an identical re-push) does not notify again.
    await push(srv.base, h.a, [fresh, { ...fresh, u: fresh.u + 1, data: { ...fresh.data, updatedAt: fresh.u + 1 } }]);
    await srv.app.pushIdle();
    assert.equal(fake.to('/recent/b').length, 1);
  });

  it('notifies about members joining with an activity in the join request', async () => {
    const h = await createHousehold(srv.base);
    const anna = browser();
    await subscribe(srv.base, h.a, `${fake.base}/join/a`, anna);
    const carla = uid('m');
    const joined = await request(srv.base, 'POST', `/api/invites/${h.inviteCode}/join`, {
      body: { memberId: carla, changes: [rec('members', carla, 2000, { name: 'Carla', color: '#000' }), activity(carla, 'member_joined')] },
    });
    assert.equal(joined.status, 200);
    await srv.app.pushIdle();
    assert.equal(decryptJson(fake.to('/join/a')[0]!.body, anna).body, 'Carla ist der WG beigetreten 👋');
  });

  it('deletes subscriptions the push service reports as gone (410)', async () => {
    const h = await createHousehold(srv.base);
    const endpoint = `${fake.base}/gone/b`;
    fake.status.set('/gone/b', 410);
    await subscribe(srv.base, h.b, endpoint, browser());
    assert.equal(subscriptionCount(endpoint), 1);

    await push(srv.base, h.a, [activity(h.a.memberId, 'note_added')]);
    await srv.app.pushIdle();
    assert.equal(fake.to('/gone/b').length, 1);
    assert.equal(subscriptionCount(endpoint), 0);

    await push(srv.base, h.a, [activity(h.a.memberId, 'note_added')]);
    await srv.app.pushIdle();
    assert.equal(fake.to('/gone/b').length, 1, 'not contacted again');
  });

  it('keeps subscriptions on other errors and does not fail the sync', async () => {
    const h = await createHousehold(srv.base);
    const endpoint = `${fake.base}/error/b`;
    fake.status.set('/error/b', 500);
    await subscribe(srv.base, h.b, endpoint, browser());
    const res = await push(srv.base, h.a, [activity(h.a.memberId, 'note_added')]);
    assert.equal(res.status, 200);
    await srv.app.pushIdle();
    assert.equal(fake.to('/error/b').length, 1);
    assert.equal(subscriptionCount(endpoint), 1);
  });

  it('DELETE …/push unsubscribes, /leave removes the device and /release the member', async () => {
    const h = await createHousehold(srv.base);
    const ben = browser();
    const unsub = `${fake.base}/unsub/b`;
    await subscribe(srv.base, h.b, unsub, ben);
    const removed = await request(srv.base, 'DELETE', `/api/households/${h.householdId}/push`, { token: h.b.token, body: { endpoint: unsub } });
    assert.equal(removed.status, 200);
    assert.deepEqual(removed.body, { ok: true });
    assert.equal(subscriptionCount(unsub), 0);

    const left = `${fake.base}/leave/b`;
    await subscribe(srv.base, h.b, left, ben);
    const annaEndpoint = `${fake.base}/leave/a`;
    await subscribe(srv.base, h.a, annaEndpoint, browser());
    assert.equal((await request(srv.base, 'POST', `/api/households/${h.householdId}/leave`, { token: h.b.token })).status, 200);
    assert.equal(subscriptionCount(left), 0);
    assert.equal(subscriptionCount(annaEndpoint), 1, "other devices' subscriptions stay");

    await push(srv.base, h.a, [activity(h.a.memberId, 'note_added')]);
    await srv.app.pushIdle();
    assert.equal(fake.requests.length, 0);

    // Ben's new phone subscribes; Anna then signs out all of Ben's devices.
    const rejoined = await request(srv.base, 'POST', `/api/invites/${h.inviteCode}/join`, { body: { memberId: h.b.memberId, changes: [] } });
    const newPhone = { ...h.b, token: rejoined.body.token as string };
    const released = `${fake.base}/release/b`;
    await subscribe(srv.base, newPhone, released, ben);
    assert.equal(subscriptionCount(released), 1);
    const res = await request(srv.base, 'POST', `/api/households/${h.householdId}/release`, { token: h.a.token, body: { memberId: h.b.memberId } });
    assert.equal(res.status, 200);
    assert.equal(subscriptionCount(released), 0);
    assert.equal(subscriptionCount(annaEndpoint), 1);
  });
});

/* ------------------------------------ reminders ---------------------------------- */

describe('daily reminders', () => {
  let srv: Running;
  let fake: FakePushService;

  // A fresh server per test: runReminders covers every household it stores.
  beforeEach(async () => {
    fake = await fakePushService();
    srv = await start();
  });
  afterEach(async () => {
    await srv.close();
    await fake.close();
  });

  it('sends one reminder per member and local day, after 09:00 household time', async () => {
    // New York in January is UTC−5: 13:00Z = 08:00 local, 14:30Z = 09:30 local.
    const h = await createHousehold(srv.base, { timezone: 'America/New_York' });
    const u = Date.now();
    await push(srv.base, h.a, [
      rec('chores', 'c_bath', u, { title: 'Bad putzen', emoji: '🛁', rotation: 'rotate', memberIds: [h.a.memberId, h.b.memberId], assigneeId: h.b.memberId, dueDate: '2026-01-15', points: 40, frequency: { unit: 'week', every: 1 } }),
      rec('chores', 'c_windows', u, { title: 'Fenster putzen', emoji: '🪟', rotation: 'rotate', memberIds: [], assigneeId: h.b.memberId, dueDate: '2026-01-20', points: 50, frequency: null }),
      rec('chores', 'c_paused', u, { title: 'Pausiert', emoji: '⏸️', rotation: 'fixed', memberIds: [], assigneeId: h.b.memberId, dueDate: '2026-01-10', points: 10, frequency: null, paused: true }),
      rec('chores', 'c_gone', u, { title: 'Gelöscht', emoji: '🗑️', rotation: 'fixed', memberIds: [], assigneeId: h.b.memberId, dueDate: '2026-01-10', points: 10, frequency: null, deleted: true }),
      rec('chores', 'c_anna', u, { title: 'Küche', emoji: '🍳', rotation: 'fixed', memberIds: [], assigneeId: h.a.memberId, dueDate: '2026-01-25', points: 10, frequency: null }),
    ]);
    const ben = browser();
    const anna = browser();
    await subscribe(srv.base, h.b, `${fake.base}/r1/b`, ben);
    await subscribe(srv.base, h.a, `${fake.base}/r1/a`, anna);

    assert.equal(await srv.app.runReminders(new Date('2026-01-15T13:00:00Z')), 0);
    assert.equal(fake.requests.length, 0, 'nothing before 09:00 local time');

    assert.equal(await srv.app.runReminders(new Date('2026-01-15T14:30:00Z')), 1);
    assert.equal(fake.to('/r1/a').length, 0, 'Anna has nothing due');
    const [req] = fake.to('/r1/b');
    assert.deepEqual(decryptJson(req!.body, ben), {
      title: '🏡 Sonnenallee 12',
      body: 'Heute dran: Bad putzen',
      tag: 'reminder',
      url: './#/chores',
    });
    assert.equal(req!.headers.topic, 'reminder');
    assert.equal(req!.headers.ttl, String(12 * 3600));

    // Later the same local day, also after the app re-registers the subscription on start.
    await subscribe(srv.base, h.b, `${fake.base}/r1/b`, ben);
    assert.equal(await srv.app.runReminders(new Date('2026-01-15T20:00:00Z')), 0);
    assert.equal(await srv.app.runReminders(new Date('2026-01-16T04:59:00Z')), 0, '23:59 local is still the same day');
    assert.equal(fake.requests.length, 1);

    // Next local day the (now overdue) chore is reminded again, once.
    assert.equal(await srv.app.runReminders(new Date('2026-01-16T14:00:00Z')), 1);
    assert.equal(await srv.app.runReminders(new Date('2026-01-16T15:00:00Z')), 0);
    assert.equal(decryptJson(fake.to('/r1/b')[1]!.body, ben).body, 'Heute dran: Bad putzen');
  });

  it('includes open chores and contract deadlines, in English, and skips members who are away', async () => {
    // No timezone in the household record → Europe/Berlin (UTC+1 in January).
    const h = await createHousehold(srv.base);
    const u = Date.now();
    await push(srv.base, h.a, [
      rec('chores', 'c_trash', u, { title: 'Take out the trash', emoji: '🗑️', rotation: 'anyone', memberIds: [], dueDate: '2026-01-15', points: 10, frequency: null }),
      rec('chores', 'c_open', u, { title: 'Clean the bathroom', emoji: '🛁', rotation: 'rotate', memberIds: [], dueDate: '2026-01-14', points: 40, frequency: null }),
      rec('chores', 'c_pool', u, { title: 'Not my pool', emoji: '🧽', rotation: 'anyone', memberIds: [h.a.memberId], dueDate: '2026-01-15', points: 10, frequency: null }),
      // Cancellation deadline 2026-01-17 (minimum term ends 2026-02-17, one month notice).
      rec('contracts', 'k_power', u, { name: 'Power', provider: 'Stadtwerke', category: 'electricity', startDate: '2025-02-18', minTermMonths: 12, renewalMonths: 0, noticeValue: 1, noticeUnit: 'month' }),
      // Deadline far away, and an open-ended contract (daysLeft 0, no urgency): not reminded.
      rec('contracts', 'k_net', u, { name: 'Internet', provider: 'ISP', category: 'internet', startDate: '2025-06-01', minTermMonths: 24, renewalMonths: 0, noticeValue: 1, noticeUnit: 'month' }),
      rec('contracts', 'k_stream', u, { name: 'Streaming', provider: 'S', category: 'streaming', renewalMonths: 0, noticeValue: 0, noticeUnit: 'day' }),
      rec('members', h.a.memberId, u, { name: 'Anna', color: '#f97316', claimed: true, awayFrom: '2026-01-10', awayUntil: '2026-01-20' }),
    ]);
    const ben = browser();
    const anna = browser();
    await subscribe(srv.base, h.b, `${fake.base}/r2/b`, ben, 'en');
    await subscribe(srv.base, h.a, `${fake.base}/r2/a`, anna, 'de');

    assert.equal(await srv.app.runReminders(new Date('2026-01-15T07:59:00Z')), 0);
    assert.equal(await srv.app.runReminders(new Date('2026-01-15T08:00:00Z')), 2);
    assert.deepEqual(decryptJson(fake.to('/r2/b')[0]!.body, ben), {
      title: '🏡 Sonnenallee 12',
      body: 'Today: Clean the bathroom, Take out the trash\nCancellation deadline for Power in 2 days',
      tag: 'reminder',
      url: './#/chores',
    });
    // Anna is away: no chores, but the contract deadline still reaches her.
    assert.deepEqual(decryptJson(fake.to('/r2/a')[0]!.body, anna), {
      title: '🏡 Sonnenallee 12',
      body: 'Kündigungsfrist Power in 2 Tagen',
      tag: 'reminder',
      url: './#/wg/contracts',
    });
  });

  it('deletes gone subscriptions during reminder runs', async () => {
    const h = await createHousehold(srv.base, { timezone: 'Europe/Berlin' });
    await push(srv.base, h.a, [
      rec('chores', 'c_x', Date.now(), { title: 'Müll', emoji: '🗑️', rotation: 'anyone', memberIds: [], dueDate: '2026-02-01', points: 10, frequency: null }),
    ]);
    fake.status.set('/r3/b', 404);
    await subscribe(srv.base, h.b, `${fake.base}/r3/b`, browser());
    assert.equal(await srv.app.runReminders(new Date('2026-02-01T10:00:00Z')), 0);
    assert.equal(fake.to('/r3/b').length, 1);
    assert.equal(await srv.app.runReminders(new Date('2026-02-02T10:00:00Z')), 0);
    assert.equal(fake.to('/r3/b').length, 1, 'the deleted subscription is not used again');
  });
});

/* ------------------------------------ validation --------------------------------- */

describe('push API', () => {
  let srv: Running;
  before(async () => {
    srv = await start();
  });
  after(async () => {
    await srv.close();
  });

  it('validates subscriptions', async () => {
    const h = await createHousehold(srv.base);
    const b = browser();
    const url = `/api/households/${h.householdId}/push`;
    const good = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: b.keys };
    const cases: Array<[string, unknown]> = [
      ['no body', undefined],
      ['no subscription', { lang: 'de' }],
      ['subscription not an object', { subscription: 'x' }],
      ['missing endpoint', { subscription: { keys: b.keys } }],
      ['endpoint not a string', { subscription: { ...good, endpoint: 42 } }],
      ['not a URL', { subscription: { ...good, endpoint: 'push.example.com/abc' } }],
      ['plain http', { subscription: { ...good, endpoint: 'http://push.example.com/abc' } }],
      ['other scheme', { subscription: { ...good, endpoint: 'ftp://push.example.com/abc' } }],
      ['credentials', { subscription: { ...good, endpoint: 'https://user:pw@push.example.com/abc' } }],
      ['too long', { subscription: { ...good, endpoint: `https://fcm.googleapis.com/${'a'.repeat(2048)}` } }],
      ['unknown push service', { subscription: { ...good, endpoint: 'https://push.example.com/abc' } }],
      ['internal host', { subscription: { ...good, endpoint: 'https://10.0.0.5/abc' } }],
      ['lookalike host', { subscription: { ...good, endpoint: 'https://evilgoogleapis.com/abc' } }],
      ['missing keys', { subscription: { endpoint: good.endpoint } }],
      ['short p256dh', { subscription: { ...good, keys: { ...b.keys, p256dh: crypto.randomBytes(64).toString('base64url') } } }],
      ['long p256dh', { subscription: { ...good, keys: { ...b.keys, p256dh: Buffer.concat([b.ecdh.getPublicKey(), Buffer.from([0])]).toString('base64url') } } }],
      ['p256dh off the curve', { subscription: { ...good, keys: { ...b.keys, p256dh: Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 7)]).toString('base64url') } } }],
      ['p256dh not base64url', { subscription: { ...good, keys: { ...b.keys, p256dh: b.keys.p256dh.replace(/.$/, '+') } } }],
      ['short auth', { subscription: { ...good, keys: { ...b.keys, auth: crypto.randomBytes(15).toString('base64url') } } }],
      ['long auth', { subscription: { ...good, keys: { ...b.keys, auth: crypto.randomBytes(17).toString('base64url') } } }],
      ['auth not a string', { subscription: { ...good, keys: { ...b.keys, auth: 16 } } }],
    ];
    for (const [name, body] of cases) {
      const res = await request(srv.base, 'POST', url, { token: h.a.token, body });
      assert.equal(res.status, 400, `${name}: expected 400, got ${res.status}`);
      assert.equal(res.body.error, 'bad_request', name);
    }

    for (const endpoint of [
      good.endpoint,
      'https://updates.push.services.mozilla.com/wpush/v2/abc',
      'https://web.push.apple.com/abc',
      'https://wns2-par02p.notify.windows.com/w/?token=abc',
      'http://127.0.0.1:9/push',
      'http://localhost:9/push',
    ]) {
      const ok = await request(srv.base, 'POST', url, { token: h.a.token, body: { subscription: { ...good, endpoint }, lang: 'en' } });
      assert.equal(ok.status, 200, endpoint);
      assert.deepEqual(ok.body, { ok: true });
    }
    // Padded base64url (and no lang) is accepted too.
    const padded = { p256dh: b.ecdh.getPublicKey().toString('base64url') + '=', auth: b.auth.toString('base64url') + '==' };
    assert.equal((await request(srv.base, 'POST', url, { token: h.a.token, body: { subscription: { ...good, keys: padded } } })).status, 200);

    assert.equal((await request(srv.base, 'DELETE', url, { token: h.a.token, body: {} })).status, 400);
    assert.equal((await request(srv.base, 'DELETE', url, { token: h.a.token, body: { endpoint: good.endpoint } })).status, 200);
    // Unknown endpoints are fine to delete (idempotent).
    assert.equal((await request(srv.base, 'DELETE', url, { token: h.a.token, body: { endpoint: good.endpoint } })).status, 200);
    assert.equal((await request(srv.base, 'GET', url, { token: h.a.token })).status, 405);
  });

  it('requires a valid token for this household', async () => {
    const h = await createHousehold(srv.base);
    const other = await createHousehold(srv.base);
    const body = { subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/x', keys: browser().keys }, lang: 'de' };
    for (const method of ['POST', 'DELETE']) {
      for (const token of [undefined, 'not-a-real-token', other.a.token]) {
        const res = await request(srv.base, method, `/api/households/${h.householdId}/push`, { token, body });
        assert.equal(res.status, 401, `${method} with ${token ? 'bad' : 'no'} token`);
        assert.equal(res.body.error, 'unauthorized');
      }
    }
  });

  it('allows DELETE in CORS preflights', async () => {
    const res = await fetch(`${srv.base}/api/households/h_x/push`, {
      method: 'OPTIONS',
      headers: { origin: 'https://example.com', 'access-control-request-method': 'DELETE' },
    });
    assert.equal(res.status, 204);
    assert.match(res.headers.get('access-control-allow-methods') ?? '', /DELETE/);
  });

  it('serves a stable 65-byte public key without auth', async () => {
    const db = tempDbPath();
    try {
      const first = await start({ dbPath: db.file });
      const one = await request(first.base, 'GET', '/api/push/key');
      // A second instance on the same database while the first still runs.
      const second = await start({ dbPath: db.file });
      const two = await request(second.base, 'GET', '/api/push/key');
      await first.close();
      await second.close();
      const third = await start({ dbPath: db.file });
      const three = await request(third.base, 'GET', '/api/push/key');
      await third.close();

      assert.equal(one.status, 200);
      assert.equal(one.headers.get('access-control-allow-origin'), '*');
      assert.match(one.body.publicKey, /^[A-Za-z0-9_-]+$/);
      const key = Buffer.from(one.body.publicKey, 'base64url');
      assert.equal(key.length, 65);
      assert.equal(key[0], 4);
      assert.equal(two.body.publicKey, one.body.publicKey);
      assert.equal(three.body.publicKey, one.body.publicKey);

      // In-memory databases get their own keys.
      const other = await request(srv.base, 'GET', '/api/push/key');
      assert.notEqual(other.body.publicKey, one.body.publicKey);
      assert.equal((await request(srv.base, 'POST', '/api/push/key')).status, 405);
    } finally {
      db.cleanup();
    }
  });

  it('uses configured VAPID keys and rejects mismatched ones', async () => {
    const keys: VapidKeys = generateVapidKeys();
    const configured = await start({ vapidKeys: keys, pushSubject: 'mailto:ops@example.com' });
    try {
      assert.equal((await request(configured.base, 'GET', '/api/push/key')).body.publicKey, keys.publicKey);
    } finally {
      await configured.close();
    }
    const wrong = { publicKey: generateVapidKeys().publicKey, privateKey: keys.privateKey };
    assert.throws(() => createApp({ dbPath: ':memory:', reminders: false, vapidKeys: wrong }), /does not match/);
  });

  it('signs with the configured subject', async () => {
    const fake = await fakePushService();
    const keys = generateVapidKeys();
    const configured = await start({ vapidKeys: keys, pushSubject: 'mailto:ops@example.com' });
    try {
      const h = await createHousehold(configured.base);
      await subscribe(configured.base, h.b, `${fake.base}/subject`, browser());
      await push(configured.base, h.a, [activity(h.a.memberId, 'note_added')]);
      await configured.app.pushIdle();
      const jwt = verifyVapid(fake.to('/subject')[0]!.headers.authorization!, keys.publicKey);
      assert.equal(jwt.claims.sub, 'mailto:ops@example.com');
    } finally {
      await configured.close();
      await fake.close();
    }
  });
});
