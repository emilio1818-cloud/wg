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
| POST | `/api/households/:id/release` | ✓ | Sign out all devices of another member (`{ memberId }`) |
| GET | `/api/push/key` | – | VAPID public key for Web Push |
| POST | `/api/households/:id/push` | ✓ | Register this device's push subscription |
| DELETE | `/api/households/:id/push` | ✓ | Remove a push subscription (`{ endpoint }`) |

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
its event streams are closed, its push subscriptions are deleted and the member
becomes unclaimed again. `POST …/release` (`{ memberId }`, not your own) →
`200 { ok: true, revoked }` does the same for every device of that member.

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

## Push notifications

The server sends [Web Push](https://www.rfc-editor.org/rfc/rfc8030) messages
itself (VAPID, RFC 8292; `aes128gcm` payload encryption, RFC 8291/8188) — no
third-party service besides the browsers' push services is involved.

### Keys

`GET /api/push/key` → `200 { publicKey }`: the server's VAPID public key as
base64url (no padding) of the 65-byte uncompressed P-256 point. Pass it (decoded
to bytes) as `applicationServerKey` to `pushManager.subscribe()`. The key is stable
for a server: it comes from `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`, or is generated
on first start and stored in the database. If it ever differs from the key of an
existing browser subscription, unsubscribe and subscribe again.

### Subscribing

`POST /api/households/:id/push` with the JSON form of the `PushSubscription`
(`subscription.toJSON()`) and the UI language:

```json
{
  "subscription": {
    "endpoint": "https://fcm.googleapis.com/fcm/send/…",
    "expirationTime": null,
    "keys": { "p256dh": "BNc…", "auth": "tBH…" }
  },
  "lang": "de"
}
```

* `endpoint` must be an `https://` URL (≤ 2048 chars; plain `http://` only for
  `127.0.0.1`/`localhost`, for development).
* `keys.p256dh` is base64url of a 65-byte P-256 point, `keys.auth` base64url of
  16 bytes (padding optional).
* `lang` is `de` (default) or `en` (anything starting with `en`).

→ `200 { ok: true }`, `400` for invalid input. The subscription is bound to the
authenticated device token and member; re-posting the same endpoint (e.g. on every
app start or after a language change) updates it in place. An endpoint can belong
to one household/member at a time — posting it again moves it.

`DELETE /api/households/:id/push` with `{ "endpoint": "…" }` → `200 { ok: true }`
removes it (idempotent). Subscriptions are also deleted when the device leaves,
its member is released, or the push service answers `404`/`410`.

### Messages

The decrypted payload is JSON for the service worker:

```json
{ "title": "🏡 Sonnenallee 12", "body": "Lena hat „Pizza“ eingetragen · 24,90 €", "tag": "act-expense_added-m_lena", "url": "./#/money?tab=history" }
```

`title` is the household emoji + name; `tag` groups notifications (a newer one with
the same tag replaces the older); `url` is the app route to open on click.

**Activity.** When a sync (or join) request creates a new `activity` record whose
`createdAt` is less than 10 minutes old, every subscription of the household is
notified except those of the activity's `actorId` and of the pushing member (at
most 10 activities per request; edits of existing activity records never notify).
Texts are composed server-side in the subscription's language from the `members`
names and the `household` currency:

| `type` | German body | `url` |
| --- | --- | --- |
| `expense_added` | Lena hat „Pizza“ eingetragen · 24,90 € | `./#/money?tab=history` |
| `transfer_added` | Jonas hat dir 20,00 € gezahlt (recipient = `targetId`), else Jonas hat Lena 20,00 € gezahlt | `./#/money?tab=history` |
| `chore_done` | Lena hat „Staubsaugen“ erledigt 🧹 | `./#/chores` |
| `items_added` | Lena braucht „Kaffee“ (count 1), else Lena hat 3 Artikel auf die Liste gesetzt | `./#/shopping` |
| `items_bought` | Lena war einkaufen (5 Artikel) · 23,10 € | `./#/shopping` |
| `event_added` | Lena hat „WG-Party“ in den Kalender eingetragen | `./#/wg/calendar` |
| `note_added` | Lena hat etwas an die Pinnwand gehängt | `./#/wg/board` |
| `contract_added` | Lena hat den Vertrag „Strom“ angelegt | `./#/wg/contracts` |
| `member_joined` | Lena ist der WG beigetreten 👋 | `./#/activity` |

Other types (`expense_edited`, `chore_added`, `member_added`, `member_left`,
`recurring_booked`) do not notify. Tag: `act-<type>-<actorId>`; TTL 24 h.

**Daily reminder.** Every 10 minutes the server checks each subscription against
the household's local time (`household.timezone`, an IANA zone; default
`Europe/Berlin`). From 09:00 local time, once per subscription and local day, it
collects for that member:

* chores that are not paused/deleted, due today or overdue (`dueDate <= today`),
  and assigned to the member — or open (`rotation: "anyone"` or no `assigneeId`,
  and the member is in `memberIds` if that is non-empty). Skipped while the member
  is away (`awayFrom`/`awayUntil` or an `away` calendar event).
* contracts whose cancellation deadline (`contractStatus`) is 0–3 days away.

If anything is due, one message is sent (tag `reminder`, `Topic: reminder`,
TTL 12 h, `url` `./#/chores`, or `./#/wg/contracts` for deadlines only):

```
Heute dran: Bad putzen, Müll rausbringen
Kündigungsfrist Strom in 2 Tagen
```

(English: `Today: Clean the bathroom, …` / `Cancellation deadline for Power in
2 days`.) The day counts as done after the first check past 09:00 even if nothing
was due, so a member gets at most one reminder per device and day. Members who
moved out (`leftAt`) or were deleted get none.

### Server configuration

| Env var | Meaning |
| --- | --- |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Key pair, base64url: 65-byte uncompressed public point / 32-byte private scalar (the format `web-push generate-vapid-keys` prints). Set both or neither; default: generated and stored in the DB `meta` table. |
| `VAPID_SUBJECT` | Contact sent to push services in the JWT `sub` claim (default `mailto:push@nestly.app`). |
| `REMINDERS` | `0` disables the daily reminders. |
| `PUSH_ALLOW_ANY_HOST` | `1` accepts endpoints on any https host. By default only the browser push services (`*.googleapis.com`, `*.push.services.mozilla.com`, `*.push.apple.com`, `*.notify.windows.com`) and loopback addresses are accepted. |

Changing the key pair invalidates all existing browser subscriptions; clients
detect the new key via `GET /api/push/key` and re-subscribe.

## Errors

`{ "error": "<code>", "message"?: "..." }` with codes `bad_request`,
`unauthorized`, `not_found`, `conflict`, `member_claimed`, `too_large`,
`rate_limited` (429).
