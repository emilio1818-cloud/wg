import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.ts';
import type { AppOptions } from '../src/app.ts';
import type { Change, CollectionName } from '../../core/src/types.ts';

/* --------------------------------- harness ---------------------------------- */

interface Running {
  base: string;
  port: number;
  close(): Promise<void>;
}

async function start(options: Partial<AppOptions> = {}): Promise<Running> {
  const app = createApp({ dbPath: ':memory:', rateLimit: false, ...options });
  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const { port } = app.server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${port}`, port, close: () => app.close() };
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
/** Unique id matching the household/member id format (8–64 chars). */
const uid = (prefix: string) => `${prefix}_${(++idCounter).toString(36).padStart(8, '0')}`;

function rec(c: CollectionName, id: string, u: number, fields: Record<string, unknown> = {}): Change {
  return { c, id, u, data: { id, createdAt: u, updatedAt: u, ...fields } };
}

interface Household {
  householdId: string;
  memberId: string;
  token: string;
  inviteCode: string;
  cursor: number;
}

async function createHousehold(base: string, extra: Change[] = []): Promise<Household> {
  const householdId = uid('h');
  const memberId = uid('m');
  const res = await request(base, 'POST', '/api/households', {
    body: {
      householdId,
      memberId,
      changes: [
        rec('household', householdId, 1000, { name: 'Sonnenallee 12', emoji: '🏡', currency: 'EUR' }),
        rec('members', memberId, 1000, { name: 'Anna', emoji: '🦊', color: '#f97316', claimed: true }),
        ...extra,
      ],
    },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return { householdId, memberId, ...res.body };
}

async function join(base: string, inviteCode: string, memberId: string, changes: Change[] = []) {
  return request(base, 'POST', `/api/invites/${inviteCode}/join`, { body: { memberId, changes } });
}

async function pullAll(base: string, h: { householdId: string; token: string }, since = 0) {
  const changes: Change[] = [];
  let cursor = since;
  for (;;) {
    const res = await request(base, 'GET', `/api/households/${h.householdId}/sync?since=${cursor}`, { token: h.token });
    assert.equal(res.status, 200);
    changes.push(...res.body.changes);
    cursor = res.body.cursor;
    if (!res.body.more) return { changes, cursor };
  }
}

function push(base: string, h: { householdId: string; token: string }, changes: Change[], since = 0) {
  return request(base, 'POST', `/api/households/${h.householdId}/sync`, { token: h.token, body: { since, changes } });
}

/** Minimal SSE client over fetch: yields parsed `{ event, data }` frames. */
async function openEvents(base: string, householdId: string, token: string) {
  const controller = new AbortController();
  const res = await fetch(`${base}/api/households/${householdId}/events?token=${encodeURIComponent(token)}`, {
    signal: controller.signal,
  });
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  return {
    res,
    /** Reads frames until one with the given event name arrives; null if the stream ends. */
    async next(event: string): Promise<{ event: string; data: unknown } | null> {
      for (;;) {
        const end = buffer.indexOf('\n\n');
        if (end >= 0) {
          const frame = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const name = /^event: (.*)$/m.exec(frame)?.[1];
          const data = /^data: (.*)$/m.exec(frame)?.[1];
          if (name === event) return { event: name, data: data ? JSON.parse(data) : null };
          continue;
        }
        const { value, done } = await reader.read();
        if (done) return null;
        buffer += decoder.decode(value, { stream: true });
      }
    },
    close: () => controller.abort(),
  };
}

/* ----------------------------------- tests ---------------------------------- */

describe('sync server', () => {
  let srv: Running;
  before(async () => {
    srv = await start();
  });
  after(async () => {
    await srv.close();
  });

  it('reports health', async () => {
    const res = await request(srv.base, 'GET', '/api/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(typeof res.body.version, 'string');
  });

  it('returns JSON 404/405 for unknown routes and methods', async () => {
    const missing = await request(srv.base, 'GET', '/api/nope');
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error, 'not_found');

    const wrongMethod = await request(srv.base, 'GET', '/api/households');
    assert.equal(wrongMethod.status, 405);
    assert.equal(wrongMethod.headers.get('allow'), 'POST');

    // Without a static dir, non-API paths are 404 too.
    assert.equal((await request(srv.base, 'GET', '/')).status, 404);
  });

  it('answers CORS preflights and sets CORS headers', async () => {
    const res = await fetch(`${srv.base}/api/households`, {
      method: 'OPTIONS',
      headers: { origin: 'https://example.com', 'access-control-request-method': 'POST' },
    });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    assert.match(res.headers.get('access-control-allow-headers') ?? '', /Authorization/);
    assert.match(res.headers.get('access-control-allow-headers') ?? '', /Content-Type/);
    assert.match(res.headers.get('access-control-allow-methods') ?? '', /POST/);

    const health = await request(srv.base, 'GET', '/api/health');
    assert.equal(health.headers.get('access-control-allow-origin'), '*');
  });

  describe('creating a household', () => {
    it('returns 201 with token, invite code and cursor', async () => {
      const h = await createHousehold(srv.base);
      assert.match(h.token, /^[A-Za-z0-9_-]{43}$/); // 32 bytes base64url
      assert.match(h.inviteCode, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
      assert.equal(h.cursor, 2);

      const pulled = await pullAll(srv.base, h);
      assert.deepEqual(
        pulled.changes.map((c) => [c.c, c.id, c.seq]),
        [
          ['household', h.householdId, 1],
          ['members', h.memberId, 2],
        ],
      );
    });

    it('rejects a duplicate household id with 409', async () => {
      const h = await createHousehold(srv.base);
      const res = await request(srv.base, 'POST', '/api/households', {
        body: {
          householdId: h.householdId,
          memberId: uid('m'),
          changes: [rec('household', h.householdId, 2000, { name: 'Hijack' })],
        },
      });
      assert.equal(res.status, 409);
      assert.equal(res.body.error, 'conflict');

      // The original data is untouched.
      const pulled = await pullAll(srv.base, h);
      assert.equal(pulled.changes.find((c) => c.c === 'household')?.data.name, 'Sonnenallee 12');
    });

    it('validates the request', async () => {
      const householdId = uid('h');
      const memberId = uid('m');
      const household = rec('household', householdId, 1);
      const cases: Array<[string, unknown]> = [
        ['empty body', {}],
        ['short householdId', { householdId: 'h_1', memberId, changes: [household] }],
        ['bad memberId', { householdId, memberId: 'm 12345678', changes: [household] }],
        ['missing household record', { householdId, memberId, changes: [rec('members', memberId, 1)] }],
        ['changes not an array', { householdId, memberId, changes: { 0: household } }],
        ['household id mismatch', { householdId, memberId, changes: [rec('household', uid('h'), 1)] }],
        ['bad collection', { householdId, memberId, changes: [household, { ...rec('members', 'x', 1), c: 'users' }] }],
        ['id differs from data.id', { householdId, memberId, changes: [household, { ...rec('notes', 'a', 1), id: 'b' }] }],
        ['invalid id characters', { householdId, memberId, changes: [household, rec('notes', 'a/b', 1)] }],
        ['id too long', { householdId, memberId, changes: [household, rec('notes', 'x'.repeat(129), 1)] }],
        ['u not positive', { householdId, memberId, changes: [household, rec('notes', 'n1', 0)] }],
        ['u not a number', { householdId, memberId, changes: [household, { ...rec('notes', 'n1', 1), u: '5' }] }],
        ['data is an array', { householdId, memberId, changes: [household, { c: 'notes', id: 'n1', u: 1, data: [] }] }],
        [
          'oversized data',
          { householdId, memberId, changes: [household, rec('notes', 'big', 1, { text: 'x'.repeat(64 * 1024) })] },
        ],
        [
          'too many changes',
          {
            householdId,
            memberId,
            changes: [household, ...Array.from({ length: 2000 }, (_, i) => rec('notes', `n${i}`, 1))],
          },
        ],
      ];
      for (const [name, body] of cases) {
        const res = await request(srv.base, 'POST', '/api/households', { body });
        assert.equal(res.status, 400, `${name}: expected 400, got ${res.status}`);
        assert.equal(res.body.error, 'bad_request', name);
        assert.equal(typeof res.body.message, 'string', name);
      }

      const invalidJson = await request(srv.base, 'POST', '/api/households', { body: '{"householdId":' });
      assert.equal(invalidJson.status, 400);

      // Nothing was created by the failed attempts.
      const ok = await request(srv.base, 'POST', '/api/households', { body: { householdId, memberId, changes: [household] } });
      assert.equal(ok.status, 201);
    });

    it('accepts data up to exactly 64 KiB', async () => {
      const id = 'n_exact';
      const base = JSON.stringify({ id, text: '' }).length;
      const data = { id, text: 'x'.repeat(64 * 1024 - base) };
      assert.equal(Buffer.byteLength(JSON.stringify(data)), 64 * 1024);
      const h = await createHousehold(srv.base);
      const res = await push(srv.base, h, [{ c: 'notes', id, u: 1, data }]);
      assert.equal(res.status, 200);
    });

    it('rejects bodies over 4 MiB with 413', async () => {
      const big = JSON.stringify({ householdId: uid('h'), memberId: uid('m'), pad: 'x'.repeat(4 * 1024 * 1024) });
      const res = await request(srv.base, 'POST', '/api/households', { body: big });
      assert.equal(res.status, 413);
      assert.equal(res.body.error, 'too_large');
    });
  });

  describe('invites', () => {
    it('previews a household case-insensitively, ignoring dashes and spaces', async () => {
      const placeholder = uid('m');
      const left = uid('m');
      const deleted = uid('m');
      const h = await createHousehold(srv.base, [
        rec('members', placeholder, 1001, { name: 'Ben', color: '#22c55e' }),
        rec('members', left, 1002, { name: 'Carla', color: '#3b82f6', leftAt: 5000 }),
        rec('members', deleted, 1003, { name: 'Dave', color: '#a855f7', deleted: true }),
      ]);
      const messy = `${h.inviteCode.slice(0, 3).toLowerCase()}-${h.inviteCode.slice(3).toLowerCase()}`;
      for (const code of [h.inviteCode, messy, encodeURIComponent(` ${h.inviteCode.slice(0, 3)} ${h.inviteCode.slice(3)} `)]) {
        const res = await request(srv.base, 'GET', `/api/invites/${code}`);
        assert.equal(res.status, 200, `code ${code}`);
        assert.deepEqual(res.body, {
          householdId: h.householdId,
          name: 'Sonnenallee 12',
          emoji: '🏡',
          members: [
            { id: h.memberId, name: 'Anna', emoji: '🦊', color: '#f97316', claimed: true },
            { id: placeholder, name: 'Ben', color: '#22c55e', claimed: false },
          ],
        });
      }
    });

    it('returns 404 for unknown or malformed codes', async () => {
      for (const code of ['AAAAAA', 'ABC', 'IIIIII', 'ABCDEFG', '%E0%A4%A']) {
        const res = await request(srv.base, 'GET', `/api/invites/${code}`);
        assert.equal(res.status, 404, code);
        assert.equal(res.body.error, 'not_found');
      }
      const joinRes = await join(srv.base, 'AAAAAA', uid('m'));
      assert.equal(joinRes.status, 404);
    });

    it('lets a device claim a placeholder member, but only once', async () => {
      const placeholder = uid('m');
      const h = await createHousehold(srv.base, [rec('members', placeholder, 1001, { name: 'Ben', color: '#22c55e' })]);

      const res = await join(srv.base, h.inviteCode.toLowerCase(), placeholder, [
        rec('members', placeholder, 2000, { name: 'Ben', color: '#22c55e', claimed: true }),
      ]);
      assert.equal(res.status, 200);
      assert.equal(res.body.householdId, h.householdId);
      assert.equal(res.body.memberId, placeholder);
      assert.match(res.body.token, /^[A-Za-z0-9_-]{43}$/);
      assert.equal(res.body.cursor, 0);

      // The new device can pull everything, including its own claim.
      const pulled = await pullAll(srv.base, { householdId: h.householdId, token: res.body.token });
      assert.equal(pulled.changes.find((c) => c.id === placeholder)?.data.claimed, true);

      const preview = await request(srv.base, 'GET', `/api/invites/${h.inviteCode}`);
      assert.equal(preview.body.members.find((m: { id: string }) => m.id === placeholder).claimed, true);

      const again = await join(srv.base, h.inviteCode, placeholder);
      assert.equal(again.status, 409);
      assert.equal(again.body.error, 'member_claimed');

      const creator = await join(srv.base, h.inviteCode, h.memberId);
      assert.equal(creator.status, 409);
      assert.equal(creator.body.error, 'member_claimed');
    });

    it('lets a device join as a new member', async () => {
      const h = await createHousehold(srv.base);
      const newbie = uid('m');
      const res = await join(srv.base, h.inviteCode, newbie, [rec('members', newbie, 3000, { name: 'Eve', color: '#000' })]);
      assert.equal(res.status, 200);
      const preview = await request(srv.base, 'GET', `/api/invites/${h.inviteCode}`);
      assert.deepEqual(
        preview.body.members.map((m: { id: string; claimed: boolean }) => [m.id, m.claimed]),
        [
          [h.memberId, true],
          [newbie, true],
        ],
      );
    });

    it('validates join requests', async () => {
      const h = await createHousehold(srv.base);
      const badMember = await join(srv.base, h.inviteCode, 'x');
      assert.equal(badMember.status, 400);
      const foreignHousehold = await join(srv.base, h.inviteCode, uid('m'), [rec('household', uid('h'), 1)]);
      assert.equal(foreignHousehold.status, 400);
    });

    it('rotating the invite code invalidates the old one', async () => {
      const h = await createHousehold(srv.base);
      const current = await request(srv.base, 'GET', `/api/households/${h.householdId}/invite`, { token: h.token });
      assert.equal(current.status, 200);
      assert.equal(current.body.inviteCode, h.inviteCode);

      const rotated = await request(srv.base, 'POST', `/api/households/${h.householdId}/invite`, { token: h.token });
      assert.equal(rotated.status, 200);
      assert.match(rotated.body.inviteCode, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
      assert.notEqual(rotated.body.inviteCode, h.inviteCode);

      const after = await request(srv.base, 'GET', `/api/households/${h.householdId}/invite`, { token: h.token });
      assert.equal(after.body.inviteCode, rotated.body.inviteCode);
      assert.equal((await request(srv.base, 'GET', `/api/invites/${h.inviteCode}`)).status, 404);
      assert.equal((await join(srv.base, h.inviteCode, uid('m'))).status, 404);
      assert.equal((await request(srv.base, 'GET', `/api/invites/${rotated.body.inviteCode}`)).status, 200);
    });
  });

  describe('auth', () => {
    it('requires a valid token for this household', async () => {
      const a = await createHousehold(srv.base);
      const b = await createHousehold(srv.base);
      const paths: Array<[string, string]> = [
        ['GET', `/api/households/${a.householdId}/sync`],
        ['POST', `/api/households/${a.householdId}/sync`],
        ['GET', `/api/households/${a.householdId}/invite`],
        ['POST', `/api/households/${a.householdId}/invite`],
        ['POST', `/api/households/${a.householdId}/leave`],
        ['GET', `/api/households/${a.householdId}/events`],
      ];
      for (const [method, url] of paths) {
        for (const token of [undefined, 'not-a-real-token', b.token]) {
          const res = await request(srv.base, method, url, { token });
          assert.equal(res.status, 401, `${method} ${url} with ${token ? 'bad' : 'no'} token`);
          assert.equal(res.body.error, 'unauthorized');
        }
      }
      // Query tokens are only accepted on the SSE endpoint.
      const viaQuery = await request(srv.base, 'GET', `/api/households/${a.householdId}/sync?token=${a.token}`);
      assert.equal(viaQuery.status, 401);
      // And the real token still works.
      assert.equal((await request(srv.base, 'GET', `/api/households/${a.householdId}/sync`, { token: a.token })).status, 200);
    });

    it('leaving revokes the token and frees the member', async () => {
      const h = await createHousehold(srv.base);
      const res = await request(srv.base, 'POST', `/api/households/${h.householdId}/leave`, { token: h.token });
      assert.equal(res.status, 200);
      assert.deepEqual(res.body, { ok: true });

      const after = await request(srv.base, 'GET', `/api/households/${h.householdId}/sync`, { token: h.token });
      assert.equal(after.status, 401);

      const preview = await request(srv.base, 'GET', `/api/invites/${h.inviteCode}`);
      assert.equal(preview.body.members[0].claimed, false);
      // A new device may take over the member.
      assert.equal((await join(srv.base, h.inviteCode, h.memberId)).status, 200);
    });
  });

  describe('sync', () => {
    it('pushes and pulls with cursor paging', async () => {
      const h = await createHousehold(srv.base);
      const notes = Array.from({ length: 1500 }, (_, i) => rec('notes', `note_${i}`, 5000 + i, { text: `#${i}` }));
      const pushed = await push(srv.base, h, notes, h.cursor);
      assert.equal(pushed.status, 200);
      assert.equal(pushed.body.changes.length, 1000);
      assert.equal(pushed.body.more, true);
      assert.equal(pushed.body.changes[0].seq, 3);

      const first = await request(srv.base, 'GET', `/api/households/${h.householdId}/sync?since=0`, { token: h.token });
      assert.equal(first.body.changes.length, 1000);
      assert.equal(first.body.more, true);
      assert.equal(first.body.cursor, 1000);

      const second = await request(srv.base, 'GET', `/api/households/${h.householdId}/sync?since=${first.body.cursor}`, {
        token: h.token,
      });
      assert.equal(second.body.changes.length, 502);
      assert.equal(second.body.more, false);
      assert.equal(second.body.cursor, 1502);

      const all = [...first.body.changes, ...second.body.changes] as Change[];
      assert.deepEqual(
        all.map((c) => c.seq),
        Array.from({ length: 1502 }, (_, i) => i + 1),
      );
      assert.equal(new Set(all.map((c) => `${c.c}/${c.id}`)).size, 1502);
      const sample = all.find((c) => c.id === 'note_42')!;
      assert.deepEqual(sample, { ...notes[42], seq: 45 });

      // Caught up: empty page, cursor stays at the head.
      const empty = await request(srv.base, 'GET', `/api/households/${h.householdId}/sync?since=1502`, { token: h.token });
      assert.deepEqual(empty.body, { changes: [], cursor: 1502, more: false });

      // Missing `since` means 0.
      const noSince = await request(srv.base, 'GET', `/api/households/${h.householdId}/sync`, { token: h.token });
      assert.equal(noSince.body.changes[0].seq, 1);
    });

    it('validates since and rejects the whole push on any invalid change', async () => {
      const h = await createHousehold(srv.base);
      for (const since of ['-1', 'abc', '1.5']) {
        const res = await request(srv.base, 'GET', `/api/households/${h.householdId}/sync?since=${since}`, { token: h.token });
        assert.equal(res.status, 400, since);
      }
      const badSince = await request(srv.base, 'POST', `/api/households/${h.householdId}/sync`, {
        token: h.token,
        body: { since: '3', changes: [] },
      });
      assert.equal(badSince.status, 400);

      const mixed = await push(srv.base, h, [rec('notes', 'good', 1), { ...rec('notes', 'bad', 1), c: 'nope' as CollectionName }]);
      assert.equal(mixed.status, 400);
      const pulled = await pullAll(srv.base, h);
      assert.equal(pulled.changes.some((c) => c.id === 'good'), false);
      assert.equal(pulled.cursor, 2);

      const foreignHousehold = await push(srv.base, h, [rec('household', uid('h'), 1)]);
      assert.equal(foreignHousehold.status, 400);
    });

    it('resolves conflicts with last-write-wins', async () => {
      const h = await createHousehold(srv.base);
      await push(srv.base, h, [rec('expenses', 'e1', 200, { title: 'new' })]);
      const { cursor } = await pullAll(srv.base, h);

      // Older write is ignored and does not advance the cursor.
      const older = await push(srv.base, h, [rec('expenses', 'e1', 100, { title: 'old' })], cursor);
      assert.deepEqual(older.body, { changes: [], cursor, more: false });

      // Newer write wins.
      const newer = await push(srv.base, h, [rec('expenses', 'e1', 300, { title: 'newest' })], cursor);
      assert.equal(newer.body.changes.length, 1);
      assert.equal(newer.body.changes[0].data.title, 'newest');
      assert.equal(newer.body.changes[0].seq, cursor + 1);

      const final = await pullAll(srv.base, h);
      assert.equal(final.changes.filter((c) => c.id === 'e1').length, 1);
      assert.equal(final.changes.find((c) => c.id === 'e1')?.data.title, 'newest');
    });

    it('breaks equal-clock ties deterministically regardless of arrival order', async () => {
      const versions = ['b', 'a', 'c'].map((title) => rec('notes', 'tie', 500, { title }));
      const finalTitles: unknown[] = [];
      for (const order of [versions, [...versions].reverse()]) {
        const h = await createHousehold(srv.base);
        for (const change of order) await push(srv.base, h, [change]);
        const { changes } = await pullAll(srv.base, h);
        finalTitles.push(changes.find((c) => c.id === 'tie')?.data.title);
      }
      // '{"id":"tie",…,"title":"c"}' is the greatest JSON string.
      assert.deepEqual(finalTitles, ['c', 'c']);

      // Within one request, duplicates are applied in order with the same rule.
      const h = await createHousehold(srv.base);
      await push(srv.base, h, versions);
      const { changes } = await pullAll(srv.base, h);
      assert.equal(changes.find((c) => c.id === 'tie')?.data.title, 'c');
    });

    it('replicates tombstones', async () => {
      const h = await createHousehold(srv.base);
      const other = uid('m');
      const joined = await join(srv.base, h.inviteCode, other);
      const b = { householdId: h.householdId, token: joined.body.token as string };

      await push(srv.base, h, [rec('items', 'milk', 100, { name: 'Milk', listId: 'l1', checked: false })]);
      const { cursor } = await pullAll(srv.base, b);

      await push(srv.base, h, [rec('items', 'milk', 200, { name: 'Milk', listId: 'l1', checked: false, deleted: true })]);
      const delta = await pullAll(srv.base, b, cursor);
      assert.equal(delta.changes.length, 1);
      assert.equal(delta.changes[0].id, 'milk');
      assert.equal(delta.changes[0].data.deleted, true);

      // A stale edit cannot resurrect the record.
      await push(srv.base, b, [rec('items', 'milk', 150, { name: 'Milk', listId: 'l1', checked: true })]);
      const final = await pullAll(srv.base, b);
      assert.equal(final.changes.find((c) => c.id === 'milk')?.data.deleted, true);
    });

    it('stores clocks beyond Number.MAX_SAFE_INTEGER without breaking pulls', async () => {
      const h = await createHousehold(srv.base);
      const res = await push(srv.base, h, [rec('notes', 'far', 2 ** 60)]);
      assert.equal(res.status, 200);
      assert.equal(res.body.changes.find((c: Change) => c.id === 'far').u, 2 ** 60);
    });
  });

  describe('server-sent events', () => {
    it('sends hello, then sync when another member pushes', { timeout: 5000 }, async () => {
      const h = await createHousehold(srv.base);
      const other = uid('m');
      const joined = await join(srv.base, h.inviteCode, other);
      const b = { householdId: h.householdId, token: joined.body.token as string };

      const events = await openEvents(srv.base, h.householdId, h.token);
      try {
        assert.equal(events.res.status, 200);
        assert.match(events.res.headers.get('content-type') ?? '', /^text\/event-stream/);
        const hello = await events.next('hello');
        assert.deepEqual(hello?.data, { cursor: h.cursor, memberId: h.memberId });

        const pushed = await push(srv.base, b, [rec('chores', 'trash', 100, { title: 'Trash' })]);
        const sync = await events.next('sync');
        assert.deepEqual(sync?.data, { cursor: pushed.body.cursor, by: other });
      } finally {
        events.close();
      }
    });

    it('does not broadcast when nothing was accepted, and ends the stream on leave', { timeout: 5000 }, async () => {
      const h = await createHousehold(srv.base);
      const events = await openEvents(srv.base, h.householdId, h.token);
      try {
        await events.next('hello');
        // Re-pushing identical data is a no-op (equal u, equal JSON).
        await push(srv.base, h, [rec('household', h.householdId, 1000, { name: 'Sonnenallee 12', emoji: '🏡', currency: 'EUR' })]);
        await request(srv.base, 'POST', `/api/households/${h.householdId}/leave`, { token: h.token });
        // The stream ends without ever carrying a sync event.
        assert.equal(await events.next('sync'), null);
      } finally {
        events.close();
      }
    });
  });
});

