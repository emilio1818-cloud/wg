# Architecture

```
┌────────────────────────────── Device (PWA / Capacitor) ─────────────────────────────┐
│  UI (TSX screens, components)                                                       │
│     │ reads selectors / calls actions                                               │
│  state/actions.ts ──► state/store.ts (all records + tombstones, dirty set) ──► IndexedDB│
│     │ domain rules                    │ onLocalWrite                                │
│  core/ (pure TS: splits, balances,    ▼                                             │
│  recurrence, chores, contracts)    state/sync.ts ── POST /sync (push+pull) ─┐       │
│                                      ▲  EventSource /events (realtime) ◄────┤       │
└──────────────────────────────────────┼──────────────────────────────────────┼───────┘
                                       │                                      │
                               ┌───────┴──────── Sync server (Node) ──────────┴──┐
                               │ node:http  ·  node:sqlite  ·  no dependencies    │
                               │ households · memberships (token hashes) · records│
                               └──────────────────────────────────────────────────┘
```

## Repository layout

| Path | What |
| --- | --- |
| `core/` | Domain model and pure business logic shared by app and server. No DOM, no Node APIs. Unit-tested with `node:test`. |
| `server/` | Sync server: invites, token auth, last-write-wins record store, server-sent events, static hosting of the web app. |
| `app/` | The client: a PWA written in TypeScript/TSX. |
| `app/src/lib/` | Framework-level code: `ui.ts` (VDOM + hooks), `router.ts` (hash router + sheet stack), `idb.ts`, `qr.ts`, `icons.ts`. |
| `app/src/state/` | Local store, sync engine, actions, selectors, preferences, demo data. |
| `app/src/screens/`, `components/` | UI. |
| `scripts/` | Build (tsc → native ES modules, service worker, manifest) and icon generation. |
| `tests/e2e/` | Playwright tests running two real devices against a real server. |

## Why no framework?

The project was built in an environment where the npm registry was unreachable, so it
has **zero runtime dependencies**. `app/src/lib/ui.ts` is a ~400-line virtual DOM with
function components and hooks whose API matches Preact (`h`, `Fragment`, `render`,
`useState`, `useEffect`, `useMemo`, `useRef`, …). Moving to Preact (+ Vite) later is a
search-and-replace of one import path. Everything is compiled by `tsc` alone; browsers load
the output as native ES modules (with `modulepreload` hints and a service worker cache).

The upside: the whole app is ~45 small modules, starts instantly, works offline, and has
no supply-chain surface.

## Data model

Every record is an entity (`core/src/types.ts`) with `id`, `createdAt`, `updatedAt` and an
optional `deleted` tombstone. Money is stored as integer cents. Collections:

`household, members, expenses, recurring, chores, choreLogs, lists, items, contracts,
events, notes, activity`

Notable modelling choices:

* **Transfers are expenses** (`kind: 'transfer'`, paid by the sender, split exactly to the
  recipient), so balances need one formula.
* **Recurring bookings use deterministic ids** (`rec_<recurringId>_<date>`), so two devices
  booking the same rent never create duplicates – they converge on the same record.
* **Chore completions are append-only logs**; the chore itself only stores the next due date
  and assignee. Points, leaderboard, streaks and fairness are derived.
* **Placeholder members** (`claimed: false`) let a flat start before everyone installs the
  app; joining with an invite claims the profile.

## Offline-first sync

1. Every local write goes to the in-memory store, is persisted to IndexedDB and marked dirty.
2. The sync engine pushes dirty records and pulls everything newer than its cursor in a
   single `POST /api/households/:id/sync` round trip (paged, 1000 records per page).
3. Conflicts are resolved per record with **last-write-wins** on `updatedAt` (monotonic
   per device, deterministic tie-break). For a flatshare this is the right trade-off: edits
   to the *same* record at the *same* time are rare, and everything else merges naturally.
4. The server broadcasts a `sync` server-sent event to the household; other devices pull
   immediately. On network loss the engine backs off exponentially and retries; the app
   stays fully usable.

Full protocol: [`SYNC_PROTOCOL.md`](SYNC_PROTOCOL.md).

## Security & privacy

* No accounts: joining yields a random 256-bit bearer token per device; the server stores
  only its SHA-256 hash. Invite codes are 6 characters from a 32-symbol alphabet (~10⁹
  combinations) and rate-limited (30 lookups/min/IP). Codes can be rotated at any time.
* A member can sign out a lost device of another member (`/release`); the profile can then
  be re-claimed with the invite code.
* The server is a dumb record store: it never interprets domain data, which keeps the
  attack surface small and makes end-to-end encryption a natural next step.
* No third-party requests: no fonts, analytics or CDNs. The only outbound links are
  user-initiated (PayPal.me, WhatsApp, mailto).

## Testing

| Layer | Tool | Command |
| --- | --- | --- |
| Domain logic | `node:test` | `npm test` |
| QR encoder | `node:test` + independent decoder | `npm test` |
| Sync server | `node:test` + `fetch` against a real server | `npm test` |
| Whole product | Playwright, two browser contexts + real server | `npm run test:e2e` |

The end-to-end suite creates a flat, joins from a second device via invite link, and checks
that expenses, settlements, shopping items (including ones added offline) and chore points
propagate in real time.
