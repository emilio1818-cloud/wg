# Nestly Sync Protocol (v1)

Nestly is **offline-first**. Every device keeps the full data set of its household
locally and replicates changes through a tiny sync server. The server is a dumb,
generic record store — all domain logic lives in the clients (`core/`).

## Model

* A household's data is a set of **records** `(collection, id) → data`.
* Collections: `household, members, expenses, recurring, chores, choreLogs, lists,
  items, contracts, events, notes, activity` (see `core/src/types.ts`).
* Every record carries an `updatedAt` clock `u` (ms). Conflicts are resolved with
  **last-write-wins**: an incoming change replaces the stored record if
  `incoming.u > stored.u`, or if `incoming.u === stored.u` and
  `JSON.stringify(incoming.data) > stored data string` (deterministic tie-break).
* Deletions are tombstones: `data.deleted === true`. Records are never hard-deleted.
* Each accepted write gets a per-household, strictly increasing sequence number
  `seq`. Clients pull "everything with `seq > cursor`".
* Deterministic IDs make concurrent derived writes idempotent (e.g. recurring
  bookings use `rec_<recurringId>_<date>`).

### Change object

```json
{ "c": "expenses", "id": "k3j2...", "u": 1730000000000, "data": { "id": "k3j2...", "...": "..." }, "seq": 42 }
```

`seq` is only present on changes sent by the server.

Validation rules (server rejects the whole request with `400` otherwise):

* `c` is one of the collections above.
* `id` matches `^[A-Za-z0-9_:.\-]{1,128}$` and equals `data.id`.
* `u` is a finite, positive number.
* `data` is a plain JSON object, serialised size ≤ 64 KiB.
* For `c === "household"`, `id` must equal the household id.
* At most 2000 changes per request, request body ≤ 4 MiB.

## Auth

Joining a household yields a random **bearer token** (stored server-side only as a
SHA-256 hash). Send it as `Authorization: Bearer <token>`. The SSE endpoint takes
`?token=` because `EventSource` cannot set headers.

## Endpoints

All bodies are JSON. CORS is open (`*`); no cookies are used.

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/api/health` | – | `{ ok: true, version }` |
| POST | `/api/households` | – | Create household |
| GET | `/api/invites/:code` | – | Preview household for an invite code |
| POST | `/api/invites/:code/join` | – | Join household |
| GET | `/api/households/:id/sync?since=N` | ✓ | Pull changes |
| POST | `/api/households/:id/sync` | ✓ | Push + pull in one round trip |
| GET | `/api/households/:id/events?token=T` | ✓ | Server-sent events |
| GET | `/api/households/:id/invite` | ✓ | Current invite code |
| POST | `/api/households/:id/invite` | ✓ | Rotate invite code |
| POST | `/api/households/:id/leave` | ✓ | Revoke this device's token |

### `POST /api/households`

```json
{ "householdId": "h_abc12345", "memberId": "m_abc12345", "changes": [ ... ] }
```

`householdId` / `memberId` match `^[A-Za-z0-9_\-]{8,64}$`. `changes` must contain
the `household` record. → `201 { token, inviteCode, cursor }`; `409` if the id exists.

### `GET /api/invites/:code`

Codes are 6 characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, case-insensitive;
spaces and dashes are ignored. →
`200 { householdId, name, emoji, members: [{ id, name, emoji, color, claimed }] }`
(members that are deleted or have `leftAt` are omitted; `claimed` = an active
token exists for that member id). `404` for unknown codes.

### `POST /api/invites/:code/join`

```json
{ "memberId": "m_xyz98765", "changes": [ { "c": "members", "id": "m_xyz98765", ... } ] }
```

`memberId` is either an unclaimed placeholder member or a new id. `409
{ error: "member_claimed" }` if another device already holds that member.
→ `200 { householdId, memberId, token, cursor }`.

In both responses `cursor` is the `since` to use for the device's next pull: the
household head after creating (the creator already holds all data) and `0` after
joining (the new device has no data yet and must pull everything).

### Invite & leave

`GET` / `POST …/invite` → `200 { inviteCode }` (POST replaces the code; the old
one stops working). `POST …/leave` → `200 { ok: true }`; the token is revoked,
its event streams are closed and the member becomes unclaimed again.

### Sync

`POST /api/households/:id/sync` with `{ since, changes }` applies `changes` (LWW)
and returns `{ changes, cursor, more }`: all records with `seq > since`, ordered by
`seq`, at most 1000 per page. While `more` is true the client pulls again with the
returned `cursor`. `GET …/sync?since=N` is the same without pushing.

Every request that accepted at least one change broadcasts
`event: sync` / `data: {"cursor":N,"by":"<memberId>"}` to all SSE listeners of
the household. The SSE stream starts with `event: hello` /
`data: {"cursor":N,"memberId":"<memberId>"}` and sends a comment heartbeat every
25 s.

## Errors

`{ "error": "<code>", "message"?: "..." }` with codes `bad_request`,
`unauthorized`, `not_found`, `conflict`, `member_claimed`, `too_large`,
`rate_limited` (429).