describe('rate limiting', () => {
  it('limits invite lookups to 30 per minute per IP', async () => {
    const srv = await start({ rateLimit: true });
    try {
      for (let i = 0; i < 30; i++) {
        assert.equal((await request(srv.base, 'GET', '/api/invites/AAAAAA')).status, 404);
      }
      const limited = await request(srv.base, 'GET', '/api/invites/AAAAAA');
      assert.equal(limited.status, 429);
      assert.equal(limited.body.error, 'rate_limited');
      assert.ok(Number(limited.headers.get('retry-after')) > 0);
      // Joining shares the invite budget; other endpoints are unaffected.
      assert.equal((await join(srv.base, 'AAAAAA', uid('m'))).status, 429);
      assert.equal((await request(srv.base, 'GET', '/api/health')).status, 200);
    } finally {
      await srv.close();
    }
  });

  it('limits all API requests to 300 per minute per IP', async () => {
    const srv = await start({ rateLimit: true });
    try {
      for (let i = 0; i < 300; i++) {
        const res = await request(srv.base, 'GET', '/api/health');
        assert.equal(res.status, 200, `request ${i + 1}`);
      }
      assert.equal((await request(srv.base, 'GET', '/api/health')).status, 429);
    } finally {
      await srv.close();
    }
  });

  it('keys clients by X-Forwarded-For when trustProxy is on', async () => {
    const srv = await start({ rateLimit: true, trustProxy: true });
    try {
      const from = (ip: string) => ({ headers: { 'x-forwarded-for': `${ip}, 10.0.0.1` } });
      for (let i = 0; i < 30; i++) await request(srv.base, 'GET', '/api/invites/AAAAAA', from('203.0.113.7'));
      assert.equal((await request(srv.base, 'GET', '/api/invites/AAAAAA', from('203.0.113.7'))).status, 429);
      assert.equal((await request(srv.base, 'GET', '/api/invites/AAAAAA', from('198.51.100.2'))).status, 404);
    } finally {
      await srv.close();
    }
  });
});

describe('static file serving', () => {
  let srv: Running;
  let tmp: string;

  before(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nestly-static-'));
    const root = path.join(tmp, 'dist');
    fs.mkdirSync(path.join(root, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><title>Nestly</title>');
    fs.writeFileSync(path.join(root, 'sw.js'), 'self.addEventListener("fetch", () => {});');
    fs.writeFileSync(path.join(root, 'manifest.webmanifest'), '{"name":"Nestly"}');
    fs.writeFileSync(path.join(root, 'assets', 'app.js'), 'console.log("hi");');
    fs.writeFileSync(path.join(root, 'assets', 'app.css'), 'body{}');
    fs.writeFileSync(path.join(root, 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    fs.writeFileSync(path.join(tmp, 'secret.txt'), 'TOP SECRET');
    srv = await start({ staticDir: root });
  });

  after(async () => {
    await srv.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('serves files with content types, caching and security headers', async () => {
    const expectations: Array<[string, RegExp]> = [
      ['/', /^text\/html/],
      ['/index.html', /^text\/html/],
      ['/assets/app.js', /^text\/javascript/],
      ['/assets/app.css', /^text\/css/],
      ['/manifest.webmanifest', /^application\/manifest\+json/],
      ['/icon.svg', /^image\/svg\+xml/],
      ['/sw.js', /^text\/javascript/],
    ];
    for (const [url, type] of expectations) {
      const res = await fetch(srv.base + url);
      assert.equal(res.status, 200, url);
      assert.match(res.headers.get('content-type') ?? '', type, url);
      assert.equal(res.headers.get('cache-control'), 'no-cache', url);
      assert.ok(res.headers.get('etag'), url);
      assert.equal(res.headers.get('x-content-type-options'), 'nosniff', url);
      assert.equal(res.headers.get('referrer-policy'), 'strict-origin-when-cross-origin', url);
      await res.arrayBuffer();
    }
    const sw = await fetch(`${srv.base}/sw.js`);
    assert.equal(sw.headers.get('service-worker-allowed'), '/');
    assert.equal(await sw.text(), 'self.addEventListener("fetch", () => {});');

    const head = await fetch(`${srv.base}/assets/app.js`, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get('content-length'), String('console.log("hi");'.length));
  });

  it('answers If-None-Match with 304', async () => {
    const first = await fetch(`${srv.base}/assets/app.js`);
    const etag = first.headers.get('etag')!;
    await first.text();
    const second = await fetch(`${srv.base}/assets/app.js`, { headers: { 'if-none-match': etag } });
    assert.equal(second.status, 304);
    assert.equal(second.headers.get('etag'), etag);
    assert.equal(await second.text(), '');

    const stale = await fetch(`${srv.base}/assets/app.js`, { headers: { 'if-none-match': 'W/"nope"' } });
    assert.equal(stale.status, 200);
    await stale.text();
  });

  it('falls back to index.html for app routes but not for missing files', async () => {
    const route = await fetch(`${srv.base}/expenses/abc123`);
    assert.equal(route.status, 200);
    assert.match(await route.text(), /<title>Nestly<\/title>/);

    const missing = await fetch(`${srv.base}/assets/missing.png`);
    assert.equal(missing.status, 404);
    await missing.text();

    // API paths never fall back to the app shell.
    const api = await request(srv.base, 'GET', '/api/does-not-exist');
    assert.equal(api.status, 404);
    assert.equal(api.body.error, 'not_found');
  });

  it('does not serve files outside the static directory', async () => {
    // fetch normalises `..` itself, so send raw paths with node:http.
    const raw = (urlPath: string) =>
      new Promise<{ status: number; body: string }>((resolve, reject) => {
        http
          .get({ host: '127.0.0.1', port: srv.port, path: urlPath }, (res) => {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', (chunk: string) => (body += chunk));
            res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
          })
          .on('error', reject);
      });
    for (const urlPath of ['/../secret.txt', '/..%2fsecret.txt', '/%2e%2e%2fsecret.txt', '/assets/..%2f..%2fsecret.txt', '/..\\secret.txt']) {
      const res = await raw(urlPath);
      assert.doesNotMatch(res.body, /TOP SECRET/, urlPath);
      assert.notEqual(res.status, 200, urlPath);
    }
    // Directory-style traversal without an extension must not escape either.
    const dir = await raw('/..%2f');
    assert.doesNotMatch(dir.body, /TOP SECRET/);
  });
});
